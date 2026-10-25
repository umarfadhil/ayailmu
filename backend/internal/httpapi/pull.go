package httpapi

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/store"
)

const (
	defaultPullLimit = 100
	maxPullLimit     = 500
)

const pullQueryRule = "after is an integer of 0 or more, limit an integer from 1 to 500 and family a registered family; no other parameter, none repeated"

type pullQuery struct {
	after  int64
	limit  int
	family string
}

// pulledEvent is one pulled event without its payload; writePage appends the stored payload bytes.
type pulledEvent struct {
	Seq              int64               `json:"seq"`
	EventID          string              `json:"event_id"`
	Kind             string              `json:"kind"`
	Schema           string              `json:"schema"`
	SchemaVersion    int                 `json:"schema_version"`
	Curriculum       envelope.Curriculum `json:"curriculum"`
	CurriculumStatus string              `json:"curriculum_status"`
	Source           envelope.Source     `json:"source"`
	SemanticSHA256   string              `json:"semantic_sha256"`
	ClockFlags       []string            `json:"clock_flags"`
	ReceivedAt       string              `json:"received_at"`
}

type pageTail struct {
	NextAfter int64 `json:"next_after"`
	HighSeq   int64 `json:"high_seq"`
	HasMore   bool  `json:"has_more"`
}

// pullEvents serves GET /v1/profiles/{pid}/events (contract §7): the profile first (404), then the
// query (400), then one consistent snapshot of the profile's events.
func (h *handler) pullEvents(w http.ResponseWriter, r *http.Request, c *call) {
	if !h.ownedProfile(w, r, c) {
		return
	}
	q, p := parsePullQuery(r.URL.RawQuery, h.registry)
	if p != nil {
		writeProblem(w, p)
		return
	}
	page, err := h.store.Pull(r.Context(), c.accountID, c.profileID, q.after, q.limit, q.family)
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeNotFound(w)
	case errors.Is(err, store.ErrAccountDeleted):
		writeAccountDeleted(w)
	case err != nil:
		h.internal(w, "pull events", err)
	default:
		h.writePage(w, page)
	}
}

func parsePullQuery(raw string, reg *curriculum.Registry) (pullQuery, *problem) {
	q := pullQuery{limit: defaultPullLimit}
	values, err := url.ParseQuery(raw)
	if err != nil {
		return pullQuery{}, invalidQuery(pullQueryRule)
	}
	for name, vs := range values {
		ok := len(vs) == 1
		if ok {
			switch v := vs[0]; name {
			case "after":
				q.after, ok = decimal(v)
			case "limit":
				var n int64
				n, ok = decimal(v)
				ok = ok && n >= 1 && n <= maxPullLimit
				q.limit = int(n)
			case "family":
				_, ok = reg.Family(v)
				q.family = v
			default:
				ok = false
			}
		}
		if !ok {
			return pullQuery{}, invalidQuery(pullQueryRule)
		}
	}
	return q, nil
}

// writePage writes a pull page by hand. Each event is its encoded metadata with the stored payload text
// appended verbatim: encoding/json would compact or re-escape the payload, and a client must get back
// exactly the bytes it sent, whitespace, escapes and number spellings included.
func (h *handler) writePage(w http.ResponseWriter, page store.Page) {
	var buf bytes.Buffer
	buf.WriteString(`{"events":[`)
	for i, e := range page.Events {
		meta, err := json.Marshal(pulledEvent{
			Seq:              e.Seq,
			EventID:          e.EventID,
			Kind:             e.Kind,
			Schema:           e.Schema,
			SchemaVersion:    e.SchemaVersion,
			Curriculum:       e.Curriculum,
			CurriculumStatus: e.CurriculumStatus,
			Source:           e.Source,
			SemanticSHA256:   hex.EncodeToString(e.SemanticSHA256[:]),
			ClockFlags:       e.ClockFlags,
			ReceivedAt:       store.FormatTime(e.ReceivedAt),
		})
		if err != nil {
			h.internal(w, "encode events", err)
			return
		}
		if i > 0 {
			buf.WriteByte(',')
		}
		buf.Write(meta[:len(meta)-1]) // everything but the closing brace
		buf.WriteString(`,"payload":`)
		buf.Write(e.Payload)
		buf.WriteByte('}')
	}
	tail, err := json.Marshal(pageTail{NextAfter: page.NextAfter, HighSeq: page.HighSeq, HasMore: page.HasMore})
	if err != nil {
		h.internal(w, "encode events", err)
		return
	}
	buf.WriteString("],")
	buf.Write(tail[1:]) // everything but the opening brace
	hdr := w.Header()
	hdr.Set("Content-Type", "application/json")
	hdr.Set("Content-Length", strconv.Itoa(buf.Len()))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(buf.Bytes())
}

// decimal reads a non-negative integer written in plain decimal digits.
func decimal(s string) (int64, bool) {
	if s == "" || len(s) > 18 {
		return 0, false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.ParseInt(s, 10, 64)
	return n, err == nil
}

func invalidQuery(detail string) *problem {
	return newProblem(http.StatusBadRequest, codeInvalidQuery, detail)
}
