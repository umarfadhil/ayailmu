package server_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"reflect"
	"slices"
	"sync"
	"testing"
	"time"

	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/journal"
	"ayailmu.local/backend/internal/server"
)

// loseResponses delivers requests but drops the first n import responses, like a connection lost after
// the server committed.
type loseResponses struct {
	mu sync.Mutex
	n  int
}

func (l *loseResponses) RoundTrip(r *http.Request) (*http.Response, error) {
	resp, err := http.DefaultTransport.RoundTrip(r)
	if err != nil {
		return nil, err
	}
	l.mu.Lock()
	lose := l.n > 0 && r.Method == http.MethodPost && r.URL.Path == "/v1/imports"
	if lose {
		l.n--
	}
	l.mu.Unlock()
	if !lose {
		return resp, nil
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return nil, errors.New("connection lost after the request was delivered")
}

func equalAll(a, b [][]byte) bool {
	return slices.EqualFunc(a, b, bytes.Equal)
}

func TestTwoDeviceJournalsReplayDurably(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	ctx := context.Background()
	dir := t.TempDir()
	devA := journal.Device{App: "expo", Family: envelope.FamilyExpo, InstallID: "inst-j-a", LocalProfileID: "lrn-j-a"}
	devB := journal.Device{App: "expo", Family: envelope.FamilyExpo, InstallID: "inst-j-b", LocalProfileID: "lrn-j-b"}
	devC := journal.Device{App: "android", Family: envelope.FamilyAndroid, InstallID: "inst-j-c", LocalProfileID: "prf-j-c"}
	pathA, pathB, pathC := filepath.Join(dir, "a.journal"), filepath.Join(dir, "b.journal"), filepath.Join(dir, "c.journal")
	// Unsent local session state: it must never reach the server and pulls must never touch it.
	stateA := []byte(`{"session_id":"ses-j-a","step":3,"marker":"LOCAL-ONLY-SNAPSHOT-A"}`)
	stateB := []byte(`{"session_id":"ses-j-b","step":1,"marker":"LOCAL-ONLY-SNAPSHOT-B"}`)
	client := func(rt http.RoundTripper) *journal.Client {
		hc := &http.Client{Timeout: 30 * time.Second}
		if rt != nil {
			hc.Transport = rt
		}
		return &journal.Client{BaseURL: s.base, Token: u.token, HTTP: hc}
	}
	rec := func(dev journal.Device, n int) []byte {
		return answer{kotlin: dev.App == "android", id: fmt.Sprintf("ans-%s-%d", dev.InstallID, n), learner: dev.LocalProfileID,
			install: dev.InstallID, at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope()
	}
	open := func(t *testing.T, path string, dev journal.Device) *journal.Journal {
		t.Helper()
		j, err := journal.Open(path, dev)
		if err != nil {
			t.Fatalf("journal.Open: %v", err)
		}
		return j
	}
	syncOK := func(t *testing.T, j *journal.Journal, opts journal.SyncOptions) journal.SyncReport {
		t.Helper()
		rep, err := j.Sync(ctx, client(nil), opts)
		if err != nil {
			t.Fatalf("Sync: %v", err)
		}
		if len(rep.Conflicts) != 0 || len(j.Pending()) != 0 {
			t.Fatalf("Sync left conflicts %v and pending %v", rep.Conflicts, j.Pending())
		}
		return rep
	}
	remoteIDs := func(j *journal.Journal) []string {
		var ids []string
		for _, r := range j.Remote() {
			ids = append(ids, r.EventID)
		}
		return ids
	}

	var a, b, c *journal.Journal
	t.Cleanup(func() {
		for _, j := range []*journal.Journal{a, b, c} {
			if j != nil {
				_ = j.Close()
			}
		}
	})
	a = open(t, pathA, devA)
	must(t, a.SetConsent(journal.Consent{Version: "trial-consent-1", At: "2026-10-15T00:00:00Z"}))
	must(t, a.SetSettings(journal.Settings{InstructionLang: ptr("id"), SessionMinutes: ptr(10)}))
	must(t, a.SetSessionState(stateA))
	must(t, a.Record(rec(devA, 1)))
	must(t, a.Record(rec(devA, 2)))

	for _, st := range []struct {
		name string
		fn   func(t *testing.T)
	}{
		{"a lost import response is retried after reopening, with the same IDs and nothing duplicated", func(t *testing.T) {
			if _, err := a.Sync(ctx, client(&loseResponses{n: 1}), journal.SyncOptions{}); err == nil {
				t.Fatal("Sync reported success although the import response was lost")
			}
			importID, pending := a.ImportID(), []string{"ans-inst-j-a-1", "ans-inst-j-a-2"}
			if importID == "" || !slices.Equal(a.Pending(), pending) || a.ProfileID() != "" {
				t.Fatalf("after the lost response: import ID %q, pending %v, profile %q", importID, a.Pending(), a.ProfileID())
			}
			must(t, a.Close())
			a = open(t, pathA, devA)
			if a.ImportID() != importID || !slices.Equal(a.Pending(), pending) || !bytes.Equal(a.SessionState(), stateA) ||
				!equalAll(a.Originals(), [][]byte{rec(devA, 1), rec(devA, 2)}) {
				t.Fatal("reopening lost the import ID, the outbox, the session state or the local originals")
			}
			rep := syncOK(t, a, journal.SyncOptions{})
			if !rep.Imported || !rep.Replayed || a.ProfileID() == "" {
				t.Fatalf("retry report = %+v (profile %q), want the original import replayed", rep, a.ProfileID())
			}
			if pg := s.pull(t, u.token, a.ProfileID(), "after=0"); len(pg.Events) != 2 {
				t.Fatalf("the server holds %d events, want each of the two exactly once", len(pg.Events))
			}
			if !bytes.Equal(a.SessionState(), stateA) || !equalAll(a.Originals(), [][]byte{rec(devA, 1), rec(devA, 2)}) {
				t.Fatal("syncing touched the session state or deleted local originals")
			}
		}},
		{"a second device links with no events and pulls the first device's originals byte for byte", func(t *testing.T) {
			b = open(t, pathB, devB)
			must(t, b.SetSessionState(stateB))
			must(t, b.SetSettings(journal.Settings{InstructionLang: ptr("id"), SessionMinutes: ptr(5)}))
			syncOK(t, b, journal.SyncOptions{LinkProfileID: a.ProfileID()})
			remote := b.Remote()
			if b.ProfileID() != a.ProfileID() || len(remote) != 2 {
				t.Fatalf("device B linked to %q with %d remote events, want %q with 2", b.ProfileID(), len(remote), a.ProfileID())
			}
			for i, r := range remote {
				if r.EventID != fmt.Sprintf("ans-inst-j-a-%d", i+1) || r.InstallID != devA.InstallID || r.LocalProfileID != devA.LocalProfileID ||
					!bytes.Equal(r.Payload, payloadOf(t, rec(devA, i+1))) {
					t.Fatalf("remote event %d is not device A's original record", i)
				}
			}
			if !bytes.Equal(b.SessionState(), stateB) || val(b.Settings().SessionMinutes) != 5 {
				t.Fatal("pulling changed device B's session state or local settings")
			}
		}},
		{"both devices answer offline and converge without duplicates", func(t *testing.T) {
			must(t, a.Record(rec(devA, 3)))
			must(t, b.Record(rec(devB, 1)))
			syncOK(t, a, journal.SyncOptions{})
			syncOK(t, b, journal.SyncOptions{})
			syncOK(t, a, journal.SyncOptions{})
			if got := remoteIDs(a); !slices.Equal(got, []string{"ans-inst-j-b-1"}) {
				t.Fatalf("device A pulled %v", got)
			}
			if got := remoteIDs(b); !slices.Equal(got, []string{"ans-inst-j-a-1", "ans-inst-j-a-2", "ans-inst-j-a-3"}) {
				t.Fatalf("device B pulled %v", got)
			}
			if pg := s.pull(t, u.token, a.ProfileID(), "after=0"); len(pg.Events) != 4 {
				t.Fatalf("the server holds %d events, want 4", len(pg.Events))
			}
		}},
		{"an Android device in the same profile never reaches the Expo journals", func(t *testing.T) {
			c = open(t, pathC, devC)
			must(t, c.Record(rec(devC, 1)))
			syncOK(t, c, journal.SyncOptions{LinkProfileID: a.ProfileID()})
			syncOK(t, a, journal.SyncOptions{})
			syncOK(t, b, journal.SyncOptions{})
			for _, j := range []*journal.Journal{a, b} {
				for _, r := range j.Remote() {
					if r.InstallID == devC.InstallID {
						t.Fatal("an Expo journal pulled an android-catalog event")
					}
				}
			}
			if n := len(c.Remote()); n != 0 {
				t.Fatalf("the Android journal pulled %d events of another family", n)
			}
		}},
		{"unsent answers, session states, cursors and pulled events survive reopening the service and the journals", func(t *testing.T) {
			must(t, a.Record(rec(devA, 4)))
			cursorA, cursorB, remoteB := a.Cursor(), b.Cursor(), b.Remote()
			must(t, a.Close())
			must(t, b.Close())
			s.reopen(t)
			a, b = open(t, pathA, devA), open(t, pathB, devB)
			if !slices.Equal(a.Pending(), []string{"ans-inst-j-a-4"}) || a.Cursor() != cursorA || b.Cursor() != cursorB ||
				!bytes.Equal(a.SessionState(), stateA) || !bytes.Equal(b.SessionState(), stateB) ||
				!equalAll(a.Originals(), [][]byte{rec(devA, 1), rec(devA, 2), rec(devA, 3), rec(devA, 4)}) || !reflect.DeepEqual(b.Remote(), remoteB) {
				t.Fatal("reopening lost an unsent answer, a cursor, a session state, a local original or a pulled event")
			}
			syncOK(t, a, journal.SyncOptions{})
			syncOK(t, b, journal.SyncOptions{})
			if got := remoteIDs(b); !slices.Equal(got, []string{"ans-inst-j-a-1", "ans-inst-j-a-2", "ans-inst-j-a-3", "ans-inst-j-a-4"}) {
				t.Fatalf("device B pulled %v after reopening", got)
			}
			if pg := s.pull(t, u.token, a.ProfileID(), "after=0"); len(pg.Events) != 6 {
				t.Fatalf("the server holds %d events, want 6", len(pg.Events))
			}
		}},
		{"settings edits stay local until pushed, and a stale push is an explicit conflict", func(t *testing.T) {
			must(t, a.SetSettings(journal.Settings{InstructionLang: ptr("id"), SessionMinutes: ptr(20)}))
			must(t, b.SetSettings(journal.Settings{InstructionLang: ptr("id"), SessionMinutes: ptr(7)}))
			syncOK(t, a, journal.SyncOptions{})
			syncOK(t, b, journal.SyncOptions{})
			if doc, _, _ := s.profile(t, u.token, a.ProfileID()); doc.Revision != 1 || val(doc.Settings.SessionMinutes) != 10 {
				t.Fatalf("event sync changed the server profile: %+v", doc)
			}
			must(t, a.PushSettings(ctx, client(nil)))
			var conflict *journal.SettingsConflict
			if err := b.PushSettings(ctx, client(nil)); !errors.As(err, &conflict) || conflict.Revision != 2 || val(conflict.Server.SessionMinutes) != 20 {
				t.Fatalf("stale push = %v, want a SettingsConflict at revision 2 showing 20 minutes", err)
			}
			if val(b.Settings().SessionMinutes) != 7 {
				t.Fatal("a refused push overwrote device B's local settings")
			}
			if doc, _, _ := s.profile(t, u.token, a.ProfileID()); doc.Revision != 2 || val(doc.Settings.SessionMinutes) != 20 {
				t.Fatalf("server profile = %+v, want revision 2 with device A's 20 minutes", doc)
			}
		}},
		{"no session state ever reaches the server", func(t *testing.T) {
			for _, e := range s.pull(t, u.token, a.ProfileID(), "after=0&limit=500").Events {
				if e.Kind != envelope.KindAnswer || bytes.Contains(e.Payload, []byte("LOCAL-ONLY-SNAPSHOT")) {
					t.Fatalf("event %s carries local session state", e.EventID)
				}
			}
			if n := s.count(t, `SELECT (SELECT count(*) FROM events WHERE payload_raw LIKE '%LOCAL-ONLY-SNAPSHOT%')
				+ (SELECT count(*) FROM imports WHERE receipt LIKE '%LOCAL-ONLY-SNAPSHOT%')`); n != 0 {
				t.Fatalf("%d stored rows contain local session state", n)
			}
		}},
	} {
		if !t.Run(st.name, st.fn) {
			return
		}
	}
}
