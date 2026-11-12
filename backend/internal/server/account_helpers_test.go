package server_test

// Helpers shared by the default build's tests and the legacy emulator tests of account_controls_test.go, which build
// only with the firebase_emulator tag. They are moved here verbatim from that file; every account and record they make
// is synthetic.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"ayailmu.local/backend/internal/server"
)

const (
	exportPath   = "/v1/me/export"
	deletionPath = "/v1/me/deletion"
	// confirmDeletion is the exact confirmation a deletion request carries, next to the caller's account ID.
	confirmDeletion = "delete-account"
	// nobodysAccount is a well-formed account ID that belongs to no account.
	nobodysAccount = "0b7e0f3c-5f6a-4d8e-9a1b-2c3d4e5f6a7b"
)

// credentialed is a synthetic emulator account whose address and password the test keeps: it can sign in again, and
// it can check that neither ever appears in an answer.
type credentialed struct {
	user
	email, password string
}

func newCredentialedUser(t *testing.T, emu string) credentialed {
	t.Helper()
	c := credentialed{email: "aya-it-" + randomHex(t, 8) + "@example.test", password: "pw-" + randomHex(t, 12)}
	var up struct {
		LocalID string `json:"localId"`
	}
	emulatorPost(t, emu, "accounts:signUp", map[string]any{"email": c.email, "password": c.password, "returnSecureToken": true}, &up)
	if up.LocalID == "" {
		t.Fatal("auth emulator sign-up returned no uid")
	}
	t.Cleanup(func() { deleteEmulatorUser(t, emu, up.LocalID) })
	c.uid = up.LocalID
	c.token = c.signIn(t, emu)
	return c
}

// signIn signs in again with the password: a new token whose auth_time is now.
func (c credentialed) signIn(t *testing.T, emu string) string {
	t.Helper()
	var in struct {
		IDToken string `json:"idToken"`
		LocalID string `json:"localId"`
	}
	emulatorPost(t, emu, "accounts:signInWithPassword", map[string]any{"email": c.email, "password": c.password, "returnSecureToken": true}, &in)
	if in.IDToken == "" || in.LocalID != c.uid {
		t.Fatal("auth emulator sign-in returned no token or another uid")
	}
	return in.IDToken
}

// withClaims re-encodes an emulator-issued token with changed claims, as authn_test.go does: an emulator-format
// UNSIGNED token the emulator never issued. The emulator verifier skips signatures, so this exercises claim handling
// only; production verification would refuse it.
func withClaims(t *testing.T, token string, change func(claims map[string]any)) string {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatal("emulator token is not a three-part JWT")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		t.Fatalf("decode emulator token claims: %v", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatalf("parse emulator token claims: %v", err)
	}
	change(claims)
	enc, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	return parts[0] + "." + base64.RawURLEncoding.EncodeToString(enc) + "." + parts[2]
}

// signedInAgo moves the token's sign-in time (auth_time) d into the past and changes nothing else. Its iat and exp
// stay those of a fresh token, so only a check of auth_time, not of the token's age, can tell.
func signedInAgo(t *testing.T, token string, d time.Duration) string {
	t.Helper()
	return withClaims(t, token, func(c map[string]any) { c["auth_time"] = float64(time.Now().Add(-d).Unix()) })
}

// emulatorHasUser reports whether the Auth emulator still holds this one synthetic account, through its local admin
// lookup by uid ("Bearer owner" is the emulator's documented local admin placeholder, not a credential). It fails
// closed: the answer must be read whole and be one JSON object of the lookup's documented shape. Absent means a 200
// without a users member (the emulator then sends its kind only, or {}) or a 400 whose error is USER_NOT_FOUND;
// present means a 200 whose users list holds exactly this uid. Anything else fails the test: another status, an
// unknown member or kind, users that is null, empty or not exactly this uid, or a 400 with another error.
func emulatorHasUser(t *testing.T, host, uid string) bool {
	t.Helper()
	b, err := json.Marshal(map[string][]string{"localId": {uid}})
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, "http://"+host+"/identitytoolkit.googleapis.com/v1/projects/"+testProject+"/accounts:lookup", bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer owner")
	resp, err := httpClient.Do(req)
	if err != nil {
		t.Fatalf("auth emulator lookup: %v", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		t.Fatalf("auth emulator lookup: reading the answer: %v", err)
	}
	// A cut-off body (over the read limit), JSON null or anything but one object fails here.
	var members map[string]json.RawMessage
	if body := bytes.TrimSpace(raw); len(body) == 0 || body[0] != '{' || json.Unmarshal(body, &members) != nil {
		t.Fatalf("auth emulator lookup: status %d with a body that is not one JSON object", resp.StatusCode)
	}
	switch resp.StatusCode {
	case http.StatusOK:
		for name, value := range members {
			var kind string
			switch {
			case name == "users":
			case name == "kind" && json.Unmarshal(value, &kind) == nil && kind == "identitytoolkit#GetAccountInfoResponse":
			default:
				t.Fatalf("auth emulator lookup: a 200 with the unexpected member %.40q", name)
			}
		}
		users, listed := members["users"]
		if !listed {
			return false
		}
		var list []struct {
			LocalID string `json:"localId"`
		}
		if !bytes.HasPrefix(bytes.TrimSpace(users), []byte("[")) || json.Unmarshal(users, &list) != nil || len(list) != 1 || list[0].LocalID != uid {
			t.Fatalf("auth emulator lookup: a 200 whose users member is not a list of exactly this uid (%d entries)", len(list))
		}
		return true
	case http.StatusBadRequest:
		var e struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		}
		if value, ok := members["error"]; ok && len(members) == 1 && bytes.HasPrefix(bytes.TrimSpace(value), []byte("{")) &&
			json.Unmarshal(value, &e) == nil && e.Code == http.StatusBadRequest &&
			(e.Message == "USER_NOT_FOUND" || strings.HasPrefix(e.Message, "USER_NOT_FOUND ")) {
			return false
		}
		t.Fatalf("auth emulator lookup: a 400 that is not USER_NOT_FOUND (error %.80q)", e.Message)
	}
	t.Fatalf("auth emulator lookup: unexpected status %d", resp.StatusCode)
	return false
}

// accountOf returns the caller's account ID as GET /v1/me reports it.
func (s *stack) accountOf(t *testing.T, token string) string {
	t.Helper()
	r := s.call(t, http.MethodGet, "/v1/me", token, nil)
	wantStatus(t, r, http.StatusOK)
	var m me
	decodeJSON(t, r.body, &m)
	if !uuidRE.MatchString(m.AccountID) {
		t.Fatalf("account ID %q is not a canonical UUID", m.AccountID)
	}
	return m.AccountID
}

// deletionBody is a deletion request with the exact confirmation for the account.
func deletionBody(accountID string) []byte {
	return []byte(`{"confirm":"` + confirmDeletion + `","account_id":"` + accountID + `"}`)
}

func (s *stack) deleteAccount(t *testing.T, token, accountID string) reply {
	t.Helper()
	return s.call(t, http.MethodPost, deletionPath, token, deletionBody(accountID))
}

// namedReason is one stable name with its explanation.
type namedReason struct {
	What string `json:"what"`
	Why  string `json:"why"`
}

// deletionDoc is the answer of POST and GET /v1/me/deletion.
type deletionDoc struct {
	DeletionID  string `json:"deletion_id"`
	AccountID   string `json:"account_id"`
	Status      string `json:"status"`
	RequestedAt string `json:"requested_at"`
	CompletedAt string `json:"completed_at"`
	ServerData  struct {
		Status      string `json:"status"`
		ErasedAt    string `json:"erased_at"`
		Profiles    int    `json:"profiles"`
		DeviceLinks int    `json:"device_links"`
		Events      int    `json:"events"`
		Imports     int    `json:"imports"`
	} `json:"server_data"`
	IdentityProvider struct {
		Status    string `json:"status"`
		Attempts  int    `json:"attempts"`
		DeletedAt string `json:"deleted_at"`
	} `json:"identity_provider"`
	NotDeleted []namedReason `json:"not_deleted"`
}

// wantDeletion checks a deletion document: the status code, a JSON body that may not be cached, the deletion's
// identity, the erased server data, an identity step that matches the state, and the deletion record and device data
// named as not deleted. A pending deletion never claims a deleted identity account or a completion.
func wantDeletion(t *testing.T, r reply, status int, accountID, state string) deletionDoc {
	t.Helper()
	wantStatus(t, r, status)
	if ct := r.header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var d deletionDoc
	decodeJSON(t, r.body, &d)
	if !uuidRE.MatchString(d.DeletionID) || d.AccountID != accountID || d.Status != state || !isRFC3339(d.RequestedAt) {
		t.Fatalf("deletion = %+v, want a deletion of account %s in state %s", d, accountID, state)
	}
	if d.ServerData.Status != "erased" || !isRFC3339(d.ServerData.ErasedAt) {
		t.Fatalf("server data = %+v, want erased, with the time", d.ServerData)
	}
	switch state {
	case "completed":
		if d.IdentityProvider.Status != "deleted" || !isRFC3339(d.IdentityProvider.DeletedAt) || !isRFC3339(d.CompletedAt) {
			t.Fatalf("completed deletion = %+v, want the identity account deleted and a completion time", d)
		}
	case "identity_deletion_pending":
		if d.IdentityProvider.Status != "pending" || d.IdentityProvider.DeletedAt != "" || d.CompletedAt != "" {
			t.Fatalf("pending deletion = %+v: it must not claim the identity account deleted or the deletion complete", d)
		}
	default:
		t.Fatalf("test setup: unknown deletion state %q", state)
	}
	var what []string
	for _, n := range d.NotDeleted {
		if n.Why == "" {
			t.Fatalf("not_deleted %q has no explanation", n.What)
		}
		what = append(what, n.What)
	}
	slices.Sort(what)
	if !slices.Equal(what, []string{"deletion_record", "device_data"}) {
		t.Fatalf("not_deleted names %v, want exactly deletion_record and device_data", what)
	}
	return d
}

func wantErased(t *testing.T, d deletionDoc, profiles, deviceLinks, events, imports int) {
	t.Helper()
	if sd := d.ServerData; sd.Profiles != profiles || sd.DeviceLinks != deviceLinks || sd.Events != events || sd.Imports != imports {
		t.Fatalf("erased %d profiles, %d device links, %d events and %d imports; want %d, %d, %d and %d",
			sd.Profiles, sd.DeviceLinks, sd.Events, sd.Imports, profiles, deviceLinks, events, imports)
	}
}

// wantGone checks that nothing of a deleted account remains or came back: no profile, device link or import of the
// account, no event of its profiles, and no other account for its identity.
func (s *stack) wantGone(t *testing.T, uid, accountID string, profileIDs ...string) {
	t.Helper()
	if n := s.count(t, `SELECT count(*) FROM accounts WHERE subject = $1 AND account_id <> $2::uuid`, uid, accountID); n != 0 {
		t.Fatalf("%d new accounts exist for the deleted identity", n)
	}
	if n := s.count(t, `SELECT (SELECT count(*) FROM profiles WHERE account_id = $1::uuid) +
		(SELECT count(*) FROM profile_sources WHERE account_id = $1::uuid) + (SELECT count(*) FROM imports WHERE account_id = $1::uuid)`, accountID); n != 0 {
		t.Fatalf("%d profile, device link or import rows of the deleted account remain", n)
	}
	if n := s.count(t, `SELECT count(*) FROM events WHERE profile_id::text = ANY($1)`, profileIDs); n != 0 {
		t.Fatalf("%d events of the deleted account's profiles remain", n)
	}
}

// exportDoc is GET /v1/me/export: every record the service stores for the account, and what it does not hold.
type exportDoc struct {
	Format      string `json:"format"`
	GeneratedAt string `json:"generated_at"`
	Contents    struct {
		Included    string        `json:"included"`
		NotIncluded []namedReason `json:"not_included"`
	} `json:"contents"`
	Account struct {
		AccountID string `json:"account_id"`
		CreatedAt string `json:"created_at"`
		Issuer    string `json:"issuer"`
		Subject   string `json:"subject"`
	} `json:"account"`
	Profiles []exportProfile `json:"profiles"`
}

type exportProfile struct {
	ProfileID string `json:"profile_id"`
	Kind      string `json:"kind"`
	CreatedAt string `json:"created_at"`
	Revision  int64  `json:"revision"`
	HighSeq   int64  `json:"high_seq"`
	Settings  struct {
		InstructionLang *string  `json:"instruction_lang"`
		SessionMinutes  *int     `json:"session_minutes"`
		ArabicScale     *float64 `json:"arabic_scale"`
	} `json:"settings"`
	Consent struct {
		Version string `json:"version"`
		At      string `json:"at"`
	} `json:"consent"`
	Sources []struct {
		App            string `json:"app"`
		InstallID      string `json:"install_id"`
		LocalProfileID string `json:"local_profile_id"`
		LinkedAt       string `json:"linked_at"`
	} `json:"sources"`
	Imports []struct {
		ImportID      string  `json:"import_id"`
		CreatedAt     string  `json:"created_at"`
		RequestSHA256 string  `json:"request_sha256"`
		Receipt       receipt `json:"receipt"`
	} `json:"imports"`
	Events []exportEvent `json:"events"`
}

// exportEvent is a pulled event plus the stored columns pull leaves out.
type exportEvent struct {
	pulled
	OccurredAt string  `json:"occurred_at"`
	LocalDate  string  `json:"local_date"`
	ImportID   *string `json:"import_id"`
}

// barrier is a re-armable BeforeCommit seam: after arm, it holds the first transaction that reaches it until open.
type barrier struct {
	mu      sync.Mutex
	armed   bool
	entered chan struct{}
	release chan struct{}
}

// arm makes the next BeforeCommit wait; the returned channel closes when one does.
func (b *barrier) arm() <-chan struct{} {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.armed, b.entered, b.release = true, make(chan struct{}), make(chan struct{})
	return b.entered
}

func (b *barrier) hold(context.Context) {
	b.mu.Lock()
	if !b.armed {
		b.mu.Unlock()
		return
	}
	b.armed = false
	entered, release := b.entered, b.release
	b.mu.Unlock()
	close(entered)
	<-release
}

// open releases a held transaction and disarms the barrier; calling it again is harmless.
func (b *barrier) open() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.armed = false
	if b.release != nil {
		select {
		case <-b.release:
		default:
			close(b.release)
		}
	}
}

// answered is one request's answer, or the transport error that stopped it.
type answered struct {
	r   reply
	err error
}

// async sends one request from its own goroutine; the channel delivers its answer once.
func (s *stack) async(method, path, token string, body []byte, headers ...string) <-chan answered {
	c := make(chan answered, 1)
	go func() {
		r, err := s.send(method, path, token, body, headers...)
		c <- answered{r, err}
	}()
	return c
}

func await(t *testing.T, c <-chan answered, what string) reply {
	t.Helper()
	select {
	case a := <-c:
		if a.err != nil {
			t.Fatalf("%s: %v", what, a.err)
		}
		return a.r
	case <-time.After(20 * time.Second):
		t.Fatalf("%s did not finish", what)
	}
	return reply{}
}

// restartWith stops the service and starts a new one on the same schema, as start does, with extra added to its
// environment. The data stays; the test that created the stack still owns the new service.
func (s *stack) restartWith(t *testing.T, extra map[string]string) {
	t.Helper()
	s.stop()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen on loopback: %v", err)
	}
	host := ln.Addr().String()
	env := serviceEnv(s.dbURL, s.emu, s.schema, host)
	for k, v := range extra {
		env[k] = v
	}
	svc, err := server.New(context.Background(), lookupIn(env), s.opts)
	if err != nil {
		ln.Close()
		t.Fatalf("server.New: %v", err)
	}
	srv := httptest.NewUnstartedServer(svc.Handler())
	srv.Listener.Close()
	srv.Listener = ln
	srv.Start()
	s.svc, s.srv, s.host, s.base = svc, srv, host, "http://"+host
}
