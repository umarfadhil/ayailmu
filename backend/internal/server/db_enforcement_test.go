package server_test

// Core database enforcement at startup, in every deploy mode and in production staging: the API refuses to start, binding
// nothing, as an owner or administrator (the test cluster's superuser), as a role that can write the migration history, as one
// that lacks a right it needs, and over a database transport that is not verified TLS (or the explicit private-network
// exception, which production never takes). Each refusal is the store's fixed error and quotes no URL, role or password.
// The tests use the isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL), throwaway aya_t_ schemas and roles, and, for
// production staging, the same TLS stand-in for Auth as its other tests.

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/server"
	"ayailmu.local/backend/internal/store"
)

func TestDeploySmokeRefusesAnElevatedOrIncompleteDatabaseRole(t *testing.T) {
	dbURL := testDatabase(t)
	host := databaseHostOf(t, dbURL)
	ctx := context.Background()
	refused := func(t *testing.T, dsn, schema string, want error) {
		t.Helper()
		svc, err := server.New(ctx, lookupIn(deployEnvFor(config.ModeDeploySmoke, schema, "127.0.0.1:8091", privateFile(t, dsn), host)), server.Options{})
		if svc != nil {
			svc.Close()
			t.Fatalf("server.New started a service whose database role must be refused (want %v)", want)
		}
		if !errors.Is(err, want) {
			t.Fatalf("server.New error = %s, want %v", quiet(err, dbURL, dsn), want)
		}
		for _, leak := range []string{dsn, passwordOf(dsn), passwordOf(dbURL), "aya_t_rt_", "aya_gotest"} {
			if leak != "" && strings.Contains(err.Error(), leak) {
				t.Fatalf("the refusal quotes %q", leak)
			}
		}
	}
	admin := func(t *testing.T, stmts ...string) {
		t.Helper()
		conn, err := pgx.Connect(ctx, dbURL)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close(ctx)
		for _, s := range stmts {
			if _, err := conn.Exec(ctx, s); err != nil {
				t.Fatalf("fixture statement: %v", err)
			}
		}
	}
	roleOf := func(dsn string) string {
		u, _ := url.Parse(dsn)
		return u.User.Username()
	}

	t.Run("the test cluster's superuser, an owner and administrator", func(t *testing.T) {
		schema, _ := migratedSchema(t, dbURL)
		refused(t, dbURL, schema, store.ErrRuntimeRoleElevated)
	})
	t.Run("a role that owns the schema's tables", func(t *testing.T) {
		schema, _ := migratedSchema(t, dbURL)
		dsn := runtimeRoleURL(t, dbURL, schema)
		admin(t, "ALTER TABLE "+pgx.Identifier{schema, "events"}.Sanitize()+" OWNER TO "+roleOf(dsn))
		refused(t, dsn, schema, store.ErrRuntimeRoleElevated)
	})
	t.Run("a role that can create objects in the schema", func(t *testing.T) {
		schema, _ := migratedSchema(t, dbURL)
		dsn := runtimeRoleURL(t, dbURL, schema)
		admin(t, "GRANT CREATE ON SCHEMA "+pgx.Identifier{schema}.Sanitize()+" TO "+roleOf(dsn))
		refused(t, dsn, schema, store.ErrRuntimeRoleElevated)
	})
	t.Run("a role that can write the migration history", func(t *testing.T) {
		schema, _ := migratedSchema(t, dbURL)
		dsn := runtimeRoleURL(t, dbURL, schema)
		admin(t, "GRANT INSERT, DELETE ON "+pgx.Identifier{schema, "schema_migrations"}.Sanitize()+" TO "+roleOf(dsn))
		refused(t, dsn, schema, store.ErrMigrationMetadataWritable)
	})
	t.Run("a role that lacks a right the service needs", func(t *testing.T) {
		schema, _ := migratedSchema(t, dbURL)
		dsn := runtimeRoleURL(t, dbURL, schema)
		admin(t, "REVOKE DELETE ON "+pgx.Identifier{schema, "events"}.Sanitize()+" FROM "+roleOf(dsn))
		refused(t, dsn, schema, store.ErrRuntimeRightsMissing)
	})
}

func TestDeploySmokeTransportIsVerifiedTLSUnlessPrivateNetworkIsExplicit(t *testing.T) {
	dbURL := testDatabase(t)
	schema, _ := migratedSchema(t, dbURL)
	u, err := url.Parse(runtimeRoleURL(t, dbURL, schema))
	if err != nil || u.Port() == "" {
		t.Fatal("AYA_TEST_DATABASE_URL must be a postgres:// URL with a host and a port")
	}
	u.Host = "localhost:" + u.Port() // a name the resolver answers: the stand-in for a container's service name
	q := u.Query()
	q.Set("sslmode", "disable")
	u.RawQuery = q.Encode()
	named := u.String()
	env := func(edit func(map[string]string)) map[string]string {
		e := deployEnvFor(config.ModeDeploySmoke, schema, "127.0.0.1:8091", privateFile(t, named), "localhost")
		if edit != nil {
			edit(e)
		}
		return e
	}

	t.Run("plaintext to a named host is refused by default", func(t *testing.T) {
		svc, err := server.New(context.Background(), lookupIn(env(nil)), server.Options{})
		if svc != nil {
			svc.Close()
		}
		if !errors.Is(err, store.ErrDatabaseTransportInsecure) {
			t.Fatalf("server.New error = %s, want store.ErrDatabaseTransportInsecure", quiet(err, named, passwordOf(named)))
		}
		if strings.Contains(err.Error(), "localhost") || strings.Contains(err.Error(), passwordOf(named)) {
			t.Fatal("the refusal quotes the host or the password")
		}
	})
	t.Run("the explicit private-network exception starts the same configuration", func(t *testing.T) {
		svc, err := server.New(context.Background(), lookupIn(env(func(e map[string]string) { e[config.EnvDBTransport] = "private-network" })), server.Options{})
		if err != nil {
			t.Fatalf("server.New with private-network: %s", quiet(err, named, passwordOf(named)))
		}
		svc.Close()
	})
}
