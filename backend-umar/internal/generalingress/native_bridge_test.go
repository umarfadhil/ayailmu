package generalingress

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
)

// Entire helper is excluded from product builds. No listener or real transport.
type wirePerson struct {
	ID, Email, Password string
	Confirmed           bool
}
type wireSession struct {
	User, ID, Method, Refresh string
	At, Expires               time.Time
	Active                    bool
}
type wireLearner struct {
	Profile store.Profile
	Owner   string
	Consent bool
	Events  []store.Record
}
type nativeWorld struct {
	runtimeHTTP bool
	clock       *testClock
	registry    *catalog.Registry
	users       map[string]*wirePerson
	accounts    map[string]string // signed provider subject -> distinct internal owner UUID
	sessions    map[string]*wireSession
	learners    map[string]*wireLearner
	codes       map[string]bool
	mail        int
	serial      int
}

func (*nativeWorld) OfflineOnly() bool { return true }
func (w *nativeWorld) Read(_ context.Context, token string) (auth.GoTrueSession, error) {
	s := w.sessions[token]
	if s == nil {
		return auth.GoTrueSession{}, ErrDenied
	}
	return auth.GoTrueSession{Principal: auth.Principal{Issuer: origin, Subject: s.User, AuthTime: s.At.Unix()}, SessionID: s.ID, Audience: "authenticated", Role: "authenticated", Method: s.Method, ExpiresAt: s.Expires}, nil
}
func (w *nativeWorld) Active(_ context.Context, issuer, user, sid string) (bool, error) {
	for _, s := range w.sessions {
		if issuer == origin && s.User == user && s.ID == sid {
			return s.Active, nil
		}
	}
	return false, nil
}
func (w *nativeWorld) issue(p *wirePerson, method string) map[string]any {
	w.serial++
	n := w.serial
	sid := fmt.Sprintf("30000000-0000-0000-0000-%012d", n)
	access := "fixture-access-" + strconv.Itoa(n)
	refresh := "fixture-refresh-" + strconv.Itoa(n)
	// Five-minute fixture token permits expiry testing with the fake clock;
	// this never changes the real provider's token policy.
	w.sessions[access] = &wireSession{User: p.ID, ID: sid, Method: method, Refresh: refresh, At: w.clock.Now(), Expires: w.clock.Now().Add(5 * time.Minute), Active: true}
	return map[string]any{"access_token": access, "refresh_token": refresh, "token_type": "bearer", "expires_in": 300, "user": w.user(p)}
}
func (w *nativeWorld) user(p *wirePerson) map[string]any {
	var confirmed any
	if p.Confirmed {
		confirmed = "2026-01-01T00:00:00Z"
	}
	return map[string]any{"id": p.ID, "email": p.Email, "email_confirmed_at": confirmed, "is_anonymous": false, "role": "authenticated"}
}
func (w *nativeWorld) personByID(id string) *wirePerson {
	for _, p := range w.users {
		if p.ID == id {
			return p
		}
	}
	return nil
}
func (w *nativeWorld) authRequest(r *http.Request) (int, any) {
	var in map[string]any
	if r.Body != nil {
		b, _ := io.ReadAll(r.Body)
		if len(b) > 0 && json.Unmarshal(b, &in) != nil {
			return 400, map[string]string{"error": "invalid_request"}
		}
	}
	field := func(k string) string { s, _ := in[k].(string); return s }
	email := field("email")
	p := w.users[email]
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	s := w.sessions[token]
	// Test-only provider allowance. This models an explicit GoTrue 429; it is
	// not a deployed policy or an app-owned durable journal.
	if (r.URL.Path == "/signup" || r.URL.Path == "/resend" || r.URL.Path == "/recover") && w.mail >= 8 {
		return 429, map[string]string{"error_code": "over_email_send_rate_limit"}
	}
	switch r.URL.Path {
	case "/signup":
		w.mail++
		if p == nil {
			w.serial++
			p = &wirePerson{ID: fmt.Sprintf("10000000-0000-0000-0000-%012d", w.serial), Email: email, Password: field("password")}
			w.users[email] = p
		}
		w.codes[email+"|signup"] = true
		return 200, map[string]any{}
	case "/resend", "/recover":
		w.mail++
		kind := "signup"
		if r.URL.Path == "/recover" {
			kind = "recovery"
		}
		if p != nil {
			w.codes[email+"|"+kind] = true
		}
		return 200, map[string]any{}
	case "/verify":
		kind := field("type")
		key := email + "|" + kind
		if p == nil || !w.codes[key] || field("token") != "123456" {
			return 401, map[string]string{"error_code": "invalid_otp"}
		}
		delete(w.codes, key)
		p.Confirmed = true
		method := "otp"
		if kind == "recovery" {
			method = "email/recovery"
		}
		return 200, w.issue(p, method)
	case "/token":
		if r.URL.Query().Get("grant_type") == "refresh_token" {
			for access, old := range w.sessions {
				if old.Refresh == field("refresh_token") && old.Active {
					old.Active = false
					p = w.personByID(old.User)
					result := w.issue(p, old.Method)
					newToken := result["access_token"].(string)
					w.sessions[newToken].ID = old.ID
					w.sessions[newToken].At = old.At
					delete(w.sessions, access)
					return 200, result
				}
			}
			return 401, map[string]string{"error_code": "invalid_refresh_token"}
		}
		if p == nil || p.Password != field("password") {
			return 401, map[string]string{"error_code": "invalid_credentials"}
		}
		if !p.Confirmed {
			return 400, map[string]string{"error_code": "email_not_confirmed"}
		}
		return 200, w.issue(p, "password")
	case "/user":
		if s == nil || !s.Active || !s.Expires.After(w.clock.Now()) {
			return 401, map[string]string{"error_code": "bad_jwt"}
		}
		p = w.personByID(s.User)
		if r.Method == "PUT" {
			p.Password = field("password")
		}
		return 200, w.user(p)
	case "/logout":
		if s == nil {
			return 401, map[string]string{"error": "unauthorized"}
		}
		s.Active = false
		return 204, nil
	}
	return 404, map[string]string{"error": "not_found"}
}
func (w *nativeWorld) api(r *http.Request) (int, any) {
	s := w.sessions[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
	if s == nil || !s.Active {
		return 401, map[string]string{"error": "unauthorized"}
	}
	owner := w.accounts[s.User]
	body, _ := io.ReadAll(r.Body)
	fail := func(code int, name string) (int, any) { return code, map[string]string{"error": name} }
	switch r.URL.Path {
	case "/v1/account":
		if owner == "" && r.Method == "POST" {
			w.serial++
			owner = fmt.Sprintf("40000000-0000-0000-0000-%012d", w.serial)
			w.accounts[s.User] = owner
		}
		if owner == "" {
			return fail(403, "adult_owner_required")
		}
		return 200, map[string]string{"account_id": owner}
	case "/v1/packs":
		return 200, w.registry
	case "/v1/learners":
		if r.Method == "GET" {
			out := []store.Profile{}
			for _, v := range w.learners {
				if v.Owner == owner {
					out = append(out, v.Profile)
				}
			}
			return 200, out
		}
		var in store.ProfileInput
		if native.Decode(body, &in) != nil {
			return fail(400, "invalid_request")
		}
		for _, v := range w.learners {
			if v.Owner == owner && v.Profile.ClientLearnerID == in.ClientLearnerID {
				return 200, v.Profile
			}
		}
		w.serial++
		p := store.Profile{ID: fmt.Sprintf("20000000-0000-0000-0000-%012d", w.serial), ClientLearnerID: in.ClientLearnerID, Kind: in.Kind, Audience: "adults", Lang: in.Lang}
		w.learners[p.ID] = &wireLearner{Profile: p, Owner: owner, Events: []store.Record{}}
		return 200, p
	}
	m := learnerRoute.FindStringSubmatch(r.URL.Path)
	if len(m) == 0 {
		return fail(404, "not_found")
	}
	learner := w.learners[m[1]]
	if learner == nil || learner.Owner != owner {
		return fail(404, "not_found")
	}
	if m[2] == "consent" {
		var in struct {
			Granted   bool   `json:"granted"`
			Version   string `json:"version"`
			Synthetic bool   `json:"synthetic"`
		}
		if native.Decode(body, &in) != nil || in.Version != "fixture-sync-v1" || in.Synthetic {
			return fail(400, "invalid_request")
		}
		learner.Consent = in.Granted
		return 200, map[string]bool{"granted": in.Granted}
	}
	if !learner.Consent {
		return fail(403, "sync_consent_required")
	}
	if r.Method == "GET" {
		after, _ := strconv.Atoi(r.URL.Query().Get("after"))
		events := []store.Record{}
		for _, e := range learner.Events {
			if e.Sequence > int64(after) {
				events = append(events, e)
			}
		}
		return 200, store.Page{Events: events, NextCursor: int64(len(learner.Events))}
	}
	var in struct {
		Schema    int      `json:"schema_version"`
		Synthetic bool     `json:"synthetic"`
		Events    []string `json:"events"`
	}
	if native.Decode(body, &in) != nil {
		return fail(400, "invalid_request")
	}
	receipts := []store.Receipt{}
	for _, raw := range in.Events {
		event, err := native.ParseForMode([]byte(raw), false, false)
		if err != nil {
			return fail(400, "invalid_native_event")
		}
		if _, err = store.ValidateRegistryEvent(w.registry, event, learner.Profile); err != nil {
			return fail(400, "invalid_reference")
		}
		duplicate := false
		for _, old := range learner.Events {
			var prior native.Event
			json.Unmarshal([]byte(old.Payload), &prior)
			if prior.AnswerID == event.AnswerID {
				if old.Payload != raw {
					return fail(409, "idempotency_conflict")
				}
				receipts = append(receipts, store.Receipt{AnswerID: event.AnswerID, Sequence: old.Sequence, Duplicate: true, RegistryStatus: "registered"})
				duplicate = true
				break
			}
		}
		if !duplicate {
			seq := int64(len(learner.Events) + 1)
			learner.Events = append(learner.Events, store.Record{Sequence: seq, Payload: raw, RegistryStatus: "registered"})
			receipts = append(receipts, store.Receipt{AnswerID: event.AnswerID, Sequence: seq, RegistryStatus: "registered"})
		}
	}
	return 200, receipts
}
func (w *nativeWorld) RoundTrip(r *http.Request) (*http.Response, error) {
	status := 0
	var body any
	if strings.HasPrefix(r.URL.Path, "/v1/") {
		status, body = w.api(r)
	} else {
		status, body = w.authRequest(r)
	}
	raw := []byte{}
	if status != 204 {
		raw, _ = json.Marshal(body)
	}
	cert := &x509.Certificate{Raw: []byte("existing-synthetic-public-root-model-no-key")}
	name := "auth-api.example.invalid"
	if w.runtimeHTTP {
		name = "localhost"
	}
	return &http.Response{StatusCode: status, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(bytes.NewReader(raw)), Request: r, TLS: &tls.ConnectionState{HandshakeComplete: true, ServerName: name, VerifiedChains: [][]*x509.Certificate{{cert}}}}, nil
}

func TestNativeWireBridgeHelper(t *testing.T) {
	if os.Getenv("AYAILMU_NATIVE_WIRE_HELPER") != "1" {
		t.Skip("pipe-only JVM helper")
	}
	parent := os.Getenv("AYAILMU_NATIVE_WIRE_TEMP")
	source := os.Getenv("AYAILMU_NATIVE_WIRE_SOURCE")
	if parent == "" || source == "" {
		t.Fatal("explicit fixture directories required")
	}
	deadline := time.AfterFunc(90*time.Second, func() { os.Exit(70) })
	defer deadline.Stop()
	root, err := os.MkdirTemp(parent, "fixture-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(root)
	registry := &catalog.Registry{}
	raw, err := os.ReadFile(filepath.Join(source, "backend-umar/candidates/reviewed-math/finalized-registry.json"))
	if err != nil || json.Unmarshal(raw, registry) != nil {
		t.Fatal("reviewed registry absent")
	}
	if os.Getenv("AYAILMU_NATIVE_RUNTIME_WIRE") == "1" {
		registry, err = catalog.LoadDeployment(filepath.Join(source, "backend-umar/candidates/reviewed-math/finalized-registry.json"), "11753bbc33b789fec5e778044400e71fe98e46b2836216e9da6252c465a46afb", "b6e0d6123cb359436f83ce3ae0685198ee13a815", true)
		if err != nil {
			t.Fatal("exact reviewed deployment registry rejected")
		}
	}
	clock := &testClock{wall: time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)}
	w := &nativeWorld{clock: clock, registry: registry, users: map[string]*wirePerson{}, accounts: map[string]string{}, sessions: map[string]*wireSession{}, learners: map[string]*wireLearner{}, codes: map[string]bool{}}
	runtimeMode := os.Getenv("AYAILMU_NATIVE_RUNTIME_WIRE") == "1"
	w.runtimeHTTP = runtimeMode
	var keyer *HMACKeyer
	var budget *Budget
	if !runtimeMode {
		keyer, err = NewHMACKeyer(true, "public-rfc4231-fixture", "ayailmu", bytes.Repeat([]byte{0xaa}, 131))
		if err != nil {
			t.Fatal(err)
		}
		disk, err := NewFileJournal(filepath.Join(root, "ledger"))
		if err != nil {
			t.Fatal(err)
		}
		budget, err = NewBudget(BudgetPolicy{Simulation: true, Scope: "wire-fixture", Deadline: clock.Now().Add(time.Hour), Global: 8, RecipientHour: 4, IPHour: 8, Cooldown: time.Minute, IdentityBinding: keyer.PolicyBinding()}, disk)
		if err != nil || budget.Initialize(context.Background(), clock.Now()) != nil {
			t.Fatal("legacy simulation fixture unavailable")
		}
	}
	sum := sha256.Sum256([]byte("existing-synthetic-public-root-model-no-key"))
	policy := Policy{Simulation: !runtimeMode, MailEnabled: true, Origin: origin, Issuer: origin, Audience: "authenticated", Deadline: clock.Now().Add(time.Hour), MaxConcurrent: 4, MailGlobal: 8, MailRecipientHour: 4, MailIPHour: 8, MailCooldown: time.Minute, AuthIPMinute: 1000, AuthRecipientMinute: 1000, MaxState: 1000, DeclarationVersion: "fixture-adult-v1", ConsentVersion: "fixture-sync-v1"}
	if runtimeMode {
		policy.MailGlobal = 0
		policy.MailIPHour = 100
	}
	runtimeConfig := RuntimeConfig{Enabled: true, Listen: "127.0.0.1:58480", UpstreamOrigin: "https://localhost:58443", CAHash: hex.EncodeToString(sum[:]), Revocation: RequireSessionStatus, Policy: ordinaryPolicyFixture(policy)}
	var p *HTTPProvider
	var b *HTTPBackend
	if runtimeMode {
		p, b, err = runtimeAdapters(runtimeConfig, clock, w, w, w, nil, nil)
	} else {
		p, b, err = NewHTTPAdapters(AdapterConfig{Simulation: true, PublicOrigin: origin, UpstreamOrigin: "https://auth-api.example.invalid", CAHash: hex.EncodeToString(sum[:]), Now: clock.Now, DeclarationVersion: "fixture-adult-v1", ConsentVersion: "fixture-sync-v1", Revocation: RequireSessionStatus}, w, w, w, budget, keyer)
	}
	if err != nil {
		t.Fatal(err)
	}
	var e *Engine
	if runtimeMode {
		e, err = NewRuntime(runtimeConfig, clock, p, p, b)
	} else {
		e, err = New(policy, clock, p, p, b)
	}
	if err != nil {
		t.Fatal(err)
	}
	var handler http.Handler
	if runtimeMode {
		handler, err = NewRuntimeHandler(runtimeConfig, e)
		if err != nil {
			t.Fatal(err)
		}
	}
	decoder := json.NewDecoder(bufio.NewReader(os.Stdin))
	encoder := json.NewEncoder(os.Stdout)
	for {
		var in struct {
			Method, Target, Peer, Body, Control string
			Headers                             [][2]string
			Seconds                             int
		}
		if err := decoder.Decode(&in); err == io.EOF {
			return
		} else if err != nil {
			t.Fatal("fixture pipe parse failure")
		}
		if in.Control != "" {
			if in.Control == "stop" {
				encoder.Encode(map[string]any{"status": 0, "body": "{}"})
				return
			}
			if in.Control == "advance" {
				clock.advance(time.Duration(in.Seconds) * time.Second)
			}
			if in.Control == "restart_gateway" && runtimeMode {
				e.Stop()
				p, b, err = runtimeAdapters(runtimeConfig, clock, w, w, w, nil, nil)
				if err != nil {
					t.Fatal(err)
				}
				e, err = NewRuntime(runtimeConfig, clock, p, p, b)
				if err != nil {
					t.Fatal(err)
				}
				handler, err = NewRuntimeHandler(runtimeConfig, e)
				if err != nil {
					t.Fatal(err)
				}
			}
			encoder.Encode(map[string]any{"status": 200, "body": fmt.Sprintf(`{"mail":%d,"accounts":%d,"runtime_http":%t}`, w.mail, len(w.users), runtimeMode)})
			continue
		}
		var status int
		var out []byte
		if runtimeMode {
			r := httptest.NewRequest(in.Method, in.Target, strings.NewReader(in.Body))
			r.RemoteAddr = net.JoinHostPort(in.Peer, "1234")
			r.TLS = &tls.ConnectionState{HandshakeComplete: true}
			for _, h := range in.Headers {
				if strings.EqualFold(h[0], "Host") {
					r.Host = h[1]
				} else {
					r.Header.Add(h[0], h[1])
				}
			}
			result := httptest.NewRecorder()
			handler.ServeHTTP(result, r)
			status = result.Code
			out = result.Body.Bytes()
		} else {
			response := e.Handle(context.Background(), Request{Method: in.Method, Target: in.Target, Peer: in.Peer, TLS: true, Headers: in.Headers, Body: []byte(in.Body)})
			status, out = EncodeResponse(response)
		}
		if encoder.Encode(map[string]any{"status": status, "body": string(out)}) != nil {
			return
		}
	}
}
