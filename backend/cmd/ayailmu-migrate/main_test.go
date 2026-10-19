package main

// Migration job, Phase 8 RED. ayailmu-migrate applies the embedded migrations as the schema's owner and exits; once they
// are applied, running it again changes nothing. It prints only the resulting schema version on stdout. It reads the
// owner's database URL only from its private file (AYA_DATABASE_URL_FILE) and dials only AYA_DB_HOSTS. A refusal exits
// 1, names the setting on stderr, prints nothing on stdout, quotes no URL or password and creates nothing. The test uses
// the isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL) in fresh aya_t_ schemas that it drops; missing infrastructure
// fails it, nothing is skipped.

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/store"
)

func lookupIn(env map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := env[k]
		return v, ok
	}
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

// urlFile writes content to a new file of exactly mode in a test-owned directory and returns its absolute path.
func urlFile(t *testing.T, content string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "database-url")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
	return path
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

// dropOwned drops one aya_t_ schema this test owns, and nothing else.
func dropOwned(t *testing.T, pool *pgxpool.Pool, schema string) {
	t.Helper()
	if !strings.HasPrefix(schema, "aya_t_") {
		t.Error("refusing to drop a schema this test does not own")
		return
	}
	if _, err := pool.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+pgx.Identifier{schema}.Sanitize()+" CASCADE"); err != nil {
		t.Errorf("drop the test schema: %v", err)
	}
}

// fixturePool is a direct pool on schema for the test's own reads; its cleanup drops that test-owned schema.
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
		dropOwned(t, pool, schema)
		pool.Close()
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

// applied is one recorded migration.
type applied struct {
	version int
	at      time.Time
}

func appliedMigrations(t *testing.T, pool *pgxpool.Pool) []applied {
	t.Helper()
	rows, err := pool.Query(context.Background(), "SELECT version, applied_at FROM schema_migrations ORDER BY version")
	if err != nil {
		t.Fatalf("read the recorded migrations: %v", err)
	}
	defer rows.Close()
	var all []applied
	for rows.Next() {
		var a applied
		if err := rows.Scan(&a.version, &a.at); err != nil {
			t.Fatalf("read the recorded migrations: %v", err)
		}
		all = append(all, a)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read the recorded migrations: %v", err)
	}
	return all
}

func TestMigrateAppliesTheEmbeddedMigrationsOnceAndPrintsOnlyTheVersion(t *testing.T) {
	ctx := context.Background()
	dbURL := testDatabaseURL(t)
	u, err := url.Parse(dbURL)
	if err != nil || u.Hostname() == "" {
		t.Fatal("AYA_TEST_DATABASE_URL must be a postgres:// URL that names its host")
	}
	password, _ := u.User.Password()
	shown := func(s string) string {
		if strings.Contains(s, dbURL) || (password != "" && strings.Contains(s, password)) {
			return "(withheld: it quotes the database URL or its password)"
		}
		return s
	}
	envFor := func(t *testing.T, schema string) map[string]string {
		return map[string]string{
			config.EnvDatabaseURLFile: urlFile(t, dbURL+"\n", 0o600),
			config.EnvDBHosts:         u.Hostname(),
			config.EnvSchema:          schema,
		}
	}

	t.Run("the embedded migrations are applied once, printing only the version", func(t *testing.T) {
		schema := ownedSchema(t)
		pool := fixturePool(t, dbURL, schema)
		env := envFor(t, schema)
		var out, errOut bytes.Buffer
		if code := run(ctx, lookupIn(env), &out, &errOut); code != 0 {
			t.Fatalf("the first run exited %d, want 0 (stderr %q)", code, shown(errOut.String()))
		}
		first := appliedMigrations(t, pool)
		if len(first) == 0 {
			t.Fatal("the first run recorded no migration")
		}
		for i, m := range first {
			if m.version != i+1 {
				t.Fatalf("the recorded migrations are not 1 to %d in order", len(first))
			}
		}
		newest := first[len(first)-1].version
		if got := out.String(); got != strconv.Itoa(newest)+"\n" {
			t.Fatalf("stdout = %q, want only the resulting version %d", shown(got), newest)
		}
		if printed := out.String() + errOut.String(); shown(printed) != printed {
			t.Fatal("the job printed the database URL or its password")
		}

		out.Reset()
		errOut.Reset()
		if code := run(ctx, lookupIn(env), &out, &errOut); code != 0 {
			t.Fatalf("the second run exited %d, want 0 (stderr %q)", code, shown(errOut.String()))
		}
		if got := out.String(); got != strconv.Itoa(newest)+"\n" {
			t.Fatalf("the second run printed %q, want the same version %d", shown(got), newest)
		}
		again := appliedMigrations(t, pool)
		if len(again) != len(first) {
			t.Fatalf("the second run left %d recorded migrations, the first %d: running the job again must change nothing", len(again), len(first))
		}
		for i := range first {
			if again[i].version != first[i].version || !again[i].at.Equal(first[i].at) {
				t.Fatal("the second run applied a migration again: running the job again must change nothing")
			}
		}
	})

	t.Run("refusals exit 1, name the setting, print nothing else and create nothing", func(t *testing.T) {
		pool := fixturePool(t, dbURL, ownedSchema(t))
		for _, c := range []struct {
			name  string
			edit  func(*testing.T, map[string]string)
			names string
		}{
			{"the database URL in the environment", func(_ *testing.T, env map[string]string) { env[config.EnvDatabaseURL] = dbURL }, config.EnvDatabaseURL},
			{"the database URL in the environment, empty", func(_ *testing.T, env map[string]string) { env[config.EnvDatabaseURL] = "" }, config.EnvDatabaseURL},
			{"the database URL file missing", func(_ *testing.T, env map[string]string) { delete(env, config.EnvDatabaseURLFile) }, config.EnvDatabaseURLFile},
			{"a database URL file readable by everyone", func(t *testing.T, env map[string]string) { env[config.EnvDatabaseURLFile] = urlFile(t, dbURL, 0o644) }, config.EnvDatabaseURLFile},
			{"a database host outside AYA_DB_HOSTS", func(_ *testing.T, env map[string]string) { env[config.EnvDBHosts] = "db" }, config.EnvDatabaseURLFile},
			{"an emulator variable, even empty", func(_ *testing.T, env map[string]string) { env[config.EnvEmulatorHost] = "" }, config.EnvEmulatorHost},
			{"Google credentials, even empty", func(_ *testing.T, env map[string]string) { env[config.EnvGoogleCreds] = "" }, config.EnvGoogleCreds},
		} {
			t.Run(c.name, func(t *testing.T) {
				schema := ownedSchema(t)
				env := envFor(t, schema)
				c.edit(t, env)
				var out, errOut bytes.Buffer
				code := run(ctx, lookupIn(env), &out, &errOut)
				if schemaExists(t, pool, schema) {
					dropOwned(t, pool, schema)
					t.Error("a refused run created its schema")
				}
				switch {
				case code != 1:
					t.Fatalf("a refused run exited %d, want 1", code)
				case out.Len() != 0:
					t.Fatalf("a refused run printed %q on stdout", shown(out.String()))
				case !strings.Contains(errOut.String(), c.names):
					t.Fatalf("stderr %q does not name %s", shown(errOut.String()), c.names)
				case shown(errOut.String()) != errOut.String():
					t.Fatal("the refusal quotes the database URL or its password")
				}
			})
		}
	})
}
