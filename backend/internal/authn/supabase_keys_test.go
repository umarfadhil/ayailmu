package authn_test

// Supabase Auth key set retrieval and rotation, Phase 3 RED. A SupabaseVerifier in FetchJWKS mode is pinned against an
// owned loopback stand-in (TLS, or plain HTTP in synthetic mode) that publishes its key set at /.well-known/jwks.json as
// the current subtest sets. The verifier runs on a fake clock, so the key set's age and the refresh cooldown never wait
// on real time, and every token stays valid for hours on either clock. Keys are ephemeral synthetic keys used through
// go-jose. No failure message prints a token, a key ID or the admin credential.

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"

	"ayailmu.local/backend/internal/authn"
)

const (
	// keysPath is where Auth publishes its key set. movedKeysPath publishes it too, so only a followed redirect
	// reaches it.
	keysPath      = supabaseBase + "/.well-known/jwks.json"
	movedKeysPath = supabaseBase + "/moved/.well-known/jwks.json"
	// withinCooldown and pastCooldown straddle the documented 30 second refresh cooldown, freshFor and expiredAfter
	// the documented 10 minute lifetime of a fetched key set.
	withinCooldown = 10 * time.Second
	pastCooldown   = time.Minute
	freshFor       = 5 * time.Minute
	expiredAfter   = 11 * time.Minute
)

// authKey is an ephemeral synthetic signing key of the stand-in: its secret half signs, its public half is published.
type authKey struct {
	kid    string
	alg    jose.SignatureAlgorithm
	secret any
	public jose.JSONWebKey
}

func newAuthKey(t *testing.T, alg jose.SignatureAlgorithm, name string) authKey {
	t.Helper()
	var secret, public any
	switch alg {
	case jose.ES256:
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		secret, public = key, &key.PublicKey
	case jose.EdDSA:
		pub, key, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		secret, public = key, pub
	default:
		t.Fatalf("no synthetic %s key", alg)
	}
	kid := name + "-" + randomHex(t, 8)
	return authKey{kid: kid, alg: alg, secret: secret, public: jose.JSONWebKey{Key: public, KeyID: kid, Algorithm: string(alg), Use: "sig"}}
}

// signing is the go-jose signing key of k under kid.
func (k authKey) signing(kid string) jose.SigningKey {
	return jose.SigningKey{Algorithm: k.alg, Key: jose.JSONWebKey{Key: k.secret, KeyID: kid}}
}

// keyedAuth is the supabaseAuth stand-in for an Auth server that publishes its key set: GET /.well-known/jwks.json
// answers as the current subtest sets, by default with the initial key, and GET /user confirms the synthetic user.
// Every request is counted; any other finds nothing. A cookie, a credential or a query on the key set request, or
// GET /user without exactly a token the stand-in issued, is a fault.
type keyedAuth struct {
	*supabaseAuth
	initial authKey
	start   time.Time
	plain   bool
	moved   http.HandlerFunc

	keys   http.HandlerFunc // guarded by supabaseAuth.mu
	issued map[string]bool  // guarded by supabaseAuth.mu
}

// newKeyedAuth starts the stand-in on owned loopback TLS, or on plain HTTP when plain is set.
func newKeyedAuth(t *testing.T, plain bool) *keyedAuth {
	t.Helper()
	k := &keyedAuth{initial: newAuthKey(t, jose.ES256, "initial"), start: time.Now(), plain: plain, issued: map[string]bool{}}
	k.supabaseAuth = &supabaseAuth{uid: randomUUID(t), sessionID: randomUUID(t), adminKey: "adm-" + randomHex(t, 16),
		marker: "auth-says-" + randomHex(t, 6), stop: make(chan struct{})}
	k.expect(t, "", nil, nil)
	k.keys, k.moved = publish(t, k.initial.public), publish(t, k.initial.public)
	if plain {
		k.srv = httptest.NewServer(http.HandlerFunc(k.route))
	} else {
		k.srv = httptest.NewTLSServer(http.HandlerFunc(k.route))
	}
	t.Cleanup(k.srv.Close)
	t.Cleanup(func() { close(k.stop) }) // runs first, so no handler still waits when the server closes
	k.issuer = k.srv.URL + supabaseBase
	return k
}

func (k *keyedAuth) route(w http.ResponseWriter, r *http.Request) {
	k.mu.Lock()
	k.calls[r.Method+" "+r.URL.Path]++
	keys, user := k.keys, k.user
	issued := k.issued[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")]
	k.mu.Unlock()
	if r.Header.Get("Cookie") != "" {
		k.fault("a request to Auth carried a cookie")
	}
	switch path := r.URL.Path; {
	case path == keysPath || path == movedKeysPath:
		if r.Method != http.MethodGet || r.URL.RawQuery != "" || r.Header.Get("Authorization") != "" || r.Header.Get("Apikey") != "" {
			k.fault("the key set request was not a plain GET without a credential")
		}
		if path == movedKeysPath {
			keys = k.moved
		}
		keys(w, r)
	case r.Method == http.MethodGet && path == supabaseBase+"/user":
		if !issued {
			k.fault("GET /user did not carry exactly a token the stand-in issued")
		}
		user(w, r)
	default:
		http.NotFound(w, r)
	}
}

// answerKeys makes Auth's key set endpoint answer with h from now on.
func (k *keyedAuth) answerKeys(h http.HandlerFunc) {
	k.mu.Lock()
	defer k.mu.Unlock()
	k.keys = h
}

// held answers with then once gate opens, and gives up when the request or the test ends.
func (k *keyedAuth) held(gate <-chan struct{}, then http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-gate:
			then(w, r)
		case <-r.Context().Done():
		case <-k.stop:
		}
	}
}

// issue signs a token of the synthetic user with key, as Auth does.
func (k *keyedAuth) issue(t *testing.T, key authKey) string {
	t.Helper()
	token := signJWT(t, key.signing(key.kid), k.timely())
	k.mu.Lock()
	defer k.mu.Unlock()
	k.issued[token] = true
	return token
}

// timely is the stand-in's claims with times valid for hours on the real clock and on any fake one started with it.
func (k *keyedAuth) timely() map[string]any {
	claims := k.claims()
	signedIn := k.start.Add(-30 * time.Second).Unix()
	claims["iat"], claims["exp"], claims["amr"] = signedIn, k.start.Add(6*time.Hour).Unix(), []any{signIn("password", signedIn)}
	return claims
}

// fetching configures a verifier that fetches the stand-in's key set on clock, through a client whose cookie jar holds a
// cookie for Auth that must never be sent; plain http runs in synthetic mode.
func (k *keyedAuth) fetching(t *testing.T, clock *fakeClock) authn.SupabaseConfig {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(k.srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	jar.SetCookies(u, []*http.Cookie{{Name: "sb-access-token", Value: k.marker}})
	client := *k.srv.Client()
	client.Jar = jar
	cfg := k.settings()
	cfg.FetchJWKS, cfg.Now, cfg.LocalSynthetic, cfg.HTTPClient = true, clock.Now, k.plain, &client
	return cfg
}

func (k *keyedAuth) fetchingVerifier(t *testing.T) (*authn.SupabaseVerifier, *fakeClock) {
	t.Helper()
	clock := &fakeClock{now: k.start}
	v, err := authn.NewSupabaseVerifier(k.fetching(t, clock))
	if err != nil || v == nil {
		t.Fatalf("NewSupabaseVerifier(a valid key-fetching configuration): %s", k.describe(err))
	}
	return v, clock
}

// counts reports how often Auth served its key set and GET /user. It fails the test on a fault or on a request
// anywhere else, such as a followed redirect or a URL a token named.
func (k *keyedAuth) counts(t *testing.T) (keys, users int) {
	t.Helper()
	keys, total := k.served(t, "GET "+keysPath)
	users, _ = k.served(t, "GET "+supabaseBase+"/user")
	if total != keys+users {
		t.Fatalf("%d requests reached Auth elsewhere than its key set and GET /user", total-keys-users)
	}
	return keys, users
}

// fakeClock is the verifier's clock here: it stands still until the test advances it.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

// publish is an answer of Auth's key set endpoint publishing keys.
func publish(t *testing.T, keys ...jose.JSONWebKey) http.HandlerFunc {
	t.Helper()
	return answerJSON(t, http.StatusOK, jose.JSONWebKeySet{Keys: keys})
}

// forge signs claims as a compact JWS with go-jose under opts: a token that brings its own key, algorithm or key URL.
func forge(t *testing.T, key jose.SigningKey, opts *jose.SignerOptions, claims map[string]any) string {
	t.Helper()
	signer, err := jose.NewSigner(key, opts.WithType("JWT"))
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

// keySetCase is an answer of Auth's key set endpoint, by default Auth's published key set.
type keySetCase struct {
	name  string
	keys  func(t *testing.T, k *keyedAuth) http.HandlerFunc
	wait  time.Duration // the caller's deadline when Auth does not answer
	plain bool          // a plain http stand-in, in synthetic mode
	ok    bool
}

// unusableKeySets are answers of Auth's key set endpoint that yield no usable key set.
func unusableKeySets() []keySetCase {
	return []keySetCase{
		{name: "a redirect, which is never followed", keys: func(*testing.T, *keyedAuth) http.HandlerFunc {
			return redirectTo(movedKeysPath, http.StatusFound)
		}},
		{name: "an error status", keys: func(t *testing.T, k *keyedAuth) http.HandlerFunc {
			return answerJSON(t, http.StatusInternalServerError, k.problem(http.StatusInternalServerError, "unexpected_failure"))
		}},
		{name: "malformed JSON", keys: func(_ *testing.T, k *keyedAuth) http.HandlerFunc {
			return answer(http.StatusOK, `{"keys":[{"kty":"EC","kid":"`+k.marker)
		}},
		{name: "more than any key set holds", keys: func(t *testing.T, k *keyedAuth) http.HandlerFunc {
			return answerJSON(t, http.StatusOK, map[string]any{"keys": []jose.JSONWebKey{k.initial.public}, "note": k.marker, "pad": strings.Repeat("x", 128<<10)})
		}},
		{name: "more keys than any key set holds", keys: func(t *testing.T, k *keyedAuth) http.HandlerFunc {
			keys := []jose.JSONWebKey{k.initial.public}
			for len(keys) <= 16 {
				keys = append(keys, newAuthKey(t, jose.ES256, "extra").public)
			}
			return publish(t, keys...)
		}},
		{name: "a private key", keys: func(t *testing.T, k *keyedAuth) http.HandlerFunc {
			private := k.initial.public
			private.Key = k.initial.secret
			return publish(t, private)
		}},
		{name: "a symmetric key", keys: func(t *testing.T, k *keyedAuth) http.HandlerFunc {
			return publish(t, k.initial.public, jose.JSONWebKey{Key: []byte(randomHex(t, 32)), KeyID: "hmac-" + randomHex(t, 8), Algorithm: string(jose.HS256), Use: "sig"})
		}},
		{name: "a key whose algorithm does not fit it", keys: func(t *testing.T, k *keyedAuth) http.HandlerFunc {
			misfit := k.initial.public
			misfit.Algorithm = string(jose.ES384)
			return publish(t, misfit)
		}},
		{name: "an RSA key under 2048 bits", keys: func(t *testing.T, k *keyedAuth) http.HandlerFunc {
			small, err := rsa.GenerateKey(rand.Reader, 1024)
			if err != nil {
				t.Fatal(err)
			}
			return publish(t, k.initial.public, jose.JSONWebKey{Key: &small.PublicKey, KeyID: "small-" + randomHex(t, 8), Algorithm: string(jose.RS256), Use: "sig"})
		}},
		{name: "no key", keys: func(*testing.T, *keyedAuth) http.HandlerFunc { return answer(http.StatusOK, `{"keys":[]}`) }},
		{name: "no answer in time", keys: func(_ *testing.T, k *keyedAuth) http.HandlerFunc { return k.hang }, wait: 300 * time.Millisecond},
	}
}

// FetchJWKS fetches the key set from only GET {base}/.well-known/jwks.json, over TLS or over plain http on loopback in
// synthetic mode: with no credential or cookie, following no redirect, within the caller's deadline, and trusting only
// what it would trust as a configured JWKS. RefreshKeys at startup establishes the set, and the token that follows needs
// no fetch. When it fails it wraps ErrKeySetUnavailable, quoting neither a key ID nor Auth's answer; no token is then
// accepted or sent to GET /user, and none fetches again within the 30 second cooldown, until a later fetch succeeds.
// FetchJWKS beside a configured key set, or over plain http outside synthetic mode, is refused before any request.
func TestSupabaseKeySetFetchIsBoundedAndCarriesNoCredential(t *testing.T) {
	cases := append([]keySetCase{
		{name: "Auth's published key set over TLS", ok: true},
		{name: "Auth's published key set over plain http on loopback in synthetic mode", plain: true, ok: true},
	}, unusableKeySets()...)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			k := newKeyedAuth(t, c.plain)
			if c.keys != nil {
				k.answerKeys(c.keys(t, k))
			}
			v, _ := k.fetchingVerifier(t)
			token := k.issue(t, k.initial)
			wait := c.wait
			if wait == 0 {
				wait = 5 * time.Second
			}
			ctx, cancel := context.WithTimeout(context.Background(), wait)
			defer cancel()
			start := time.Now()
			err := v.RefreshKeys(ctx)
			switch elapsed := time.Since(start); {
			case c.ok && err != nil:
				t.Fatalf("RefreshKeys(Auth's published key set): %s", k.describe(err, k.initial.kid))
			case !c.ok && !errors.Is(err, authn.ErrKeySetUnavailable):
				t.Fatalf("RefreshKeys accepted a key set it cannot use (error %s)", k.describe(err, k.initial.kid))
			case k.quotes(err, k.initial.kid):
				t.Fatal("the refusal quotes a key ID or Auth's answer")
			case elapsed > wait+2*time.Second:
				t.Fatalf("RefreshKeys took %v, well past the caller's deadline", elapsed)
			}
			verifyCtx, cancelVerify := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancelVerify()
			s, err := v.VerifySession(verifyCtx, token)
			switch {
			case c.ok && err != nil:
				t.Fatalf("VerifySession(a token of the fetched key): %s", k.describe(err, token, k.initial.kid))
			case !c.ok && (!errors.Is(err, authn.ErrUnauthenticated) || s != (authn.Session{})):
				t.Fatalf("VerifySession accepted a token without a usable key set (error %s)", k.describe(err, token, k.initial.kid))
			case k.quotes(err, token, k.initial.kid):
				t.Fatal("the refusal quotes a token, a key ID or Auth's answer")
			}
			want := 0
			if c.ok {
				want = 1
			}
			if keys, users := k.counts(t); keys != 1 || users != want {
				t.Fatalf("Auth served its key set %d times and GET /user %d times, want once (at startup, never per token) and %d", keys, users, want)
			}
			if printed := fmt.Sprintf("%v %+v %#v", v, v, v); strings.Contains(printed, k.adminKey) || strings.Contains(printed, k.initial.kid) {
				t.Fatal("formatting the verifier prints the admin credential or a key ID")
			}
		})
	}

	t.Run("a failed start recovers once Auth publishes its key set", func(t *testing.T) {
		k := newKeyedAuth(t, false)
		k.answerKeys(answer(http.StatusServiceUnavailable, ""))
		v, clock := k.fetchingVerifier(t)
		token := k.issue(t, k.initial)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := v.RefreshKeys(ctx); !errors.Is(err, authn.ErrKeySetUnavailable) {
			t.Fatalf("RefreshKeys while Auth is down = %s, want ErrKeySetUnavailable", k.describe(err))
		}
		k.answerKeys(publish(t, k.initial.public))
		for _, step := range []struct {
			name    string
			advance time.Duration
			ok      bool
			keys    int
		}{
			{"right after the failed start, a token is refused without another fetch", 0, false, 1},
			{"within the cooldown, still no fetch", withinCooldown, false, 1},
			{"past the cooldown, a token fetches Auth's key set and verifies", pastCooldown, true, 2},
		} {
			clock.advance(step.advance)
			_, err := v.VerifySession(ctx, token)
			switch {
			case step.ok && err != nil:
				t.Fatalf("%s: %s", step.name, k.describe(err, token, k.initial.kid))
			case !step.ok && !errors.Is(err, authn.ErrUnauthenticated):
				t.Fatalf("%s: VerifySession = %s, want ErrUnauthenticated", step.name, k.describe(err, token, k.initial.kid))
			}
			if keys, _ := k.counts(t); keys != step.keys {
				t.Fatalf("%s: Auth served its key set %d times, want %d", step.name, keys, step.keys)
			}
		}
	})

	t.Run("configurations that cannot fetch safely are refused", func(t *testing.T) {
		tlsAuth, plainAuth := newKeyedAuth(t, false), newKeyedAuth(t, true)
		clock := &fakeClock{now: time.Now()}
		both := tlsAuth.fetching(t, clock)
		both.JWKS = mustJSON(t, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{tlsAuth.initial.public}})
		insecure := plainAuth.fetching(t, clock)
		insecure.LocalSynthetic = false
		for name, cfg := range map[string]authn.SupabaseConfig{"a configured key set as well": both, "plain http outside synthetic mode": insecure} {
			if v, err := authn.NewSupabaseVerifier(cfg); v != nil || !errors.Is(err, authn.ErrUnsafeConfig) {
				t.Fatalf("NewSupabaseVerifier(FetchJWKS with %s) = verifier %t, ErrUnsafeConfig %t", name, v != nil, errors.Is(err, authn.ErrUnsafeConfig))
			}
		}
		for _, k := range []*keyedAuth{tlsAuth, plainAuth} {
			if _, total := k.served(t, "GET "+keysPath); total != 0 {
				t.Fatal("building a verifier contacted Auth")
			}
		}
	})
}

// A fetched key set is cached: a token of a key it holds needs no fetch while the set is under 10 minutes old. A token
// of a key it does not hold refreshes it, at most every 30 seconds, so Auth's next key, of another algorithm, is trusted
// beside the old one during their overlap. After Auth retires the old key, its tokens verify until the set expires; the
// refresh that follows refuses them, and the next key keeps working.
func TestSupabaseKeyRotationTrustsOnlyAuthsCurrentKeys(t *testing.T) {
	k := newKeyedAuth(t, false)
	v, clock := k.fetchingVerifier(t)
	next := newAuthKey(t, jose.EdDSA, "next")
	old, rotated := k.issue(t, k.initial), k.issue(t, next)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	users := 0
	for _, s := range []struct {
		name    string
		advance time.Duration
		publish []jose.JSONWebKey // Auth's key set from this step on; nil keeps it
		token   string
		ok      bool
		keys    int // key set fetches so far
	}{
		{"the first token fetches the key set", 0, nil, old, true, 1},
		{"a token of a held key needs no fetch", withinCooldown, nil, old, true, 1},
		{"Auth adds its next key: a token of it refreshes the set", pastCooldown, []jose.JSONWebKey{k.initial.public, next.public}, rotated, true, 2},
		{"during the overlap the old key still verifies", 0, nil, old, true, 2},
		{"Auth retires the old key: the fresh set still trusts it", freshFor, []jose.JSONWebKey{next.public}, old, true, 2},
		{"once the set expires, its refresh refuses the retired key", expiredAfter - freshFor, nil, old, false, 3},
		{"the next key keeps working", 0, nil, rotated, true, 3},
	} {
		clock.advance(s.advance)
		if s.publish != nil {
			k.answerKeys(publish(t, s.publish...))
		}
		_, err := v.VerifySession(ctx, s.token)
		switch {
		case s.ok && err != nil:
			t.Fatalf("%s: %s", s.name, k.describe(err, s.token, k.initial.kid, next.kid))
		case !s.ok && !errors.Is(err, authn.ErrUnauthenticated):
			t.Fatalf("%s: VerifySession = %s, want ErrUnauthenticated", s.name, k.describe(err, s.token, k.initial.kid, next.kid))
		case k.quotes(err, s.token, k.initial.kid, next.kid):
			t.Fatalf("%s: the refusal quotes a token or a key ID", s.name)
		}
		if s.ok {
			users++
		}
		if keys, got := k.counts(t); keys != s.keys || got != users {
			t.Fatalf("%s: Auth served its key set %d times and GET /user %d times, want %d and %d", s.name, keys, got, s.keys, users)
		}
	}
}

// Key set refreshes are shared and rate-limited. Concurrent tokens of Auth's next key share one fetch, and all verify.
// Tokens of unknown keys, or forged to bring their own key, algorithm or key URL, are refused with at most one fetch per
// 30 seconds; none makes the verifier fetch a URL it names or reach GET /user. A fresh key set outlives a failed refresh.
// An expired one fails closed, within the caller's deadline, whatever is wrong with its refresh.
func TestSupabaseKeyRefreshIsSharedRateLimitedAndFailsClosed(t *testing.T) {
	t.Run("concurrent tokens of Auth's next key share one fetch", func(t *testing.T) {
		k := newKeyedAuth(t, false)
		v, clock := k.fetchingVerifier(t)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := v.RefreshKeys(ctx); err != nil {
			t.Fatalf("RefreshKeys(Auth's published key set): %s", k.describe(err, k.initial.kid))
		}
		next := newAuthKey(t, jose.ES256, "next")
		token := k.issue(t, next)
		gate := make(chan struct{})
		k.answerKeys(k.held(gate, publish(t, k.initial.public, next.public)))
		clock.advance(pastCooldown)
		const n = 8
		errs := make([]error, n)
		var ready, done sync.WaitGroup
		for i := range n {
			ready.Add(1)
			done.Add(1)
			go func() {
				defer done.Done()
				ready.Done()
				_, errs[i] = v.VerifySession(ctx, token)
			}()
		}
		ready.Wait()
		close(gate)
		done.Wait()
		for _, err := range errs {
			if err != nil {
				t.Fatalf("a concurrent token of Auth's next key was refused: %s", k.describe(err, token, next.kid))
			}
		}
		if keys, users := k.counts(t); keys != 2 || users != n {
			t.Fatalf("Auth served its key set %d times and GET /user %d times, want twice (startup, one shared refresh) and %d", keys, users, n)
		}
	})

	t.Run("unknown and forged keys cause at most one fetch per cooldown", func(t *testing.T) {
		k := newKeyedAuth(t, false)
		v, clock := k.fetchingVerifier(t)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := v.RefreshKeys(ctx); err != nil {
			t.Fatalf("RefreshKeys(Auth's published key set): %s", k.describe(err, k.initial.kid))
		}
		stranger, edStranger := newAuthKey(t, jose.ES256, "stranger"), newAuthKey(t, jose.EdDSA, "stranger")
		claims := k.timely()
		named := k.srv.URL + supabaseBase + "/named-by-a-token"
		published := mustJSON(t, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{k.initial.public}})
		forged := []string{
			// the published key set as an HMAC secret, under the published key's kid
			forge(t, jose.SigningKey{Algorithm: jose.HS256, Key: published}, (&jose.SignerOptions{}).WithHeader("kid", k.initial.kid), claims),
			unsignedJWT(t, claims),
			// another algorithm under the published key's kid
			forge(t, edStranger.signing(k.initial.kid), &jose.SignerOptions{}, claims),
			// a key of its own, embedded
			forge(t, stranger.signing(stranger.kid), &jose.SignerOptions{EmbedJWK: true}, claims),
			// key URLs of its own
			forge(t, stranger.signing(stranger.kid), (&jose.SignerOptions{}).WithHeader("jku", named+"/jwks.json").WithHeader("x5u", named+"/key.pem"), claims),
		}
		prefix := "unknown-" + randomHex(t, 8)
		var unknown []string
		for i := range 16 {
			unknown = append(unknown, signJWT(t, stranger.signing(fmt.Sprintf("%s-%d", prefix, i)), claims))
		}
		clock.advance(pastCooldown) // one refresh may follow; the rest of the stream is within its cooldown
		for _, batch := range [][]string{append(forged, unknown...), unknown} {
			for _, token := range batch {
				s, err := v.VerifySession(ctx, token)
				switch {
				case !errors.Is(err, authn.ErrUnauthenticated) || s != (authn.Session{}):
					t.Fatalf("VerifySession accepted a token of an unknown or forged key (error %s)", k.describe(err, token, prefix, stranger.kid))
				case k.quotes(err, token, prefix, k.initial.kid, stranger.kid, edStranger.kid):
					t.Fatal("the refusal quotes a token or a key ID")
				}
			}
			clock.advance(withinCooldown)
		}
		if keys, users := k.counts(t); keys > 2 || users != 0 {
			t.Fatalf("%d tokens of unknown or forged keys made Auth serve its key set %d times after startup and GET /user %d times, want at most once and never",
				len(forged)+2*len(unknown), keys-1, users)
		}
		if _, err := v.VerifySession(ctx, k.issue(t, k.initial)); err != nil {
			t.Fatalf("a token of Auth's published key, after the stream: %s", k.describe(err, k.initial.kid))
		}
	})

	t.Run("a fresh key set outlives a failed refresh", func(t *testing.T) {
		k := newKeyedAuth(t, false)
		v, clock := k.fetchingVerifier(t)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := v.RefreshKeys(ctx); err != nil {
			t.Fatalf("RefreshKeys(Auth's published key set): %s", k.describe(err, k.initial.kid))
		}
		k.answerKeys(answer(http.StatusServiceUnavailable, ""))
		clock.advance(pastCooldown)
		stranger := newAuthKey(t, jose.ES256, "stranger")
		if _, err := v.VerifySession(ctx, signJWT(t, stranger.signing(stranger.kid), k.timely())); !errors.Is(err, authn.ErrUnauthenticated) {
			t.Fatalf("VerifySession(a token of a key Auth never published) = %s, want ErrUnauthenticated", k.describe(err, stranger.kid))
		}
		if _, err := v.VerifySession(ctx, k.issue(t, k.initial)); err != nil {
			t.Fatalf("a token of the fresh key set after a failed refresh: %s", k.describe(err, k.initial.kid))
		}
		if keys, users := k.counts(t); keys != 2 || users != 1 {
			t.Fatalf("Auth served its key set %d times and GET /user %d times, want twice (startup, the failed refresh) and once", keys, users)
		}
	})

	for _, c := range unusableKeySets() {
		t.Run("an expired key set fails closed on "+c.name, func(t *testing.T) {
			k := newKeyedAuth(t, false)
			v, clock := k.fetchingVerifier(t)
			token := k.issue(t, k.initial)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			if _, err := v.VerifySession(ctx, token); err != nil {
				t.Fatalf("the first token, with Auth's key set published: %s", k.describe(err, token, k.initial.kid))
			}
			k.answerKeys(c.keys(t, k))
			clock.advance(expiredAfter)
			wait := c.wait
			if wait == 0 {
				wait = 5 * time.Second
			}
			late, cancelLate := context.WithTimeout(context.Background(), wait)
			defer cancelLate()
			start := time.Now()
			s, err := v.VerifySession(late, token)
			switch elapsed := time.Since(start); {
			case !errors.Is(err, authn.ErrUnauthenticated) || s != (authn.Session{}):
				t.Fatalf("VerifySession accepted a token on an expired key set whose refresh failed (error %s)", k.describe(err, token, k.initial.kid))
			case k.quotes(err, token, k.initial.kid):
				t.Fatal("the refusal quotes a token, a key ID or Auth's answer")
			case elapsed > wait+2*time.Second:
				t.Fatalf("the refusal took %v, well past the caller's deadline", elapsed)
			}
			if keys, users := k.counts(t); keys != 2 || users != 1 {
				t.Fatalf("Auth served its key set %d times and GET /user %d times, want twice (the first token, one refresh) and once", keys, users)
			}
		})
	}
}
