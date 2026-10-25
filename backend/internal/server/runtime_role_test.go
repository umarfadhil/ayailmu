package server_test

// The deploy modes and production start only as a plain runtime role (store.VerifyRuntimePrivileges), so their tests run as
// one: a throwaway LOGIN role holding exactly the rights the service's source uses (the proof that they suffice is
// TestExactRuntimeRightsSufficeForEveryStoreOperation in package store, which this list repeats), nothing else, dropped when
// the test ends. The test cluster's own user is a superuser and the migration role's tables are its own: starting a deploy-mode
// service as either of them is refused, which TestDeployModesRefuseAnElevatedDatabaseRole shows.

import (
	"context"
	"net/url"
	"testing"

	"github.com/jackc/pgx/v5"
)

// runtimeRights is the real source's exact need, table by table. It is the list in internal/store/runtime.go.
var runtimeRights = []struct{ table, privileges string }{
	{"accounts", "SELECT, INSERT, UPDATE"},
	{"account_deletions", "SELECT, INSERT, UPDATE"},
	{"profiles", "SELECT, INSERT, UPDATE, DELETE"},
	{"profile_sources", "SELECT, INSERT, DELETE"},
	{"events", "SELECT, INSERT, DELETE"},
	{"imports", "SELECT, INSERT, DELETE"},
	{"schema_migrations", "SELECT"},
}

// runtimeRoleURL is dbURL with a new throwaway runtime role's credentials. When schema exists and is migrated the role holds
// exactly runtimeRights on it; otherwise it holds nothing (an absent or unmigrated schema refuses startup first). The role,
// and with it every grant, is dropped when the test ends.
func runtimeRoleURL(t *testing.T, dbURL, schema string) string {
	t.Helper()
	ctx := context.Background()
	role, password := "aya_t_rt_"+randomHex(t, 5), randomHex(t, 16)
	admin := func(stmts ...string) {
		t.Helper()
		conn, err := pgx.Connect(ctx, dbURL)
		if err != nil {
			t.Fatalf("connect as the test cluster's administrator: %v", err)
		}
		defer conn.Close(ctx)
		for _, s := range stmts {
			if _, err := conn.Exec(ctx, s); err != nil {
				t.Fatalf("fixture statement: %v", err)
			}
		}
	}
	admin("CREATE ROLE " + role + " LOGIN PASSWORD '" + password + "'")
	t.Cleanup(func() {
		conn, err := pgx.Connect(ctx, dbURL)
		if err != nil {
			t.Errorf("connect to drop the runtime role: %v", err)
			return
		}
		defer conn.Close(ctx)
		for _, s := range []string{"DROP OWNED BY " + role + " CASCADE", "DROP ROLE IF EXISTS " + role} {
			if _, err := conn.Exec(ctx, s); err != nil {
				t.Errorf("drop the runtime role: %v", err)
			}
		}
	})
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		t.Fatalf("connect as the test cluster's administrator: %v", err)
	}
	var migrated bool
	err = conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = $1 AND c.relname = 'schema_migrations')`, schema).Scan(&migrated)
	conn.Close(ctx)
	if err != nil {
		t.Fatalf("look for the migrated schema: %v", err)
	}
	if migrated {
		stmts := []string{"GRANT USAGE ON SCHEMA " + pgx.Identifier{schema}.Sanitize() + " TO " + role}
		for _, r := range runtimeRights {
			stmts = append(stmts, "GRANT "+r.privileges+" ON "+pgx.Identifier{schema, r.table}.Sanitize()+" TO "+role)
		}
		admin(stmts...)
	}
	u, err := url.Parse(dbURL)
	if err != nil {
		t.Fatal(err)
	}
	u.User = url.UserPassword(role, password)
	return u.String()
}
