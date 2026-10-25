package httpapi

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/store"
)

const progressQueryRule = "family is required and must be a registered family; no other parameter"

// notAssessed is the server's whole statement on learned and retention states: it derives neither.
var notAssessed = assessment{Status: "not_assessed_by_server"}

type progressDoc struct {
	ProfileID            string        `json:"profile_id"`
	Family               string        `json:"family"`
	AsOfSeq              int64         `json:"as_of_seq"`
	Derivation           string        `json:"derivation"`
	Learned              assessment    `json:"learned"`
	Retention            assessment    `json:"retention"`
	Events               int           `json:"events"`
	ExcludedUnregistered int           `json:"excluded_unregistered"`
	ClockFlagged         int           `json:"clock_flagged"`
	SourceInstalls       int           `json:"source_installs"`
	Skills               []skillDoc    `json:"skills"`
	Versions             []versionDoc  `json:"versions"`
	Provenance           provenanceDoc `json:"provenance"`
}

type assessment struct {
	Status string `json:"status"`
}

type skillDoc struct {
	Skill                   string         `json:"skill"`
	Events                  int            `json:"events"`
	ByOutcome               map[string]int `json:"by_outcome"`
	ByRoleOrPool            map[string]int `json:"by_role_or_pool"`
	EvidenceModes           map[string]int `json:"evidence_modes"`
	DistinctExposureKeys    int            `json:"distinct_exposure_keys"`
	LocalDays               int            `json:"local_days"`
	FreshClaims             int            `json:"fresh_claims"`
	FreshClaimsContradicted int            `json:"fresh_claims_contradicted"`
}

type versionDoc struct {
	Track          string  `json:"track"`
	ContentVersion string  `json:"content_version"`
	RulesVersion   string  `json:"rules_version"`
	Events         int     `json:"events"`
	Pack           packDoc `json:"pack"`
}

// packDoc carries the registry's own caveats for a pack, verbatim.
type packDoc struct {
	Lifecycle                 string `json:"lifecycle"`
	Synthetic                 bool   `json:"synthetic"`
	ReviewedProductionContent bool   `json:"reviewed_production_content"`
	AnswerFormat              string `json:"answer_format,omitempty"`
	Note                      string `json:"note"`
}

// provenanceDoc counts each flag as true, false, absent (the record omits it) or unknown (the record
// holds something else); absent and unknown are never counted as false.
type provenanceDoc struct {
	Synthetic           map[string]int `json:"synthetic"`
	FeedbackDeferred    map[string]int `json:"feedback_deferred"`
	HintUsed            map[string]int `json:"hint_used"`
	RetentionValidFalse int            `json:"retention_valid_false"`
}

// progress serves GET /v1/profiles/{pid}/progress (contract §8): factual counts over one family's
// registered events, read in learning order. Mastery, readiness, learned state and retention stay with
// each client's engine.
func (h *handler) progress(w http.ResponseWriter, r *http.Request, c *call) {
	if !h.ownedProfile(w, r, c) {
		return
	}
	family, p := parseProgressQuery(r.URL.RawQuery, h.registry)
	if p != nil {
		writeProblem(w, p)
		return
	}
	events, asOfSeq, err := h.store.FamilyEvents(r.Context(), c.accountID, c.profileID, family)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeNotFound(w)
		return
	case errors.Is(err, store.ErrAccountDeleted):
		writeAccountDeleted(w)
		return
	case err != nil:
		h.internal(w, "read family events", err)
		return
	}
	doc, err := h.factualProgress(strings.ToLower(c.profileID), family, asOfSeq, events)
	if err != nil {
		h.internal(w, "count progress", err)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

func parseProgressQuery(raw string, reg *curriculum.Registry) (string, *problem) {
	values, err := url.ParseQuery(raw)
	if err != nil || len(values) != 1 || len(values["family"]) != 1 {
		return "", invalidQuery(progressQueryRule)
	}
	family := values["family"][0]
	if _, ok := reg.Family(family); !ok {
		return "", invalidQuery(progressQueryRule)
	}
	return family, nil
}

type versionKey struct{ track, content, rules string }

// skillTally accumulates one skill's counts.
type skillTally struct {
	doc       skillDoc
	exposures map[string]bool
	days      map[string]bool
}

// factualProgress counts what the stored events say. Each event's facts come from envelope.Parse, the
// code that accepted it, and no stored record is changed. Unregistered events are only counted as
// excluded. A fresh claim counts as contradicted when an earlier event in learning order showed the same
// item or lineage.
func (h *handler) factualProgress(profileID, family string, asOfSeq int64, stored []store.StoredEvent) (progressDoc, error) {
	doc := progressDoc{
		ProfileID:  profileID,
		Family:     family,
		AsOfSeq:    asOfSeq,
		Derivation: "factual-counts-v1",
		Learned:    notAssessed,
		Retention:  notAssessed,
		Skills:     []skillDoc{},
		Versions:   []versionDoc{},
		Provenance: provenanceDoc{Synthetic: buckets(), FeedbackDeferred: buckets(), HintUsed: buckets()},
	}
	skills := map[string]*skillTally{}
	versions := map[versionKey]*versionDoc{}
	installs := map[string]bool{}
	seenItems, seenLineages := map[string]bool{}, map[string]bool{}
	for _, e := range stored {
		if e.CurriculumStatus != envelope.StatusRegistered {
			doc.ExcludedUnregistered++
			continue
		}
		raw, err := storedEnvelope(e)
		if err != nil {
			return progressDoc{}, err
		}
		ev, err := envelope.Parse(raw, h.registry)
		if err != nil {
			return progressDoc{}, fmt.Errorf("httpapi: re-read stored event: %w", err)
		}
		payload, _ := objectMembers(e.Payload)
		f := ev.Facts
		doc.Events++
		if len(e.ClockFlags) > 0 {
			doc.ClockFlagged++
		}
		installs[e.Source.InstallID] = true

		key := versionKey{e.Curriculum.Track, e.Curriculum.ContentVersion, e.Curriculum.RulesVersion}
		v := versions[key]
		if v == nil {
			v = &versionDoc{Track: key.track, ContentVersion: key.content, RulesVersion: key.rules, Pack: h.packCaveats(family, key.track, key.content)}
			versions[key] = v
		}
		v.Events++

		exposure, contradicted := f.ItemID, seenItems[f.ItemID]
		if f.Lineage != nil {
			exposure = *f.Lineage
			contradicted = contradicted || seenLineages[*f.Lineage]
			seenLineages[*f.Lineage] = true
		}
		seenItems[f.ItemID] = true
		fresh := f.FreshEvidence != nil && *f.FreshEvidence
		roleOrPool := f.Pool
		if f.Role != nil {
			roleOrPool = *f.Role
		}
		mode := "absent"
		if f.EvidenceMode != nil {
			mode = *f.EvidenceMode
		}
		for _, name := range distinctStrings(f.Skills) {
			t := skills[name]
			if t == nil {
				t = &skillTally{
					doc:       skillDoc{Skill: name, ByOutcome: map[string]int{}, ByRoleOrPool: map[string]int{}, EvidenceModes: map[string]int{}},
					exposures: map[string]bool{},
					days:      map[string]bool{},
				}
				skills[name] = t
			}
			t.doc.Events++
			t.doc.ByOutcome[f.Outcome]++
			t.doc.ByRoleOrPool[roleOrPool]++
			t.doc.EvidenceModes[mode]++
			t.exposures[exposure] = true
			t.days[f.LocalDate] = true
			if fresh {
				t.doc.FreshClaims++
				if contradicted {
					t.doc.FreshClaimsContradicted++
				}
			}
		}

		doc.Provenance.Synthetic[bucket(f.Synthetic, payload, "synthetic")]++
		doc.Provenance.FeedbackDeferred[bucket(f.FeedbackDeferred, payload, "feedback_deferred")]++
		doc.Provenance.HintUsed[bucket(f.HintUsed, payload, "hint_used")]++
		if f.RetentionValid != nil && !*f.RetentionValid {
			doc.Provenance.RetentionValidFalse++
		}
	}
	doc.SourceInstalls = len(installs)
	for _, name := range slices.Sorted(maps.Keys(skills)) {
		t := skills[name]
		t.doc.DistinctExposureKeys, t.doc.LocalDays = len(t.exposures), len(t.days)
		doc.Skills = append(doc.Skills, t.doc)
	}
	list := slices.Collect(maps.Values(versions))
	slices.SortFunc(list, func(a, b *versionDoc) int {
		return cmp.Or(cmp.Compare(a.Track, b.Track), cmp.Compare(a.ContentVersion, b.ContentVersion), cmp.Compare(a.RulesVersion, b.RulesVersion))
	})
	for _, v := range list {
		doc.Versions = append(doc.Versions, *v)
	}
	return doc, nil
}

// storedEnvelope rebuilds an event's envelope from its stored fields and exact payload, so its facts are
// read by the same envelope.Parse that accepted it.
func storedEnvelope(e store.StoredEvent) ([]byte, error) {
	head, err := json.Marshal(struct {
		Version       int                 `json:"envelope_version"`
		EventID       string              `json:"event_id"`
		Kind          string              `json:"kind"`
		Schema        string              `json:"schema"`
		SchemaVersion int                 `json:"schema_version"`
		Curriculum    envelope.Curriculum `json:"curriculum"`
		Source        envelope.Source     `json:"source"`
	}{Version: envelope.Version, EventID: e.EventID, Kind: e.Kind, Schema: e.Schema, SchemaVersion: e.SchemaVersion,
		Curriculum: e.Curriculum, Source: e.Source})
	if err != nil {
		return nil, err
	}
	raw := append(head[:len(head)-1], `,"payload":`...)
	raw = append(raw, e.Payload...)
	return append(raw, '}'), nil
}

// packCaveats copies the registry's labels of a pack verbatim.
func (h *handler) packCaveats(family, track, contentVersion string) packDoc {
	p, _ := h.registry.Pack(family, track, contentVersion)
	return packDoc{Lifecycle: p.Lifecycle, Synthetic: p.Synthetic, ReviewedProductionContent: p.ReviewedProductionContent,
		AnswerFormat: p.Source.AnswerFormat, Note: p.Note}
}

func buckets() map[string]int {
	return map[string]int{"true": 0, "false": 0, "absent": 0, "unknown": 0}
}

// bucket sorts one provenance flag: the boolean the record holds; "absent" when the record omits it, as
// Kotlin does for a default value and v1 records do for v2 members; "unknown" when the member holds
// anything else, which only a member its client store leaves unchecked can.
func bucket(fact *bool, payload map[string]json.RawMessage, member string) string {
	_, present := payload[member]
	switch {
	case fact != nil && *fact:
		return "true"
	case fact != nil:
		return "false"
	case present:
		return "unknown"
	default:
		return "absent"
	}
}

// distinctStrings keeps the first occurrence of each value, so an event counts once per skill.
func distinctStrings(list []string) []string {
	seen := make(map[string]bool, len(list))
	out := make([]string, 0, len(list))
	for _, s := range list {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}
