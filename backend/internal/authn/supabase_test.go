package authn_test

// Supabase Auth adapter, Phase 2 RED. SupabaseVerifier is pinned against an owned loopback TLS stand-in for one
// standalone Supabase Auth (GoTrue v2.197.0) server. Keys are ephemeral synthetic P-256 keys used through go-jose, the
// maintained library that does all cryptography; users, sessions and the admin credential are synthetic. No failure
// message prints a token or the admin credential.

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
)

const (
	// supabaseBase is the path the stand-in serves Auth under, as a gateway would.
	supabaseBase = "/auth/v1"
	// supabaseAudience is the aud claim Auth gives signed-in users.
	supabaseAudience = "authenticated"
)

// supabaseAuth stands in for one Auth server on owned loopback TLS. GET /user and DELETE /admin/users/{id} answer as
// the current subtest sets; every request is counted, and one that breaks the adapter's side of the contract is
// recorded as a fault. It trusts any bearer token, so only the adapter's own checks can refuse a forged one.
type supabaseAuth struct {
	srv       *httptest.Server
	key       *ecdsa.PrivateKey
	kid       string
	issuer    string
	jwks      []byte
	uid       string
	sessionID string
	adminKey  string
	marker    string
	stop      chan struct{}

	mu     sync.Mutex
	bearer string
	user   http.HandlerFunc
	remove http.HandlerFunc
	calls  map[string]int
	faults []string
}

func newSupabaseAuth(t *testing.T) *supabaseAuth {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	a := &supabaseAuth{key: key, kid: "kid-" + randomHex(t, 4), uid: randomUUID(t), sessionID: randomUUID(t),
		adminKey: "adm-" + randomHex(t, 16), marker: "auth-says-" + randomHex(t, 6), stop: make(chan struct{})}
	public := jose.JSONWebKey{Key: &key.PublicKey, KeyID: a.kid, Algorithm: string(jose.ES256), Use: "sig"}
	a.jwks = mustJSON(t, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{public}})
	a.expect(t, "", nil, nil)
	a.srv = httptest.NewTLSServer(http.HandlerFunc(a.serve))
	t.Cleanup(a.srv.Close)
	t.Cleanup(func() { close(a.stop) }) // runs first, so no handler still waits when the server closes
	a.issuer = a.srv.URL + supabaseBase
	return a
}

func (a *supabaseAuth) serve(w http.ResponseWriter, r *http.Request) {
	a.mu.Lock()
	a.calls[r.Method+" "+r.URL.Path]++
	bearer, user, remove := a.bearer, a.user, a.remove
	a.mu.Unlock()
	switch {
	case r.Method == http.MethodGet && r.URL.Path == supabaseBase+"/user":
		if r.Header.Get("Authorization") != "Bearer "+bearer {
			a.fault("GET /user did not carry exactly the caller's bearer token")
		}
		user(w, r)
	case r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, supabaseBase+"/admin/users/"):
		if r.Header.Get("Authorization") != "Bearer "+a.adminKey {
			a.fault("the admin request did not carry exactly the admin credential")
		}
		var body map[string]any
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<10)).Decode(&body); err != nil || len(body) != 1 || body["should_soft_delete"] != false {
			a.fault(`the admin request's body is not {"should_soft_delete":false}`)
		}
		remove(w, r)
	case r.URL.Path == supabaseBase+"/elsewhere":
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(a.userDoc(a.uid))
	default:
		http.NotFound(w, r)
	}
}

func (a *supabaseAuth) fault(what string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.faults = append(a.faults, what)
}

// expect starts a subtest. GET /user expects bearer and answers with user, by default confirming the synthetic user;
// DELETE answers with remove, by default Auth's success (200 {}). The counts and faults restart.
func (a *supabaseAuth) expect(t *testing.T, bearer string, user, remove http.HandlerFunc) {
	t.Helper()
	if user == nil {
		user = answerJSON(t, http.StatusOK, a.userDoc(a.uid))
	}
	if remove == nil {
		remove = answer(http.StatusOK, "{}")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.bearer, a.user, a.remove, a.calls, a.faults = bearer, user, remove, map[string]int{}, nil
}

// served reports how often Auth served request and how many requests reached it in all. It fails the test when a
// request broke the adapter's side of the contract.
func (a *supabaseAuth) served(t *testing.T, request string) (n, total int) {
	t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.faults) > 0 {
		t.Fatalf("the adapter broke its side of Auth's contract: %q", a.faults)
	}
	for _, c := range a.calls {
		total += c
	}
	return a.calls[request], total
}

// settings is a valid configuration for the stand-in: its TLS address under supabaseBase, trusted through its own client.
func (a *supabaseAuth) settings() authn.SupabaseConfig {
	return authn.SupabaseConfig{BaseURL: a.srv.URL + supabaseBase, Issuer: a.issuer, Audience: supabaseAudience, JWKS: a.jwks,
		AdminKey: config.Secret(a.adminKey), HTTPClient: a.srv.Client()}
}

func (a *supabaseAuth) verifier(t *testing.T) *authn.SupabaseVerifier {
	t.Helper()
	v, err := authn.NewSupabaseVerifier(a.settings())
	if err != nil || v == nil {
		t.Fatalf("NewSupabaseVerifier(a valid synthetic configuration): %s", a.describe(err))
	}
	return v
}

// claims is a valid access token's claim set, as Auth v2.197.0 issues one right after a password sign-in.
func (a *supabaseAuth) claims() map[string]any {
	now := time.Now().Unix()
	return map[string]any{
		"iss":           a.issuer,
		"aud":           supabaseAudience,
		"sub":           a.uid,
		"role":          "authenticated",
		"exp":           now + 3600,
		"iat":           now - 30,
		"session_id":    a.sessionID,
		"is_anonymous":  false,
		"email":         "aya-it-" + a.uid[:8] + "@example.test",
		"app_metadata":  map[string]any{"provider": "email", "providers": []string{"email"}},
		"user_metadata": map[string]any{},
		"amr":           []any{signIn("password", now-30)},
	}
}

// sign signs claims with the configured key under its kid, as Auth does.
func (a *supabaseAuth) sign(t *testing.T, claims map[string]any) string {
	t.Helper()
	return signJWT(t, jose.SigningKey{Algorithm: jose.ES256, Key: jose.JSONWebKey{Key: a.key, KeyID: a.kid}}, claims)
}

// userDoc is GET /user's answer about a user, as Auth v2.197.0 shapes it; its metadata carries the answer marker.
func (a *supabaseAuth) userDoc(id string) map[string]any {
	return map[string]any{
		"id":            id,
		"aud":           supabaseAudience,
		"role":          "authenticated",
		"email":         "aya-it-" + id[:8] + "@example.test",
		"app_metadata":  map[string]any{"provider": "email", "providers": []string{"email"}},
		"user_metadata": map[string]any{"note": a.marker},
		"is_anonymous":  false,
	}
}

// problem is Auth's error document; its message carries the answer marker.
func (a *supabaseAuth) problem(status int, code string) map[string]any {
	return map[string]any{"code": status, "error_code": code, "msg": a.marker}
}

// hang never answers: it waits until the caller gives up or the test ends.
func (a *supabaseAuth) hang(_ http.ResponseWriter, r *http.Request) {
	select {
	case <-r.Context().Done():
	case <-a.stop:
	}
}

// quotes reports whether err's text quotes the admin credential, the synthetic user or session, the answer marker or
// any of extra (tokens and claims).
func (a *supabaseAuth) quotes(err error, extra ...string) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	for _, s := range append([]string{a.adminKey, a.uid, a.sessionID, a.marker}, extra...) {
		if len(s) > 16 && strings.Contains(msg, s) {
			return true
		}
	}
	return false
}

// describe renders err for a failure message, withholding text that quotes what quotes looks for.
func (a *supabaseAuth) describe(err error, extra ...string) string {
	if err == nil || a.quotes(err, extra...) {
		return fmt.Sprintf("no error or a withheld one (nil %t)", err == nil)
	}
	return fmt.Sprintf("%q", err.Error())
}

// signIn is one amr entry: a method and when it happened.
func signIn(method string, at int64) map[string]any {
	return map[string]any{"method": method, "timestamp": at}
}

// signJWT signs claims as a compact JWS with go-jose.
func signJWT(t *testing.T, key jose.SigningKey, claims map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(key, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatalf("go-jose signer: %v", err)
	}
	signed, err := signer.Sign(mustJSON(t, claims))
	if err != nil {
		t.Fatalf("go-jose sign: %v", err)
	}
	token, err := signed.CompactSerialize()
	if err != nil {
		t.Fatalf("go-jose serialize: %v", err)
	}
	return token
}

// signedBy signs with another key or algorithm than Auth's.
func signedBy(alg jose.SignatureAlgorithm, key any) func(*testing.T, map[string]any) string {
	return func(t *testing.T, claims map[string]any) string {
		return signJWT(t, jose.SigningKey{Algorithm: alg, Key: key}, claims)
	}
}

// unsignedJWT is an "alg":"none" token.
func unsignedJWT(t *testing.T, claims map[string]any) string {
	t.Helper()
	enc := base64.RawURLEncoding.EncodeToString
	return enc([]byte(`{"alg":"none","typ":"JWT"}`)) + "." + enc(mustJSON(t, claims)) + "."
}

// answer is an Auth answer: status and exactly body.
func answer(status int, body string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

func answerJSON(t *testing.T, status int, v any) http.HandlerFunc {
	t.Helper()
	return answer(status, string(mustJSON(t, v)))
}

func redirectTo(path string, status int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, path, status) }
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// randomUUID is a synthetic canonical UUID: lowercase, version 4.
func randomUUID(t *testing.T) string {
	t.Helper()
	h := randomHex(t, 16)
	return h[:8] + "-" + h[8:12] + "-4" + h[13:16] + "-a" + h[17:20] + "-" + h[20:]
}

// NewSupabaseVerifier pins the Auth server and its keys. The base URL is https, or plain http on a canonical literal
// loopback address in synthetic mode only; userinfo, a query, a fragment and other unsafe URLs are refused without
// quoting them. Issuer, audience, the admin credential and a key set of asymmetric public keys are required. Neither
// the verifier nor its configuration ever prints the admin credential.
func TestNewSupabaseVerifierPinsTheAuthServerAndItsKeys(t *testing.T) {
	a := newSupabaseAuth(t)
	marker := "unsafe-" + randomHex(t, 6)
	other, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	modulus := make([]byte, 1024) // an RSA modulus of 8192 bits
	if _, err := rand.Read(modulus); err != nil {
		t.Fatal(err)
	}
	modulus[0] |= 0x80
	set := func(k jose.JSONWebKey) []byte {
		return mustJSON(t, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{k}})
	}
	for _, c := range []struct {
		name      string
		baseURL   string
		synthetic bool
		jwks      []byte
		edit      func(*authn.SupabaseConfig)
		ok        bool
	}{
		{name: "the TLS Auth server under a path", ok: true},
		{name: "an https host name", baseURL: "https://auth.ayailmu.test", ok: true},
		{name: "plain http on IPv4 loopback in synthetic mode", baseURL: "http://127.0.0.1:9999", synthetic: true, ok: true},
		{name: "plain http on IPv6 loopback in synthetic mode", baseURL: "http://[::1]:9999", synthetic: true, ok: true},
		{name: "plain http outside synthetic mode", baseURL: "http://127.0.0.1:9999"},
		{name: "plain http to a LAN address", baseURL: "http://192.0.2.10:9999", synthetic: true},
		{name: "plain http by host name", baseURL: "http://localhost:9999", synthetic: true},
		{name: "plain http without an explicit port", baseURL: "http://127.0.0.1", synthetic: true},
		{name: "plain http to an IPv4-mapped address", baseURL: "http://[::ffff:127.0.0.1]:9999", synthetic: true},
		{name: "userinfo", baseURL: "https://admin:" + marker + "@auth.ayailmu.test"},
		{name: "a query", baseURL: "https://auth.ayailmu.test/auth/v1?apikey=" + marker},
		{name: "a fragment", baseURL: "https://auth.ayailmu.test/auth/v1#" + marker},
		{name: "dot segments", baseURL: "https://auth.ayailmu.test/auth/../" + marker},
		{name: "another scheme", baseURL: "ftp://auth.ayailmu.test/" + marker},
		{name: "no host", baseURL: "https:///" + marker},
		{name: "a relative URL", baseURL: marker + "/auth/v1"},
		{name: "no issuer", edit: func(c *authn.SupabaseConfig) { c.Issuer = "" }},
		{name: "no audience", edit: func(c *authn.SupabaseConfig) { c.Audience = "" }},
		{name: "no admin credential", edit: func(c *authn.SupabaseConfig) { c.AdminKey = "" }},
		{name: "a malformed key set", jwks: []byte(`{"keys":[{"kty":"` + marker)},
		{name: "an empty key set", jwks: []byte(`{"keys":[]}`)},
		{name: "a symmetric key", jwks: set(jose.JSONWebKey{Key: []byte(randomHex(t, 32)), KeyID: "hmac", Algorithm: string(jose.HS256), Use: "sig"})},
		{name: "a private key", jwks: set(jose.JSONWebKey{Key: other, KeyID: "private", Algorithm: string(jose.ES256), Use: "sig"})},
		{name: "an RSA key over go-jose's default 4096-bit cap", jwks: []byte(`{"keys":[{"kty":"RSA","kid":"rsa-8192","alg":"RS256","use":"sig","n":"` +
			base64.RawURLEncoding.EncodeToString(modulus) + `","e":"AQAB"}]}`)},
	} {
		t.Run(c.name, func(t *testing.T) {
			cfg := a.settings()
			if c.baseURL != "" {
				cfg.BaseURL, cfg.LocalSynthetic = c.baseURL, c.synthetic
			}
			if c.jwks != nil {
				cfg.JWKS = c.jwks
			}
			if c.edit != nil {
				c.edit(&cfg)
			}
			v, err := authn.NewSupabaseVerifier(cfg)
			switch {
			case c.ok && (err != nil || v == nil):
				t.Fatalf("NewSupabaseVerifier refused a safe configuration: %s", a.describe(err))
			case c.ok && strings.Contains(fmt.Sprintf("%v %+v %#v %v %+v %#v", v, v, v, cfg, cfg, cfg), a.adminKey):
				t.Fatal("formatting the verifier or its configuration prints the admin credential")
			case !c.ok && (v != nil || !errors.Is(err, authn.ErrUnsafeConfig)):
				t.Fatalf("NewSupabaseVerifier accepted an unsafe configuration (verifier %t, ErrUnsafeConfig %t)", v != nil, errors.Is(err, authn.ErrUnsafeConfig))
			case !c.ok && (strings.Contains(err.Error(), marker) || a.quotes(err)):
				t.Fatal("the refusal quotes the configuration")
			}
		})
	}
}

// VerifySession proves a token locally (a configured key, the exact issuer and audience, the authenticated role, a
// canonical UUID subject, a session and valid times), then asks Auth's GET /user, which must confirm the same active
// user and session. The sign-in time is the verified amr password entry's: never iat and never a refresh. Verify
// returns the same identity.
func TestSupabaseVerifySessionProvesTheUserAndTheirPasswordSignIn(t *testing.T) {
	a := newSupabaseAuth(t)
	v := a.verifier(t)
	ctx := context.Background()
	now := time.Now().Unix()
	want := authn.Identity{Issuer: a.issuer, Subject: a.uid, SignInProvider: "email"}
	for _, c := range []struct {
		name     string
		iat      int64
		amr      []any
		signedIn int64
	}{
		{"a fresh password sign-in", now - 30, []any{signIn("password", now-30)}, now - 30},
		{"a refreshed token keeps the password sign-in time", now, []any{signIn("password", now-7200), signIn("token_refresh", now)}, now - 7200},
		{"a refresh alone is no sign-in", now, []any{signIn("token_refresh", now)}, 0},
		{"no amr, no sign-in time", now - 30, nil, 0},
	} {
		t.Run(c.name, func(t *testing.T) {
			claims := a.claims()
			claims["iat"], claims["amr"] = c.iat, c.amr
			if c.amr == nil {
				delete(claims, "amr")
			}
			token := a.sign(t, claims)
			a.expect(t, token, nil, nil)
			s, err := v.VerifySession(ctx, token)
			switch {
			case err != nil:
				t.Fatalf("VerifySession(a valid synthetic token): %s", a.describe(err, token))
			case s.Identity != want:
				t.Fatalf("identity = %+v, want %+v", s.Identity, want)
			case c.signedIn == 0 && !s.AuthTime.IsZero():
				t.Fatalf("sign-in time %v without a password sign-in, want none", s.AuthTime)
			case c.signedIn != 0 && !s.AuthTime.Equal(time.Unix(c.signedIn, 0)):
				t.Fatalf("sign-in time %v, want the password sign-in's %v: never iat or a refresh", s.AuthTime, time.Unix(c.signedIn, 0))
			}
			if id, err := v.Verify(ctx, token); err != nil || id != s.Identity {
				t.Fatalf("Verify = %+v (%s), want VerifySession's identity", id, a.describe(err, token))
			}
			if n, _ := a.served(t, "GET "+supabaseBase+"/user"); n != 2 {
				t.Fatalf("Auth's GET /user answered %d times for two verifications, want once each", n)
			}
		})
	}
}

// What the adapter cannot prove it refuses with ErrUnauthenticated, quoting no token, claim, credential or answer of
// Auth. A token that fails locally never reaches Auth. Otherwise Auth's GET /user is asked exactly once, and its
// refusal, another user, a banned user, a redirect, or a malformed, oversized or late answer is a refusal too.
func TestSupabaseVerifierRefusesWhatItCannotProve(t *testing.T) {
	a := newSupabaseAuth(t)
	v := a.verifier(t)
	other, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	banned := a.userDoc(a.uid)
	banned["banned_until"] = time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	oversized := a.userDoc(a.uid)
	oversized["user_metadata"] = map[string]any{"note": a.marker, "pad": strings.Repeat("x", 2<<20)}
	for _, c := range []struct {
		name   string
		claims func(c map[string]any)
		sign   func(t *testing.T, c map[string]any) string
		user   http.HandlerFunc
		wait   time.Duration
	}{
		{name: "signed by another key under the configured kid", sign: signedBy(jose.ES256, jose.JSONWebKey{Key: other, KeyID: a.kid})},
		{name: "HS256 keyed with the published key set", sign: signedBy(jose.HS256, a.jwks)},
		{name: "alg none", sign: unsignedJWT},
		{name: "a kid the key set does not hold", sign: signedBy(jose.ES256, jose.JSONWebKey{Key: other, KeyID: "kid-unknown"})},
		{name: "another issuer", claims: func(c map[string]any) { c["iss"] = "https://auth.other.test" + supabaseBase }},
		{name: "another audience", claims: func(c map[string]any) { c["aud"] = "authenticated-elsewhere" }},
		{name: "expired", claims: func(c map[string]any) { c["exp"] = time.Now().Add(-10 * time.Minute).Unix() }},
		{name: "not valid yet", claims: func(c map[string]any) { c["nbf"] = time.Now().Add(10 * time.Minute).Unix() }},
		{name: "issued in the future", claims: func(c map[string]any) { c["iat"] = time.Now().Add(10 * time.Minute).Unix() }},
		{name: "the service_role key", claims: func(c map[string]any) { c["role"] = "service_role" }},
		{name: "the anon key", claims: func(c map[string]any) { c["role"] = "anon" }},
		{name: "an anonymous user", claims: func(c map[string]any) { c["is_anonymous"] = true }},
		{name: "no session", claims: func(c map[string]any) { delete(c, "session_id") }},
		{name: "a subject that is not a canonical UUID", claims: func(c map[string]any) { c["sub"] = strings.ToUpper(a.uid) }},
		{name: "not a JWT", sign: func(*testing.T, map[string]any) string { return "not-a-jwt" }},
		{name: "Auth answers about another user", user: answerJSON(t, http.StatusOK, a.userDoc(randomUUID(t)))},
		{name: "Auth reports the session revoked", user: answerJSON(t, http.StatusForbidden, a.problem(http.StatusForbidden, "session_not_found"))},
		{name: "Auth no longer has the user", user: answerJSON(t, http.StatusNotFound, a.problem(http.StatusNotFound, "user_not_found"))},
		{name: "Auth reports the user banned", user: answerJSON(t, http.StatusOK, banned)},
		{name: "Auth redirects", user: redirectTo(supabaseBase+"/elsewhere", http.StatusFound)},
		{name: "Auth answers malformed JSON", user: answer(http.StatusOK, `{"id":"`+a.uid)},
		{name: "Auth answers more than any user document holds", user: answerJSON(t, http.StatusOK, oversized)},
		{name: "Auth does not answer in time", user: a.hang, wait: 300 * time.Millisecond},
	} {
		t.Run(c.name, func(t *testing.T) {
			claims, sign, wait := a.claims(), c.sign, c.wait
			if c.claims != nil {
				c.claims(claims)
			}
			if sign == nil {
				sign = a.sign
			}
			if wait == 0 {
				wait = 5 * time.Second
			}
			token := sign(t, claims)
			a.expect(t, token, c.user, nil)
			ctx, cancel := context.WithTimeout(context.Background(), wait)
			defer cancel()
			start := time.Now()
			s, err := v.VerifySession(ctx, token)
			switch elapsed := time.Since(start); {
			case !errors.Is(err, authn.ErrUnauthenticated) || s != (authn.Session{}):
				t.Fatalf("VerifySession accepted what it cannot prove (error %s)", a.describe(err, token))
			case a.quotes(err, token, strings.ToUpper(a.uid)):
				t.Fatal("the refusal quotes the token, a claim, the admin credential or Auth's answer")
			case elapsed > wait+2*time.Second:
				t.Fatalf("the refusal took %v, well past the caller's deadline", elapsed)
			}
			switch asked, total := a.served(t, "GET "+supabaseBase+"/user"); {
			case c.user == nil && asked != 0:
				t.Fatalf("a token that fails locally was sent to Auth (%d requests)", asked)
			case c.user != nil && asked != 1:
				t.Fatalf("Auth's GET /user was asked %d times, want once", asked)
			case total != asked:
				t.Fatal("a request reached Auth elsewhere than GET /user: a redirect was followed")
			}
		})
	}
}

// DeleteIdentity deletes only a canonical UUID user of its own issuer, through DELETE /admin/users/{id} with the
// server-only admin credential and an explicit hard delete. Auth v2.197.0's success, 200 {}, and a precise 404
// user_not_found count as deleted; nothing else does. A refused identity reaches no endpoint. Failures wrap
// ErrIdentityNotDeleted and quote no credential, subject or answer of Auth.
func TestSupabaseDeleteIdentityDeletesOnlyItsOwnUsers(t *testing.T) {
	a := newSupabaseAuth(t)
	v := a.verifier(t)
	own := authn.Identity{Issuer: a.issuer, Subject: a.uid, SignInProvider: "email"}
	foreign, pathlike := own, own
	foreign.Issuer = "https://auth.other.test" + supabaseBase
	pathlike.Subject = "../" + a.uid
	deleteAt := "DELETE " + supabaseBase + "/admin/users/" + a.uid
	for _, c := range []struct {
		name    string
		id      authn.Identity
		answer  http.HandlerFunc
		deleted bool
		asked   int
	}{
		{"Auth deletes the user and answers 200 {}", own, answer(http.StatusOK, "{}"), true, 1},
		{"Auth no longer has the user: 404 user_not_found", own, answerJSON(t, http.StatusNotFound, a.problem(http.StatusNotFound, "user_not_found")), true, 1},
		{"another issuer is never sent", foreign, nil, false, 0},
		{"a subject that is not a canonical UUID is never sent", pathlike, nil, false, 0},
		{"Auth refuses the admin credential", own, answerJSON(t, http.StatusForbidden, a.problem(http.StatusForbidden, "not_admin")), false, 1},
		{"a 404 that does not say user_not_found", own, answer(http.StatusNotFound, "404 page not found "+a.marker), false, 1},
		{"204 is not Auth's success", own, answer(http.StatusNoContent, ""), false, 1},
		{"a user document is not Auth's success", own, answerJSON(t, http.StatusOK, a.userDoc(a.uid)), false, 1},
		{"malformed JSON", own, answer(http.StatusOK, `{"`+a.marker), false, 1},
		{"a redirect is not followed", own, redirectTo(supabaseBase+"/elsewhere", http.StatusTemporaryRedirect), false, 1},
	} {
		t.Run(c.name, func(t *testing.T) {
			a.expect(t, "", nil, c.answer)
			err := v.DeleteIdentity(context.Background(), c.id)
			switch {
			case c.deleted && err != nil:
				t.Fatalf("DeleteIdentity: %s, want the identity deleted", a.describe(err))
			case !c.deleted && !errors.Is(err, authn.ErrIdentityNotDeleted):
				t.Fatalf("DeleteIdentity = %s, want ErrIdentityNotDeleted", a.describe(err))
			case a.quotes(err):
				t.Fatal("the failure quotes the admin credential, the subject or Auth's answer")
			}
			if n, total := a.served(t, deleteAt); n != c.asked || total != c.asked {
				t.Fatalf("Auth's admin delete was called %d times (%d requests in all), want %d", n, total, c.asked)
			}
		})
	}
}
