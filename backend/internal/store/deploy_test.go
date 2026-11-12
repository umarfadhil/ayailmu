package store_test

// Deploy-mode database guards, Phase 8 RED. ParseConfigAllowing applies a deploy mode's exact database host allow-list to
// every host pgx would dial, the primary and each fallback, after pgx read the PG* environment: neither a fallback, a host
// parameter nor PGHOST adds a host the deployment did not name, and neither loopback nor a Unix socket is implied.
// VerifySchema accepts only a schema whose recorded migrations are exactly this binary's, with reads only: it runs on a
// session whose every transaction is read-only, as the runtime role has no DDL right, and creates or changes nothing. The
// schema test uses the isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL) in a fresh aya_t_ schema that it drops;
// missing infrastructure fails it, nothing is skipped. No connection string or password is printed.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/store"
)

// storePassword is a synthetic marker, not a credential: no refusal may quote it.
const storePassword = "fake-store-pw-not-real-2291"

// runtimeURL is a runtime role's connection string to hosts, with query appended.
func runtimeURL(hosts, query string) string {
	return "postgres://aya_runtime:" + storePassword + "@" + hosts + "/ayailmu" + query
}

// withheld renders err for a failure message, unless it quotes the synthetic password.
func withheld(err error) string {
	switch {
	case err == nil:
		return "no error"
	case strings.Contains(err.Error(), storePassword):
		return "an error that quotes the password (withheld)"
	default:
		return err.Error()
	}
}

// Every host pgx would dial must be exactly one of the allowed hosts: the named primary and fallbacks in both string
// forms, a host parameter, and the hosts pgx takes from PGHOST when the string names none. A refusal quotes no password,
// and a connection string pgx cannot parse is refused as such. Nothing is dialed.
func TestParseConfigAllowingChecksEveryHostPgxWouldDial(t *testing.T) {
	allowed := []string{"db", "db-replica"}
	for _, c := range []struct {
		name string
		dsn  string
		env  map[string]string
		want error
	}{
		{"the allowed primary host", runtimeURL("db:5432", "?sslmode=disable"), nil, nil},
		{"allowed primary and fallback hosts", runtimeURL("db:5432,db-replica:5432", "?sslmode=disable"), nil, nil},
		{"keyword form naming allowed hosts", "host=db,db-replica port=5432 user=aya_runtime password=" + storePassword + " dbname=ayailmu sslmode=disable", nil, nil},
		{"PGHOST naming an allowed host", runtimeURL("", "?sslmode=disable"), map[string]string{"PGHOST": "db"}, nil},
		{"a primary host outside the allow-list", runtimeURL("db.example.com:5432", ""), nil, store.ErrDatabaseHostNotAllowed},
		{"a fallback host outside the allow-list", runtimeURL("db:5432,db.example.com:5432", ""), nil, store.ErrDatabaseHostNotAllowed},
		{"a host parameter outside the allow-list", runtimeURL("db:5432", "?host=db.example.com"), nil, store.ErrDatabaseHostNotAllowed},
		{"loopback, which the allow-list does not name", runtimeURL("127.0.0.1:5432", ""), nil, store.ErrDatabaseHostNotAllowed},
		{"a Unix socket directory the allow-list does not name", "host=/var/run/postgresql user=aya_runtime dbname=ayailmu", nil, store.ErrDatabaseHostNotAllowed},
		{"PGHOST naming a host outside the allow-list", runtimeURL("", "?sslmode=disable"), map[string]string{"PGHOST": "db.example.com"}, store.ErrDatabaseHostNotAllowed},
		{"PGHOST adding a fallback outside the allow-list", runtimeURL("", "?sslmode=disable"), map[string]string{"PGHOST": "db,db.example.com"}, store.ErrDatabaseHostNotAllowed},
		{"a connection string pgx cannot parse", runtimeURL("db:5432", "?connect_timeout=soon"), nil, store.ErrInvalidDatabaseURL},
	} {
		t.Run(c.name, func(t *testing.T) {
			for k, v := range c.env {
				t.Setenv(k, v)
			}
			cfg, err := store.ParseConfigAllowing(c.dsn, "ayailmu", allowed)
			if c.want == nil {
				switch {
				case err != nil:
					t.Fatalf("ParseConfigAllowing refused allowed hosts: %s", withheld(err))
				case cfg.ConnConfig.RuntimeParams["search_path"] != "ayailmu":
					t.Fatalf("search_path = %q, want the configured schema", cfg.ConnConfig.RuntimeParams["search_path"])
				}
				return
			}
			if !errors.Is(err, c.want) {
				t.Fatalf("ParseConfigAllowing error = %s, want %v", withheld(err), c.want)
			}
			if strings.Contains(err.Error(), storePassword) {
				t.Fatal("the refusal quotes the password")
			}
		})
	}

	t.Run("an empty allow-list allows nothing", func(t *testing.T) {
		if _, err := store.ParseConfigAllowing(runtimeURL("db:5432", ""), "ayailmu", nil); !errors.Is(err, store.ErrDatabaseHostNotAllowed) {
			t.Fatalf("ParseConfigAllowing with no allowed host = %s, want ErrDatabaseHostNotAllowed", withheld(err))
		}
	})
	t.Run("a schema outside the rule is refused", func(t *testing.T) {
		if _, err := store.ParseConfigAllowing(runtimeURL("db:5432", ""), "public", allowed); !errors.Is(err, store.ErrInvalidSchema) {
			t.Fatalf("ParseConfigAllowing for schema public = %s, want ErrInvalidSchema", withheld(err))
		}
	})
}

// testDatabaseURL returns the isolated loopback PostgreSQL. It fails, never skips, when it is missing.
func testDatabaseURL(t *testing.T) string {
	t.Helper()
	dbURL := os.Getenv("AYA_TEST_DATABASE_URL")
	if dbURL == "" {
		t.Fatal("AYA_TEST_DATABASE_URL is not set: this test needs the isolated loopback PostgreSQL; refusing to skip")
	}
	return dbURL
}

// readOnlySession is dbURL for sessions whose every transaction is read-only, as the runtime role's would be without any
// DDL or write right: any DDL or write such a session tried would fail.
func readOnlySession(t *testing.T, dbURL string) string {
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

// ownedSchema is the name of a fresh schema this test owns.
func ownedSchema(t *testing.T) string {
	t.Helper()
	b := make([]byte, 6)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return "aya_t_" + hex.EncodeToString(b)
}

// fixturePool is a direct read-write pool on schema for the test's own reads, edits and cleanup, which drops that
// test-owned schema and nothing else.
func fixturePool(t *testing.T, dbURL, schema string) *pgxpool.Pool {
	t.Helper()
	cfg, err := store.ParseConfig(dbURL, schema)
	if err != nil {
		t.Fatalf("fixture database config: %v", err)
	}
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("fixture database pool: %v", err)
	}
	t.Cleanup(func() {
		defer pool.Close()
		if !strings.HasPrefix(schema, "aya_t_") {
			t.Error("refusing to drop a schema this test does not own")
			return
		}
		if _, err := pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+pgx.Identifier{schema}.Sanitize()+" CASCADE"); err != nil {
			t.Errorf("drop the test schema: %v", err)
		}
	})
	return pool
}

func schemaExists(t *testing.T, pool *pgxpool.Pool, schema string) bool {
	t.Helper()
	var ok bool
	if err := pool.QueryRow(context.Background(), "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1)", schema).Scan(&ok); err != nil {
		t.Fatalf("check the schema: %v", err)
	}
	return ok
}

// recordedVersions lists the schema's recorded migration versions in order.
func recordedVersions(t *testing.T, pool *pgxpool.Pool) []int {
	t.Helper()
	rows, err := pool.Query(context.Background(), "SELECT version FROM schema_migrations ORDER BY version")
	if err != nil {
		t.Fatalf("read the recorded migrations: %v", err)
	}
	versions, err := pgx.CollectRows(rows, pgx.RowTo[int])
	if err != nil {
		t.Fatalf("read the recorded migrations: %v", err)
	}
	return versions
}

func execute(t *testing.T, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("fixture statement: %v", err)
	}
}

// On a session that cannot write (the premise is checked first: such a session cannot even migrate), VerifySchema finds
// an absent schema not current and creates nothing; it finds the schema the owner migrated current; and it finds the
// schema not current again whenever the record is not exactly this binary's migrations: the newest one or an earlier one
// unrecorded, a newer version recorded, or no record at all. Each verification only reads, so none could have tried to
// repair the schema: a write on this session would have failed instead of reporting ErrSchemaNotCurrent.
func TestVerifySchemaAcceptsOnlyTheCurrentSchemaAndNeverWrites(t *testing.T) {
	ctx := context.Background()
	dbURL := testDatabaseURL(t)
	schema := ownedSchema(t)
	fixture := fixturePool(t, dbURL, schema)

	runtime, err := store.Open(ctx, readOnlySession(t, dbURL), schema)
	if err != nil {
		t.Fatalf("open a store on a read-only session: %v", err)
	}
	t.Cleanup(runtime.Close)
	if err := runtime.Migrate(ctx); err == nil {
		t.Fatal("a read-only session migrated the schema: the premise of this test does not hold")
	}
	if schemaExists(t, fixture, schema) {
		t.Fatal("a refused read-only migration created the schema")
	}

	if err := runtime.VerifySchema(ctx); !errors.Is(err, store.ErrSchemaNotCurrent) {
		t.Fatalf("VerifySchema on an absent schema = %s, want ErrSchemaNotCurrent", withheld(err))
	}
	if schemaExists(t, fixture, schema) {
		t.Fatal("verifying an absent schema created it")
	}

	owner, err := store.Open(ctx, dbURL, schema)
	if err != nil {
		t.Fatalf("open the owner's store: %v", err)
	}
	t.Cleanup(owner.Close)
	if err := owner.Migrate(ctx); err != nil {
		t.Fatalf("migrate as the owner: %v", err)
	}
	versions := recordedVersions(t, fixture)
	if len(versions) < 2 {
		t.Fatalf("the owner recorded %d migrations, want this binary's several", len(versions))
	}
	oldest, newest := versions[0], versions[len(versions)-1]
	if err := runtime.VerifySchema(ctx); err != nil {
		t.Fatalf("VerifySchema on the schema the owner migrated = %s, want nil", withheld(err))
	}

	for _, c := range []struct {
		name    string
		change  string
		undo    string
		version int
	}{
		{"the newest migration unrecorded", "DELETE FROM schema_migrations WHERE version = $1", "INSERT INTO schema_migrations (version) VALUES ($1)", newest},
		{"an earlier migration unrecorded", "DELETE FROM schema_migrations WHERE version = $1", "INSERT INTO schema_migrations (version) VALUES ($1)", oldest},
		{"a migration newer than this binary's recorded", "INSERT INTO schema_migrations (version) VALUES ($1)", "DELETE FROM schema_migrations WHERE version = $1", newest + 1},
	} {
		t.Run("not current: "+c.name, func(t *testing.T) {
			execute(t, fixture, c.change, c.version)
			t.Cleanup(func() {
				if _, err := fixture.Exec(context.Background(), c.undo, c.version); err != nil {
					t.Errorf("restore the migration record: %v", err)
				}
			})
			if err := runtime.VerifySchema(ctx); !errors.Is(err, store.ErrSchemaNotCurrent) {
				t.Fatalf("VerifySchema = %s, want ErrSchemaNotCurrent", withheld(err))
			}
		})
	}
	if err := runtime.VerifySchema(ctx); err != nil {
		t.Fatalf("VerifySchema once the record is restored = %s, want nil", withheld(err))
	}
	t.Run("not current: no migration record at all", func(t *testing.T) {
		execute(t, fixture, "DROP TABLE schema_migrations")
		if err := runtime.VerifySchema(ctx); !errors.Is(err, store.ErrSchemaNotCurrent) {
			t.Fatalf("VerifySchema without schema_migrations = %s, want ErrSchemaNotCurrent", withheld(err))
		}
	})
}
