//go:build firebase_emulator

package server_test

import (
	"bytes"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/server"
)

func TestGuestImportCreatesWholeAdultProfilesOnly(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-i-1", LocalProfileID: "lrn-i-1"}
	ev := func(n int) []byte {
		return answer{id: fmt.Sprintf("ans-i-%d", n), learner: src.LocalProfileID, install: src.InstallID, at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope()
	}
	evs := [][]byte{ev(1), ev(2), ev(3)}
	post := func(t *testing.T, body []byte) reply {
		t.Helper()
		return s.call(t, http.MethodPost, "/v1/imports", u.token, body)
	}

	if !t.Run("a new account has no profile until an import creates one", func(t *testing.T) {
		r := s.call(t, http.MethodGet, "/v1/me", u.token, nil)
		wantStatus(t, r, http.StatusOK)
		var m me
		decodeJSON(t, r.body, &m)
		if !uuidRE.MatchString(m.AccountID) || len(m.Profiles) != 0 {
			t.Fatalf("me = %+v, want an account ID and no profiles", m)
		}
	}) {
		return
	}

	t.Run("an import refused anywhere writes nothing", func(t *testing.T) {
		invalid := swap(t, ev(4), `"outcome":"correct"`, `"outcome":"great"`)
		p := wantProblem(t, post(t, importBody("imp-i-bad-0", src, newAdult, evs[0], invalid)), http.StatusUnprocessableEntity, "import_rejected")
		if len(p.Results) != 1 || p.Results[0].Index != 1 || p.Results[0].Status != http.StatusUnprocessableEntity || p.Results[0].Code != envelope.CodeInvalidPayload {
			t.Fatalf("report = %+v, want exactly event 1 refused as invalid_payload", p.Results)
		}
		s.wantNoProfileData(t, u)

		adult, consent := `"kind":"adult"`, `,"consent":{"version":"trial-consent-1","at":"2026-10-15T00:00:00Z"}`
		for i, c := range []struct{ target, code string }{
			{strings.Replace(newAdult, adult, `"kind":"child"`, 1), "unsupported_profile_kind"},
			{strings.Replace(newAdult, adult, adult+`,"label":"Budi"`, 1), "invalid_import"},
			{strings.Replace(newAdult, adult, adult+`,"birth_year":1990`, 1), "invalid_import"},
			{strings.Replace(newAdult, adult, adult+`,"email":"guest@example.test"`, 1), "invalid_import"},
			{strings.Replace(newAdult, consent, "", 1), "invalid_import"},
		} {
			if c.target == newAdult {
				t.Fatalf("case %d: test setup left the target unchanged", i)
			}
			wantProblem(t, post(t, importBody(fmt.Sprintf("imp-i-bad-%d", i+1), src, c.target, evs...)), http.StatusUnprocessableEntity, c.code)
			s.wantNoProfileData(t, u)
		}
		nul := sourceRef{App: "expo", InstallID: `inst-i-1\u0000`, LocalProfileID: src.LocalProfileID}
		wantProblem(t, post(t, importBody("imp-i-bad-nul", nul, newAdult)), http.StatusUnprocessableEntity, "nul_in_indexed_text")
		s.wantNoProfileData(t, u)
	})

	var first receipt
	if !t.Run("a valid import creates one minimal adult profile, links its device and stores every event", func(t *testing.T) {
		r := post(t, importBody("imp-i-1", src, newAdult, evs...))
		wantStatus(t, r, http.StatusCreated)
		decodeJSON(t, r.body, &first)
		want := receipt{ImportID: "imp-i-1", ProfileID: first.ProfileID, ProfileCreated: true, Stored: 3, HighSeq: 3,
			EventIDsSHA256: eventIDsSHA256("ans-i-1", "ans-i-2", "ans-i-3"), CommittedAt: first.CommittedAt}
		if first != want || !uuidRE.MatchString(first.ProfileID) || !isRFC3339(first.CommittedAt) {
			t.Fatalf("receipt = %+v", first)
		}
		doc, etag, raw := s.profile(t, u.token, first.ProfileID)
		if doc.ProfileID != first.ProfileID || doc.Kind != "adult" || doc.Revision != 1 || etag != `"r1"` || doc.HighSeq != 3 {
			t.Fatalf("profile = %+v (ETag %s)", doc, etag)
		}
		if val(doc.Settings.InstructionLang) != "id" || val(doc.Settings.SessionMinutes) != 10 || val(doc.Settings.ArabicScale) != 1.25 ||
			doc.Consent.Version != "trial-consent-1" || !sameInstant(doc.Consent.At, "2026-10-15T00:00:00Z") || !slices.Equal(doc.Sources, []sourceRef{src}) {
			t.Fatalf("profile settings, consent or sources = %+v", doc)
		}
		for _, k := range keysIn(t, raw) {
			switch k {
			case "label", "name", "display_name", "birth_year", "email", "phone":
				t.Fatalf("the profile document carries %q", k)
			}
		}
		pg := s.pull(t, u.token, first.ProfileID, "after=0")
		if len(pg.Events) != 3 {
			t.Fatalf("pulled %d events, want 3", len(pg.Events))
		}
		for i, e := range pg.Events {
			if e.Seq != int64(i+1) || e.EventID != fmt.Sprintf("ans-i-%d", i+1) || !bytes.Equal(e.Payload, payloadOf(t, evs[i])) || e.Source.LocalProfileID != src.LocalProfileID {
				t.Fatalf("pulled event %d is not the guest's original record", i)
			}
		}
	}) {
		return
	}

	t.Run("an identical retry, however spelled, returns the original receipt", func(t *testing.T) {
		body := importBody("imp-i-1", src, newAdult, evs...)
		for i, b := range [][]byte{body, reformat(t, body)} {
			r := post(t, b)
			wantStatus(t, r, http.StatusOK)
			var again receipt
			decodeJSON(t, r.body, &again)
			if !again.Replayed {
				t.Fatalf("retry %d receipt = %+v, want replayed", i, again)
			}
			again.Replayed = false
			if again != first {
				t.Fatalf("retry %d receipt = %+v, want the original %+v", i, again, first)
			}
		}
	})

	t.Run("reusing an import ID for other content is refused", func(t *testing.T) {
		wantProblem(t, post(t, importBody("imp-i-1", src, newAdult, evs[0], evs[1])), http.StatusConflict, "import_id_reused")
		if doc, _, _ := s.profile(t, u.token, first.ProfileID); doc.HighSeq != 3 {
			t.Fatalf("high_seq = %d after a refused import, want 3", doc.HighSeq)
		}
	})

	t.Run("a lost import ID cannot create a second profile for the same device", func(t *testing.T) {
		r := post(t, importBody("imp-i-2", src, newAdult, evs...))
		wantStatus(t, r, http.StatusCreated)
		var rc receipt
		decodeJSON(t, r.body, &rc)
		if rc.ProfileID != first.ProfileID || rc.ProfileCreated || rc.Stored != 0 || rc.Identical != 3 || rc.HighSeq != 3 {
			t.Fatalf("receipt = %+v, want the existing profile with every event identical", rc)
		}
		r = s.call(t, http.MethodGet, "/v1/me", u.token, nil)
		wantStatus(t, r, http.StatusOK)
		var m me
		decodeJSON(t, r.body, &m)
		if len(m.Profiles) != 1 {
			t.Fatalf("the account has %d profiles, want 1", len(m.Profiles))
		}
	})

	t.Run("a device already linked elsewhere cannot be retargeted", func(t *testing.T) {
		other := sourceRef{App: "android", InstallID: "inst-i-2", LocalProfileID: "prf-i-2"}
		r := post(t, importBody("imp-i-3", other, newAdult))
		wantStatus(t, r, http.StatusCreated)
		var second receipt
		decodeJSON(t, r.body, &second)
		if !second.ProfileCreated || second.ProfileID == first.ProfileID || second.Stored != 0 || second.HighSeq != 0 {
			t.Fatalf("receipt = %+v, want a second empty profile", second)
		}
		wantProblem(t, post(t, importBody("imp-i-4", src, linkTo(second.ProfileID))), http.StatusConflict, "source_already_linked")
		if doc, _, _ := s.profile(t, u.token, second.ProfileID); !slices.Equal(doc.Sources, []sourceRef{other}) {
			t.Fatalf("sources = %+v, want only the device that created the profile", doc.Sources)
		}
	})

	t.Run("an import with a conflicting event rolls back everything", func(t *testing.T) {
		newcomer := sourceRef{App: "expo", InstallID: "inst-i-3", LocalProfileID: "lrn-i-3"}
		fresh := answer{id: "ans-i-10", learner: newcomer.LocalProfileID, install: newcomer.InstallID}.envelope()
		clash := answer{id: "ans-i-1", learner: newcomer.LocalProfileID, install: newcomer.InstallID}.envelope()
		p := wantProblem(t, post(t, importBody("imp-i-5", newcomer, linkTo(first.ProfileID), fresh, clash)), http.StatusConflict, "import_rejected")
		if len(p.Results) != 1 || p.Results[0].Index != 1 || p.Results[0].Status != http.StatusConflict || p.Results[0].Code != "event_conflict" {
			t.Fatalf("report = %+v, want exactly event 1 refused as event_conflict", p.Results)
		}
		doc, _, _ := s.profile(t, u.token, first.ProfileID)
		if doc.HighSeq != 3 || !slices.Equal(doc.Sources, []sourceRef{src}) {
			t.Fatalf("a rolled-back import changed the profile: high_seq %d, sources %+v", doc.HighSeq, doc.Sources)
		}
		if n := s.count(t, "SELECT count(*) FROM events WHERE event_id = 'ans-i-10'") + s.count(t, "SELECT count(*) FROM imports WHERE import_id = 'imp-i-5'"); n != 0 {
			t.Fatalf("a rolled-back import left %d rows", n)
		}
	})
}

func TestAccountsCannotReachOrInferEachOther(t *testing.T) {
	s := newStack(t, server.Options{})
	a, b := newUser(t, s.emu), newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-x-1", LocalProfileID: "lrn-x-1"}
	pa := s.seedProfile(t, a, src)
	ev := answer{id: "ans-x-1", learner: src.LocalProfileID, install: src.InstallID}.envelope()
	s.seedEvent(t, pa, ev)
	const etagA = `"r1"` // the seeded revision
	const nobody = "0b7e0f3c-5f6a-4d8e-9a1b-2c3d4e5f6a7b" // well formed, owned by no account

	t.Run("another account's profile is indistinguishable from a missing one", func(t *testing.T) {
		for _, op := range []struct {
			method, suffix, contentType string
			body                        []byte
		}{
			{http.MethodGet, "", "", nil},
			{http.MethodPatch, "", "application/merge-patch+json", []byte(`{"settings":{"session_minutes":30}}`)},
			{http.MethodPost, "/events", "application/json", batch(ev)},
			{http.MethodGet, "/events?after=0", "", nil},
			{http.MethodGet, "/progress?family=" + envelope.FamilyExpo, "", nil},
		} {
			var bodies [][]byte
			for _, pid := range []string{pa, nobody, "not-a-uuid"} {
				hdr := []string{"If-Match", etagA}
				if op.contentType != "" {
					hdr = append(hdr, "Content-Type", op.contentType)
				}
				r := s.call(t, op.method, "/v1/profiles/"+pid+op.suffix, b.token, op.body, hdr...)
				wantProblem(t, r, http.StatusNotFound, "not_found")
				bodies = append(bodies, r.body)
			}
			if !bytes.Equal(bodies[0], bodies[1]) || !bytes.Equal(bodies[1], bodies[2]) {
				t.Fatalf("%s %s: the 404 for another account's profile differs from a missing one", op.method, op.suffix)
			}
		}
		doc, etag, _ := s.profile(t, a.token, pa)
		if etag != etagA || doc.HighSeq != 1 || val(doc.Settings.SessionMinutes) != 10 {
			t.Fatalf("the owner's profile changed: %+v (ETag %s)", doc, etag)
		}
	})

	t.Run("an import cannot target another account's profile", func(t *testing.T) {
		mine := sourceRef{App: "expo", InstallID: "inst-x-2", LocalProfileID: "lrn-x-2"}
		var bodies [][]byte
		for i, pid := range []string{pa, nobody} {
			r := s.call(t, http.MethodPost, "/v1/imports", b.token, importBody(fmt.Sprintf("imp-x-%d", i), mine, linkTo(pid)))
			wantProblem(t, r, http.StatusNotFound, "not_found")
			bodies = append(bodies, r.body)
		}
		if !bytes.Equal(bodies[0], bodies[1]) {
			t.Fatal("the 404 for another account's profile differs from a missing one")
		}
		s.wantNoProfileData(t, b)
	})

	t.Run("the same device identifiers in another account create that account's own profile", func(t *testing.T) {
		evB := answer{id: "ans-x-1", learner: src.LocalProfileID, install: src.InstallID, outcome: "wrong"}.envelope()
		r := s.call(t, http.MethodPost, "/v1/imports", b.token, importBody("imp-x-own", src, newAdult, evB))
		wantStatus(t, r, http.StatusCreated)
		var rb receipt
		decodeJSON(t, r.body, &rb)
		if rb.ProfileID == pa || !rb.ProfileCreated || rb.Stored != 1 || rb.Identical != 0 {
			t.Fatalf("receipt = %+v, want a new profile of B's own with B's event stored", rb)
		}
		if pg := s.pull(t, a.token, pa, "after=0"); len(pg.Events) != 1 || !bytes.Equal(pg.Events[0].Payload, payloadOf(t, ev)) {
			t.Fatal("A's event changed after B stored an event with the same ID")
		}
		if pg := s.pull(t, b.token, rb.ProfileID, "after=0"); len(pg.Events) != 1 || !bytes.Equal(pg.Events[0].Payload, payloadOf(t, evB)) {
			t.Fatal("B's profile does not hold exactly B's record")
		}
		for _, c := range []struct {
			u   user
			pid string
		}{{a, pa}, {b, rb.ProfileID}} {
			r := s.call(t, http.MethodGet, "/v1/me", c.u.token, nil)
			wantStatus(t, r, http.StatusOK)
			var m me
			decodeJSON(t, r.body, &m)
			if len(m.Profiles) != 1 || m.Profiles[0].ProfileID != c.pid {
				t.Fatalf("me = %+v, want exactly the account's own profile", m)
			}
		}
	})
}

func TestProfileReadAndExplicitRevisionConflicts(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-p-1", LocalProfileID: "lrn-p-1"}
	pid := s.seedProfile(t, u, src)
	path := "/v1/profiles/" + pid
	patch := func(t *testing.T, ifMatch, body string) reply {
		t.Helper()
		hdr := []string{"Content-Type", "application/merge-patch+json"}
		if ifMatch != "" {
			hdr = append(hdr, "If-Match", ifMatch)
		}
		return s.call(t, http.MethodPatch, path, u.token, []byte(body), hdr...)
	}
	wantRevision := func(t *testing.T, rev int64) profileDoc {
		t.Helper()
		doc, etag, _ := s.profile(t, u.token, pid)
		if doc.Revision != rev || etag != fmt.Sprintf(`"r%d"`, rev) {
			t.Fatalf("revision = %d (ETag %s), want %d", doc.Revision, etag, rev)
		}
		return doc
	}
	applied := func(t *testing.T, r reply, rev int64) profileDoc {
		t.Helper()
		wantStatus(t, r, http.StatusOK)
		var doc profileDoc
		decodeJSON(t, r.body, &doc)
		if doc.Revision != rev || r.header.Get("ETag") != fmt.Sprintf(`"r%d"`, rev) {
			t.Fatalf("patched revision = %d (ETag %s), want %d", doc.Revision, r.header.Get("ETag"), rev)
		}
		return doc
	}
	current := func(t *testing.T, r reply) profileDoc {
		t.Helper()
		p := wantProblem(t, r, http.StatusPreconditionFailed, "revision_conflict")
		var cur profileDoc
		decodeJSON(t, p.Current, &cur)
		if r.header.Get("ETag") != fmt.Sprintf(`"r%d"`, cur.Revision) {
			t.Fatalf("412 ETag = %s, want the current revision %d", r.header.Get("ETag"), cur.Revision)
		}
		return cur
	}

	for _, st := range []struct {
		name string
		fn   func(t *testing.T)
	}{
		{"a read returns the adult profile with its revision as ETag", func(t *testing.T) {
			doc, etag, raw := s.profile(t, u.token, pid)
			if doc.ProfileID != pid || doc.Kind != "adult" || doc.Revision != 1 || etag != `"r1"` || doc.HighSeq != 0 ||
				val(doc.Settings.InstructionLang) != "id" || val(doc.Settings.SessionMinutes) != 10 || val(doc.Settings.ArabicScale) != 1.0 ||
				doc.Consent.Version != "trial-consent-1" || !slices.Equal(doc.Sources, []sourceRef{src}) {
				t.Fatalf("profile = %+v (ETag %s)", doc, etag)
			}
			for _, k := range keysIn(t, raw) {
				if k == "label" || k == "birth_year" || k == "email" || k == "name" {
					t.Fatalf("the profile document carries %q", k)
				}
			}
		}},
		{"a patch without If-Match is 428", func(t *testing.T) {
			wantProblem(t, patch(t, "", `{"settings":{"session_minutes":15}}`), http.StatusPreconditionRequired, "precondition_required")
			wantRevision(t, 1)
		}},
		{"a stale If-Match is 412 with the current document", func(t *testing.T) {
			if cur := current(t, patch(t, `"r7"`, `{"settings":{"session_minutes":15}}`)); cur.Revision != 1 || val(cur.Settings.SessionMinutes) != 10 {
				t.Fatalf("412 current = %+v, want revision 1", cur)
			}
		}},
		{"the current If-Match applies a merge patch and bumps the revision", func(t *testing.T) {
			doc := applied(t, patch(t, `"r1"`, `{"settings":{"session_minutes":15}}`), 2)
			if val(doc.Settings.SessionMinutes) != 15 || val(doc.Settings.InstructionLang) != "id" || val(doc.Settings.ArabicScale) != 1.0 {
				t.Fatalf("settings = %+v", doc.Settings)
			}
		}},
		{"a device on the old base gets an explicit conflict, then re-applies on the new base", func(t *testing.T) {
			if cur := current(t, patch(t, `"r1"`, `{"settings":{"arabic_scale":1.5}}`)); cur.Revision != 2 || val(cur.Settings.SessionMinutes) != 15 || val(cur.Settings.ArabicScale) != 1.0 {
				t.Fatalf("412 current = %+v", cur)
			}
			doc := applied(t, patch(t, `"r2"`, `{"settings":{"arabic_scale":1.5}}`), 3)
			if val(doc.Settings.ArabicScale) != 1.5 || val(doc.Settings.SessionMinutes) != 15 {
				t.Fatalf("settings = %+v", doc.Settings)
			}
		}},
		{"a patch that changes nothing keeps the revision", func(t *testing.T) {
			applied(t, patch(t, `"r3"`, `{"settings":{"arabic_scale":1.5}}`), 3)
		}},
		{"null removes a setting", func(t *testing.T) {
			if doc := applied(t, patch(t, `"r3"`, `{"settings":{"instruction_lang":null}}`), 4); doc.Settings.InstructionLang != nil {
				t.Fatalf("instruction_lang = %q, want removed", *doc.Settings.InstructionLang)
			}
		}},
		{"invalid values are refused without a change", func(t *testing.T) {
			for _, body := range []string{
				`{"settings":{"session_minutes":0}}`, `{"settings":{"session_minutes":241}}`, `{"settings":{"session_minutes":1.5}}`,
				`{"settings":{"session_minutes":"15"}}`, `{"settings":{"arabic_scale":0.5}}`, `{"settings":{"arabic_scale":2.5}}`,
				`{"settings":{"instruction_lang":"ar"}}`, `{"settings":{"theme":"dark"}}`, `{"settings":[]}`,
			} {
				wantProblem(t, patch(t, `"r4"`, body), http.StatusUnprocessableEntity, "invalid_profile_patch")
			}
			wantRevision(t, 4)
		}},
		{"identity, consent and server fields cannot be patched", func(t *testing.T) {
			for _, body := range []string{
				`{"kind":"child"}`, `{"consent":{"version":"trial-consent-2","at":"2026-10-18T00:00:00Z"}}`, `{"label":"Budi"}`,
				`{"birth_year":1990}`, `{"email":"guest@example.test"}`, `{"revision":9}`, `{"high_seq":5}`, `{"sources":[]}`,
				`{"profile_id":"` + pid + `"}`,
			} {
				wantProblem(t, patch(t, `"r4"`, body), http.StatusUnprocessableEntity, "profile_field_not_patchable")
			}
			for _, body := range []string{`[]`, `"settings"`, `null`} {
				wantProblem(t, patch(t, `"r4"`, body), http.StatusBadRequest, "invalid_request")
			}
			wantRevision(t, 4)
		}},
		{"event sync never changes the profile revision", func(t *testing.T) {
			res := s.upload(t, u.token, pid, answer{id: "ans-p-1", learner: src.LocalProfileID, install: src.InstallID}.envelope())
			if res.Results[0].Status != http.StatusCreated {
				t.Fatalf("upload = %+v", res.Results[0])
			}
			if doc := wantRevision(t, 4); doc.HighSeq != 1 {
				t.Fatalf("high_seq = %d, want 1", doc.HighSeq)
			}
			applied(t, patch(t, `"r4"`, `{"settings":{"session_minutes":20}}`), 5)
		}},
	} {
		if !t.Run(st.name, st.fn) {
			return
		}
	}
}
