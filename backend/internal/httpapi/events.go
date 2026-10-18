package httpapi

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/store"
)

// Per-event result values beyond the store's stored, identical and conflict.
const (
	resultInvalid  = "invalid"  // 422: the envelope or its indexed text failed a check
	resultUnlinked = "unlinked" // 409 source_not_linked: an import event from another device profile
)

// eventResult is one event's outcome in a batch response or an import report.
type eventResult struct {
	Index            int       `json:"index"`
	EventID          string    `json:"event_id,omitempty"`
	Result           string    `json:"result"`
	Status           int       `json:"status"`
	Code             string    `json:"code,omitempty"`
	Detail           string    `json:"detail,omitempty"`
	Seq              int64     `json:"seq,omitempty"`
	ReceivedAt       string    `json:"received_at,omitempty"`
	SemanticSHA256   string    `json:"semantic_sha256,omitempty"`
	StoredSHA256     string    `json:"stored_sha256,omitempty"`
	ReceivedSHA256   string    `json:"received_sha256,omitempty"`
	CurriculumStatus string    `json:"curriculum_status,omitempty"`
	ClockFlags       *[]string `json:"clock_flags,omitempty"`
}

type batchDoc struct {
	Results []eventResult `json:"results"`
	HighSeq int64         `json:"high_seq"`
}

// postEvents serves POST /v1/profiles/{pid}/events (contract §6): the profile first (404), then the
// batch shape, then each event's checks before the database, then one transaction under the profile row
// lock. Results come back in request order.
func (h *handler) postEvents(w http.ResponseWriter, r *http.Request, c *call) {
	if !h.ownedProfile(w, r, c) {
		return
	}
	envs, p := batchEnvelopes(c.body)
	if p != nil {
		writeProblem(w, p)
		return
	}
	received := time.Now()
	results := make([]eventResult, len(envs))
	var valid []store.PendingEvent
	var positions []int
	for i, raw := range envs {
		ev, failure := h.checkEnvelope(i, raw, received)
		if failure != nil {
			results[i] = *failure
			continue
		}
		valid = append(valid, ev)
		positions = append(positions, i)
	}
	res, err := h.store.Ingest(r.Context(), store.IngestInput{AccountID: c.accountID, ProfileID: c.profileID, Events: valid, BeforeCommit: h.beforeCommit})
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeNotFound(w)
		return
	case errors.Is(err, store.ErrSourceNotLinked):
		writeProblem(w, newProblem(http.StatusConflict, codeSourceNotLinked, "an event comes from a device profile that is not linked to this profile; nothing was stored"))
		return
	case err != nil:
		h.internal(w, "ingest events", err)
		return
	}
	for j, o := range res.Outcomes {
		results[positions[j]] = outcomeResult(positions[j], valid[j], o)
	}
	writeJSON(w, http.StatusOK, batchDoc{Results: results, HighSeq: res.HighSeq})
}

// outcomeResult reports a persisted event. Stored and identical results describe the stored copy, the
// first one accepted; a conflict gives both hashes and leaves the stored copy untouched.
func outcomeResult(index int, pe store.PendingEvent, o store.EventOutcome) eventResult {
	r := eventResult{Index: index, EventID: pe.Event.EventID, Result: o.Result, Seq: o.Seq}
	if o.Result == store.ResultConflict {
		r.Status, r.Code, r.Detail = http.StatusConflict, codeEventConflict, "an event with this ID and other content is already stored"
		r.StoredSHA256 = hex.EncodeToString(o.StoredSHA256[:])
		r.ReceivedSHA256 = hex.EncodeToString(pe.Event.SemanticSHA256[:])
		return r
	}
	r.Status = http.StatusOK
	if o.Result == store.ResultStored {
		r.Status = http.StatusCreated
	}
	flags := o.ClockFlags
	r.ReceivedAt = store.FormatTime(o.ReceivedAt)
	r.SemanticSHA256 = hex.EncodeToString(o.StoredSHA256[:])
	r.CurriculumStatus = o.CurriculumStatus
	r.ClockFlags = &flags
	return r
}

// checkEnvelope runs every check made before the database on one envelope, envelope.Parse and then NUL
// in the relationally indexed text, and computes its clock flags.
func (h *handler) checkEnvelope(index int, raw []byte, received time.Time) (store.PendingEvent, *eventResult) {
	ev, err := envelope.Parse(raw, h.registry)
	if err != nil {
		code, detail := envelope.CodeInvalidJSON, "the envelope could not be parsed"
		var p *envelope.Problem
		if errors.As(err, &p) {
			code, detail = p.Code, p.Detail
		}
		return store.PendingEvent{}, invalidEvent(index, eventIDOf(raw), code, detail)
	}
	if indexedTextHasNUL(ev) {
		return store.PendingEvent{}, invalidEvent(index, ev.EventID, codeNULInIndexedText, "curriculum and source text may not contain U+0000")
	}
	return store.PendingEvent{Event: ev, ClockFlags: clockFlags(ev.Facts.OccurredAt, ev.Facts.LocalDate, received)}, nil
}

func invalidEvent(index int, eventID, code, detail string) *eventResult {
	return &eventResult{Index: index, EventID: eventID, Result: resultInvalid, Status: http.StatusUnprocessableEntity, Code: code, Detail: detail}
}

// indexedTextHasNUL reports U+0000 in the curriculum and source text kept in indexed columns. The
// payload is exempt: it is stored as its exact text, where a NUL can only appear escaped.
func indexedTextHasNUL(ev envelope.Event) bool {
	for _, s := range []string{ev.Curriculum.Family, ev.Curriculum.Track, ev.Curriculum.ContentVersion, ev.Curriculum.RulesVersion,
		ev.Source.App, ev.Source.InstallID, ev.Source.AppVersion, ev.Source.LocalProfileID} {
		if hasNUL(s) {
			return true
		}
	}
	return false
}

// Clock flags are recorded with an event and never a reason to refuse it (contract §6).
const (
	flagFutureSkew   = "future_skew"
	flagLocalDateFar = "local_date_far"
	flagPre2020      = "pre_2020"
)

var year2020 = time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)

// clockFlags compares an event's own times with its receipt: occurred more than 10 minutes after
// receipt, a local date outside the UTC dates of occurred-12h to occurred+14h, or before 2020. The
// result is sorted and never nil.
func clockFlags(occurred time.Time, localDate string, received time.Time) []string {
	flags := []string{}
	if occurred.Sub(received) > 10*time.Minute {
		flags = append(flags, flagFutureSkew)
	}
	earliest := occurred.Add(-12 * time.Hour).UTC().Format(time.DateOnly)
	latest := occurred.Add(14 * time.Hour).UTC().Format(time.DateOnly)
	if localDate < earliest || localDate > latest {
		flags = append(flags, flagLocalDateFar)
	}
	if occurred.Before(year2020) {
		flags = append(flags, flagPre2020)
	}
	return flags
}

// eventIDOf returns the event_id of an envelope that failed to parse when it is a well-formed event ID,
// so a report never echoes arbitrary request text.
func eventIDOf(raw []byte) string {
	var e struct {
		EventID string `json:"event_id"`
	}
	_ = json.Unmarshal(raw, &e)
	if !isEventID(e.EventID) {
		return ""
	}
	return e.EventID
}

// isEventID matches [A-Za-z0-9][A-Za-z0-9._:-]{0,127}, the rule envelope.Parse applies to event IDs.
func isEventID(s string) bool {
	if s == "" || len(s) > 128 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		alnum := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
		if !alnum && (i == 0 || (c != '.' && c != '_' && c != ':' && c != '-')) {
			return false
		}
	}
	return true
}
