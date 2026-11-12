//go:build firebase_emulator

package server_test

// Account export and deletion: docs/superpowers/specs/2026-10-18-account-export-deletion-design.md. Every account
// and record here is synthetic and lives in the test's own schema and the local Auth emulator. The helpers these
// tests share with the default build are in account_helpers_test.go.

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/server"
)

// The export and deletion routes keep every existing guard: the uniform 401, exact methods with Allow, and CORS grants
// for the local web app only. /v1/me itself keeps its one method (TestHTTPGuards).
func TestAccountControlRoutesKeepTheGuards(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	canonical := s.call(t, http.MethodGet, "/v1/me", "", nil)
	wantProblem(t, canonical, http.StatusUnauthorized, "unauthenticated")

	t.Run("without a valid token every account control is the uniform 401", func(t *testing.T) {
		for _, c := range []struct {
			method, path string
			body         []byte
		}{
			{http.MethodGet, exportPath, nil},
			{http.MethodGet, deletionPath, nil},
			{http.MethodPost, deletionPath, deletionBody(nobodysAccount)},
		} {
			for _, token := range []string{"", "not-a-jwt"} {
				r := s.call(t, c.method, c.path, token, c.body)
				wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
				if !bytes.Equal(r.body, canonical.body) {
					t.Fatalf("%s %s: the 401 differs from the uniform 401", c.method, c.path)
				}
			}
		}
	})

	t.Run("each route answers only its own methods", func(t *testing.T) {
		for _, c := range []struct{ method, path, allow string }{
			{http.MethodPost, exportPath, "GET"},
			{http.MethodDelete, exportPath, "GET"},
			{http.MethodDelete, deletionPath, "GET, POST"},
			{http.MethodPut, deletionPath, "GET, POST"},
			{http.MethodPatch, deletionPath, "GET, POST"},
		} {
			r := s.call(t, c.method, c.path, u.token, nil)
			wantProblem(t, r, http.StatusMethodNotAllowed, "method_not_allowed")
			if got := r.header.Get("Allow"); got != c.allow {
				t.Fatalf("%s %s: Allow = %q, want %q", c.method, c.path, got, c.allow)
			}
		}
	})

	t.Run("no deletion exists until one is requested", func(t *testing.T) {
		wantProblem(t, s.call(t, http.MethodGet, deletionPath, u.token, nil), http.StatusNotFound, "not_found")
	})

	t.Run("the local web app gets exact preflight grants, nothing else does", func(t *testing.T) {
		for _, origin := range webOrigins {
			wantPreflightGrant(t, s.preflight(t, exportPath, origin, http.MethodGet, "authorization"), origin, "GET")
			wantPreflightGrant(t, s.preflight(t, deletionPath, origin, http.MethodGet, "authorization"), origin, "GET, POST")
			wantPreflightGrant(t, s.preflight(t, deletionPath, origin, http.MethodPost, "authorization,content-type"), origin, "GET, POST")
			wantPreflightRefused(t, s.preflight(t, deletionPath, origin, http.MethodDelete, "authorization"), "invalid_preflight")
			wantPreflightRefused(t, s.preflight(t, exportPath, origin, http.MethodPost, "authorization,content-type"), "invalid_preflight")
		}
		wantPreflightRefused(t, s.preflight(t, deletionPath, unlistedOrigin, http.MethodPost, "authorization,content-type"), "origin_not_allowed")
	})
}

// A deletion needs, checked by the server: the exact confirmation naming the caller's own account, and a sign-in
// (auth_time, not the token's age) from the last five minutes. Body problems come first, so a malformed request never
// sends the learner to sign in again for nothing. A refusal deletes nothing and never reaches the identity provider.
func TestDeletionNeedsExplicitConfirmationAndARecentSignIn(t *testing.T) {
	var attempts atomic.Int32
	s := newStack(t, server.Options{BeforeIdentityDeletion: func(context.Context) error {
		attempts.Add(1)
		return nil
	}})
	u, other := newUser(t, s.emu), newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-dc-1", LocalProfileID: "lrn-dc-1"}
	pid := s.seedProfile(t, u, src)
	s.seedEvent(t, pid, answer{id: "ans-dc-1", learner: src.LocalProfileID, install: src.InstallID}.envelope())
	accountID, otherID := s.accountOf(t, u.token), s.accountOf(t, other.token)
	post := func(t *testing.T, token string, body []byte, headers ...string) reply {
		t.Helper()
		return s.call(t, http.MethodPost, deletionPath, token, body, headers...)
	}
	// untouched checks that nothing was deleted: the profile with its event, no deletion, and an identity account the
	// provider was never asked to delete.
	untouched := func(t *testing.T) {
		t.Helper()
		if doc, _, _ := s.profile(t, u.token, pid); doc.HighSeq != 1 || len(doc.Sources) != 1 {
			t.Fatalf("profile after a refused deletion = %+v", doc)
		}
		if n := s.count(t, `SELECT count(*) FROM events WHERE profile_id = $1::uuid`, pid); n != 1 {
			t.Fatalf("a refused deletion left %d of 1 events", n)
		}
		wantProblem(t, s.call(t, http.MethodGet, deletionPath, u.token, nil), http.StatusNotFound, "not_found")
		if attempts.Load() != 0 || !emulatorHasUser(t, s.emu, u.uid) {
			t.Fatal("a refused deletion reached the identity provider")
		}
	}

	t.Run("the body is typed, bounded and well formed", func(t *testing.T) {
		for _, ct := range []string{"text/plain", "application/merge-patch+json", ""} {
			wantProblem(t, post(t, u.token, deletionBody(accountID), "Content-Type", ct), http.StatusUnsupportedMediaType, "unsupported_media_type")
		}
		padded := []byte(`{"confirm":"` + confirmDeletion + `",` + strings.Repeat(" ", 2<<10) + `"account_id":"` + accountID + `"}`)
		wantProblem(t, post(t, u.token, padded), http.StatusRequestEntityTooLarge, "body_too_large")
		wantProblem(t, post(t, u.token, []byte(`{"confirm":`)), http.StatusBadRequest, "invalid_json")
		for _, body := range []string{
			`[]`, `"` + confirmDeletion + `"`, `{}`, `{"confirm":"` + confirmDeletion + `"}`, `{"account_id":"` + accountID + `"}`,
			`{"confirm":"` + confirmDeletion + `","account_id":"` + accountID + `","reason":"none"}`,
			`{"confirm":true,"account_id":"` + accountID + `"}`,
			`{"confirm":"` + confirmDeletion + `","account_id":null}`,
			`{"confirm":"` + confirmDeletion + `","confirm":"` + confirmDeletion + `","account_id":"` + accountID + `"}`,
		} {
			wantProblem(t, post(t, u.token, []byte(body)), http.StatusBadRequest, "invalid_request")
		}
		untouched(t)
	})

	t.Run("the confirmation must be exact and name the caller's own account", func(t *testing.T) {
		var refusals [][]byte
		for _, body := range [][]byte{
			[]byte(`{"confirm":"DELETE-ACCOUNT","account_id":"` + accountID + `"}`),
			[]byte(`{"confirm":"delete account","account_id":"` + accountID + `"}`),
			[]byte(`{"confirm":"","account_id":"` + accountID + `"}`),
			[]byte(`{"confirm":"yes","account_id":"` + accountID + `"}`),
			deletionBody(otherID),
			deletionBody(nobodysAccount),
			deletionBody("not-an-account"),
		} {
			r := post(t, u.token, body)
			wantProblem(t, r, http.StatusUnprocessableEntity, "deletion_not_confirmed")
			refusals = append(refusals, r.body)
		}
		for i, b := range refusals {
			if !bytes.Equal(b, refusals[0]) {
				t.Fatalf("refusal %d differs from the first: it must not tell another account's ID from any wrong value", i)
			}
		}
		untouched(t)
		wantStatus(t, s.call(t, http.MethodGet, "/v1/me", other.token, nil), http.StatusOK)
	})

	t.Run("a sign-in older than five minutes gets the step-up challenge, however fresh the token", func(t *testing.T) {
		stale := signedInAgo(t, u.token, 6*time.Minute)
		r := post(t, stale, deletionBody(accountID))
		wantProblem(t, r, http.StatusUnauthorized, "reauthentication_required")
		challenge := r.header.Get("WWW-Authenticate")
		if !strings.HasPrefix(challenge, "Bearer ") || !strings.Contains(challenge, `error="insufficient_user_authentication"`) || !strings.Contains(challenge, "max_age=300") {
			t.Fatalf("WWW-Authenticate = %q, want the RFC 9470 step-up challenge with max_age=300", challenge)
		}
		// The token stays valid: only this action needs the recent sign-in.
		wantStatus(t, s.call(t, http.MethodGet, "/v1/me", stale, nil), http.StatusOK)
		untouched(t)
	})

	t.Run("a sign-in time that is missing or ahead of the server clock is never recent", func(t *testing.T) {
		for name, token := range map[string]string{
			"missing": withClaims(t, u.token, func(c map[string]any) { delete(c, "auth_time") }),
			"ahead":   withClaims(t, u.token, func(c map[string]any) { c["auth_time"] = float64(time.Now().Add(10 * time.Minute).Unix()) }),
		} {
			r := post(t, token, deletionBody(accountID))
			// The verifier or the recent-sign-in check may refuse it; either way it is a 401 and nothing happens.
			wantStatus(t, r, http.StatusUnauthorized)
			var p problem
			decodeJSON(t, r.body, &p)
			if p.Code != "reauthentication_required" && p.Code != "unauthenticated" {
				t.Fatalf("%s sign-in time: problem %q, want reauthentication_required or unauthenticated", name, p.Code)
			}
		}
		untouched(t)
	})

	t.Run("a recent, confirmed request erases the server data and the identity account", func(t *testing.T) {
		// Four minutes is still recent: the window is five.
		d := wantDeletion(t, post(t, signedInAgo(t, u.token, 4*time.Minute), deletionBody(accountID)), http.StatusOK, accountID, "completed")
		wantErased(t, d, 1, 1, 1, 0)
		if d.IdentityProvider.Attempts != 1 || attempts.Load() != 1 {
			t.Fatalf("identity attempts = %d (the seam saw %d), want 1", d.IdentityProvider.Attempts, attempts.Load())
		}
		if emulatorHasUser(t, s.emu, u.uid) {
			t.Fatal("the identity account still exists after a completed deletion")
		}
		s.wantGone(t, u.uid, accountID, pid)
		// A retry after a lost answer: the identity account is gone, so its token no longer verifies.
		wantProblem(t, post(t, u.token, deletionBody(accountID)), http.StatusUnauthorized, "unauthenticated")
		s.wantGone(t, u.uid, accountID, pid)
		wantStatus(t, s.call(t, http.MethodGet, "/v1/me", other.token, nil), http.StatusOK)
	})
}

// The export holds every record the service stores for the signed-in account, payload bytes exact, and names what it
// does not hold: the identity provider's account, data that stays on devices, and credentials (the service stores
// none). It needs a recent sign-in, like deletion, and never shows another account's records.
func TestExportHoldsExactlyTheServerDataOfTheSignedInAccount(t *testing.T) {
	s := newStack(t, server.Options{})
	a, b := newCredentialedUser(t, s.emu), newCredentialedUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-ex-1", LocalProfileID: "lrn-ex-1"}
	ev := func(n int, outcome string) []byte {
		return answer{id: fmt.Sprintf("ans-ex-%d", n), learner: src.LocalProfileID, install: src.InstallID, outcome: outcome,
			at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope()
	}
	// A imports two answers and uploads a third. B uses the same device identifiers, import ID and first event ID with
	// another outcome: only the account tells them apart.
	r := s.call(t, http.MethodPost, "/v1/imports", a.token, importBody("imp-ex-1", src, newAdult, ev(1, "correct"), ev(2, "correct")))
	wantStatus(t, r, http.StatusCreated)
	var ra receipt
	decodeJSON(t, r.body, &ra)
	if up := s.upload(t, a.token, ra.ProfileID, ev(3, "correct")); up.Results[0].Status != http.StatusCreated {
		t.Fatalf("upload = %+v", up.Results[0])
	}
	r = s.call(t, http.MethodPost, "/v1/imports", b.token, importBody("imp-ex-1", src, newAdult, ev(1, "wrong")))
	wantStatus(t, r, http.StatusCreated)
	var rb receipt
	decodeJSON(t, r.body, &rb)
	accountA := s.accountOf(t, a.token)
	export := func(t *testing.T, token string) (exportDoc, reply) {
		t.Helper()
		r := s.call(t, http.MethodGet, exportPath, token, nil)
		wantStatus(t, r, http.StatusOK)
		if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
			t.Fatalf("Content-Type = %q, want application/json", ct)
		}
		var x exportDoc
		decodeJSON(t, r.body, &x)
		return x, r
	}

	t.Run("the export is the account's server data, exactly", func(t *testing.T) {
		x, _ := export(t, a.token)
		if x.Format != "ayailmu-server-export-1" || !isRFC3339(x.GeneratedAt) {
			t.Fatalf("format %q, generated_at %q", x.Format, x.GeneratedAt)
		}
		if x.Account.AccountID != accountA || x.Account.Issuer != testIssuer || x.Account.Subject != a.uid || !isRFC3339(x.Account.CreatedAt) {
			t.Fatalf("account = %+v, want account %s of issuer %s and subject %s", x.Account, accountA, testIssuer, a.uid)
		}
		if len(x.Profiles) != 1 {
			t.Fatalf("the export holds %d profiles, want 1", len(x.Profiles))
		}
		p := x.Profiles[0]
		if p.ProfileID != ra.ProfileID || p.Kind != "adult" || p.Revision != 1 || p.HighSeq != 3 || !isRFC3339(p.CreatedAt) ||
			val(p.Settings.InstructionLang) != "id" || val(p.Settings.SessionMinutes) != 10 || val(p.Settings.ArabicScale) != 1.25 ||
			p.Consent.Version != "trial-consent-1" || !sameInstant(p.Consent.At, "2026-10-15T00:00:00Z") {
			t.Fatalf("profile %s: kind %q, revision %d, high_seq %d, created_at %q, settings %+v, consent %+v",
				p.ProfileID, p.Kind, p.Revision, p.HighSeq, p.CreatedAt, p.Settings, p.Consent)
		}
		if len(p.Sources) != 1 || p.Sources[0].App != src.App || p.Sources[0].InstallID != src.InstallID ||
			p.Sources[0].LocalProfileID != src.LocalProfileID || !isRFC3339(p.Sources[0].LinkedAt) {
			t.Fatalf("sources = %+v, want the one linked device with its link time", p.Sources)
		}
		if len(p.Imports) != 1 || p.Imports[0].ImportID != "imp-ex-1" || !sha256RE.MatchString(p.Imports[0].RequestSHA256) ||
			!isRFC3339(p.Imports[0].CreatedAt) || p.Imports[0].Receipt != ra {
			t.Fatalf("imports = %+v, want the stored import with its original receipt %+v", p.Imports, ra)
		}
		if len(p.Events) != 3 {
			t.Fatalf("the export holds %d events, want 3", len(p.Events))
		}
		for i, e := range p.Events {
			n := i + 1
			if e.Seq != int64(n) || e.EventID != fmt.Sprintf("ans-ex-%d", n) || e.Kind != "answer" || e.Curriculum.Family != envelope.FamilyExpo ||
				e.CurriculumStatus != envelope.StatusRegistered || e.Source.InstallID != src.InstallID || e.Source.LocalProfileID != src.LocalProfileID ||
				!sha256RE.MatchString(e.SemanticSHA256) || e.ClockFlags == nil || !isRFC3339(e.ReceivedAt) ||
				!sameInstant(e.OccurredAt, baseTime.Add(time.Duration(n)*time.Minute).Format(time.RFC3339)) || e.LocalDate != "2026-10-16" {
				t.Fatalf("event %d: seq %d, id %q, kind %q, curriculum %+v (%s), source %+v, hash %q, clock_flags %v, received %q, occurred %q, local date %q",
					n, e.Seq, e.EventID, e.Kind, e.Curriculum, e.CurriculumStatus, e.Source, e.SemanticSHA256, e.ClockFlags, e.ReceivedAt, e.OccurredAt, e.LocalDate)
			}
			imported := n <= 2
			if (e.ImportID != nil) != imported || (imported && *e.ImportID != "imp-ex-1") {
				t.Fatalf("event %d: import_id set %v, want imp-ex-1 on the imported events only", n, e.ImportID != nil)
			}
			if !bytes.Equal(e.Payload, payloadOf(t, ev(n, "correct"))) {
				t.Fatalf("event %d: the exported payload is not the original's exact bytes", n)
			}
		}
		var what []string
		for _, n := range x.Contents.NotIncluded {
			if n.Why == "" {
				t.Fatalf("not_included %q has no explanation", n.What)
			}
			what = append(what, n.What)
		}
		slices.Sort(what)
		if x.Contents.Included == "" || !slices.Equal(what, []string{"credentials", "device_data", "identity_provider_account"}) {
			t.Fatalf("contents = %+v: the export must say what it holds and name exactly what it does not", x.Contents)
		}
	})

	t.Run("the export holds no credential and nothing of another account", func(t *testing.T) {
		_, r := export(t, a.token)
		for _, c := range []struct{ what, value string }{
			{"the bearer token", a.token}, {"the password", a.password}, {"the sign-in address", a.email},
			{"the other account's address", b.email}, {"the other account's subject", b.uid}, {"the other account's profile", rb.ProfileID},
		} {
			if bytes.Contains(r.body, []byte(c.value)) {
				t.Fatalf("the export contains %s", c.what)
			}
		}
		if bytes.Contains(r.body, payloadOf(t, ev(1, "wrong"))) {
			t.Fatal("the export contains the other account's record under the same event ID")
		}
		for _, k := range keysIn(t, r.body) {
			switch strings.ToLower(k) {
			case "password", "token", "id_token", "idtoken", "refresh_token", "refreshtoken", "access_token", "authorization",
				"email", "api_key", "apikey", "secret", "credential", "credentials", "private_key":
				t.Fatalf("the export carries a %q member", k)
			}
		}
	})

	t.Run("the other account's export is its own", func(t *testing.T) {
		x, r := export(t, b.token)
		if x.Account.Subject != b.uid || len(x.Profiles) != 1 || x.Profiles[0].ProfileID != rb.ProfileID || len(x.Profiles[0].Events) != 1 ||
			!bytes.Equal(x.Profiles[0].Events[0].Payload, payloadOf(t, ev(1, "wrong"))) {
			t.Fatalf("B's export: subject match %v, %d profiles; want exactly B's profile %s with B's one record", x.Account.Subject == b.uid, len(x.Profiles), rb.ProfileID)
		}
		if bytes.Contains(r.body, []byte(ra.ProfileID)) || bytes.Contains(r.body, []byte(a.uid)) {
			t.Fatal("B's export contains A's profile or subject")
		}
	})

	t.Run("an account without profiles exports its account record and an empty list", func(t *testing.T) {
		c := newUser(t, s.emu)
		x, r := export(t, c.token)
		if x.Account.Subject != c.uid || !uuidRE.MatchString(x.Account.AccountID) || len(x.Profiles) != 0 || !bytes.Contains(r.body, []byte(`"profiles":[]`)) {
			t.Fatalf("export of an account without profiles = %.300q", r.body)
		}
	})

	t.Run("an old sign-in gets the step-up challenge, which the web app can read", func(t *testing.T) {
		r := s.call(t, http.MethodGet, exportPath, signedInAgo(t, a.token, 6*time.Minute), nil, "Origin", webOriginLocalhost)
		wantProblem(t, r, http.StatusUnauthorized, "reauthentication_required")
		if challenge := r.header.Get("WWW-Authenticate"); !strings.Contains(challenge, `error="insufficient_user_authentication"`) || !strings.Contains(challenge, "max_age=300") {
			t.Fatalf("WWW-Authenticate = %q, want the RFC 9470 step-up challenge with max_age=300", challenge)
		}
		wantCORSGrant(t, r, webOriginLocalhost)
		r = s.call(t, http.MethodGet, exportPath, a.token, nil, "Origin", webOriginLocalhost)
		wantStatus(t, r, http.StatusOK)
		wantCORSGrant(t, r, webOriginLocalhost)
	})
}

// When the identity provider cannot delete the sign-in account, the server data is already erased and stays erased,
// the answer is 202 with the identity step pending (never "completed"), and nothing brings the data back: not the old
// token, not a replayed frozen import, not a new sign-in of the same identity. A retry, as after a lost answer, is the
// same deletion; once the provider recovers it completes, and the identity's tokens stop verifying.
func TestIdentityProviderFailureLeavesAnHonestPendingDeletion(t *testing.T) {
	const outageText = "synthetic identity provider outage"
	var outage atomic.Bool
	var attempts atomic.Int32
	s := newStack(t, server.Options{BeforeIdentityDeletion: func(context.Context) error {
		attempts.Add(1)
		if outage.Load() {
			return errors.New(outageText)
		}
		return nil
	}})
	u := newCredentialedUser(t, s.emu)
	bystander := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-pd-1", LocalProfileID: "lrn-pd-1"}
	ev := func(n int) []byte {
		return answer{id: fmt.Sprintf("ans-pd-%d", n), learner: src.LocalProfileID, install: src.InstallID, at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope()
	}
	// The device's first import, kept byte for byte as a journal keeps a frozen import, then a later upload.
	frozen := importBody("imp-pd-1", src, newAdult, ev(1), ev(2))
	r := s.call(t, http.MethodPost, "/v1/imports", u.token, frozen)
	wantStatus(t, r, http.StatusCreated)
	var first receipt
	decodeJSON(t, r.body, &first)
	pid := first.ProfileID
	if up := s.upload(t, u.token, pid, ev(3)); up.Results[0].Status != http.StatusCreated {
		t.Fatalf("upload = %+v", up.Results[0])
	}
	// Another account with the same device identifiers and event ID.
	bp := s.seedProfile(t, bystander, src)
	s.seedEvent(t, bp, ev(1))
	accountID := s.accountOf(t, u.token)
	outage.Store(true)

	var pending deletionDoc
	if !t.Run("a provider failure is reported as pending, after the server data was erased", func(t *testing.T) {
		r := s.deleteAccount(t, u.token, accountID)
		pending = wantDeletion(t, r, http.StatusAccepted, accountID, "identity_deletion_pending")
		wantErased(t, pending, 1, 1, 3, 1)
		if pending.IdentityProvider.Attempts != 1 || attempts.Load() != 1 {
			t.Fatalf("identity attempts = %d (the seam saw %d), want 1", pending.IdentityProvider.Attempts, attempts.Load())
		}
		if mentions(r, outageText) {
			t.Fatal("the answer quotes the identity provider's error")
		}
		if !emulatorHasUser(t, s.emu, u.uid) {
			t.Fatal("test setup: the identity account was deleted despite the outage")
		}
		s.wantGone(t, u.uid, accountID, pid)
		g := wantDeletion(t, s.call(t, http.MethodGet, deletionPath, u.token, nil), http.StatusOK, accountID, "identity_deletion_pending")
		if g.DeletionID != pending.DeletionID || g.RequestedAt != pending.RequestedAt || g.ServerData != pending.ServerData {
			t.Fatalf("GET deletion = %+v, want the pending deletion %+v", g, pending)
		}
	}) {
		return
	}

	t.Run("nothing brings the data back: old token, replayed frozen import, new sign-in", func(t *testing.T) {
		requests := []struct {
			method, path, contentType string
			body                      []byte
		}{
			{http.MethodGet, "/v1/me", "", nil},
			{http.MethodGet, "/v1/curricula", "", nil},
			{http.MethodGet, exportPath, "", nil},
			{http.MethodPost, "/v1/imports", "application/json", frozen},
			{http.MethodPost, "/v1/imports", "application/json", importBody("imp-pd-2", src, newAdult, ev(4))},
			{http.MethodGet, "/v1/profiles/" + pid, "", nil},
			{http.MethodPatch, "/v1/profiles/" + pid, "application/merge-patch+json", []byte(`{"settings":{"session_minutes":20}}`)},
			{http.MethodPost, "/v1/profiles/" + pid + "/events", "application/json", batch(ev(4))},
			{http.MethodGet, "/v1/profiles/" + pid + "/events?after=0", "", nil},
			{http.MethodGet, "/v1/profiles/" + pid + "/progress?family=" + envelope.FamilyExpo, "", nil},
		}
		var gone []byte
		for _, token := range []string{u.token, u.signIn(t, s.emu)} {
			for _, c := range requests {
				hdr := []string{"If-Match", `"r1"`}
				if c.contentType != "" {
					hdr = append(hdr, "Content-Type", c.contentType)
				}
				r := s.call(t, c.method, c.path, token, c.body, hdr...)
				wantProblem(t, r, http.StatusGone, "account_deleted")
				if gone == nil {
					gone = r.body
				} else if !bytes.Equal(r.body, gone) {
					t.Fatalf("%s %s: the 410 differs from the first", c.method, c.path)
				}
			}
		}
		s.wantGone(t, u.uid, accountID, pid)
		if pg := s.pull(t, bystander.token, bp, "after=0"); len(pg.Events) != 1 || !bytes.Equal(pg.Events[0].Payload, payloadOf(t, ev(1))) {
			t.Fatal("the other account's record with the same device identifiers and event ID changed")
		}
	})

	t.Run("a retry during the outage, as after a lost answer, is the same deletion", func(t *testing.T) {
		again := wantDeletion(t, s.deleteAccount(t, u.token, accountID), http.StatusAccepted, accountID, "identity_deletion_pending")
		if again.DeletionID != pending.DeletionID || again.RequestedAt != pending.RequestedAt || again.ServerData != pending.ServerData ||
			again.IdentityProvider.Attempts != 2 || attempts.Load() != 2 {
			t.Fatalf("retry = %+v, want deletion %s again with a second identity attempt", again, pending.DeletionID)
		}
	})

	t.Run("once the provider recovers, a retry completes the same deletion", func(t *testing.T) {
		outage.Store(false)
		done := wantDeletion(t, s.deleteAccount(t, u.token, accountID), http.StatusOK, accountID, "completed")
		if done.DeletionID != pending.DeletionID || done.RequestedAt != pending.RequestedAt || done.ServerData != pending.ServerData ||
			done.IdentityProvider.Attempts != 3 || attempts.Load() != 3 {
			t.Fatalf("completion = %+v, want deletion %s completed on the third identity attempt", done, pending.DeletionID)
		}
		if emulatorHasUser(t, s.emu, u.uid) {
			t.Fatal("the identity account still exists after the deletion completed")
		}
		for _, c := range []struct {
			method, path string
			body         []byte
		}{{http.MethodGet, "/v1/me", nil}, {http.MethodGet, deletionPath, nil}, {http.MethodPost, "/v1/imports", frozen}} {
			wantProblem(t, s.call(t, c.method, c.path, u.token, c.body), http.StatusUnauthorized, "unauthenticated")
		}
		s.wantGone(t, u.uid, accountID, pid)
	})
}

// A store failure while erasing rolls the whole erasure back: nothing is deleted or recorded, the identity provider is
// never asked, and the answer says so (503 account_deletion_failed) without quoting the failure. The same request
// succeeds once the store recovers.
func TestStoreFailureWhileErasingDeletesNothing(t *testing.T) {
	const failure = "synthetic erasure failure"
	var attempts atomic.Int32
	s := newStack(t, server.Options{BeforeIdentityDeletion: func(context.Context) error {
		attempts.Add(1)
		return nil
	}})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-sf-1", LocalProfileID: "lrn-sf-1"}
	pid := s.seedProfile(t, u, src)
	for i := 1; i <= 2; i++ {
		s.seedEvent(t, pid, answer{id: fmt.Sprintf("ans-sf-%d", i), learner: src.LocalProfileID, install: src.InstallID}.envelope())
	}
	accountID := s.accountOf(t, u.token)
	// The failure lives in this test's own disposable schema: deleting any event raises.
	ctx := context.Background()
	_, err := s.db.Exec(ctx, `CREATE FUNCTION aya_t_refuse_erasure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION '`+failure+`'; END$$`)
	must(t, err)
	_, err = s.db.Exec(ctx, `CREATE TRIGGER aya_t_refuse_erasure BEFORE DELETE ON events FOR EACH ROW EXECUTE FUNCTION aya_t_refuse_erasure()`)
	must(t, err)

	t.Run("the failed erasure deletes and records nothing and never reaches the provider", func(t *testing.T) {
		r := s.deleteAccount(t, u.token, accountID)
		wantProblem(t, r, http.StatusServiceUnavailable, "account_deletion_failed")
		if mentions(r, failure) {
			t.Fatal("the answer quotes the store's error")
		}
		if doc, _, _ := s.profile(t, u.token, pid); doc.HighSeq != 2 {
			t.Fatalf("high_seq = %d after a failed erasure, want 2", doc.HighSeq)
		}
		if n := s.count(t, `SELECT count(*) FROM events WHERE profile_id = $1::uuid`, pid); n != 2 {
			t.Fatalf("a failed erasure left %d of 2 events", n)
		}
		wantProblem(t, s.call(t, http.MethodGet, deletionPath, u.token, nil), http.StatusNotFound, "not_found")
		if attempts.Load() != 0 || !emulatorHasUser(t, s.emu, u.uid) {
			t.Fatal("the identity provider was asked although the server data was not erased")
		}
	})

	t.Run("the same request succeeds once the store recovers", func(t *testing.T) {
		_, err := s.db.Exec(ctx, `DROP TRIGGER aya_t_refuse_erasure ON events`)
		must(t, err)
		d := wantDeletion(t, s.deleteAccount(t, u.token, accountID), http.StatusOK, accountID, "completed")
		wantErased(t, d, 1, 1, 2, 0)
		if attempts.Load() != 1 || emulatorHasUser(t, s.emu, u.uid) {
			t.Fatal("the identity account was not deleted exactly once after the erasure")
		}
		s.wantGone(t, u.uid, accountID, pid)
	})
}

// Deletion and writes of one account serialize. A write already in its transaction commits first and is erased with
// the rest; a write that starts while the erasure is open waits and is refused as account_deleted, never stored. Two
// deletions at once are one deletion. BeforeCommit holds the first transaction that reaches it: an import, an ingest
// or, as the contract extends the seam, the deletion's erasure transaction.
func TestDeletionSerializesWithIngestAndImport(t *testing.T) {
	b := &barrier{}
	var outage atomic.Bool
	s := newStack(t, server.Options{
		BeforeCommit: b.hold,
		BeforeIdentityDeletion: func(context.Context) error {
			if outage.Load() {
				return errors.New("synthetic identity provider outage")
			}
			return nil
		},
	})
	t.Cleanup(b.open) // runs before the server closes, so no request stays parked
	ev := func(src sourceRef, id string) []byte {
		return answer{id: id, learner: src.LocalProfileID, install: src.InstallID}.envelope()
	}
	// heldBy waits until the transaction of the request in flight reaches the barrier.
	heldBy := func(t *testing.T, entered <-chan struct{}, inFlight <-chan answered, what string) {
		t.Helper()
		select {
		case <-entered:
		case a := <-inFlight:
			t.Fatalf("%s answered %d (%.200q) before reaching its commit barrier", what, a.r.status, a.r.body)
		case <-time.After(10 * time.Second):
			t.Fatalf("%s never reached its commit barrier", what)
		}
	}

	t.Run("an import already in its transaction commits first, then is erased with the rest", func(t *testing.T) {
		defer b.open()
		outage.Store(false)
		u := newUser(t, s.emu)
		accountID := s.accountOf(t, u.token)
		src := sourceRef{App: "expo", InstallID: "inst-sz-1", LocalProfileID: "lrn-sz-1"}
		entered := b.arm()
		imp := s.async(http.MethodPost, "/v1/imports", u.token, importBody("imp-sz-1", src, newAdult, ev(src, "ans-sz-1"), ev(src, "ans-sz-2")))
		heldBy(t, entered, imp, "the import")
		del := s.async(http.MethodPost, deletionPath, u.token, deletionBody(accountID))
		time.Sleep(300 * time.Millisecond) // every chance for a wrong implementation to erase around the open import
		b.open()
		r := await(t, imp, "the import")
		wantStatus(t, r, http.StatusCreated)
		var rc receipt
		decodeJSON(t, r.body, &rc)
		d := wantDeletion(t, await(t, del, "the deletion"), http.StatusOK, accountID, "completed")
		wantErased(t, d, 1, 1, 2, 1)
		s.wantGone(t, u.uid, accountID, rc.ProfileID)
	})

	t.Run("an upload already in its transaction commits first, then is erased with the rest", func(t *testing.T) {
		defer b.open()
		outage.Store(false)
		u := newUser(t, s.emu)
		src := sourceRef{App: "expo", InstallID: "inst-sz-2", LocalProfileID: "lrn-sz-2"}
		pid := s.seedProfile(t, u, src)
		s.seedEvent(t, pid, ev(src, "ans-sz-3"))
		accountID := s.accountOf(t, u.token)
		entered := b.arm()
		up := s.async(http.MethodPost, "/v1/profiles/"+pid+"/events", u.token, batch(ev(src, "ans-sz-4"), ev(src, "ans-sz-5")))
		heldBy(t, entered, up, "the upload")
		del := s.async(http.MethodPost, deletionPath, u.token, deletionBody(accountID))
		time.Sleep(300 * time.Millisecond) // every chance for a wrong implementation to erase around the open upload
		b.open()
		r := await(t, up, "the upload")
		wantStatus(t, r, http.StatusOK)
		var br batchReply
		decodeJSON(t, r.body, &br)
		if len(br.Results) != 2 || br.Results[0].Status != http.StatusCreated || br.Results[1].Status != http.StatusCreated {
			t.Fatalf("upload results = %+v, want both stored", br.Results)
		}
		d := wantDeletion(t, await(t, del, "the deletion"), http.StatusOK, accountID, "completed")
		wantErased(t, d, 1, 1, 3, 0)
		s.wantGone(t, u.uid, accountID, pid)
	})

	t.Run("writes that start while the erasure is open are refused and never stored", func(t *testing.T) {
		defer b.open()
		outage.Store(true) // the identity account stays, so the writers' tokens verify whatever the timing
		u := newUser(t, s.emu)
		src := sourceRef{App: "expo", InstallID: "inst-sz-3", LocalProfileID: "lrn-sz-3"}
		newcomer := sourceRef{App: "expo", InstallID: "inst-sz-4", LocalProfileID: "lrn-sz-4"}
		r := s.call(t, http.MethodPost, "/v1/imports", u.token, importBody("imp-sz-3", src, newAdult, ev(src, "ans-sz-6")))
		wantStatus(t, r, http.StatusCreated)
		var rc receipt
		decodeJSON(t, r.body, &rc)
		accountID := s.accountOf(t, u.token)
		entered := b.arm()
		del := s.async(http.MethodPost, deletionPath, u.token, deletionBody(accountID))
		heldBy(t, entered, del, "the deletion")
		up := s.async(http.MethodPost, "/v1/profiles/"+rc.ProfileID+"/events", u.token, batch(ev(src, "ans-sz-7")))
		imp := s.async(http.MethodPost, "/v1/imports", u.token, importBody("imp-sz-4", newcomer, newAdult, ev(newcomer, "ans-sz-8")))
		time.Sleep(300 * time.Millisecond) // both writers reach the account's locks while the erasure holds them
		b.open()
		d := wantDeletion(t, await(t, del, "the deletion"), http.StatusAccepted, accountID, "identity_deletion_pending")
		wantErased(t, d, 1, 1, 1, 1)
		wantProblem(t, await(t, up, "the upload"), http.StatusGone, "account_deleted")
		wantProblem(t, await(t, imp, "the import"), http.StatusGone, "account_deleted")
		s.wantGone(t, u.uid, accountID, rc.ProfileID)
	})

	t.Run("two deletions at once are one deletion", func(t *testing.T) {
		defer b.open()
		outage.Store(true) // both answers come while the identity account still verifies their token
		u := newUser(t, s.emu)
		src := sourceRef{App: "expo", InstallID: "inst-sz-5", LocalProfileID: "lrn-sz-5"}
		pid := s.seedProfile(t, u, src)
		s.seedEvent(t, pid, ev(src, "ans-sz-9"))
		accountID := s.accountOf(t, u.token)
		entered := b.arm()
		first := s.async(http.MethodPost, deletionPath, u.token, deletionBody(accountID))
		heldBy(t, entered, first, "the first deletion")
		second := s.async(http.MethodPost, deletionPath, u.token, deletionBody(accountID))
		time.Sleep(300 * time.Millisecond) // whether the second waits for the account or comes after the commit, it is the same deletion
		b.open()
		d1 := wantDeletion(t, await(t, first, "the first deletion"), http.StatusAccepted, accountID, "identity_deletion_pending")
		d2 := wantDeletion(t, await(t, second, "the second deletion"), http.StatusAccepted, accountID, "identity_deletion_pending")
		if d1.DeletionID != d2.DeletionID || d1.RequestedAt != d2.RequestedAt || d1.ServerData != d2.ServerData {
			t.Fatalf("concurrent deletions answered %+v and %+v, want one deletion", d1, d2)
		}
		wantErased(t, d1, 1, 1, 1, 0)
		outage.Store(false)
		d3 := wantDeletion(t, s.deleteAccount(t, u.token, accountID), http.StatusOK, accountID, "completed")
		if d3.DeletionID != d1.DeletionID || d3.ServerData != d1.ServerData {
			t.Fatalf("completion = %+v, want deletion %s", d3, d1.DeletionID)
		}
		s.wantGone(t, u.uid, accountID, pid)
	})
}

// Deletion takes its locks in the order Store.Import already does: the account's advisory lock first, then the account
// row, which an import key-share locks when it inserts a profile or an import record. A fixture transaction stands in
// for an import that holds the advisory lock and has not inserted its profile yet. The deletion must queue for that
// lock while holding nothing of the account, so the import's next step, a key-share lock on the account row, succeeds
// at once (NOWAIT): taking the account row first would deadlock with every such import. Once the import commits, the
// deletion erases what it wrote too.
func TestDeletionWaitsForAnImportWithoutHoldingTheAccountRow(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-lk-1", LocalProfileID: "lrn-lk-1"}
	pid := s.seedProfile(t, u, src)
	s.seedEvent(t, pid, answer{id: "ans-lk-1", learner: src.LocalProfileID, install: src.InstallID}.envelope())
	accountID := s.accountOf(t, u.token)
	// importLock is the per-account advisory lock key Store.Import takes first (store/imports.go); deletion shares it.
	importLock := "ayailmu-import:" + s.schema + ":" + accountID
	ctx := context.Background()

	tx, err := s.db.Begin(ctx)
	must(t, err)
	defer tx.Rollback(ctx) // releases the lock if the test stops early; a no-op after Commit
	_, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", importLock)
	must(t, err)

	del := s.async(http.MethodPost, deletionPath, u.token, deletionBody(accountID))
	// queued reports a backend of this database waiting for exactly that lock. A bigint key shows its high half in
	// classid, its low half in objid and objsubid 1.
	queued := func() bool {
		return s.count(t, `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
			AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
			AND ((classid::bigint << 32) | objid::bigint) = hashtext($1)::bigint`, importLock) > 0
	}
	for deadline := time.Now().Add(10 * time.Second); !queued(); time.Sleep(20 * time.Millisecond) {
		select {
		case a := <-del:
			t.Fatalf("the deletion answered %d (%.200q) without waiting for the import's advisory lock", a.r.status, a.r.body)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("the deletion never queued for the import's advisory lock")
		}
	}
	// The import's next step: inserting its profile key-share locks the account row.
	var one int
	if err := tx.QueryRow(ctx, `SELECT 1 FROM accounts WHERE account_id = $1::uuid FOR KEY SHARE NOWAIT`, accountID).Scan(&one); err != nil {
		t.Fatalf("the deletion holds the account row while it waits for the import's advisory lock, so the import's next insert would deadlock: %v", err)
	}
	// An import into an existing profile locks that profile's row next.
	if err := tx.QueryRow(ctx, `SELECT 1 FROM profiles WHERE profile_id = $1::uuid FOR UPDATE NOWAIT`, pid).Scan(&one); err != nil {
		t.Fatalf("the deletion holds a profile row while it waits for the import's advisory lock, so an import into that profile would deadlock: %v", err)
	}
	var newPid string
	must(t, tx.QueryRow(ctx, `INSERT INTO profiles (account_id, kind, consent_version, consent_at)
		VALUES ($1::uuid, 'adult', 'trial-consent-1', '2026-10-15T00:00:00Z') RETURNING profile_id::text`, accountID).Scan(&newPid))
	_, err = tx.Exec(ctx, `INSERT INTO profile_sources (account_id, profile_id, app, install_id, local_profile_id)
		VALUES ($1::uuid, $2::uuid, 'expo', 'inst-lk-2', 'lrn-lk-2')`, accountID, newPid)
	must(t, err)
	select {
	case a := <-del:
		t.Fatalf("the deletion answered %d while the import still held the account's advisory lock", a.r.status)
	default:
	}
	must(t, tx.Commit(ctx))
	d := wantDeletion(t, await(t, del, "the deletion"), http.StatusOK, accountID, "completed")
	wantErased(t, d, 2, 2, 1, 0)
	s.wantGone(t, u.uid, accountID, pid, newPid)
}

// The server export is bounded: its encoded body is at most AYA_EXPORT_MAX_BYTES, 16 MiB by default, a setting that can
// only lower the limit. The export is built from one snapshot into a capped buffer, so one that would pass the limit is
// refused whole (413 export_too_large): no truncated or partial export is ever sent. A body of exactly the limit is
// served.
func TestExportIsBoundedAndNeverPartial(t *testing.T) {
	const envExportMax = "AYA_EXPORT_MAX_BYTES"
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-bx-1", LocalProfileID: "lrn-bx-1"}
	pid := s.seedProfile(t, u, src)
	for n := 1; n <= 5; n++ {
		s.seedEvent(t, pid, answer{id: fmt.Sprintf("ans-bx-%d", n), learner: src.LocalProfileID, install: src.InstallID,
			at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope())
	}
	export := func(t *testing.T) reply {
		t.Helper()
		return s.call(t, http.MethodGet, exportPath, u.token, nil)
	}
	// wantRefused checks a refusal that carries no part of the export.
	wantRefused := func(t *testing.T, r reply) {
		t.Helper()
		wantProblem(t, r, http.StatusRequestEntityTooLarge, "export_too_large")
		for _, part := range []string{pid, `"events"`, "ans-bx-"} {
			if bytes.Contains(r.body, []byte(part)) {
				t.Fatalf("the refusal carries part of the export: %.300q", r.body)
			}
		}
	}

	t.Run("an export of exactly the limit is served whole; one byte over is refused whole", func(t *testing.T) {
		r := export(t)
		wantStatus(t, r, http.StatusOK)
		var x exportDoc
		decodeJSON(t, r.body, &x)
		// A fixed-width generated_at makes the same data encode to the same length every time.
		if len(x.GeneratedAt) != len("2006-01-02T15:04:05Z") || !strings.HasSuffix(x.GeneratedAt, "Z") || !isRFC3339(x.GeneratedAt) {
			t.Fatalf("generated_at = %q, want RFC 3339 UTC in whole seconds", x.GeneratedAt)
		}
		size := len(r.body)
		s.restartWith(t, map[string]string{envExportMax: strconv.Itoa(size)})
		r = export(t)
		wantStatus(t, r, http.StatusOK)
		var at exportDoc
		decodeJSON(t, r.body, &at)
		if len(r.body) != size || len(at.Profiles) != 1 || len(at.Profiles[0].Events) != 5 {
			t.Fatalf("export at the limit: %d bytes and %d profiles; want the whole %d-byte export", len(r.body), len(at.Profiles), size)
		}
		s.restartWith(t, map[string]string{envExportMax: strconv.Itoa(size - 1)})
		wantRefused(t, export(t))
		// The limit is the export's alone.
		wantStatus(t, s.call(t, http.MethodGet, "/v1/profiles/"+pid+"/events?after=0", u.token, nil), http.StatusOK)
	})

	t.Run("by default the export is capped at 16 MiB", func(t *testing.T) {
		s.restartWith(t, nil)
		// A synthetic size fixture written straight into this test's own schema: valid JSON objects of about 64 KiB, not
		// answer records. Only the export reads them.
		bulk := func(t *testing.T, from, to int) {
			t.Helper()
			ctx := context.Background()
			_, err := s.db.Exec(ctx, `INSERT INTO events (profile_id, seq, event_id, kind, record_schema, schema_version, family, track,
				content_version, rules_version, curriculum_status, occurred_at, local_date, payload_raw, semantic_sha256,
				source_app, source_install_id, source_app_version, source_local_profile_id)
				SELECT $1::uuid, g, 'ans-bx-big-' || g, 'answer', 'expo.answer_record', 2, $2, 'arab', 'demo-synthetic-0.3',
					'pilot-0.3-local', 'registered', '2026-10-16T02:00:00Z', '2026-10-16',
					'{"answer_id":"ans-bx-big-' || g || '","pad":"' || repeat('x', 65000) || '"}', decode(repeat('00', 32), 'hex'),
					'expo', $3, '0.3.0', $4
				FROM generate_series($5::bigint, $6::bigint) AS g`, pid, envelope.FamilyExpo, src.InstallID, src.LocalProfileID, from, to)
			must(t, err)
			_, err = s.db.Exec(ctx, `UPDATE profiles SET high_seq = $2 WHERE profile_id = $1::uuid`, pid, to)
			must(t, err)
		}
		bulk(t, 6, 245) // 240 payloads of about 64 KiB: an export of roughly 15 MiB
		r := export(t)
		wantStatus(t, r, http.StatusOK)
		var x exportDoc
		decodeJSON(t, r.body, &x)
		if len(r.body) <= 14<<20 || len(r.body) > 16<<20 || len(x.Profiles) != 1 || len(x.Profiles[0].Events) != 245 {
			t.Fatalf("export of %d bytes and %d profiles; want all 245 events in more than 14 and at most 16 MiB", len(r.body), len(x.Profiles))
		}
		bulk(t, 246, 285) // 40 more: about 18 MiB
		wantRefused(t, export(t))
	})

	t.Run("the setting can only lower the limit", func(t *testing.T) {
		for _, c := range []struct {
			value    string
			accepted bool
		}{
			{"1024", true}, {"16777216", true},
			{"0", false}, {"1023", false}, {"16777217", false}, {"-1", false}, {"16MiB", false}, {"unlimited", false},
		} {
			t.Run(c.value, func(t *testing.T) {
				schema := newSchemaName(t)
				env := serviceEnv(s.dbURL, s.emu, schema, "127.0.0.1:8091")
				env[envExportMax] = c.value
				svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
				if svc != nil {
					svc.Close()
				}
				created := schemaExists(t, s.db, schema)
				if created {
					dropSchema(t, s.db, schema)
				}
				switch {
				case c.accepted && err != nil:
					t.Fatalf("server.New refused %s=%s: %v", envExportMax, c.value, err)
				case !c.accepted && (err == nil || !strings.Contains(err.Error(), envExportMax)):
					t.Fatalf("server.New with %s=%q: error %v, want a refusal naming %s", envExportMax, c.value, err, envExportMax)
				case !c.accepted && created:
					t.Fatal("a refused configuration created its schema")
				}
			})
		}
	})
}
