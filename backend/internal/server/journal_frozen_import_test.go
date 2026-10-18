package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/journal"
	"ayailmu.local/backend/internal/server"
)

// sentRequest is what recorder keeps of a request. Headers are never kept: they carry the bearer token.
type sentRequest struct {
	method, path string
	body         []byte
}

// recorder forwards each request to inner and keeps its method, path and body in memory. When rewrite
// is set it also rewrites the body of every import response, so a test can hand the journal a receipt
// that does not verify.
type recorder struct {
	inner   http.RoundTripper
	rewrite func(receipt []byte) []byte

	mu        sync.Mutex
	sent      []sentRequest
	rewritten int
}

func (rc *recorder) RoundTrip(r *http.Request) (*http.Response, error) {
	fwd := r.Clone(r.Context())
	var body []byte
	if r.Body != nil && r.Body != http.NoBody {
		b, err := io.ReadAll(r.Body)
		r.Body.Close()
		if err != nil {
			return nil, err
		}
		body = b
		fwd.Body = io.NopCloser(bytes.NewReader(b))
		fwd.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(b)), nil }
	}
	rc.mu.Lock()
	rc.sent = append(rc.sent, sentRequest{method: r.Method, path: r.URL.Path, body: body})
	rc.mu.Unlock()
	resp, err := rc.inner.RoundTrip(fwd)
	if err != nil || rc.rewrite == nil || !isImport(sentRequest{method: r.Method, path: r.URL.Path}) {
		return resp, err
	}
	receipt, err := io.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		return nil, err
	}
	changed := rc.rewrite(receipt)
	rc.mu.Lock()
	if !bytes.Equal(changed, receipt) {
		rc.rewritten++
	}
	rc.mu.Unlock()
	resp.Body = io.NopCloser(bytes.NewReader(changed))
	resp.ContentLength = int64(len(changed))
	resp.Header.Set("Content-Length", strconv.Itoa(len(changed)))
	return resp, nil
}

// all returns what was sent, in order.
func (rc *recorder) all() []sentRequest {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return slices.Clone(rc.sent)
}

func (rc *recorder) bodies(match func(sentRequest) bool) [][]byte {
	var out [][]byte
	for _, r := range rc.all() {
		if match(r) {
			out = append(out, r.body)
		}
	}
	return out
}

func (rc *recorder) rewrites() int {
	rc.mu.Lock()
	defer rc.mu.Unlock()
	return rc.rewritten
}

func isImport(r sentRequest) bool {
	return r.method == http.MethodPost && r.path == "/v1/imports"
}

func isEventUpload(r sentRequest) bool {
	return r.method == http.MethodPost && strings.HasPrefix(r.path, "/v1/profiles/") && strings.HasSuffix(r.path, "/events")
}

func asBytes(list []json.RawMessage) [][]byte {
	out := make([][]byte, len(list))
	for i, raw := range list {
		out[i] = raw
	}
	return out
}

// A device whose import response was lost retries with the request it first sent, byte for byte, even
// after it recorded a new answer and changed its settings and consent. The server replays the receipt.
// The journal acknowledges nothing until a receipt verifies: its counts, and a checksum over every event
// ID it sent, repeats included. The later answer then goes up in its own event upload.
func TestJournalRetriesFrozenImportAfterLostResponse(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "frozen.journal")
	dev := journal.Device{App: "expo", Family: envelope.FamilyExpo, InstallID: "inst-f-1", LocalProfileID: "lrn-f-1"}
	state := []byte(`{"session_id":"ses-f-1","step":2,"marker":"LOCAL-ONLY-SNAPSHOT-F"}`)
	rec := func(n int) []byte {
		return answer{id: fmt.Sprintf("ans-f-%d", n), learner: dev.LocalProfileID, install: dev.InstallID,
			at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope()
	}
	rec1, rec2, rec3 := rec(1), rec(2), rec(3)
	// rec2 stays valid but is written as no encoder would write it: whitespace, JSON unicode escapes and a
	// number spelling that any re-encoding would change. The escapes are assembled at run time, so no
	// editor or transport can decode them in this source.
	escape := func(hex4 string) string { return `\` + "u" + hex4 }
	rec2 = swap(t, rec2, `"payload":{"answer_id":`, "\"payload\" :\n  {\n\t\"answer_id\" :")
	rec2 = swap(t, rec2, `"text":"sahabat"`, `"text" : "sah`+escape("0061")+`bat"`)
	rec2 = swap(t, rec2, "A:word-form:"+sadiqun, "A:word-form:"+escape("0635")+string([]rune(sadiqun)[1:]))
	rec2 = swap(t, rec2, `"time_on_item_ms":5300`, `"time_on_item_ms": 5.30e3`)
	rec2 = swap(t, rec2, `"misconceptions":[]}}`, "\"misconceptions\" : [ ]\n}\n}")
	for _, seq := range []string{`"sah` + escape("0061") + `bat"`, "A:word-form:" + escape("0635")} {
		if !bytes.Contains(rec2, []byte(seq)) {
			t.Fatalf("test setup: the formatted envelope lacks the JSON escape sequence %q", seq)
		}
	}
	if _, err := envelope.Parse(rec2, curriculum.Default()); err != nil {
		t.Fatalf("test setup: the formatted envelope must be valid: %v", err)
	}
	// rec1 is recorded twice: the import carries both copies, and its receipt must cover the repeat.
	original := [][]byte{rec1, rec1, rec2}
	pending := []string{"ans-f-1", "ans-f-1", "ans-f-2"}

	open := func(t *testing.T) *journal.Journal {
		t.Helper()
		j, err := journal.Open(path, dev)
		if err != nil {
			t.Fatalf("journal.Open: %v", err)
		}
		return j
	}
	client := func(rt http.RoundTripper) *journal.Client {
		return &journal.Client{BaseURL: s.base, Token: u.token, HTTP: &http.Client{Timeout: 30 * time.Second, Transport: rt}}
	}
	var j *journal.Journal
	t.Cleanup(func() {
		if j != nil {
			_ = j.Close()
		}
	})
	j = open(t)
	must(t, j.SetConsent(journal.Consent{Version: "trial-consent-1", At: "2026-10-15T00:00:00Z"}))
	must(t, j.SetSettings(journal.Settings{InstructionLang: ptr("id"), SessionMinutes: ptr(10)}))
	must(t, j.SetSessionState(state))
	for _, env := range original {
		must(t, j.Record(env))
	}

	// The first import is delivered and committed, but its response is lost.
	lost := &recorder{inner: &loseResponses{n: 1}}
	if _, err := j.Sync(ctx, client(lost), journal.SyncOptions{}); err == nil {
		t.Fatal("Sync reported success although the import response was lost")
	}
	sent := lost.bodies(isImport)
	if len(sent) != 1 {
		t.Fatalf("the first sync sent %d import requests, want 1", len(sent))
	}
	frozen := sent[0]
	var first struct {
		ImportID string            `json:"import_id"`
		Events   []json.RawMessage `json:"events"`
	}
	decodeJSON(t, frozen, &first)
	if first.ImportID == "" || !equalAll(asBytes(first.Events), original) {
		t.Fatal("the import request does not carry an import ID and every original envelope, the repeat included, byte for byte")
	}
	if n := s.count(t, `SELECT count(*) FROM events e JOIN profiles p USING (profile_id) JOIN accounts a ON a.account_id = p.account_id
		WHERE a.subject = $1 AND e.import_id = $2`, u.uid, first.ImportID); n != 2 {
		t.Fatalf("the lost import stored %d events, want 2: it must commit before its response is lost", n)
	}

	// Reopened, the device keeps everything, records a new answer and changes its settings and consent.
	must(t, j.Close())
	j = open(t)
	if j.ImportID() != first.ImportID || j.ProfileID() != "" || !slices.Equal(j.Pending(), pending) ||
		!equalAll(j.Originals(), original) || !bytes.Equal(j.SessionState(), state) {
		t.Fatal("reopening lost the import ID, the outbox, an original or the session state, or linked a profile without a receipt")
	}
	must(t, j.Record(rec3))
	must(t, j.SetSettings(journal.Settings{InstructionLang: ptr("id"), SessionMinutes: ptr(25)}))
	must(t, j.SetConsent(journal.Consent{Version: "trial-consent-2", At: "2026-10-17T00:00:00Z"}))
	pending = append(pending, "ans-f-3")

	// A receipt that does not verify acknowledges nothing, links nothing and uploads nothing.
	for _, c := range []struct {
		name    string
		rewrite func(receipt []byte) []byte
	}{
		{"a malformed receipt", func(r []byte) []byte { return r[:len(r)/2] }},
		{"a checksum that leaves out the repeated ID", func(r []byte) []byte {
			return bytes.Replace(r, []byte(eventIDsSHA256("ans-f-1", "ans-f-1", "ans-f-2")), []byte(eventIDsSHA256("ans-f-1", "ans-f-2")), 1)
		}},
		{"counts that do not cover the request", func(r []byte) []byte {
			return bytes.Replace(r, []byte(`"identical":1`), []byte(`"identical":0`), 1)
		}},
	} {
		tampered := &recorder{inner: http.DefaultTransport, rewrite: c.rewrite}
		if _, err := j.Sync(ctx, client(tampered), journal.SyncOptions{}); err == nil {
			t.Fatalf("%s: Sync succeeded on a receipt that does not verify", c.name)
		}
		retried := tampered.bodies(isImport)
		if len(retried) == 0 || tampered.rewrites() == 0 {
			t.Fatalf("%s: test setup: no import response was rewritten", c.name)
		}
		for _, b := range retried {
			if !bytes.Equal(b, frozen) {
				t.Fatalf("%s: the retried import request is not the first request byte for byte", c.name)
			}
		}
		if len(tampered.bodies(isEventUpload)) != 0 || j.ProfileID() != "" || !slices.Equal(j.Pending(), pending) {
			t.Fatalf("%s: the journal acted on the unverified receipt: it uploaded events, linked a profile or acknowledged events", c.name)
		}
	}
	if n := s.count(t, `SELECT count(*) FROM events e JOIN profiles p USING (profile_id) JOIN accounts a ON a.account_id = p.account_id
		WHERE a.subject = $1`, u.uid); n != 2 {
		t.Fatalf("the server holds %d events after the unverified receipts, want still 2", n)
	}

	// The verified replay acknowledges the frozen import; the later answer follows in its own upload.
	clean := &recorder{inner: http.DefaultTransport}
	rep, err := j.Sync(ctx, client(clean), journal.SyncOptions{})
	if err != nil {
		t.Fatalf("Sync after the lost response: %v", err)
	}
	if !rep.Imported || !rep.Replayed || len(rep.Conflicts) != 0 {
		t.Fatalf("report = %+v, want the original import replayed without conflicts", rep)
	}
	importAt, uploadAt, uploads := -1, -1, 0
	for i, r := range clean.all() {
		switch {
		case isImport(r):
			if !bytes.Equal(r.body, frozen) {
				t.Fatal("the replayed import request is not the first request byte for byte")
			}
			if importAt < 0 {
				importAt = i
			}
		case isEventUpload(r):
			var batch struct {
				Events []json.RawMessage `json:"events"`
			}
			decodeJSON(t, r.body, &batch)
			if !equalAll(asBytes(batch.Events), [][]byte{rec3}) {
				t.Fatal("the event upload does not carry exactly the later answer, byte for byte")
			}
			uploads++
			uploadAt = i
		}
	}
	if importAt < 0 || uploads != 1 || uploadAt < importAt {
		t.Fatalf("requests: import at %d, %d event uploads, the last at %d; want the replayed import, then one upload of the later answer",
			importAt, uploads, uploadAt)
	}

	var pid string
	if err := s.db.QueryRow(ctx, `SELECT p.profile_id::text FROM profiles p JOIN accounts a USING (account_id) WHERE a.subject = $1`,
		u.uid).Scan(&pid); err != nil {
		t.Fatalf("read the account's profile: %v", err)
	}
	local := j.Settings()
	if len(j.Pending()) != 0 || j.ProfileID() != pid || j.ImportID() != first.ImportID || !equalAll(j.Originals(), append(original, rec3)) ||
		!bytes.Equal(j.SessionState(), state) || val(local.InstructionLang) != "id" || val(local.SessionMinutes) != 25 || local.ArabicScale != nil {
		t.Fatal("after the sync the journal lost an original, the session state or its own settings, or did not acknowledge and link")
	}

	for _, c := range []struct {
		what      string
		got, want int
	}{
		{"profiles of the account", s.count(t, `SELECT count(*) FROM profiles p JOIN accounts a USING (account_id) WHERE a.subject = $1`, u.uid), 1},
		{"device links of the profile", s.count(t, `SELECT count(*) FROM profile_sources WHERE profile_id = $1::uuid`, pid), 1},
		{"import records of the account", s.count(t, `SELECT count(*) FROM imports i JOIN accounts a USING (account_id) WHERE a.subject = $1`, u.uid), 1},
		{"events of the profile", s.count(t, `SELECT count(*) FROM events WHERE profile_id = $1::uuid`, pid), 3},
		{"distinct event IDs of the profile", s.count(t, `SELECT count(DISTINCT event_id) FROM events WHERE profile_id = $1::uuid`, pid), 3},
		{"events stored by the import", s.count(t, `SELECT count(*) FROM events WHERE profile_id = $1::uuid AND import_id = $2`, pid, first.ImportID), 2},
		{"the later answer stored by its own upload", s.count(t, `SELECT count(*) FROM events WHERE profile_id = $1::uuid AND event_id = 'ans-f-3' AND import_id IS NULL`, pid), 1},
	} {
		if c.got != c.want {
			t.Fatalf("%s = %d, want %d", c.what, c.got, c.want)
		}
	}
	for _, c := range []struct {
		id  string
		env []byte
	}{{"ans-f-2", rec2}, {"ans-f-3", rec3}} {
		var payload string
		if err := s.db.QueryRow(ctx, `SELECT payload_raw FROM events WHERE profile_id = $1::uuid AND event_id = $2`, pid, c.id).Scan(&payload); err != nil {
			t.Fatalf("read %s: %v", c.id, err)
		}
		if payload != string(payloadOf(t, c.env)) {
			t.Fatalf("%s: the stored payload is not the original's exact bytes", c.id)
		}
	}
	doc, etag, _ := s.profile(t, u.token, pid)
	if doc.Revision != 1 || etag != `"r1"` || doc.HighSeq != 3 || val(doc.Settings.InstructionLang) != "id" || val(doc.Settings.SessionMinutes) != 10 ||
		doc.Settings.ArabicScale != nil || doc.Consent.Version != "trial-consent-1" || !sameInstant(doc.Consent.At, "2026-10-15T00:00:00Z") ||
		!slices.Equal(doc.Sources, []sourceRef{{App: dev.App, InstallID: dev.InstallID, LocalProfileID: dev.LocalProfileID}}) {
		t.Fatalf("server profile = %+v: the retry or the upload rewrote its settings, consent, revision or sources", doc)
	}
}
