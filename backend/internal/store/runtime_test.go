package store_test

// Runtime privileges. A deploy-mode API must not run as an owner, an administrator or any role that can reshape the database:
// VerifyRuntimePrivileges reads the connection's own effective rights, which include everything inherited, and refuses
//
//   - superuser, role or database creation, replication and row-security bypass, a different session and current role, and
//     membership in any other role (inherited or settable elevation, the predefined pg_* roles included);
//   - ownership of the schema or of anything in it, and the right to create objects in the schema, in public or in the database;
//   - TRUNCATE, TRIGGER and REFERENCES on the app tables, and WITH GRANT OPTION on any of them;
//   - any right to write the migration history (schema_migrations): only the migration job does.
//
// It also refuses a role that lacks what the service really does. The exact rights are the ones the real source uses, which
// TestExactRuntimeRightsSufficeForEveryStoreOperation proves by running every operation as a role holding exactly them:
//
//	accounts           SELECT INSERT UPDATE   (UPDATE only because SELECT ... FOR UPDATE, the erasure's row lock, needs it)
//	account_deletions  SELECT INSERT UPDATE
//	profiles           SELECT INSERT UPDATE DELETE
//	profile_sources    SELECT INSERT DELETE
//	events             SELECT INSERT DELETE
//	imports            SELECT INSERT DELETE
//	schema_migrations  SELECT
//
// plus USAGE on the schema. The adult app deletes accounts' data, so DELETE is required where the source deletes, unlike
// the guardian/child backend's rule. Extra DML on the app tables is not refused (the compose stack grants all four on every
// table); the migration history's protection is separate and absolute. Every refusal is a fixed error naming no role,
// schema or table. The tests use the isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL) with throwaway aya_t_ roles and
// schemas that they drop; missing infrastructure fails them, nothing is skipped.

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/store"
)

// exactRights is what the real source needs, table by table (see above).
var exactRights = []struct{ table, privileges string }{
	{"accounts", "SELECT, INSERT, UPDATE"},
	{"account_deletions", "SELECT, INSERT, UPDATE"},
	{"profiles", "SELECT, INSERT, UPDATE, DELETE"},
	{"profile_sources", "SELECT, INSERT, DELETE"},
	{"events", "SELECT, INSERT, DELETE"},
	{"imports", "SELECT, INSERT, DELETE"},
	{"schema_migrations", "SELECT"},
}

// privDB is a schema migrated by a throwaway non-super migration role, with a throwaway runtime role that holds nothing yet.
type privDB struct {
	t       *testing.T
	admin   *pgxpool.Pool // the test cluster's superuser, for roles, grants and reads
	dbURL   string
	dbName  string
	schema  string
	mig     string
	rt      string
	rtPass  string
	migPass string
}

func randHex(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	return hex.EncodeToString(b)
}

func newPrivDB(t *testing.T) *privDB { return newPrivDBPrepared(t, nil) }

// newPrivDBPrepared is newPrivDB with prepare run, as the cluster's superuser, after the roles exist and before the first
// migration: the way a deployment's bootstrap creates the schema and its default privileges.
func newPrivDBPrepared(t *testing.T, prepare func(p *privDB)) *privDB {
	t.Helper()
	ctx := context.Background()
	dbURL := testDatabaseURL(t)
	schema := ownedSchema(t)
	p := &privDB{t: t, dbURL: dbURL, schema: schema}
	p.admin = fixturePool(t, dbURL, schema) // its cleanup drops the schema last
	suffix := randHex(t, 5)
	p.mig, p.rt = "aya_t_mig_"+suffix, "aya_t_rt_"+suffix
	p.migPass, p.rtPass = randHex(t, 16), randHex(t, 16)
	if err := p.admin.QueryRow(ctx, "SELECT current_database()").Scan(&p.dbName); err != nil {
		t.Fatal(err)
	}
	p.exec(`CREATE ROLE ` + p.mig + ` LOGIN PASSWORD '` + p.migPass + `'`)
	p.exec(`CREATE ROLE ` + p.rt + ` LOGIN PASSWORD '` + p.rtPass + `'`)
	t.Cleanup(func() {
		for _, r := range []string{p.rt, p.mig} {
			for _, stmt := range []string{"DROP OWNED BY " + r + " CASCADE", "DROP ROLE IF EXISTS " + r} {
				if _, err := p.admin.Exec(context.Background(), stmt); err != nil {
					t.Errorf("clean up role: %v", err)
				}
			}
		}
	})
	p.exec(`GRANT CREATE ON DATABASE ` + pgx.Identifier{p.dbName}.Sanitize() + ` TO ` + p.mig)
	if prepare != nil {
		prepare(p)
	}
	owner, err := store.Open(ctx, p.urlFor(p.mig, p.migPass), schema)
	if err != nil {
		t.Fatalf("open as the migration role: %s", withheld(err))
	}
	defer owner.Close()
	if err := owner.Migrate(ctx); err != nil {
		t.Fatalf("migrate as the migration role: %s", withheld(err))
	}
	return p
}

func (p *privDB) exec(sql string, args ...any) {
	p.t.Helper()
	if _, err := p.admin.Exec(context.Background(), sql, args...); err != nil {
		p.t.Fatalf("fixture statement: %v", err)
	}
}

func (p *privDB) urlFor(role, pass string) string {
	u, err := url.Parse(p.dbURL)
	if err != nil {
		p.t.Fatal(err)
	}
	u.User = url.UserPassword(role, pass)
	return u.String()
}

// tbl is the schema-qualified table.
func (p *privDB) tbl(name string) string { return pgx.Identifier{p.schema, name}.Sanitize() }

// grantExact gives the runtime role exactly the real source's rights.
func (p *privDB) grantExact() {
	p.t.Helper()
	p.exec(`GRANT USAGE ON SCHEMA ` + pgx.Identifier{p.schema}.Sanitize() + ` TO ` + p.rt)
	for _, r := range exactRights {
		p.exec(`GRANT ` + r.privileges + ` ON ` + p.tbl(r.table) + ` TO ` + p.rt)
	}
}

// open opens a store as the runtime role, extra being appended to the URL's query.
func (p *privDB) open(extra url.Values) *store.Store {
	p.t.Helper()
	u, _ := url.Parse(p.urlFor(p.rt, p.rtPass))
	q := u.Query()
	for k, v := range extra {
		q[k] = v
	}
	u.RawQuery = q.Encode()
	st, err := store.Open(context.Background(), u.String(), p.schema)
	if err != nil {
		p.t.Fatalf("open as the runtime role: %s", withheld(err))
	}
	p.t.Cleanup(st.Close)
	return st
}

func (p *privDB) verify(extra url.Values) error {
	p.t.Helper()
	return p.open(extra).VerifyRuntimePrivileges(context.Background())
}

func wantRuntimeError(t *testing.T, err, want error, p *privDB) {
	t.Helper()
	if !errors.Is(err, want) {
		t.Fatalf("VerifyRuntimePrivileges = %s, want %v", withheld(err), want)
	}
	for _, leak := range []string{p.rt, p.mig, p.schema, p.dbName, p.rtPass, "schema_migrations", "accounts"} {
		if strings.Contains(err.Error(), leak) {
			t.Fatalf("the refusal quotes %q: %s", leak, err)
		}
	}
}

func TestVerifyRuntimePrivilegesAcceptsExactlyTheRealRights(t *testing.T) {
	p := newPrivDB(t)
	p.grantExact()
	if err := p.verify(nil); err != nil {
		t.Fatalf("a role with exactly the real rights was refused: %s", withheld(err))
	}
	t.Run("extra DML on the app tables, as the compose stack grants, is accepted", func(t *testing.T) {
		for _, tbl := range []string{"accounts", "account_deletions", "profiles", "profile_sources", "events", "imports"} {
			p.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ` + p.tbl(tbl) + ` TO ` + p.rt)
		}
		if err := p.verify(nil); err != nil {
			t.Fatalf("full DML on the app tables was refused: %s", withheld(err))
		}
	})
}

func TestVerifyRuntimePrivilegesRefusesElevation(t *testing.T) {
	for _, c := range []struct {
		name string
		do   func(p *privDB)
	}{
		{"a superuser", func(p *privDB) { p.exec(`ALTER ROLE ` + p.rt + ` SUPERUSER`) }},
		{"CREATEROLE", func(p *privDB) { p.exec(`ALTER ROLE ` + p.rt + ` CREATEROLE`) }},
		{"CREATEDB", func(p *privDB) { p.exec(`ALTER ROLE ` + p.rt + ` CREATEDB`) }},
		{"REPLICATION", func(p *privDB) { p.exec(`ALTER ROLE ` + p.rt + ` REPLICATION`) }},
		{"BYPASSRLS", func(p *privDB) { p.exec(`ALTER ROLE ` + p.rt + ` BYPASSRLS`) }},
		{"membership in a plain role", func(p *privDB) {
			p.exec(`CREATE ROLE ` + p.rt + `_grp NOLOGIN`)
			p.t.Cleanup(func() { p.exec(`DROP ROLE IF EXISTS ` + p.rt + `_grp`) })
			p.exec(`GRANT ` + p.rt + `_grp TO ` + p.rt)
		}},
		{"membership without inheritance (SET only)", func(p *privDB) {
			p.exec(`CREATE ROLE ` + p.rt + `_grp NOLOGIN`)
			p.t.Cleanup(func() { p.exec(`DROP ROLE IF EXISTS ` + p.rt + `_grp`) })
			p.exec(`GRANT ` + p.rt + `_grp TO ` + p.rt + ` WITH INHERIT FALSE, SET TRUE`)
		}},
		{"membership in a predefined role", func(p *privDB) { p.exec(`GRANT pg_read_all_data TO ` + p.rt) }},
		{"membership in the migration role, inheriting its ownership", func(p *privDB) { p.exec(`GRANT ` + p.mig + ` TO ` + p.rt) }},
		{"ownership of the schema", func(p *privDB) { p.exec(`ALTER SCHEMA ` + pgx.Identifier{p.schema}.Sanitize() + ` OWNER TO ` + p.rt) }},
		{"ownership of a table", func(p *privDB) { p.exec(`ALTER TABLE ` + p.tbl("events") + ` OWNER TO ` + p.rt) }},
		{"CREATE in the schema", func(p *privDB) {
			p.exec(`GRANT CREATE ON SCHEMA ` + pgx.Identifier{p.schema}.Sanitize() + ` TO ` + p.rt)
		}},
		{"CREATE in public", func(p *privDB) { p.exec(`GRANT CREATE ON SCHEMA public TO ` + p.rt) }},
		{"CREATE in the database", func(p *privDB) {
			p.exec(`GRANT CREATE ON DATABASE ` + pgx.Identifier{p.dbName}.Sanitize() + ` TO ` + p.rt)
		}},
		{"TRUNCATE on an app table", func(p *privDB) { p.exec(`GRANT TRUNCATE ON ` + p.tbl("events") + ` TO ` + p.rt) }},
		{"TRIGGER on an app table", func(p *privDB) { p.exec(`GRANT TRIGGER ON ` + p.tbl("profiles") + ` TO ` + p.rt) }},
		{"REFERENCES on an app table", func(p *privDB) { p.exec(`GRANT REFERENCES ON ` + p.tbl("accounts") + ` TO ` + p.rt) }},
		{"a column-level REFERENCES on an app table", func(p *privDB) { p.exec(`GRANT REFERENCES (issuer) ON ` + p.tbl("accounts") + ` TO ` + p.rt) }},
		{"WITH GRANT OPTION on an app table", func(p *privDB) {
			p.exec(`GRANT SELECT ON ` + p.tbl("events") + ` TO ` + p.rt + ` WITH GRANT OPTION`)
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			p := newPrivDB(t)
			p.grantExact()
			c.do(p)
			wantRuntimeError(t, p.verify(nil), store.ErrRuntimeRoleElevated, p)
		})
	}

	t.Run("a session that logged in as another role and adopted the runtime role", func(t *testing.T) {
		p := newPrivDB(t)
		p.grantExact()
		// Log in as the test cluster's superuser and make the runtime role the connection's current role: RESET ROLE would
		// restore the superuser, so the effective rights of the current role alone prove nothing.
		u, _ := url.Parse(p.dbURL)
		q := u.Query()
		q.Set("role", p.rt)
		u.RawQuery = q.Encode()
		st, err := store.Open(context.Background(), u.String(), p.schema)
		if err != nil {
			t.Fatalf("open: %s", withheld(err))
		}
		defer st.Close()
		wantRuntimeError(t, st.VerifyRuntimePrivileges(context.Background()), store.ErrRuntimeRoleElevated, p)
	})
}

func TestVerifyRuntimePrivilegesRefusesAnyRightToWriteTheMigrationHistory(t *testing.T) {
	for _, c := range []struct{ name, grant string }{
		{"INSERT", "GRANT INSERT ON %s TO %s"},
		{"UPDATE", "GRANT UPDATE ON %s TO %s"},
		{"DELETE", "GRANT DELETE ON %s TO %s"},
		{"TRUNCATE", "GRANT TRUNCATE ON %s TO %s"},
		{"a column-level INSERT", "GRANT INSERT (version) ON %s TO %s"},
		{"a column-level UPDATE", "GRANT UPDATE (applied_at) ON %s TO %s"},
		{"ALL PRIVILEGES", "GRANT ALL ON %s TO %s"},
	} {
		t.Run(c.name, func(t *testing.T) {
			p := newPrivDB(t)
			p.grantExact()
			p.exec(fmt.Sprintf(c.grant, p.tbl("schema_migrations"), p.rt))
			err := p.verify(nil)
			if c.name == "TRUNCATE" || c.name == "ALL PRIVILEGES" {
				// TRUNCATE (and ALL, which includes it and TRIGGER and REFERENCES) is also an elevation: either refusal is right.
				if !errors.Is(err, store.ErrMigrationMetadataWritable) && !errors.Is(err, store.ErrRuntimeRoleElevated) {
					t.Fatalf("VerifyRuntimePrivileges = %s, want a refusal", withheld(err))
				}
				return
			}
			wantRuntimeError(t, err, store.ErrMigrationMetadataWritable, p)
		})
	}
}

func TestVerifyRuntimePrivilegesRefusesAMissingRealRight(t *testing.T) {
	p := newPrivDB(t)
	p.grantExact()
	if err := p.verify(nil); err != nil {
		t.Fatalf("the exact rights were refused: %s", withheld(err))
	}
	for _, r := range exactRights {
		for _, priv := range strings.Split(r.privileges, ", ") {
			t.Run(r.table+" lacks "+priv, func(t *testing.T) {
				p.exec(`REVOKE ` + priv + ` ON ` + p.tbl(r.table) + ` FROM ` + p.rt)
				t.Cleanup(func() { p.exec(`GRANT ` + priv + ` ON ` + p.tbl(r.table) + ` TO ` + p.rt) })
				wantRuntimeError(t, p.verify(nil), store.ErrRuntimeRightsMissing, p)
			})
		}
	}
	t.Run("no USAGE on the schema", func(t *testing.T) {
		p.exec(`REVOKE USAGE ON SCHEMA ` + pgx.Identifier{p.schema}.Sanitize() + ` FROM ` + p.rt)
		t.Cleanup(func() { p.exec(`GRANT USAGE ON SCHEMA ` + pgx.Identifier{p.schema}.Sanitize() + ` TO ` + p.rt) })
		wantRuntimeError(t, p.verify(nil), store.ErrRuntimeRightsMissing, p)
	})
	t.Run("restored rights are accepted again", func(t *testing.T) {
		if err := p.verify(nil); err != nil {
			t.Fatalf("after restoring every right: %s", withheld(err))
		}
	})
}

// The matrix is not a guess: this runs every operation of the store as a role that holds exactly it. The two rights a reader
// would least expect are shown necessary.
func TestExactRuntimeRightsSufficeForEveryStoreOperation(t *testing.T) {
	ctx := context.Background()
	p := newPrivDB(t)
	p.grantExact()
	st := p.open(nil)
	if err := st.VerifySchema(ctx); err != nil {
		t.Fatalf("VerifySchema: %s", withheld(err))
	}
	if err := st.VerifyRuntimePrivileges(ctx); err != nil {
		t.Fatalf("VerifyRuntimePrivileges: %s", withheld(err))
	}
	const issuer = "https://auth.ayailmu-local.test/auth/v1"
	anchor := store.LedgerAnchor{AuthMode: "local-supabase", Issuer: issuer}
	step := func(name string, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s as the exact-rights role: %s (%s)", name, withheld(err), store.ErrorClass(err))
		}
	}
	event := func(id string, n int) store.PendingEvent {
		return store.PendingEvent{Event: envelope.Event{
			EventID: id, Kind: "answer", Schema: "expo.answer_record", SchemaVersion: 1,
			Curriculum: envelope.Curriculum{Family: "expo-trial-arabic", Track: "arab", ContentVersion: "demo-synthetic-0.3", RulesVersion: "r1"},
			Source:     envelope.Source{App: "expo", InstallID: "inst-1", AppVersion: "1.0.0", LocalProfileID: "lrn-1"},
			Payload:    []byte(`{}`), SemanticSHA256: [32]byte{byte(n)}, CurriculumStatus: "registered",
			Facts: envelope.Facts{OccurredAt: time.Date(2026, 10, 15, 8, 0, n, 0, time.UTC), LocalDate: "2026-10-15"},
		}}
	}

	acct, err := st.EnsureAccount(ctx, "local-supabase", issuer, newTestUUID(t))
	step("EnsureAccount", err)
	lang, minutes := "id", 20
	imp, err := st.Import(ctx, store.ImportInput{
		AccountID: acct.ID, ImportID: "imp-1", RequestSHA256: [32]byte{7},
		Source:     store.Source{App: "expo", InstallID: "inst-1", LocalProfileID: "lrn-1"},
		NewProfile: &store.NewProfile{Settings: store.Settings{InstructionLang: &lang, SessionMinutes: &minutes}, ConsentVersion: "trial-consent-1", ConsentAt: time.Date(2026, 10, 15, 8, 0, 0, 0, time.UTC)},
		Events:     []store.PendingEvent{event("ev-1", 1)},
	})
	step("Import", err)
	profileID := imp.Receipt.ProfileID
	_, err = st.Ingest(ctx, store.IngestInput{AccountID: acct.ID, ProfileID: profileID, Events: []store.PendingEvent{event("ev-2", 2)}})
	step("Ingest", err)
	_, _, err = st.LookupImport(ctx, acct.ID, "imp-1", [32]byte{7})
	step("LookupImport", err)
	_, err = st.AccountProfiles(ctx, acct.ID)
	step("AccountProfiles", err)
	_, err = st.Profile(ctx, acct.ID, profileID)
	step("Profile", err)
	_, err = st.UpdateSettings(ctx, acct.ID, profileID, 1, store.Settings{SessionMinutes: &minutes})
	step("UpdateSettings", err)
	_, err = st.Pull(ctx, acct.ID, profileID, 0, 10, "")
	step("Pull", err)
	step("ExportAccount", st.ExportAccount(ctx, acct.ID, func(*store.Export) error { return nil }))
	_, err = st.ExportDeletionLedger(ctx, anchor)
	step("ExportDeletionLedger (before any deletion)", err)

	// Replay creates the anchor of an account this database never saw, and its tombstone: INSERT on accounts and
	// account_deletions, and the erasure's DELETEs and FOR UPDATE locks.
	t.Run("minimality: the erasure needs UPDATE on accounts (its row lock) and DELETE on profiles", func(t *testing.T) {
		for _, c := range []struct{ table, priv string }{{"accounts", "UPDATE"}, {"profiles", "DELETE"}} {
			p.exec(`REVOKE ` + c.priv + ` ON ` + p.tbl(c.table) + ` FROM ` + p.rt)
			_, err := st.EraseAccount(ctx, acct.ID, nil)
			p.exec(`GRANT ` + c.priv + ` ON ` + p.tbl(c.table) + ` TO ` + p.rt)
			if err == nil || store.ErrorClass(err) != "sqlstate 42501" {
				t.Fatalf("EraseAccount without %s on %s: %v (%s), want permission denied", c.priv, c.table, err != nil, store.ErrorClass(err))
			}
		}
	})

	del, err := st.EraseAccount(ctx, acct.ID, nil)
	step("EraseAccount", err)
	if del.Events != 2 {
		t.Fatalf("EraseAccount erased %d events, want 2", del.Events)
	}
	_, err = st.RecordIdentityAttempt(ctx, acct.ID, false)
	step("RecordIdentityAttempt", err)
	_, found, err := st.AccountDeletion(ctx, acct.ID)
	step("AccountDeletion", err)
	if !found {
		t.Fatal("the erased account has no recorded deletion")
	}
	ledger, err := st.ExportDeletionLedger(ctx, anchor)
	step("ExportDeletionLedger", err)
	if len(ledger.Entries) != 1 {
		t.Fatalf("the ledger has %d entries, want 1", len(ledger.Entries))
	}
	entry := ledger.Entries[0]
	entry.AccountID, entry.DeletionID, entry.Subject = newTestUUID(t), newTestUUID(t), newTestUUID(t)
	ledger.Entries = []store.LedgerEntry{entry}
	_, err = st.ReplayDeletionLedger(ctx, anchor, ledger)
	step("ReplayDeletionLedger", err)
	_, err = st.ReplayDeletionLedger(ctx, anchor, ledger)
	step("ReplayDeletionLedger (again)", err)
}

// newTestUUID is a fresh canonical version 4 UUID.
func newTestUUID(t *testing.T) string {
	t.Helper()
	h := randHex(t, 16)
	return h[:8] + "-" + h[8:12] + "-4" + h[13:16] + "-a" + h[17:20] + "-" + h[20:]
}

// A deployment's bootstrap gives the runtime role DML on every table the migration role will create (the compose stack does
// exactly that through default privileges), and PUBLIC may hold more. Migrate then takes every write right on its own history
// table from everyone but its owner, and only on that table: the other tables keep their grants, SELECT stays, and running it
// again changes nothing. Without this the history would be writable by the very role the API runs as.
func TestMigrateTakesWriteRightsOnTheMigrationHistoryAwayFromEveryoneButItsOwner(t *testing.T) {
	ctx := context.Background()
	p := newPrivDBPrepared(t, func(p *privDB) {
		schema := pgx.Identifier{p.schema}.Sanitize()
		p.exec(`CREATE SCHEMA ` + schema + ` AUTHORIZATION ` + p.mig)
		p.exec(`GRANT USAGE ON SCHEMA ` + schema + ` TO ` + p.rt)
		p.exec(`ALTER DEFAULT PRIVILEGES FOR ROLE ` + p.mig + ` IN SCHEMA ` + schema + ` GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ` + p.rt)
		p.exec(`ALTER DEFAULT PRIVILEGES FOR ROLE ` + p.mig + ` IN SCHEMA ` + schema + ` GRANT SELECT, INSERT ON TABLES TO PUBLIC`)
	})
	can := func(role, table, priv string) bool {
		t.Helper()
		var ok bool
		if err := p.admin.QueryRow(ctx, `SELECT has_table_privilege($1, $2, $3)`, role, p.schema+"."+table, priv).Scan(&ok); err != nil {
			t.Fatal(err)
		}
		return ok
	}
	check := func(when string) {
		t.Helper()
		for _, role := range []string{p.rt, "public"} {
			for _, priv := range []string{"INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"} {
				if can(role, "schema_migrations", priv) {
					t.Fatalf("%s: %s can still %s the migration history", when, role, priv)
				}
			}
		}
		if !can(p.rt, "schema_migrations", "SELECT") {
			t.Fatalf("%s: the runtime role lost SELECT on the migration history", when)
		}
		if !can(p.mig, "schema_migrations", "INSERT") {
			t.Fatalf("%s: the migration role lost its own rights", when)
		}
		for _, priv := range []string{"SELECT", "INSERT", "UPDATE", "DELETE"} {
			if !can(p.rt, "accounts", priv) {
				t.Fatalf("%s: the runtime role lost %s on an app table", when, priv)
			}
		}
	}
	check("after the first migration")

	// A grant made later (for instance by a template that grants on ALL TABLES) is taken away by the next run.
	p.exec(`GRANT INSERT, UPDATE, DELETE ON ` + p.tbl("schema_migrations") + ` TO ` + p.rt)
	p.exec(`GRANT INSERT ON ` + p.tbl("schema_migrations") + ` TO PUBLIC`) // a superuser's grant is recorded as the owner's
	owner, err := store.Open(ctx, p.urlFor(p.mig, p.migPass), p.schema)
	if err != nil {
		t.Fatal(withheld(err))
	}
	defer owner.Close()
	for i := 0; i < 2; i++ {
		if err := owner.Migrate(ctx); err != nil {
			t.Fatalf("Migrate again: %s", withheld(err))
		}
		check(fmt.Sprintf("after migration run %d", i+2))
	}
	if err := p.verify(nil); err != nil {
		t.Fatalf("a role with DML on every app table and a read-only history was refused: %s", withheld(err))
	}
}
