package server_test

// Production mode for a staging deployment, Phase 18 RED. With its explicit opt-in (AYA_AUTH_PROVIDER=standalone-gotrue,
// AYA_DEPLOYMENT_ENV=staging) a production service trusts the deployment's own standalone GoTrue through the established
// signed-token verifier, not in synthetic mode: Auth by its own public name over https, whose certificate must verify,
// reached on the TLS proxy's private listener (an explicit port), never over plain http. Startup verifies the schema and
// never migrates it, so the runtime role needs no DDL or write right to start. Accounts keep the existing provider kind
// (local-supabase, the self-hosted Supabase Auth) and the deployment's own issuer, so no schema change is needed.
//
// It sits behind one TLS-terminating proxy and trusts nobody else: a request is admitted only from an exact trusted proxy
// address (AYA_TRUSTED_PROXIES), saying with exactly one X-Forwarded-Proto: https that its client used TLS, at one of its
// exact public Host values (an X-Forwarded-Host, if any, must be that Host). Forwarded and X-Forwarded-For are never
// trusted. Every other peer, a plaintext hop, a spoofed, repeated or malformed forwarded value and a malformed remote
// address is refused with the Host refusal (421 host_not_allowed) before authentication, so Auth is never asked. The one
// exception is the container's own loopback health probe: GET /v1/healthz and /v1/readyz at the probe's Host, nothing
// else. Revocation (Auth's GET /user) and the password-only recent sign-in of the account export still hold.
//
// The Auth stand-in is localAuth's (local_supabase_test.go) behind a TLS listener with a test CA's certificate for
// auth-staging.example.com; the service reaches it through server.Options.AuthHTTPClient, a client that trusts only that
// CA and routes only the Auth host's private listener to the stand-in. The host names are documented placeholders
// (example.com), never resolved or contacted. Requests reach the handler directly, so each sets its own remote address.
// The tests use the isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL) in fresh aya_t_ schemas that they drop; nothing
// is skipped, and no DSN, token or credential is printed.

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"errors"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/server"
	"ayailmu.local/backend/internal/store"
)

// The staging settings, by name: they are new, so the tests spell them out.
const (
	stagingEnvAuthProvider   = "AYA_AUTH_PROVIDER"
	stagingEnvDeployment     = "AYA_DEPLOYMENT_ENV"
	stagingEnvTrustedProxies = "AYA_TRUSTED_PROXIES"
)

const (
	stagingAPIHost   = "api-staging.example.com"
	stagingAppOrigin = "https://app-staging.example.com"
	stagingAuthHost  = "auth-staging.example.com"
	// stagingAuthPort is the proxy's private TLS listener for Auth's verifier and admin calls.
	stagingAuthPort = "9443"
	stagingIssuer   = "https://auth-staging.example.com"
	// stagingProxyIP is the TLS-terminating proxy's fixed address on the private network.
	stagingProxyIP = "10.30.0.2"
	// stagingProbeHost is the Host of the container's own loopback health probe when the service listens on 0.0.0.0:8080.
	stagingProbeHost = "127.0.0.1:8080"
	stagingProbePeer = "127.0.0.1:50000"
)

// stagingViaProxy are the headers the trusted proxy adds to a request its client sent over TLS.
var stagingViaProxy = []string{"X-Forwarded-Proto", "https", "X-Forwarded-Host", stagingAPIHost, "X-Forwarded-For", "203.0.113.7"}

// stagingCA is a test certificate authority that only the clients built from it trust.
type stagingCA struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pool *x509.CertPool
}

func newStagingCA(t *testing.T) stagingCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "ayailmu staging test CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour), IsCA: true, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return stagingCA{cert: cert, key: key, pool: pool}
}

// leaf issues a server certificate for name.
func (ca stagingCA) leaf(t *testing.T, name string) tls.Certificate {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	serial, err := rand.Int(rand.Reader, big.NewInt(1<<62))
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: name}, DNSNames: []string{name},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(24 * time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

// stagingAuth serves localAuth's Auth behind TLS with cert. Once revoked, GET /user refuses the session as GoTrue does
// for a revoked one.
type stagingAuth struct {
	a   *localAuth
	srv *httptest.Server

	mu      sync.Mutex
	revoked bool
}

func newStagingAuth(t *testing.T, a *localAuth, cert tls.Certificate) *stagingAuth {
	t.Helper()
	s := &stagingAuth{a: a}
	s.srv = httptest.NewUnstartedServer(http.HandlerFunc(s.serve))
	s.srv.TLS = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	s.srv.StartTLS()
	t.Cleanup(s.srv.Close)
	return s
}

func (s *stagingAuth) serve(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	revoked := s.revoked
	s.mu.Unlock()
	if revoked && r.Method == http.MethodGet && r.URL.Path == "/user" {
		s.a.mu.Lock()
		s.a.calls[r.Method+" "+r.URL.Path]++
		s.a.mu.Unlock()
		respond(http.StatusUnauthorized, `{"code":401,"error_code":"session_not_found","msg":"Session from session_id claim in JWT does not exist"}`)(w, r)
		return
	}
	s.a.serve(w, r)
}

func (s *stagingAuth) revoke() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.revoked = true
}

// stagingAuthClient trusts only ca, verifies certificates as usual, and reaches only Auth's private listener, which
// leads to srv: the stand-in for the staging network.
func stagingAuthClient(ca stagingCA, srv *httptest.Server) *http.Client {
	target := srv.Listener.Addr().String()
	return &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{RootCAs: ca.pool, MinVersion: tls.VersionTLS12},
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			if addr != stagingAuthHost+":"+stagingAuthPort {
				return nil, errors.New("the staging network reaches only Auth's private listener")
			}
			var d net.Dialer
			return d.DialContext(ctx, network, target)
		},
	}}
}

// stagingServiceEnv is a complete, explicitly opted-in staging configuration on schema, with dbURL and adminKey in
// private files and the database's own host as the one allowed database host.
func stagingServiceEnv(t *testing.T, dbURL, schema, adminKey string) map[string]string {
	t.Helper()
	return map[string]string{
		config.EnvMode:                 config.ModeProduction,
		stagingEnvAuthProvider:         "standalone-gotrue",
		stagingEnvDeployment:           "staging",
		config.EnvListen:               "0.0.0.0:8080",
		config.EnvAllowedHosts:         stagingAPIHost,
		config.EnvCORSOrigins:          stagingAppOrigin,
		stagingEnvTrustedProxies:       stagingProxyIP,
		config.EnvDBHosts:              databaseHostOf(t, dbURL),
		config.EnvDatabaseURLFile:      privateFile(t, dbURL),
		config.EnvSchema:               schema,
		config.EnvSupabaseURL:          "https://" + stagingAuthHost + ":" + stagingAuthPort,
		config.EnvSupabaseIssuer:       stagingIssuer,
		config.EnvSupabaseAudience:     "authenticated",
		config.EnvSupabaseAdminKeyFile: privateFile(t, adminKey+"\n"),
	}
}

// startStagingService starts a staging service on a fresh migrated schema, reaching Auth with client.
func startStagingService(t *testing.T, dbURL string, a *localAuth, client *http.Client) (*server.Service, *pgxpool.Pool) {
	t.Helper()
	schema, db := migratedSchema(t, dbURL)
	svc, err := server.New(context.Background(), lookupIn(stagingServiceEnv(t, dbURL, schema, a.admin)), server.Options{AuthHTTPClient: client})
	if err != nil {
		t.Fatalf("server.New(a complete, explicitly opted-in staging setup) = %s; want it started", quiet(err, dbURL, a.admin))
	}
	t.Cleanup(svc.Close)
	return svc, db
}

// stagingToken signs an access token of localAuth's user with its key, as the staging GoTrue issues one: provider and
// the amr method of its sign-in, half a minute ago.
func stagingToken(t *testing.T, a *localAuth, provider, method string) string {
	t.Helper()
	now := time.Now().Unix()
	claims, err := json.Marshal(map[string]any{
		"iss": stagingIssuer, "aud": "authenticated", "sub": a.uid, "role": "authenticated", "exp": now + 3600, "iat": now - 30,
		"session_id": a.sid, "is_anonymous": false, "app_metadata": map[string]any{"provider": provider, "providers": []string{provider}},
		"amr": []any{map[string]any{"method": method, "timestamp": now - 30}},
	})
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: jose.JSONWebKey{Key: a.key, KeyID: a.kid}}, (&jose.SignerOptions{}).WithType("JWT"))
	if err != nil {
		t.Fatalf("go-jose signer: %v", err)
	}
	signed, err := signer.Sign(claims)
	if err != nil {
		t.Fatalf("go-jose sign: %v", err)
	}
	token, err := signed.CompactSerialize()
	if err != nil {
		t.Fatalf("go-jose serialize: %v", err)
	}
	return token
}

// stagingRequest serves one request through svc's handler as if it arrived from peer (the remote address) with host as
// its Host, a bearer token unless empty, and the header pairs given (a repeated name adds another header line).
func stagingRequest(svc *server.Service, method, path, peer, host, token string, headers ...string) reply {
	req := httptest.NewRequest(method, "http://"+stagingAPIHost+path, nil)
	req.RemoteAddr = peer
	req.Host = host
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Add(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	svc.Handler().ServeHTTP(rec, req)
	return reply{status: rec.Code, header: rec.Header(), body: rec.Body.Bytes()}
}

// A staging service verifies its schema and never migrates it: an absent schema refuses startup and stays absent. On the
// current schema, over a session that cannot write, it starts once it has fetched Auth's key set over TLS whose
// certificate verifies for Auth's own name, and its loopback probe reports the production mode and readiness. A
// certificate of a CA the service does not trust, or one for another name, refuses startup (no usable key set), and an
// Auth client that skips certificate verification is refused outright.
func TestProductionStagingServiceVerifiesAuthOverTLSAndOnlyVerifiesTheSchema(t *testing.T) {
	dbURL := testDatabase(t)
	ca := newStagingCA(t)
	a := newLocalAuth(t)
	auth := newStagingAuth(t, a, ca.leaf(t, stagingAuthHost))
	client := stagingAuthClient(ca, auth.srv)
	probe := fixturePool(t, dbURL, "aya_t_probe")
	t.Cleanup(probe.Close)

	t.Run("an absent schema refuses startup and stays absent", func(t *testing.T) {
		schema := newSchemaName(t)
		svc, err := server.New(context.Background(), lookupIn(stagingServiceEnv(t, dbURL, schema, a.admin)), server.Options{AuthHTTPClient: client})
		if svc != nil {
			svc.Close()
		}
		if !errors.Is(err, store.ErrSchemaNotCurrent) {
			t.Fatalf("server.New on an absent schema = %s; want store.ErrSchemaNotCurrent: the service verifies, never migrates", quiet(err, dbURL, a.admin))
		}
		if schemaExists(t, probe, schema) {
			t.Fatal("the staging service created its schema; only the migration job may")
		}
	})

	t.Run("on the current schema, over a session that cannot write, it starts with Auth's key set fetched over verified TLS", func(t *testing.T) {
		schema, _ := migratedSchema(t, dbURL)
		before, _, _ := a.served(t)
		svc, err := server.New(context.Background(), lookupIn(stagingServiceEnv(t, readOnlySessionURL(t, dbURL), schema, a.admin)),
			server.Options{AuthHTTPClient: client})
		if err != nil {
			t.Fatalf("server.New = %s; want a staging service started on a read-only session", quiet(err, dbURL, a.admin))
		}
		defer svc.Close()
		if keys, users, _ := a.served(t); keys <= before || users != 0 {
			t.Fatalf("startup fetched Auth's key set %d times and asked GET /user %d times; want the key set fetched, no user asked", keys-before, users)
		}
		r := stagingRequest(svc, http.MethodGet, "/v1/healthz", stagingProbePeer, stagingProbeHost, "")
		wantStatus(t, r, http.StatusOK)
		var h struct{ Status, Mode string }
		decodeJSON(t, r.body, &h)
		if h.Status != "ok" || h.Mode != config.ModeProduction {
			t.Fatalf("health = %+v, want ok in production mode", h)
		}
		r = stagingRequest(svc, http.MethodGet, "/v1/readyz", stagingProbePeer, stagingProbeHost, "")
		wantStatus(t, r, http.StatusOK)
	})

	for _, c := range []struct {
		name string
		cert func(t *testing.T) tls.Certificate
	}{
		{"a certificate of a CA the service does not trust", func(t *testing.T) tls.Certificate { return newStagingCA(t).leaf(t, stagingAuthHost) }},
		{"a certificate for another name", func(t *testing.T) tls.Certificate { return ca.leaf(t, "other.example.com") }},
	} {
		t.Run(c.name+" refuses startup", func(t *testing.T) {
			schema, _ := migratedSchema(t, dbURL)
			other := newStagingAuth(t, a, c.cert(t))
			svc, err := server.New(context.Background(), lookupIn(stagingServiceEnv(t, dbURL, schema, a.admin)),
				server.Options{AuthHTTPClient: stagingAuthClient(ca, other.srv)})
			if svc != nil {
				svc.Close()
			}
			if !errors.Is(err, authn.ErrKeySetUnavailable) {
				t.Fatalf("server.New = %s; want authn.ErrKeySetUnavailable: Auth's certificate must verify", quiet(err, dbURL, a.admin))
			}
		})
	}

	t.Run("an Auth client that skips certificate verification is refused", func(t *testing.T) {
		schema, _ := migratedSchema(t, dbURL)
		insecure := stagingAuthClient(ca, auth.srv)
		insecure.Transport.(*http.Transport).TLSClientConfig.InsecureSkipVerify = true
		svc, err := server.New(context.Background(), lookupIn(stagingServiceEnv(t, dbURL, schema, a.admin)), server.Options{AuthHTTPClient: insecure})
		if svc != nil {
			svc.Close()
		}
		if !errors.Is(err, authn.ErrUnsafeConfig) {
			t.Fatalf("server.New = %s; want authn.ErrUnsafeConfig: no TLS bypass", quiet(err, dbURL, a.admin))
		}
	})
}

// A staging service admits a request only from its trusted proxy, over HTTPS by the proxy's one X-Forwarded-Proto, at its
// public Host: then a token of the staging Auth reaches GET /v1/me, creating the account with the existing provider kind
// and the staging issuer, and CORS grants exactly its web origin. Everything else is refused with the Host refusal before
// authentication, so Auth is never asked and no account is created: an untrusted peer, private or public, with or
// without forwarded headers or a claim to be the proxy; a plaintext hop; a missing, wrong, upper-case, repeated or listed
// X-Forwarded-Proto; a Forwarded header in its place; an X-Forwarded-Host that is not the Host, or repeated; a Host the
// service does not answer, or the probe's Host through the proxy; a loopback peer anywhere but health and readiness at
// the probe's Host; and a malformed remote address. The probe itself answers.
func TestProductionStagingServiceAdmitsOnlyItsTrustedProxyOverHTTPS(t *testing.T) {
	dbURL := testDatabase(t)
	ca := newStagingCA(t)
	a := newLocalAuth(t)
	auth := newStagingAuth(t, a, ca.leaf(t, stagingAuthHost))
	svc, db := startStagingService(t, dbURL, a, stagingAuthClient(ca, auth.srv))
	token := stagingToken(t, a, "email", "password")
	proxyPeer := stagingProxyIP + ":41234"

	r := stagingRequest(svc, http.MethodGet, "/v1/me", proxyPeer, stagingAPIHost, token, stagingViaProxy...)
	wantStatus(t, r, http.StatusOK)
	if r.header.Get("Strict-Transport-Security") == "" {
		t.Fatal("an admitted answer does not ask browsers to keep to HTTPS")
	}
	var mode, issuer, subject string
	if err := db.QueryRow(context.Background(), `SELECT auth_mode, issuer, subject FROM accounts`).Scan(&mode, &issuer, &subject); err != nil {
		t.Fatalf("read the account: %v", err)
	}
	if mode != config.ModeLocalSupabase || issuer != stagingIssuer || subject != a.uid {
		t.Fatalf("account = %q/%q/%q, want the existing local-supabase provider kind, the staging issuer and the token's subject", mode, issuer, subject)
	}
	_, users, _ := a.served(t)
	if users != 1 {
		t.Fatalf("GET /user asked %d times for one admitted request, want 1", users)
	}

	preflight := func(origin string) reply {
		return stagingRequest(svc, http.MethodOptions, "/v1/me", proxyPeer, stagingAPIHost, "",
			append([]string{"Origin", origin, "Access-Control-Request-Method", http.MethodGet}, stagingViaProxy...)...)
	}
	if got := preflight(stagingAppOrigin).header.Get("Access-Control-Allow-Origin"); got != stagingAppOrigin {
		t.Fatalf("Access-Control-Allow-Origin = %q for the staging web origin, want exactly it", got)
	}
	if got := preflight("https://evil.example.com").header.Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("Access-Control-Allow-Origin = %q for a foreign origin, want none", got)
	}
	r = stagingRequest(svc, http.MethodGet, "/v1/readyz", proxyPeer, stagingAPIHost, "", stagingViaProxy...)
	wantStatus(t, r, http.StatusOK)

	for _, c := range []struct {
		name, method, path, peer, host string
		headers                        []string
	}{
		{"a private-network peer that is not the proxy", "GET", "/v1/me", "10.30.0.9:41234", stagingAPIHost, stagingViaProxy},
		{"a public client reaching the service directly", "GET", "/v1/me", "203.0.113.7:51000", stagingAPIHost, stagingViaProxy},
		{"a direct plaintext request", "GET", "/v1/me", "203.0.113.7:51000", stagingAPIHost, nil},
		{"an untrusted peer claiming to be the proxy", "GET", "/v1/me", "203.0.113.7:51000", stagingAPIHost,
			append([]string{"X-Forwarded-For", stagingProxyIP, "Forwarded", "for=" + stagingProxyIP + ";proto=https"}, stagingViaProxy...)},
		{"the proxy forwarding plaintext", "GET", "/v1/me", proxyPeer, stagingAPIHost, []string{"X-Forwarded-Host", stagingAPIHost}},
		{"the proxy forwarding http", "GET", "/v1/me", proxyPeer, stagingAPIHost, []string{"X-Forwarded-Proto", "http"}},
		{"an upper-case proto", "GET", "/v1/me", proxyPeer, stagingAPIHost, []string{"X-Forwarded-Proto", "HTTPS"}},
		{"two proto headers", "GET", "/v1/me", proxyPeer, stagingAPIHost, []string{"X-Forwarded-Proto", "https", "X-Forwarded-Proto", "https"}},
		{"a proto list", "GET", "/v1/me", proxyPeer, stagingAPIHost, []string{"X-Forwarded-Proto", "https, https"}},
		{"Forwarded in place of X-Forwarded-Proto", "GET", "/v1/me", proxyPeer, stagingAPIHost,
			[]string{"Forwarded", "for=203.0.113.7;proto=https;host=" + stagingAPIHost, "X-Forwarded-Host", stagingAPIHost}},
		{"a forwarded Host that is not the Host", "GET", "/v1/me", proxyPeer, stagingAPIHost,
			[]string{"X-Forwarded-Proto", "https", "X-Forwarded-Host", "evil.example.com"}},
		{"two forwarded Host headers", "GET", "/v1/me", proxyPeer, stagingAPIHost,
			[]string{"X-Forwarded-Proto", "https", "X-Forwarded-Host", stagingAPIHost, "X-Forwarded-Host", stagingAPIHost}},
		{"a Host the service does not answer", "GET", "/v1/me", proxyPeer, "evil.example.com", stagingViaProxy},
		{"the probe's Host through the proxy", "GET", "/v1/me", proxyPeer, stagingProbeHost, stagingViaProxy},
		{"a loopback peer outside health and readiness", "GET", "/v1/me", stagingProbePeer, stagingProbeHost, nil},
		{"a loopback peer at the public Host", "GET", "/v1/me", stagingProbePeer, stagingAPIHost, stagingViaProxy},
		{"an IPv6 loopback peer outside health and readiness", "GET", "/v1/me", "[::1]:50000", stagingProbeHost, nil},
		{"a private-network peer at the probe's Host", "GET", "/v1/healthz", "10.30.0.9:41234", stagingProbeHost, nil},
		{"an empty remote address", "GET", "/v1/me", "", stagingAPIHost, stagingViaProxy},
		{"a remote address that is no address", "GET", "/v1/me", "garbage", stagingAPIHost, stagingViaProxy},
		{"the proxy's address without a port", "GET", "/v1/me", stagingProxyIP, stagingAPIHost, stagingViaProxy},
		{"the proxy's address with an empty port", "GET", "/v1/me", stagingProxyIP + ":", stagingAPIHost, stagingViaProxy},
		{"the proxy's IPv4 address in brackets", "GET", "/v1/me", "[" + stagingProxyIP + "]:41234", stagingAPIHost, stagingViaProxy},
	} {
		t.Run(c.name, func(t *testing.T) {
			wantProblem(t, stagingRequest(svc, c.method, c.path, c.peer, c.host, token, c.headers...), http.StatusMisdirectedRequest, "host_not_allowed")
		})
	}
	if _, after, _ := a.served(t); after != users {
		t.Fatalf("refused requests asked GET /user %d more times; want Auth never asked", after-users)
	}
	var accounts int
	if err := db.QueryRow(context.Background(), `SELECT count(*) FROM accounts`).Scan(&accounts); err != nil {
		t.Fatalf("count accounts: %v", err)
	}
	if accounts != 1 {
		t.Fatalf("%d accounts after the refused requests, want only the admitted one's", accounts)
	}

	for _, path := range []string{"/v1/healthz", "/v1/readyz"} {
		wantStatus(t, stagingRequest(svc, http.MethodGet, path, stagingProbePeer, stagingProbeHost, ""), http.StatusOK)
	}
}

// Through the trusted proxy, a staging service keeps the account controls' rules: a password sign-in of the last minutes
// may read the account export, a Google (OAuth-only) session needs a password sign-in first, and a session Auth no
// longer confirms (revoked) is refused with the uniform 401.
func TestProductionStagingServiceKeepsRevocationAndThePasswordStepUp(t *testing.T) {
	dbURL := testDatabase(t)
	ca := newStagingCA(t)
	a := newLocalAuth(t)
	auth := newStagingAuth(t, a, ca.leaf(t, stagingAuthHost))
	svc, _ := startStagingService(t, dbURL, a, stagingAuthClient(ca, auth.srv))
	proxyPeer := stagingProxyIP + ":41234"
	password := stagingToken(t, a, "email", "password")
	google := stagingToken(t, a, "google", "oauth")

	wantStatus(t, stagingRequest(svc, http.MethodGet, "/v1/me/export", proxyPeer, stagingAPIHost, password, stagingViaProxy...), http.StatusOK)
	wantProblem(t, stagingRequest(svc, http.MethodGet, "/v1/me/export", proxyPeer, stagingAPIHost, google, stagingViaProxy...),
		http.StatusUnauthorized, "reauthentication_required")

	auth.revoke()
	wantProblem(t, stagingRequest(svc, http.MethodGet, "/v1/me", proxyPeer, stagingAPIHost, password, stagingViaProxy...),
		http.StatusUnauthorized, "unauthenticated")
}
