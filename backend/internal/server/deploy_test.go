package server_test

// Deploy modes, Phase 8 RED. A deploy-smoke service is a deployment's deny-all verifier. On the current schema it starts on
// a session that cannot write (as the runtime role, which has no DDL right), answers health and readiness, and gives every
// request the uniform 401 whatever token it carries, so it never creates an account. Readiness follows the database and
// its schema: 503 not_ready, without detail, once the schema is not exactly this binary's or the database is gone, while
// health stays 200. Startup verifies the schema and never migrates it: an absent or older schema refuses startup and is
// left as it was. A database host outside AYA_DB_HOSTS, and a database URL in the environment, refuse startup before
// anything is opened. A deploy mode answers only its exact Host values and the container's own loopback probe, grants
// CORS only to its exact https origins (none: native clients only), and asks browsers to keep to HTTPS. The tests use the
// isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL) in fresh aya_t_ schemas that they drop; missing infrastructure
// fails them, nothing is skipped. No DSN, token or credential is printed.

import (
	"bytes"
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/server"
	"ayailmu.local/backend/internal/store"
)

const (
	// deployHost is the synthetic public name of the stack's HTTPS front, in a .test domain that resolves nowhere, and
	// deployOrigin the web origin the stack grants: the service only meets them as Host and Origin header values.
	deployHost   = "api.ayailmu-local.test"
	deployOrigin = "https://app.ayailmu-local.test"
	// localWebPreview is the loopback modes' Expo web preview, which no deploy mode grants.
	localWebPreview = "http://localhost:8087"
)

// readOnlySessionURL is dbURL for sessions whose every transaction is read-only, as the runtime role's would be without
// any DDL or write right: anything such a service tried to create or change would fail.
func readOnlySessionURL(t *testing.T, dbURL string) string {
	t.Helper()
	u, err := url.Parse(dbURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		t.Fatal("AYA_TEST_DATABASE_URL must be a postgres:// URL for a read-only session setting to be added to it")
	}
	q := u.Query()
	q.Set("default_transaction_read_only", "on")
	u.RawQuery = q.Encode()
	return u.String()
}

// databaseHostOf is the host of dbURL, as AYA_DB_HOSTS must list it.
func databaseHostOf(t *testing.T, dbURL string) string {
	t.Helper()
	u, err := url.Parse(dbURL)
	if err != nil || u.Hostname() == "" {
		t.Fatal("AYA_TEST_DATABASE_URL must be a postgres:// URL that names its host")
	}
	return u.Hostname()
}

// passwordOf is dbURL's password, which no refusal may quote.
func passwordOf(dbURL string) string {
	u, err := url.Parse(dbURL)
	if err != nil {
		return ""
	}
	password, _ := u.User.Password()
	return password
}

// deployEnvFor is a complete configuration of a deploy mode on schema, listening on listen, with its database URL in the
// private file urlFile and dbHost as its one database host. It answers deployHost and grants deployOrigin.
func deployEnvFor(mode, schema, listen, urlFile, dbHost string) map[string]string {
	return map[string]string{
		config.EnvMode:            mode,
		config.EnvListen:          listen,
		config.EnvAllowedHosts:    deployHost,
		config.EnvCORSOrigins:     deployOrigin,
		config.EnvDBHosts:         dbHost,
		config.EnvDatabaseURLFile: urlFile,
		config.EnvSchema:          schema,
	}
}

// migratedSchema is a fresh aya_t_ schema that the migration path (store.Migrate as the schema's owner) brought up to
// date, and a fixture pool on it; the schema is dropped at cleanup.
func migratedSchema(t *testing.T, dbURL string) (string, *pgxpool.Pool) {
	t.Helper()
	schema := newSchemaName(t)
	db := fixturePool(t, dbURL, schema)
	t.Cleanup(func() {
		dropSchema(t, db, schema)
		db.Close()
	})
	owner, err := store.Open(context.Background(), dbURL, schema)
	if err != nil {
		t.Fatalf("open the owner's store: %s", quiet(err, dbURL))
	}
	defer owner.Close()
	if err := owner.Migrate(context.Background()); err != nil {
		t.Fatalf("migrate as the owner: %s", quiet(err, dbURL))
	}
	return schema, db
}

// newestVersion is the newest migration version recorded in the fixture pool's schema.
func newestVersion(t *testing.T, db *pgxpool.Pool) int {
	t.Helper()
	var v int
	if err := db.QueryRow(context.Background(), "SELECT max(version) FROM schema_migrations").Scan(&v); err != nil {
		t.Fatalf("read the newest recorded migration: %v", err)
	}
	return v
}

// wantReadiness checks GET /v1/readyz through the stack's front: exactly status and body, with no detail.
func wantReadiness(t *testing.T, s *stack, status int, body string) {
	t.Helper()
	r := s.call(t, http.MethodGet, "/v1/readyz", "", nil, "Host", deployHost)
	wantStatus(t, r, status)
	if got := strings.TrimSpace(string(r.body)); got != body {
		t.Fatalf("GET /v1/readyz = %d %.200q, want %d %s and no detail", r.status, r.body, status, body)
	}
}

// On the current schema, on a session that cannot write, a deploy-smoke service reports its mode and readiness, and
// answers every route with the uniform 401 whether a request carries no token, a well-formed token signed by a key this
// deployment never trusts, or an opaque one; no account is created. Readiness turns not_ready while the record holds a
// newer release's migration and back to ready once it is gone, and not_ready once the service's database is closed;
// health answers 200 throughout.
func TestDeploySmokeServiceDeniesEveryTokenAndReportsReadiness(t *testing.T) {
	dbURL := testDatabase(t)
	schema, db := migratedSchema(t, dbURL)
	ln := loopbackListener(t)
	env := deployEnvFor(config.ModeDeploySmoke, schema, ln.Addr().String(), privateFile(t, readOnlySessionURL(t, dbURL)), databaseHostOf(t, dbURL))
	svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
	if err != nil {
		ln.Close()
		t.Fatalf("server.New(deploy-smoke on the current schema, on a session that cannot write): %s", quiet(err, dbURL))
	}
	s := serveOn(t, ln, svc, db)

	r := s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", deployHost)
	wantStatus(t, r, http.StatusOK)
	var h struct{ Status, Mode string }
	decodeJSON(t, r.body, &h)
	if h.Status != "ok" || h.Mode != config.ModeDeploySmoke {
		t.Fatalf("health = %+v, want ok/%s", h, config.ModeDeploySmoke)
	}
	wantReadiness(t, s, http.StatusOK, `{"status":"ready"}`)

	none := s.call(t, http.MethodGet, "/v1/me", "", nil, "Host", deployHost)
	wantProblem(t, none, http.StatusUnauthorized, "unauthenticated")
	pid := syntheticUUID(t)
	tokens := []string{newLocalAuth(t).token(t), "opaque-" + randomHex(t, 16)}
	for _, rt := range []struct{ method, path string }{
		{http.MethodGet, "/v1/me"},
		{http.MethodGet, "/v1/curricula"},
		{http.MethodPost, "/v1/imports"},
		{http.MethodGet, "/v1/profiles/" + pid},
		{http.MethodPatch, "/v1/profiles/" + pid},
		{http.MethodPost, "/v1/profiles/" + pid + "/events"},
		{http.MethodGet, "/v1/profiles/" + pid + "/events?after=0"},
		{http.MethodGet, "/v1/profiles/" + pid + "/progress?family=expo-trial-arabic"},
		{http.MethodGet, "/v1/me/export"},
		{http.MethodGet, "/v1/me/deletion"},
		{http.MethodPost, "/v1/me/deletion"},
	} {
		for i, token := range tokens {
			var body []byte
			if rt.method != http.MethodGet {
				body = []byte(`{}`)
			}
			r := s.call(t, rt.method, rt.path, token, body, "Host", deployHost)
			wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
			if !bytes.Equal(r.body, none.body) {
				t.Fatalf("token %d on %s %s gets another 401 than no token", i, rt.method, rt.path)
			}
		}
	}
	if n := s.count(t, "SELECT count(*) FROM accounts"); n != 0 {
		t.Fatalf("deploy-smoke created %d accounts; it accepts no token", n)
	}

	newer := newestVersion(t, db) + 1
	if _, err := db.Exec(context.Background(), "INSERT INTO schema_migrations (version) VALUES ($1)", newer); err != nil {
		t.Fatalf("record a newer release's migration: %v", err)
	}
	wantReadiness(t, s, http.StatusServiceUnavailable, `{"status":"not_ready"}`)
	wantStatus(t, s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", deployHost), http.StatusOK)
	if _, err := db.Exec(context.Background(), "DELETE FROM schema_migrations WHERE version = $1", newer); err != nil {
		t.Fatalf("remove the newer migration: %v", err)
	}
	wantReadiness(t, s, http.StatusOK, `{"status":"ready"}`)

	svc.Close()
	wantReadiness(t, s, http.StatusServiceUnavailable, `{"status":"not_ready"}`)
	wantStatus(t, s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", deployHost), http.StatusOK)
}

// Startup verifies the schema and never migrates it: an absent schema refuses startup with ErrSchemaNotCurrent and stays
// absent even on a session that could create it, and an older one refuses startup with its record left as it was. The
// current schema starts on a session that cannot write. A database host outside AYA_DB_HOSTS, and a database URL in the
// environment, refuse startup before anything is opened. No refusal quotes the database URL or its password.
func TestDeploySmokeStartsOnlyOnTheCurrentSchemaAndRunsNoDDL(t *testing.T) {
	dbURL := testDatabase(t)
	host := databaseHostOf(t, dbURL)
	probe := fixturePool(t, dbURL, "aya_t_probe")
	t.Cleanup(probe.Close)
	refused := func(t *testing.T, env map[string]string) error {
		t.Helper()
		svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
		if svc != nil {
			svc.Close()
			t.Error("server.New started a deploy-smoke service it must refuse")
		}
		if err != nil {
			if strings.Contains(err.Error(), dbURL) || (passwordOf(dbURL) != "" && strings.Contains(err.Error(), passwordOf(dbURL))) {
				t.Fatal("the refusal quotes the database URL or its password")
			}
		}
		return err
	}

	t.Run("an absent schema refuses startup and stays absent, even on a session that could create it", func(t *testing.T) {
		schema := newSchemaName(t)
		err := refused(t, deployEnvFor(config.ModeDeploySmoke, schema, "127.0.0.1:8091", privateFile(t, dbURL), host))
		if schemaExists(t, probe, schema) {
			dropSchema(t, probe, schema)
			t.Error("startup created the schema: only the migration job may")
		}
		if !errors.Is(err, store.ErrSchemaNotCurrent) {
			t.Fatalf("server.New error = %s, want store.ErrSchemaNotCurrent", quiet(err, dbURL))
		}
	})

	t.Run("an older schema refuses startup and is left as it was", func(t *testing.T) {
		schema, db := migratedSchema(t, dbURL)
		newest := newestVersion(t, db)
		if _, err := db.Exec(context.Background(), "DELETE FROM schema_migrations WHERE version = $1", newest); err != nil {
			t.Fatalf("make the record an older release's: %v", err)
		}
		err := refused(t, deployEnvFor(config.ModeDeploySmoke, schema, "127.0.0.1:8091", privateFile(t, dbURL), host))
		if !errors.Is(err, store.ErrSchemaNotCurrent) {
			t.Fatalf("server.New error = %s, want store.ErrSchemaNotCurrent", quiet(err, dbURL))
		}
		if got := newestVersion(t, db); got != newest-1 {
			t.Fatalf("startup changed the record (newest now %d, was %d): it must never migrate", got, newest-1)
		}
	})

	t.Run("the current schema starts on a session that cannot write", func(t *testing.T) {
		schema, _ := migratedSchema(t, dbURL)
		env := deployEnvFor(config.ModeDeploySmoke, schema, "127.0.0.1:8091", privateFile(t, readOnlySessionURL(t, dbURL)), host)
		svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
		if err != nil {
			t.Fatalf("server.New(deploy-smoke on the current schema, on a session that cannot write): %s", quiet(err, dbURL))
		}
		svc.Close()
	})

	t.Run("a database host outside AYA_DB_HOSTS refuses startup before anything is opened", func(t *testing.T) {
		schema := newSchemaName(t)
		err := refused(t, deployEnvFor(config.ModeDeploySmoke, schema, "127.0.0.1:8091", privateFile(t, dbURL), "db"))
		if schemaExists(t, probe, schema) {
			dropSchema(t, probe, schema)
			t.Error("a refused startup created its schema")
		}
		if !errors.Is(err, config.ErrDatabaseHostNotAllowed) {
			t.Fatalf("server.New error = %s, want config.ErrDatabaseHostNotAllowed", quiet(err, dbURL))
		}
	})

	t.Run("a database URL in the environment refuses startup before anything is opened", func(t *testing.T) {
		schema := newSchemaName(t)
		env := deployEnvFor(config.ModeDeploySmoke, schema, "127.0.0.1:8091", privateFile(t, dbURL), host)
		env[config.EnvDatabaseURL] = dbURL
		err := refused(t, env)
		if schemaExists(t, probe, schema) {
			dropSchema(t, probe, schema)
			t.Error("a refused startup created its schema")
		}
		if !errors.Is(err, config.ErrSecretInEnvironment) {
			t.Fatalf("server.New error = %s, want config.ErrSecretInEnvironment", quiet(err, dbURL))
		}
	})
}

// A deploy-mode service answers exactly its configured Host values and the container's own loopback health probe
// (127.0.0.1:<port>), not localhost:<port>, another port or another name; it asks browsers to keep to HTTPS for at least
// a day. Its CORS gate grants only its exact https origin, without credentials, and neither the loopback modes' web
// preview nor any other origin; without AYA_CORS_ORIGINS it grants none at all.
func TestDeployModesAnswerOnlyTheirExactHostsAndOrigins(t *testing.T) {
	dbURL := testDatabase(t)
	schema, db := migratedSchema(t, dbURL)
	open := func(t *testing.T, edit func(map[string]string)) (*stack, string) {
		t.Helper()
		ln := loopbackListener(t)
		env := deployEnvFor(config.ModeDeploySmoke, schema, ln.Addr().String(), privateFile(t, readOnlySessionURL(t, dbURL)), databaseHostOf(t, dbURL))
		if edit != nil {
			edit(env)
		}
		svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
		if err != nil {
			ln.Close()
			t.Fatalf("server.New(deploy-smoke): %s", quiet(err, dbURL))
		}
		return serveOn(t, ln, svc, db), ln.Addr().String()
	}
	preflight := func(t *testing.T, s *stack, origin string) reply {
		t.Helper()
		return s.call(t, http.MethodOptions, "/v1/me", "", nil, "Host", deployHost, "Origin", origin,
			"Access-Control-Request-Method", "GET", "Access-Control-Request-Headers", "authorization")
	}
	s, probeHost := open(t, nil)
	_, port, err := net.SplitHostPort(probeHost)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("only the exact Host values and the loopback probe are answered", func(t *testing.T) {
		for _, c := range []struct {
			host string
			ok   bool
		}{
			{deployHost, true},
			{probeHost, true},
			{"localhost:" + port, false},
			{deployHost + ":" + port, false},
			{"app.ayailmu-local.test", false},
			{"evil.example", false},
		} {
			r := s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", c.host)
			if c.ok {
				wantStatus(t, r, http.StatusOK)
			} else {
				wantProblem(t, r, http.StatusMisdirectedRequest, "host_not_allowed")
			}
		}
	})

	t.Run("every answer asks browsers to keep to HTTPS", func(t *testing.T) {
		r := s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", deployHost)
		hsts := r.header.Get("Strict-Transport-Security")
		age, ok := strings.CutPrefix(hsts, "max-age=")
		seconds, err := strconv.Atoi(strings.TrimSpace(strings.SplitN(age, ";", 2)[0]))
		if !ok || err != nil || seconds < 86400 {
			t.Fatalf("Strict-Transport-Security = %q, want a max-age of at least a day", hsts)
		}
	})

	t.Run("CORS grants only the exact https origin", func(t *testing.T) {
		r := preflight(t, s, deployOrigin)
		wantStatus(t, r, http.StatusNoContent)
		if got := r.header.Get("Access-Control-Allow-Origin"); got != deployOrigin {
			t.Fatalf("Access-Control-Allow-Origin = %q, want exactly %q", got, deployOrigin)
		}
		if got := r.header.Get("Access-Control-Allow-Credentials"); got != "" {
			t.Fatalf("Access-Control-Allow-Credentials = %q, want none: the API takes bearer tokens, not cookies", got)
		}
		for _, origin := range []string{localWebPreview, "http://127.0.0.1:8087", "http://app.ayailmu-local.test", "https://evil.example"} {
			r := preflight(t, s, origin)
			wantProblem(t, r, http.StatusForbidden, "origin_not_allowed")
			if got := r.header.Get("Access-Control-Allow-Origin"); got != "" {
				t.Fatalf("a preflight from an origin outside AYA_CORS_ORIGINS was granted %q", got)
			}
		}
		r = s.call(t, http.MethodGet, "/v1/me", "", nil, "Host", deployHost, "Origin", deployOrigin)
		wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
		if got := r.header.Get("Access-Control-Allow-Origin"); got != deployOrigin {
			t.Fatalf("a request from the granted origin cannot read its answer (Access-Control-Allow-Origin %q)", got)
		}
		r = s.call(t, http.MethodGet, "/v1/me", "", nil, "Host", deployHost, "Origin", localWebPreview)
		if got := r.header.Get("Access-Control-Allow-Origin"); got != "" {
			t.Fatalf("a request from the local web preview was granted %q", got)
		}
	})

	t.Run("without AYA_CORS_ORIGINS only native clients are served", func(t *testing.T) {
		native, _ := open(t, func(env map[string]string) { delete(env, config.EnvCORSOrigins) })
		for _, origin := range []string{deployOrigin, localWebPreview} {
			wantProblem(t, preflight(t, native, origin), http.StatusForbidden, "origin_not_allowed")
		}
		wantStatus(t, native.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", deployHost), http.StatusOK)
	})
}
