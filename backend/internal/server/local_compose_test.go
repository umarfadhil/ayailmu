package server_test

// Local synthetic Compose mode (AYA_MODE=local-compose), Phase 8 RED. The service factory builds the FetchJWKS Supabase
// verifier against the stack's own GoTrue by its name on the internal network (a name, not a literal loopback address),
// which must be exactly one of AYA_AUTH_HOSTS, port included; plain http is acceptable only there. Startup fetches Auth's
// key set and verifies the schema without migrating it, and nothing serves before both pass. Accounts are keyed by the
// configured issuer and a token's subject and record the local-supabase provider kind: the stack's accounts are local
// synthetic Supabase accounts, so the account schema needs no new mode. The deploy guards apply as in deploy-smoke.
// TestLocalComposeServiceTrustsOnlyItsAllowlistedAuthByName runs against the owned plain-HTTP stand-in that
// local_supabase_test.go defines, reached by the name "localhost"; TestLocalComposeServiceAcceptsARealGoTruePasswordSession
// runs against the pinned real GoTrue v2.197.0 fixture (AYA_REAL_AUTH_FIXTURE), also by name. Both use the isolated
// loopback PostgreSQL (AYA_TEST_DATABASE_URL) in fresh aya_t_ schemas that they drop. Missing infrastructure fails the
// tests; nothing is skipped. No token, password or credential is printed.

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"testing"
	"time"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/server"
	"ayailmu.local/backend/internal/store"
)

// composeEnvFor is a complete local-compose configuration on schema, listening on listen, whose Auth is reached by its
// internal name authHost, signing as issuer for audience, with its admin credential in adminKeyFile. The database URL is
// a throwaway runtime role (runtimeRoleURL), DML-capable as the runtime's is: GET /v1/me creates the account.
func composeEnvFor(t *testing.T, dbURL, schema, listen, authHost, issuer, audience, adminKeyFile string) map[string]string {
	t.Helper()
	env := deployEnvFor(config.ModeLocalCompose, schema, listen, privateFile(t, runtimeRoleURL(t, dbURL, schema)), databaseHostOf(t, dbURL))
	env[config.EnvSupabaseURL] = "http://" + authHost
	env[config.EnvAuthHosts] = authHost
	env[config.EnvSupabaseIssuer] = issuer
	env[config.EnvSupabaseAudience] = audience
	env[config.EnvSupabaseAdminKeyFile] = adminKeyFile
	return env
}

// byName is the port of base, which must be on literal IPv4 loopback, reached by the name "localhost": it stands in for a
// container's name on the stack's internal network, a name the resolver answers rather than a literal loopback address.
func byName(t *testing.T, base string) string {
	t.Helper()
	u, err := url.Parse(base)
	if err != nil || u.Hostname() != "127.0.0.1" || u.Port() == "" {
		t.Fatal("the Auth under test is not on literal IPv4 loopback with a port")
	}
	return "localhost:" + u.Port()
}

// A local-compose service fetches its Auth's key set by the Auth's allowlisted internal name at startup, reports its mode
// and readiness, and lets a token of Auth's key reach GET /v1/me: one GET /user, an account keyed by the local-supabase
// provider kind, the configured issuer and the token's subject. It answers only its exact Host values. An Auth URL whose
// host is not one of AYA_AUTH_HOSTS refuses startup without any request to Auth, and an unmigrated schema refuses startup
// and stays absent.
func TestLocalComposeServiceTrustsOnlyItsAllowlistedAuthByName(t *testing.T) {
	dbURL := testDatabase(t)
	probe := fixturePool(t, dbURL, "aya_t_probe")
	t.Cleanup(probe.Close)

	t.Run("Auth's key set fetched by name at startup verifies its tokens", func(t *testing.T) {
		a := newLocalAuth(t)
		schema, db := migratedSchema(t, dbURL)
		ln := loopbackListener(t)
		env := composeEnvFor(t, dbURL, schema, ln.Addr().String(), byName(t, a.srv.URL), localIssuer, "authenticated", privateFile(t, a.admin))
		svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
		if err != nil {
			ln.Close()
			t.Fatalf("server.New(local-compose with its Auth by name): %s", quiet(err, a.admin, dbURL))
		}
		s := serveOn(t, ln, svc, db)
		if keys, users, _ := a.served(t); keys != 1 || users != 0 {
			t.Fatalf("startup asked Auth's key set %d times and GET /user %d times, want once and never", keys, users)
		}

		r := s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", deployHost)
		wantStatus(t, r, http.StatusOK)
		var h struct{ Status, Mode string }
		decodeJSON(t, r.body, &h)
		if h.Status != "ok" || h.Mode != config.ModeLocalCompose {
			t.Fatalf("health = %+v, want ok/%s", h, config.ModeLocalCompose)
		}
		wantReadiness(t, s, http.StatusOK, `{"status":"ready"}`)

		r = s.call(t, http.MethodGet, "/v1/me", a.token(t), nil, "Host", deployHost)
		wantStatus(t, r, http.StatusOK)
		var got me
		decodeJSON(t, r.body, &got)
		if !uuidRE.MatchString(got.AccountID) || len(got.Profiles) != 0 {
			t.Fatalf("GET /v1/me = %+v, want a new account without profiles", got)
		}
		if keys, users, _ := a.served(t); keys != 1 || users != 1 {
			t.Fatalf("a token of the startup key set asked Auth's key set %d times in all and GET /user %d times, want once each", keys, users)
		}
		if mode, issuer, subject := s.onlyAccount(t); mode != config.ModeLocalSupabase || issuer != localIssuer || subject != a.uid {
			t.Fatalf("the account is keyed %q/%q/%q, want the local-supabase provider kind, the configured issuer and the token's subject", mode, issuer, subject)
		}
		wantProblem(t, s.call(t, http.MethodGet, "/v1/me", "", nil, "Host", deployHost), http.StatusUnauthorized, "unauthenticated")
		_, port, err := net.SplitHostPort(ln.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		wantProblem(t, s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", "localhost:"+port), http.StatusMisdirectedRequest, "host_not_allowed")
	})

	t.Run("an Auth URL outside AYA_AUTH_HOSTS refuses startup without contacting Auth", func(t *testing.T) {
		a := newLocalAuth(t)
		schema := newSchemaName(t)
		env := composeEnvFor(t, dbURL, schema, "127.0.0.1:8091", byName(t, a.srv.URL), localIssuer, "authenticated", privateFile(t, a.admin))
		env[config.EnvAuthHosts] = "aya-auth:9999"
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		svc, err := server.New(ctx, lookupIn(env), server.Options{})
		if svc != nil {
			svc.Close()
		}
		if schemaExists(t, probe, schema) {
			dropSchema(t, probe, schema)
			t.Error("a refused startup created its schema")
		}
		if svc != nil || !errors.Is(err, config.ErrAuthHostNotAllowed) {
			t.Fatalf("server.New error = %s, want config.ErrAuthHostNotAllowed", quiet(err, a.admin, dbURL))
		}
		if _, _, total := a.served(t); total != 0 {
			t.Fatalf("a refused startup sent %d requests to Auth", total)
		}
	})

	t.Run("an unmigrated schema refuses startup and stays absent", func(t *testing.T) {
		a := newLocalAuth(t)
		schema := newSchemaName(t)
		env := composeEnvFor(t, dbURL, schema, "127.0.0.1:8091", byName(t, a.srv.URL), localIssuer, "authenticated", privateFile(t, a.admin))
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		svc, err := server.New(ctx, lookupIn(env), server.Options{})
		if svc != nil {
			svc.Close()
		}
		if schemaExists(t, probe, schema) {
			dropSchema(t, probe, schema)
			t.Error("startup created the schema: only the migration job may")
		}
		if svc != nil || !errors.Is(err, store.ErrSchemaNotCurrent) {
			t.Fatalf("server.New error = %s, want store.ErrSchemaNotCurrent", quiet(err, a.admin, dbURL))
		}
	})
}

// Against the pinned real GoTrue v2.197.0 fixture reached by name, a local-compose service built by the factory fetches
// Auth's key set at startup, and a password session the test signs in to reaches GET /v1/me as the fixture's synthetic
// user; a second request finds the same account, keyed by the local-supabase provider kind, the fixture's issuer and its
// user's ID. Tokens signed with Auth's own key but naming another issuer, another audience or the service_role get the
// same uniform 401 as no token, and create no account.
func TestLocalComposeServiceAcceptsARealGoTruePasswordSession(t *testing.T) {
	fx := realAuthFixture(t)
	dbURL := testDatabase(t)
	token := fx.signIn(t)
	secrets := []string{token, fx.password, fx.wrongIssuer, fx.wrongAudience, fx.wrongRole, dbURL}

	schema, db := migratedSchema(t, dbURL)
	ln := loopbackListener(t)
	env := composeEnvFor(t, dbURL, schema, ln.Addr().String(), byName(t, fx.url), fx.issuer, fx.audience, fx.adminKeyFile)
	svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
	if err != nil {
		ln.Close()
		t.Fatalf("server.New(local-compose against the real GoTrue fixture by name): %s", quiet(err, secrets...))
	}
	s := serveOn(t, ln, svc, db)

	r := s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", deployHost)
	wantStatus(t, r, http.StatusOK)
	var h struct{ Status, Mode string }
	decodeJSON(t, r.body, &h)
	if h.Status != "ok" || h.Mode != config.ModeLocalCompose {
		t.Fatalf("health = %+v, want ok/%s", h, config.ModeLocalCompose)
	}

	r = s.call(t, http.MethodGet, "/v1/me", token, nil, "Host", deployHost)
	wantStatus(t, r, http.StatusOK)
	var first me
	decodeJSON(t, r.body, &first)
	if !uuidRE.MatchString(first.AccountID) || len(first.Profiles) != 0 {
		t.Fatalf("GET /v1/me = %+v, want a new account without profiles", first)
	}
	r = s.call(t, http.MethodGet, "/v1/me", token, nil, "Host", deployHost)
	wantStatus(t, r, http.StatusOK)
	var again me
	decodeJSON(t, r.body, &again)
	if again.AccountID != first.AccountID {
		t.Fatal("a second request of the same session found another account")
	}
	if mode, issuer, subject := s.onlyAccount(t); mode != config.ModeLocalSupabase || issuer != fx.issuer || subject != fx.userID {
		t.Fatalf("the account is keyed %q/%q/%q, want the local-supabase provider kind, the fixture's issuer and its user's ID", mode, issuer, subject)
	}

	none := s.call(t, http.MethodGet, "/v1/me", "", nil, "Host", deployHost)
	wantProblem(t, none, http.StatusUnauthorized, "unauthenticated")
	for _, c := range []struct{ name, token string }{
		{"another issuer", fx.wrongIssuer},
		{"another audience", fx.wrongAudience},
		{"the service_role", fx.wrongRole},
	} {
		r := s.call(t, http.MethodGet, "/v1/me", c.token, nil, "Host", deployHost)
		wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
		if !bytes.Equal(r.body, none.body) {
			t.Fatalf("a token signed with Auth's key but naming %s gets another 401 than no token", c.name)
		}
	}
	if n := s.count(t, "SELECT count(*) FROM accounts"); n != 1 {
		t.Fatalf("refused tokens left %d accounts, want only the signed-in user's", n)
	}
}
