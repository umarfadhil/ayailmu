package store_test

// Deletion ledger, Phase 9 RED. A ledger exports every recorded deletion with its account's anchor (account ID, auth
// mode, trusted issuer, provider subject and creation time) and its record (deletion ID, erasure time and counts, and
// the identity step's attempts, confirmation and last failure), reading only. Replaying a newer, independently kept
// ledger into a restore of an older snapshot keeps or recreates each account's exact anchor and tombstone and erases its
// resurrected data again, even when the snapshot already records the deletion (EraseAccount returns early then), taking
// the locks in EraseAccount's order. It refuses an invalid ledger or one that contradicts the database whole, before
// writing anything, never touches a bystander (another account of the same issuer, or one of another issuer with the
// same subject), and is idempotent and monotonic: replaying an older ledger never regresses a record. The tests use the
// isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL) in fresh aya_t_ schemas that they drop (deploy_test.go's
// helpers); missing infrastructure fails them, nothing is skipped. No connection string or password is printed.

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"ayailmu.local/backend/internal/store"
)

const (
	// ledgerMode and ledgerIssuer are the trusted provider: the local synthetic Supabase Auth's auth mode and its fixed
	// synthetic issuer.
	ledgerMode   = "local-supabase"
	ledgerIssuer = "https://auth.ayailmu-local.test/auth/v1"
	// foreignIssuer is another provider's issuer, whose accounts a ledger of the trusted one never touches.
	foreignIssuer = "https://securetoken.google.com/demo-ayailmu"
)

var (
	trustedAnchor = store.LedgerAnchor{AuthMode: ledgerMode, Issuer: ledgerIssuer}
	// ledgerBase is the synthetic time every fixture time derives from, in whole microseconds as PostgreSQL keeps them.
	ledgerBase = time.Date(2026, 10, 15, 8, 0, 0, 0, time.UTC)
	// ledgerTables are the app tables, the scope of every digest.
	ledgerTables = []string{"accounts", "account_deletions", "profiles", "profile_sources", "events", "imports"}
)

// newUUID is a fresh synthetic canonical UUID: lowercase, version 4.
func newUUID(t *testing.T) string {
	t.Helper()
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		t.Fatal(err)
	}
	h := hex.EncodeToString(b)
	return h[:8] + "-" + h[8:12] + "-4" + h[13:16] + "-a" + h[17:20] + "-" + h[20:]
}

// at is ledgerBase plus d.
func at(d time.Duration) time.Time { return ledgerBase.Add(d) }

// stamp is a pointer to at(d), for the record's optional times.
func stamp(d time.Duration) *time.Time {
	v := at(d)
	return &v
}

// ledgerDB is a migrated fresh schema: the store under test and a direct pool for the test's own rows and reads.
type ledgerDB struct {
	st     *store.Store
	pool   *pgxpool.Pool
	schema string
}

func openLedgerDB(t *testing.T) *ledgerDB {
	t.Helper()
	ctx := context.Background()
	dbURL := testDatabaseURL(t)
	schema := ownedSchema(t)
	pool := fixturePool(t, dbURL, schema) // its cleanup, registered first, drops the schema last
	st, err := store.Open(ctx, dbURL, schema)
	if err != nil {
		t.Fatalf("open the store: %s", withheld(err))
	}
	t.Cleanup(st.Close)
	if err := st.Migrate(ctx); err != nil {
		t.Fatalf("migrate the test schema: %s", withheld(err))
	}
	return &ledgerDB{st: st, pool: pool, schema: schema}
}

// account inserts an account row created at ledgerBase.
func (db *ledgerDB) account(t *testing.T, accountID, authMode, issuer, subject string) {
	t.Helper()
	execute(t, db.pool, `INSERT INTO accounts (account_id, auth_mode, issuer, subject, created_at) VALUES ($1::uuid, $2, $3, $4, $5)`,
		accountID, authMode, issuer, subject, ledgerBase)
}

// seedOwned gives the account one profile with one device link, one import and two events of that import, tagged so
// that no two seeds collide, and returns the profile's ID. Its rows are what an erasure of it counts (1, 1, 2, 1).
func (db *ledgerDB) seedOwned(t *testing.T, accountID, tag string) string {
	t.Helper()
	profileID := newUUID(t)
	execute(t, db.pool, `INSERT INTO profiles (profile_id, account_id, kind, consent_version, consent_at)
		VALUES ($1::uuid, $2::uuid, 'adult', 'trial-consent-1', $3)`, profileID, accountID, ledgerBase)
	execute(t, db.pool, `INSERT INTO profile_sources (account_id, profile_id, app, install_id, local_profile_id)
		VALUES ($1::uuid, $2::uuid, 'expo', $3, $4)`, accountID, profileID, "inst-"+tag, "lrn-"+tag)
	execute(t, db.pool, `INSERT INTO imports (account_id, import_id, request_sha256, profile_id, receipt)
		VALUES ($1::uuid, $2, decode(repeat('ab', 32), 'hex'), $3::uuid, '{}')`, accountID, "imp-"+tag, profileID)
	for seq := 1; seq <= 2; seq++ {
		execute(t, db.pool, `INSERT INTO events (profile_id, seq, event_id, kind, record_schema, schema_version, family, track,
			content_version, rules_version, curriculum_status, occurred_at, local_date, payload_raw, semantic_sha256, source_app,
			source_install_id, source_app_version, source_local_profile_id, import_id)
			VALUES ($1::uuid, $2, $3, 'answer', 'aya.answer', 1, 'arab', 'core', 'c1', 'r1', 'registered', $4, '2026-10-15', '{}',
			decode(repeat('cd', 32), 'hex'), 'expo', $5, '1.0.0', $6, $7)`,
			profileID, seq, fmt.Sprintf("ans-%s-%d", tag, seq), ledgerBase, "inst-"+tag, "lrn-"+tag, "imp-"+tag)
	}
	return profileID
}

// tombstone records e's deletion as the database itself would hold it.
func (db *ledgerDB) tombstone(t *testing.T, e store.LedgerEntry) {
	t.Helper()
	execute(t, db.pool, `INSERT INTO account_deletions (account_id, deletion_id, requested_at, erased_profiles, erased_device_links,
		erased_events, erased_imports, identity_attempts, identity_deleted_at, identity_last_failure_at)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10)`, e.AccountID, e.DeletionID, e.RequestedAt, e.Profiles,
		e.DeviceLinks, e.Events, e.Imports, e.IdentityAttempts, e.IdentityDeletedAt, e.IdentityLastFailureAt)
}

// owned counts the account's rows: profiles, device links, events and imports.
type owned struct{ profiles, links, events, imports int64 }

func (db *ledgerDB) owned(t *testing.T, accountID string) owned {
	t.Helper()
	var o owned
	if err := db.pool.QueryRow(context.Background(), `SELECT
		(SELECT count(*) FROM profiles WHERE account_id = $1::uuid),
		(SELECT count(*) FROM profile_sources WHERE account_id = $1::uuid),
		(SELECT count(*) FROM events WHERE profile_id IN (SELECT profile_id FROM profiles WHERE account_id = $1::uuid)),
		(SELECT count(*) FROM imports WHERE account_id = $1::uuid)`, accountID).Scan(&o.profiles, &o.links, &o.events, &o.imports); err != nil {
		t.Fatalf("count the account's rows: %v", err)
	}
	return o
}

// digest fingerprints every app table, row by row: equal digests mean nothing was written.
func (db *ledgerDB) digest(t *testing.T) map[string]string {
	t.Helper()
	return db.digestWhere(t, "true", "true")
}

// digestExcept fingerprints every row that is not the account's, and not its profiles' events: what a replay of the
// account's deletion must leave exactly as it was.
func (db *ledgerDB) digestExcept(t *testing.T, accountID string) map[string]string {
	t.Helper()
	id := "'" + accountID + "'::uuid" // a UUID this test generated
	return db.digestWhere(t, "account_id <> "+id, "profile_id NOT IN (SELECT profile_id FROM profiles WHERE account_id = "+id+")")
}

func (db *ledgerDB) digestWhere(t *testing.T, accountRows, eventRows string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, table := range ledgerTables {
		where := accountRows
		if table == "events" {
			where = eventRows
		}
		var d string
		if err := db.pool.QueryRow(context.Background(), `SELECT count(*)::text || ':' || coalesce(md5(string_agg(x::text, '|' ORDER BY x::text)), '')
			FROM `+table+` AS x WHERE `+where).Scan(&d); err != nil {
			t.Fatalf("digest %s: %v", table, err)
		}
		out[table] = d
	}
	return out
}

// sameDigest fails the test unless before and after are equal, table by table.
func sameDigest(t *testing.T, before, after map[string]string, what string) {
	t.Helper()
	for _, table := range ledgerTables {
		if before[table] != after[table] {
			t.Fatalf("%s changed table %s", what, table)
		}
	}
}

// record is an account's deletion record as stored, with the last failure that store.Deletion leaves out.
type record struct {
	deletionID    string
	requestedAt   time.Time
	profiles      int
	links         int
	events        int64
	imports       int
	attempts      int
	deletedAt     *time.Time
	lastFailureAt *time.Time
}

func (db *ledgerDB) record(t *testing.T, accountID string) (record, bool) {
	t.Helper()
	var r record
	err := db.pool.QueryRow(context.Background(), `SELECT deletion_id::text, requested_at, erased_profiles, erased_device_links, erased_events,
		erased_imports, identity_attempts, identity_deleted_at, identity_last_failure_at FROM account_deletions WHERE account_id = $1::uuid`,
		accountID).Scan(&r.deletionID, &r.requestedAt, &r.profiles, &r.links, &r.events, &r.imports, &r.attempts, &r.deletedAt, &r.lastFailureAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return record{}, false
	case err != nil:
		t.Fatalf("read the deletion record: %v", err)
	}
	return r, true
}

// anchorOf reads the account row's auth mode, issuer, subject and creation time.
func (db *ledgerDB) anchorOf(t *testing.T, accountID string) (mode, issuer, subject string, created time.Time, found bool) {
	t.Helper()
	err := db.pool.QueryRow(context.Background(), `SELECT auth_mode, issuer, subject, created_at FROM accounts WHERE account_id = $1::uuid`,
		accountID).Scan(&mode, &issuer, &subject, &created)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return "", "", "", time.Time{}, false
	case err != nil:
		t.Fatalf("read the account row: %v", err)
	}
	return mode, issuer, subject, created, true
}

// entryFor is a valid entry of the trusted provider: erased (1, 1, 2, 1) an hour after the account's creation, its
// identity confirmed a minute later at the first attempt.
func entryFor(accountID, subject, deletionID string) store.LedgerEntry {
	return store.LedgerEntry{
		AccountID: accountID, AuthMode: ledgerMode, Issuer: ledgerIssuer, Subject: subject, AccountCreatedAt: ledgerBase,
		DeletionID: deletionID, RequestedAt: at(time.Hour + 123456*time.Microsecond),
		Profiles: 1, DeviceLinks: 1, Events: 2, Imports: 1,
		IdentityAttempts: 1, IdentityDeletedAt: stamp(time.Hour + time.Minute),
	}
}

// ledgerOf is a ledger of the trusted provider holding entries.
func ledgerOf(entries ...store.LedgerEntry) store.Ledger {
	return store.Ledger{Format: store.LedgerFormat, ExportedAt: at(24 * time.Hour), Anchor: trustedAnchor, Entries: entries}
}

// sameTime reports whether two optional times are both unset or equal.
func sameTime(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && a.Equal(*b))
}

// sameEntry reports whether two entries carry the same anchor and record.
func sameEntry(a, b store.LedgerEntry) bool {
	return a.AccountID == b.AccountID && a.AuthMode == b.AuthMode && a.Issuer == b.Issuer && a.Subject == b.Subject &&
		a.AccountCreatedAt.Equal(b.AccountCreatedAt) && a.DeletionID == b.DeletionID && a.RequestedAt.Equal(b.RequestedAt) &&
		a.Profiles == b.Profiles && a.DeviceLinks == b.DeviceLinks && a.Events == b.Events && a.Imports == b.Imports &&
		a.IdentityAttempts == b.IdentityAttempts && sameTime(a.IdentityDeletedAt, b.IdentityDeletedAt) &&
		sameTime(a.IdentityLastFailureAt, b.IdentityLastFailureAt)
}

// A newer ledger's deletion, replayed into a restore, erases again what the restore holds of the account and leaves its
// exact anchor and tombstone, whatever the restore held: an old snapshot from before the deletion (the account and its
// data, no record), a snapshot from before the account existed (nothing of it), or the counterexample of a snapshot that
// already records the deletion and its identity's confirmation beside resurrected data, on which EraseAccount returns
// early and erases nothing. Bystanders keep every row: another account of the trusted issuer, an account of another
// issuer with the same subject, and an older deletion the ledger does not carry. A token of the identity then finds the
// deleted account, never a new one.
func TestDeletionLedgerReplayErasesResurrectedDataEvenUnderAnExistingTombstone(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct {
		name      string
		account   bool // the restore holds the account row
		data      bool // and its data
		tombstone bool // and its deletion record, identity confirmed
	}{
		{"an old snapshot from before the deletion", true, true, false},
		{"a snapshot from before the account existed", false, false, false},
		{"a snapshot that records the deletion beside resurrected data", true, true, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			db := openLedgerDB(t)
			accountID, subject, deletionID := newUUID(t), newUUID(t), newUUID(t)
			e := entryFor(accountID, subject, deletionID)
			if c.account {
				db.account(t, accountID, ledgerMode, ledgerIssuer, subject)
			}
			if c.data {
				db.seedOwned(t, accountID, "a1")
			}
			if c.tombstone {
				db.tombstone(t, e)
				// The premise: EraseAccount trusts the recorded deletion, returns it and erases nothing.
				d, err := db.st.EraseAccount(ctx, accountID, nil)
				if err != nil || d.DeletionID != deletionID {
					t.Fatalf("premise: EraseAccount on a recorded deletion = %q, %s; want the recorded deletion", d.DeletionID, withheld(err))
				}
				if o := db.owned(t, accountID); o != (owned{1, 1, 2, 1}) {
					t.Fatalf("premise: EraseAccount on a recorded deletion left %+v of the resurrected rows, want all of them", o)
				}
			}
			other, foreign, older := newUUID(t), newUUID(t), newUUID(t)
			db.account(t, other, ledgerMode, ledgerIssuer, newUUID(t))
			db.seedOwned(t, other, "b1")
			db.account(t, foreign, "emulator", foreignIssuer, subject)
			db.seedOwned(t, foreign, "f1")
			db.account(t, older, ledgerMode, ledgerIssuer, newUUID(t))
			db.tombstone(t, entryFor(older, "", newUUID(t)))
			bystanders := db.digestExcept(t, accountID)

			report, err := db.st.ReplayDeletionLedger(ctx, trustedAnchor, ledgerOf(e))
			if err != nil {
				t.Fatalf("ReplayDeletionLedger: %s", withheld(err))
			}
			if len(report.Deletions) != 1 {
				t.Fatalf("the report lists %d deletions, want the ledger's one", len(report.Deletions))
			}
			r := report.Deletions[0]
			erased := owned{}
			if c.data {
				erased = owned{1, 1, 2, 1}
			}
			switch {
			case r.AccountID != accountID || r.DeletionID != deletionID || r.Deletion.DeletionID != deletionID:
				t.Fatal("the report names another account or deletion than the ledger's")
			case r.AnchorCreated != !c.account || r.RecordCreated != !c.tombstone:
				t.Fatalf("the report says anchor created %v and record created %v, want %v and %v", r.AnchorCreated, r.RecordCreated, !c.account, !c.tombstone)
			case (owned{int64(r.Profiles), int64(r.DeviceLinks), r.Events, int64(r.Imports)}) != erased:
				t.Fatalf("the report counts %d, %d, %d, %d rows erased, want %+v", r.Profiles, r.DeviceLinks, r.Events, r.Imports, erased)
			}
			if o := db.owned(t, accountID); o != (owned{}) {
				t.Fatalf("the replay left %+v of the account's resurrected rows", o)
			}
			mode, issuer, gotSubject, created, found := db.anchorOf(t, accountID)
			if !found || mode != ledgerMode || issuer != ledgerIssuer || gotSubject != subject || !created.Equal(ledgerBase) {
				t.Fatal("the account row is not the ledger's exact anchor: account ID, auth mode, issuer, subject and creation time")
			}
			rec, found := db.record(t, accountID)
			switch {
			case !found:
				t.Fatal("the replay left the account without its tombstone")
			case rec.deletionID != deletionID || !rec.requestedAt.Equal(e.RequestedAt):
				t.Fatal("the tombstone is not the ledger's deletion and erasure time")
			case rec.profiles != 1 || rec.links != 1 || rec.events != 2 || rec.imports != 1:
				t.Fatal("the tombstone does not keep the original erasure's counts")
			case rec.attempts != 1 || !sameTime(rec.deletedAt, e.IdentityDeletedAt) || rec.lastFailureAt != nil:
				t.Fatal("the tombstone does not keep the ledger's identity attempts, confirmation and failure")
			}
			sameDigest(t, bystanders, db.digestExcept(t, accountID), "the replay of another account's deletion")
			acct, err := db.st.EnsureAccount(ctx, ledgerMode, ledgerIssuer, subject)
			if err != nil || acct.ID != accountID || !acct.Deleted {
				t.Fatalf("a token of the identity finds account %q (deleted %v, %s), want the deleted account", acct.ID, acct.Deleted, withheld(err))
			}
		})
	}
}

// wantRecord fails the test unless the account's tombstone is deletion e's, from its erasure time, with exactly these
// counts and identity metadata.
func (db *ledgerDB) wantRecord(t *testing.T, what string, e store.LedgerEntry, events int64, attempts int, deletedAt, lastFailure *time.Time) {
	t.Helper()
	r, found := db.record(t, e.AccountID)
	switch {
	case !found:
		t.Fatalf("%s: the account has no tombstone", what)
	case r.deletionID != e.DeletionID || !r.requestedAt.Equal(e.RequestedAt):
		t.Fatalf("%s: the tombstone is not the ledger's deletion and erasure time", what)
	case r.profiles != 1 || r.links != 1 || r.events != events || r.imports != 1:
		t.Fatalf("%s: the tombstone counts %d, %d, %d, %d erased rows, want 1, 1, %d, 1", what, r.profiles, r.links, r.events, r.imports, events)
	case r.attempts != attempts:
		t.Fatalf("%s: the tombstone counts %d identity attempts, want %d", what, r.attempts, attempts)
	case !sameTime(r.deletedAt, deletedAt):
		t.Fatalf("%s: the tombstone's identity confirmation is %v, want %v", what, r.deletedAt, deletedAt)
	case !sameTime(r.lastFailureAt, lastFailure):
		t.Fatalf("%s: the tombstone's last identity failure is %v, want %v", what, r.lastFailureAt, lastFailure)
	}
}

// Replaying is idempotent and never regresses a record. A second replay of the same ledger erases nothing and changes
// nothing. An older ledger of the same deletion, replayed after a newer one, leaves the newer record: the greater counts
// and attempts, its confirmation and its later failure. A restore whose tombstone holds an earlier confirmation than
// the ledger keeps that first confirmation, and takes the ledger's greater attempts and later failure.
func TestDeletionLedgerReplayIsIdempotentAndNeverRegressesTheRecord(t *testing.T) {
	ctx := context.Background()
	db := openLedgerDB(t)
	accountID, subject, deletionID := newUUID(t), newUUID(t), newUUID(t)
	db.account(t, accountID, ledgerMode, ledgerIssuer, subject)
	db.seedOwned(t, accountID, "m1")
	newer := entryFor(accountID, subject, deletionID)
	newer.IdentityAttempts, newer.IdentityDeletedAt, newer.IdentityLastFailureAt = 3, stamp(3*time.Hour), stamp(2*time.Hour)
	older := entryFor(accountID, subject, deletionID)
	older.Events, older.IdentityAttempts, older.IdentityDeletedAt, older.IdentityLastFailureAt = 1, 1, nil, stamp(90*time.Minute)

	if _, err := db.st.ReplayDeletionLedger(ctx, trustedAnchor, ledgerOf(newer)); err != nil {
		t.Fatalf("replay the newer ledger: %s", withheld(err))
	}
	db.wantRecord(t, "after the newer ledger", newer, 2, 3, newer.IdentityDeletedAt, newer.IdentityLastFailureAt)
	if o := db.owned(t, accountID); o != (owned{}) {
		t.Fatalf("the replay left %+v of the account's rows", o)
	}

	t.Run("a second replay of the same ledger erases nothing and changes nothing", func(t *testing.T) {
		before := db.digest(t)
		report, err := db.st.ReplayDeletionLedger(ctx, trustedAnchor, ledgerOf(newer))
		if err != nil {
			t.Fatalf("replay the same ledger again: %s", withheld(err))
		}
		if len(report.Deletions) != 1 {
			t.Fatalf("the report lists %d deletions, want the ledger's one", len(report.Deletions))
		}
		if r := report.Deletions[0]; r.AnchorCreated || r.RecordCreated || r.Profiles != 0 || r.DeviceLinks != 0 || r.Events != 0 || r.Imports != 0 {
			t.Fatalf("a second replay reports %+v, want nothing created or erased", r)
		}
		sameDigest(t, before, db.digest(t), "a second replay of the same ledger")
	})

	t.Run("an older ledger never regresses the newer record", func(t *testing.T) {
		if _, err := db.st.ReplayDeletionLedger(ctx, trustedAnchor, ledgerOf(older)); err != nil {
			t.Fatalf("replay the older ledger: %s", withheld(err))
		}
		db.wantRecord(t, "after the older ledger", newer, 2, 3, newer.IdentityDeletedAt, newer.IdentityLastFailureAt)
	})

	t.Run("an earlier recorded confirmation stays the first one", func(t *testing.T) {
		db := openLedgerDB(t)
		restored := entryFor(newUUID(t), newUUID(t), newUUID(t))
		restored.IdentityAttempts, restored.IdentityDeletedAt = 2, stamp(70*time.Minute)
		db.account(t, restored.AccountID, ledgerMode, ledgerIssuer, restored.Subject)
		db.tombstone(t, restored)
		db.seedOwned(t, restored.AccountID, "m2")
		ledger := restored
		ledger.IdentityAttempts, ledger.IdentityDeletedAt, ledger.IdentityLastFailureAt = 4, stamp(5*time.Hour), stamp(4*time.Hour)
		if _, err := db.st.ReplayDeletionLedger(ctx, trustedAnchor, ledgerOf(ledger)); err != nil {
			t.Fatalf("replay into a restore with an earlier confirmation: %s", withheld(err))
		}
		db.wantRecord(t, "after the replay", restored, 2, 4, restored.IdentityDeletedAt, ledger.IdentityLastFailureAt)
		if o := db.owned(t, restored.AccountID); o != (owned{}) {
			t.Fatalf("the replay left %+v of the account's resurrected rows", o)
		}
	})
}

// A ledger entry that contradicts the database refuses the whole replay before anything is written, the valid entry
// beside it included: no other account is reconciled in the entry's place, and the valid entry's resurrected data stays
// until a consistent ledger is replayed.
func TestDeletionLedgerReplayRefusesConflictingMappingsWithoutWriting(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct {
		name string
		// conflicting creates what the entry it returns contradicts.
		conflicting func(t *testing.T, db *ledgerDB) store.LedgerEntry
	}{
		{"its account ID is another identity's account", func(t *testing.T, db *ledgerDB) store.LedgerEntry {
			accountID := newUUID(t)
			db.account(t, accountID, ledgerMode, ledgerIssuer, newUUID(t))
			return entryFor(accountID, newUUID(t), newUUID(t))
		}},
		{"its account ID is an account of another auth mode", func(t *testing.T, db *ledgerDB) store.LedgerEntry {
			accountID, subject := newUUID(t), newUUID(t)
			db.account(t, accountID, "emulator", ledgerIssuer, subject)
			return entryFor(accountID, subject, newUUID(t))
		}},
		{"its identity is another account's", func(t *testing.T, db *ledgerDB) store.LedgerEntry {
			subject := newUUID(t)
			db.account(t, newUUID(t), ledgerMode, ledgerIssuer, subject)
			return entryFor(newUUID(t), subject, newUUID(t))
		}},
		{"its account's recorded deletion is another one", func(t *testing.T, db *ledgerDB) store.LedgerEntry {
			accountID, subject := newUUID(t), newUUID(t)
			db.account(t, accountID, ledgerMode, ledgerIssuer, subject)
			db.tombstone(t, entryFor(accountID, subject, newUUID(t)))
			return entryFor(accountID, subject, newUUID(t))
		}},
		{"its deletion ID is another account's", func(t *testing.T, db *ledgerDB) store.LedgerEntry {
			accountID, deletionID := newUUID(t), newUUID(t)
			db.account(t, accountID, ledgerMode, ledgerIssuer, newUUID(t))
			db.tombstone(t, entryFor(accountID, "", deletionID))
			return entryFor(newUUID(t), newUUID(t), deletionID)
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			db := openLedgerDB(t)
			valid, subject := newUUID(t), newUUID(t)
			db.account(t, valid, ledgerMode, ledgerIssuer, subject)
			db.seedOwned(t, valid, "v1")
			conflicting := c.conflicting(t, db)
			before := db.digest(t)
			_, err := db.st.ReplayDeletionLedger(ctx, trustedAnchor, ledgerOf(entryFor(valid, subject, newUUID(t)), conflicting))
			if !errors.Is(err, store.ErrLedgerConflict) {
				t.Fatalf("ReplayDeletionLedger = %s, want ErrLedgerConflict", withheld(err))
			}
			if o := db.owned(t, valid); o != (owned{1, 1, 2, 1}) {
				t.Fatalf("a refused replay erased the valid entry's rows (%+v left): every mapping must be checked before anything is erased", o)
			}
			sameDigest(t, before, db.digest(t), "a refused replay")
		})
	}
}

// A ledger that is not a valid ledger of the trusted provider is refused whole before the database is touched: nothing
// is written, and nothing of another provider's accounts is reconciled.
func TestDeletionLedgerReplayRefusesAnInvalidLedgerWithoutWriting(t *testing.T) {
	ctx := context.Background()
	db := openLedgerDB(t)
	accountID, subject := newUUID(t), newUUID(t)
	db.account(t, accountID, ledgerMode, ledgerIssuer, subject)
	db.seedOwned(t, accountID, "i1")
	db.account(t, newUUID(t), "emulator", foreignIssuer, subject)
	valid := func() store.LedgerEntry { return entryFor(accountID, subject, newUUID(t)) }
	edited := func(edit func(*store.LedgerEntry)) func() store.Ledger {
		return func() store.Ledger {
			e := valid()
			edit(&e)
			return ledgerOf(e)
		}
	}
	many := make([]store.LedgerEntry, store.MaxLedgerEntries+1)
	for i := range many {
		many[i] = entryFor(newUUID(t), newUUID(t), newUUID(t))
	}
	for _, c := range []struct {
		name   string
		ledger func() store.Ledger
	}{
		{"another format", func() store.Ledger { l := ledgerOf(valid()); l.Format = "ayailmu-deletion-ledger-0"; return l }},
		{"a ledger of another issuer", func() store.Ledger { l := ledgerOf(valid()); l.Anchor.Issuer = foreignIssuer; return l }},
		{"a ledger of another auth mode", func() store.Ledger { l := ledgerOf(valid()); l.Anchor.AuthMode = "emulator"; return l }},
		{"an entry of another issuer", edited(func(e *store.LedgerEntry) { e.Issuer = foreignIssuer })},
		{"an entry of another auth mode", edited(func(e *store.LedgerEntry) { e.AuthMode = "emulator" })},
		{"an account ID in upper case", edited(func(e *store.LedgerEntry) { e.AccountID = strings.ToUpper(e.AccountID) })},
		{"a subject that is not a UUID", edited(func(e *store.LedgerEntry) { e.Subject = "aya-ledger@example.test" })},
		{"the nil UUID as subject", edited(func(e *store.LedgerEntry) { e.Subject = "00000000-0000-0000-0000-000000000000" })},
		{"a deletion ID without its hyphens", edited(func(e *store.LedgerEntry) { e.DeletionID = strings.ReplaceAll(e.DeletionID, "-", "") })},
		{"a negative count", edited(func(e *store.LedgerEntry) { e.Events = -1 })},
		{"a confirmation without an attempt", edited(func(e *store.LedgerEntry) { e.IdentityAttempts = 0 })},
		{"a failure without an attempt", edited(func(e *store.LedgerEntry) {
			e.IdentityAttempts, e.IdentityDeletedAt, e.IdentityLastFailureAt = 0, nil, stamp(2*time.Hour)
		})},
		{"one account twice", func() store.Ledger { return ledgerOf(valid(), valid()) }},
		{"one identity for two accounts", func() store.Ledger { return ledgerOf(valid(), entryFor(newUUID(t), subject, newUUID(t))) }},
		{"one deletion for two accounts", func() store.Ledger {
			e := valid()
			return ledgerOf(e, entryFor(newUUID(t), newUUID(t), e.DeletionID))
		}},
		{"more entries than a ledger may carry", func() store.Ledger { return ledgerOf(many...) }},
	} {
		t.Run(c.name, func(t *testing.T) {
			before := db.digest(t)
			_, err := db.st.ReplayDeletionLedger(ctx, trustedAnchor, c.ledger())
			if !errors.Is(err, store.ErrLedgerInvalid) {
				t.Fatalf("ReplayDeletionLedger = %s, want ErrLedgerInvalid", withheld(err))
			}
			sameDigest(t, before, db.digest(t), "a refused replay")
		})
	}
}

// A replay takes each account's locks in EraseAccount's order. A fixture transaction stands in for an import that holds
// the account's advisory lock (the key Import and EraseAccount take first) and has not written yet: the replay must
// queue for that lock while holding nothing of the account, so the import can still key-share lock the account row and
// lock a profile row at once (NOWAIT), and insert a profile with its device link. Taking the account row first would
// deadlock with every such import. Once the import commits, the replay erases what it wrote too.
func TestDeletionLedgerReplayTakesTheAccountsLocksInTheErasureOrder(t *testing.T) {
	ctx := context.Background()
	db := openLedgerDB(t)
	accountID, subject := newUUID(t), newUUID(t)
	db.account(t, accountID, ledgerMode, ledgerIssuer, subject)
	pid := db.seedOwned(t, accountID, "l1")
	ledger := ledgerOf(entryFor(accountID, subject, newUUID(t)))
	newPid := newUUID(t)
	// lockKey is the per-account advisory lock key Store.Import and Store.EraseAccount take first (accountLockKey).
	lockKey := "ayailmu-import:" + db.schema + ":" + accountID

	tx, err := db.pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin the import's stand-in: %v", err)
	}
	defer tx.Rollback(ctx) // releases the lock if the test stops early; a no-op after Commit
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", lockKey); err != nil {
		t.Fatalf("take the account's advisory lock: %v", err)
	}

	type outcome struct {
		report store.ReplayReport
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		report, err := db.st.ReplayDeletionLedger(ctx, trustedAnchor, ledger)
		done <- outcome{report, err}
	}()
	// queued reports a backend of this database waiting for exactly that lock. A bigint key shows its high half in
	// classid, its low half in objid and objsubid 1.
	queued := func() bool {
		var n int
		if err := db.pool.QueryRow(ctx, `SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objsubid = 1
			AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
			AND ((classid::bigint << 32) | objid::bigint) = hashtext($1)::bigint`, lockKey).Scan(&n); err != nil {
			t.Fatalf("read the lock queue: %v", err)
		}
		return n > 0
	}
	for deadline := time.Now().Add(10 * time.Second); !queued(); time.Sleep(20 * time.Millisecond) {
		select {
		case o := <-done:
			t.Fatalf("the replay returned (%s) without waiting for the account's advisory lock", withheld(o.err))
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("the replay never queued for the account's advisory lock")
		}
	}
	var one int
	if err := tx.QueryRow(ctx, `SELECT 1 FROM accounts WHERE account_id = $1::uuid FOR KEY SHARE NOWAIT`, accountID).Scan(&one); err != nil {
		t.Fatalf("the replay holds the account row while it waits for the account's advisory lock, so an import's next insert would deadlock: %v", err)
	}
	if err := tx.QueryRow(ctx, `SELECT 1 FROM profiles WHERE profile_id = $1::uuid FOR UPDATE NOWAIT`, pid).Scan(&one); err != nil {
		t.Fatalf("the replay holds a profile row while it waits for the account's advisory lock, so an import into it would deadlock: %v", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO profiles (profile_id, account_id, kind, consent_version, consent_at)
		VALUES ($1::uuid, $2::uuid, 'adult', 'trial-consent-1', $3)`, newPid, accountID, ledgerBase); err != nil {
		t.Fatalf("the import's stand-in could not insert its profile: %v", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO profile_sources (account_id, profile_id, app, install_id, local_profile_id)
		VALUES ($1::uuid, $2::uuid, 'expo', 'inst-l2', 'lrn-l2')`, accountID, newPid); err != nil {
		t.Fatalf("the import's stand-in could not link its device: %v", err)
	}
	select {
	case o := <-done:
		t.Fatalf("the replay returned (%s) while the import still held the account's advisory lock", withheld(o.err))
	default:
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit the import's stand-in: %v", err)
	}
	var o outcome
	select {
	case o = <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("the replay did not finish once the import committed")
	}
	if o.err != nil {
		t.Fatalf("ReplayDeletionLedger: %s", withheld(o.err))
	}
	if len(o.report.Deletions) != 1 {
		t.Fatalf("the report lists %d deletions, want the ledger's one", len(o.report.Deletions))
	}
	if r := o.report.Deletions[0]; r.Profiles != 2 || r.DeviceLinks != 2 || r.Events != 2 || r.Imports != 1 {
		t.Fatalf("the replay erased %d, %d, %d, %d rows, want the import's profile and link too (2, 2, 2, 1)", r.Profiles, r.DeviceLinks, r.Events, r.Imports)
	}
	if left := db.owned(t, accountID); left != (owned{}) {
		t.Fatalf("the replay left %+v of the account's rows", left)
	}
}

// members lists the member names of one JSON object, sorted and comma-separated.
func members(t *testing.T, raw []byte) string {
	t.Helper()
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil || obj == nil {
		t.Fatal("the encoded ledger is not made of JSON objects")
	}
	return strings.Join(slices.Sorted(maps.Keys(obj)), ",")
}

// wantDocumentMembers fails the test unless the encoded ledger has exactly the documented members, at every level.
func wantDocumentMembers(t *testing.T, doc []byte) {
	t.Helper()
	if got := members(t, doc); got != "auth_mode,deletions,exported_at,format,issuer" {
		t.Fatalf("the document's members are %s", got)
	}
	var top struct{ Deletions []json.RawMessage }
	if err := json.Unmarshal(doc, &top); err != nil || len(top.Deletions) == 0 {
		t.Fatal("the encoded ledger carries no deletions")
	}
	for _, entry := range top.Deletions {
		if got := members(t, entry); got != "account_created_at,account_id,auth_mode,deletion_id,erased,identity,issuer,requested_at,subject" {
			t.Fatalf("an entry's members are %s", got)
		}
		var parts struct{ Erased, Identity json.RawMessage }
		if err := json.Unmarshal(entry, &parts); err != nil {
			t.Fatal("an encoded entry is malformed")
		}
		if got := members(t, parts.Erased); got != "device_links,events,imports,profiles" {
			t.Fatalf("an entry's erased members are %s", got)
		}
		if got := members(t, parts.Identity); got != "attempts,deleted_at,last_failure_at" {
			t.Fatalf("an entry's identity members are %s", got)
		}
	}
}

// The export reads only, on a session that cannot write: every recorded deletion of the trusted provider, in account ID
// order, with its account's exact anchor and its record, and nothing of an account that was not deleted. It encodes to
// the one documented JSON document, which has no other member (no email), and decodes back unchanged. A database without
// deletions exports an empty ledger. A database that also records a deletion of another provider's account, or more
// deletions than one ledger may carry, is refused whole: a ledger is never partial.
func TestDeletionLedgerExportReadsOnlyAndCarriesEachAnchorAndRecord(t *testing.T) {
	ctx := context.Background()
	// exporter is a store whose every transaction is read-only: any write the export tried would fail.
	exporter := func(t *testing.T, db *ledgerDB) *store.Store {
		t.Helper()
		st, err := store.Open(ctx, readOnlySession(t, testDatabaseURL(t)), db.schema)
		if err != nil {
			t.Fatalf("open a read-only store: %s", withheld(err))
		}
		t.Cleanup(st.Close)
		return st
	}
	db := openLedgerDB(t)
	st := exporter(t, db)

	t.Run("a database without deletions exports an empty ledger", func(t *testing.T) {
		l, err := st.ExportDeletionLedger(ctx, trustedAnchor)
		if err != nil || l.Format != store.LedgerFormat || l.Anchor != trustedAnchor || len(l.Entries) != 0 {
			t.Fatalf("ExportDeletionLedger = %d entries of %q/%+v, %s; want an empty ledger of the trusted provider", len(l.Entries), l.Format, l.Anchor, withheld(err))
		}
	})

	confirmed := entryFor(newUUID(t), newUUID(t), newUUID(t))
	pending := entryFor(newUUID(t), newUUID(t), newUUID(t))
	pending.IdentityAttempts, pending.IdentityDeletedAt, pending.IdentityLastFailureAt = 2, nil, stamp(2*time.Hour)
	want := []store.LedgerEntry{confirmed, pending}
	if want[1].AccountID < want[0].AccountID {
		want[0], want[1] = want[1], want[0]
	}
	for _, e := range want {
		db.account(t, e.AccountID, ledgerMode, ledgerIssuer, e.Subject)
		db.tombstone(t, e)
	}
	active, activeSubject := newUUID(t), newUUID(t)
	db.account(t, active, ledgerMode, ledgerIssuer, activeSubject)
	db.seedOwned(t, active, "x1")
	before := db.digest(t)

	l, err := st.ExportDeletionLedger(ctx, trustedAnchor)
	if err != nil {
		t.Fatalf("ExportDeletionLedger: %s", withheld(err))
	}
	sameDigest(t, before, db.digest(t), "the export")
	switch {
	case l.Format != store.LedgerFormat || l.Anchor != trustedAnchor:
		t.Fatalf("the ledger is %q/%+v, want the format and the trusted provider", l.Format, l.Anchor)
	case l.ExportedAt.IsZero():
		t.Fatal("the ledger does not say when its snapshot was taken")
	case len(l.Entries) != len(want):
		t.Fatalf("the ledger carries %d entries, want the %d recorded deletions", len(l.Entries), len(want))
	}
	for i := range want {
		if !sameEntry(l.Entries[i], want[i]) {
			t.Fatalf("entry %d is not the account's exact anchor and record, in account ID order", i)
		}
	}

	var doc bytes.Buffer
	if err := store.EncodeDeletionLedger(&doc, l); err != nil {
		t.Fatalf("EncodeDeletionLedger: %s", withheld(err))
	}
	if strings.Contains(doc.String(), active) || strings.Contains(doc.String(), activeSubject) {
		t.Fatal("the ledger carries an account that was not deleted")
	}
	wantDocumentMembers(t, doc.Bytes())
	back, err := store.DecodeDeletionLedger(bytes.NewReader(doc.Bytes()), trustedAnchor)
	if err != nil {
		t.Fatalf("DecodeDeletionLedger of an encoded export: %s", withheld(err))
	}
	if back.Format != l.Format || back.Anchor != l.Anchor || !back.ExportedAt.Equal(l.ExportedAt) || len(back.Entries) != len(l.Entries) {
		t.Fatal("the decoded ledger is not the exported one")
	}
	for i := range l.Entries {
		if !sameEntry(back.Entries[i], l.Entries[i]) {
			t.Fatalf("decoded entry %d is not the exported one", i)
		}
	}

	t.Run("a deletion of another provider's account refuses the whole export", func(t *testing.T) {
		db := openLedgerDB(t)
		ours, theirs := entryFor(newUUID(t), newUUID(t), newUUID(t)), entryFor(newUUID(t), newUUID(t), newUUID(t))
		db.account(t, ours.AccountID, ledgerMode, ledgerIssuer, ours.Subject)
		db.tombstone(t, ours)
		db.account(t, theirs.AccountID, "emulator", foreignIssuer, theirs.Subject)
		db.tombstone(t, theirs)
		l, err := exporter(t, db).ExportDeletionLedger(ctx, trustedAnchor)
		if !errors.Is(err, store.ErrLedgerForeignAccount) || len(l.Entries) != 0 {
			t.Fatalf("ExportDeletionLedger = %d entries, %s; want nothing and ErrLedgerForeignAccount", len(l.Entries), withheld(err))
		}
	})
	t.Run("more deletions than one ledger may carry refuse the whole export", func(t *testing.T) {
		db := openLedgerDB(t)
		execute(t, db.pool, `WITH created AS (INSERT INTO accounts (auth_mode, issuer, subject)
			SELECT 'local-supabase', $1, gen_random_uuid()::text FROM generate_series(1, $2::int) RETURNING account_id)
			INSERT INTO account_deletions (account_id, erased_profiles, erased_device_links, erased_events, erased_imports)
			SELECT account_id, 0, 0, 0, 0 FROM created`, ledgerIssuer, store.MaxLedgerEntries+1)
		l, err := exporter(t, db).ExportDeletionLedger(ctx, trustedAnchor)
		if !errors.Is(err, store.ErrLedgerTooLarge) || len(l.Entries) != 0 {
			t.Fatalf("ExportDeletionLedger = %d entries, %s; want nothing and ErrLedgerTooLarge", len(l.Entries), withheld(err))
		}
	})
}

// The decoder is strict and bounded. It accepts exactly the documented document of the trusted provider and refuses
// anything else with ErrLedgerInvalid, quoting nothing of the document: not JSON or not one object; another format or
// another provider; a member missing, unknown (an email) or repeated; trailing data; IDs that are not canonical UUIDs;
// one account, identity or deletion twice; impossible counts or identity metadata; and more bytes or entries than a
// ledger may carry.
func TestDeletionLedgerDecodeIsStrictAndBounded(t *testing.T) {
	const (
		accountID  = "0f8b2c34-5d6e-4f70-a182-93a4b5c6d7e8"
		subject    = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
		deletionID = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e"
		other      = "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f"
	)
	entryWith := func(accountID, subject, deletionID string) string {
		return `{"account_id":"` + accountID + `","auth_mode":"local-supabase","issuer":"` + ledgerIssuer + `","subject":"` + subject +
			`","account_created_at":"2026-10-15T08:00:00Z","deletion_id":"` + deletionID + `","requested_at":"2026-10-15T09:00:00.123456Z",` +
			`"erased":{"profiles":1,"device_links":1,"events":2,"imports":1},` +
			`"identity":{"attempts":1,"deleted_at":"2026-10-15T09:01:00Z","last_failure_at":null}}`
	}
	doc := func(entries ...string) string {
		return `{"format":"ayailmu-deletion-ledger-1","exported_at":"2026-10-16T08:00:00Z","auth_mode":"local-supabase","issuer":"` +
			ledgerIssuer + `","deletions":[` + strings.Join(entries, ",") + `]}`
	}
	entry := entryWith(accountID, subject, deletionID)
	valid := doc(entry)
	replace := func(old, new string) string {
		if !strings.Contains(valid, old) {
			t.Fatalf("the test's own mutation %q does not apply", old)
		}
		return strings.Replace(valid, old, new, 1)
	}

	t.Run("the documented document", func(t *testing.T) {
		l, err := store.DecodeDeletionLedger(strings.NewReader(valid), trustedAnchor)
		if err != nil {
			t.Fatalf("DecodeDeletionLedger: %s", withheld(err))
		}
		want := store.LedgerEntry{AccountID: accountID, AuthMode: ledgerMode, Issuer: ledgerIssuer, Subject: subject,
			AccountCreatedAt: ledgerBase, DeletionID: deletionID, RequestedAt: at(time.Hour + 123456*time.Microsecond),
			Profiles: 1, DeviceLinks: 1, Events: 2, Imports: 1, IdentityAttempts: 1, IdentityDeletedAt: stamp(time.Hour + time.Minute)}
		switch {
		case l.Format != store.LedgerFormat || l.Anchor != trustedAnchor || !l.ExportedAt.Equal(at(24*time.Hour)):
			t.Fatalf("the ledger is %q/%+v exported at %v, want the document's", l.Format, l.Anchor, l.ExportedAt)
		case len(l.Entries) != 1 || !sameEntry(l.Entries[0], want):
			t.Fatal("the decoded entry is not the document's")
		}
	})
	t.Run("an empty ledger", func(t *testing.T) {
		if l, err := store.DecodeDeletionLedger(strings.NewReader(doc()), trustedAnchor); err != nil || len(l.Entries) != 0 {
			t.Fatalf("DecodeDeletionLedger of a ledger without deletions = %d entries, %s; want none and no error", len(l.Entries), withheld(err))
		}
	})

	many := make([]string, store.MaxLedgerEntries+1)
	for i := range many {
		many[i] = entryWith(fmt.Sprintf("00000000-0000-4000-8000-%012x", i+1), fmt.Sprintf("10000000-0000-4000-8000-%012x", i+1),
			fmt.Sprintf("20000000-0000-4000-8000-%012x", i+1))
	}
	foreignAnchor := store.LedgerAnchor{AuthMode: ledgerMode, Issuer: foreignIssuer}
	for _, c := range []struct {
		name    string
		doc     string
		trusted store.LedgerAnchor
	}{
		{"not JSON", "ayailmu-deletion-ledger-1", trustedAnchor},
		{"a JSON array", "[" + valid + "]", trustedAnchor},
		{"another format", replace(`"ayailmu-deletion-ledger-1"`, `"ayailmu-deletion-ledger-2"`), trustedAnchor},
		{"a ledger of another issuer", replace(`"issuer":"`+ledgerIssuer+`","deletions"`, `"issuer":"`+foreignIssuer+`","deletions"`), trustedAnchor},
		{"a ledger of another auth mode", replace(`"exported_at":"2026-10-16T08:00:00Z","auth_mode":"local-supabase"`,
			`"exported_at":"2026-10-16T08:00:00Z","auth_mode":"emulator"`), trustedAnchor},
		{"a ledger that another issuer is trusted for", valid, foreignAnchor},
		{"an entry of another issuer", replace(`"issuer":"`+ledgerIssuer+`","subject"`, `"issuer":"`+foreignIssuer+`","subject"`), trustedAnchor},
		{"an entry of another auth mode", replace(`"account_id":"`+accountID+`","auth_mode":"local-supabase"`,
			`"account_id":"`+accountID+`","auth_mode":"emulator"`), trustedAnchor},
		{"a member missing", replace(`"subject":"`+subject+`",`, ""), trustedAnchor},
		{"an unknown member: an email", replace(`"subject":`, `"email":"aya-ledger@example.test","subject":`), trustedAnchor},
		{"an unknown member of the document", replace(`"deletions":`, `"note":"x","deletions":`), trustedAnchor},
		{"a repeated member", replace(`"subject":`, `"subject":"`+other+`","subject":`), trustedAnchor},
		{"trailing data", valid + `{}`, trustedAnchor},
		{"two documents", valid + valid, trustedAnchor},
		{"an account ID in upper case", replace(accountID, strings.ToUpper(accountID)), trustedAnchor},
		{"a subject that is not a UUID", replace(`"subject":"`+subject+`"`, `"subject":"aya-ledger@example.test"`), trustedAnchor},
		{"the nil UUID as subject", replace(`"subject":"`+subject+`"`, `"subject":"00000000-0000-0000-0000-000000000000"`), trustedAnchor},
		{"a deletion ID in braces", replace(`"`+deletionID+`"`, `"{`+deletionID+`}"`), trustedAnchor},
		{"one account twice", doc(entry, entryWith(accountID, other, other)), trustedAnchor},
		{"one identity for two accounts", doc(entry, entryWith(other, subject, other)), trustedAnchor},
		{"one deletion for two accounts", doc(entry, entryWith(other, other, deletionID)), trustedAnchor},
		{"a negative count", replace(`"events":2`, `"events":-1`), trustedAnchor},
		{"a count that is not an integer", replace(`"events":2`, `"events":2.5`), trustedAnchor},
		{"a confirmation without an attempt", replace(`"attempts":1`, `"attempts":0`), trustedAnchor},
		{"a time that is not RFC 3339", replace(`"requested_at":"2026-10-15T09:00:00.123456Z"`, `"requested_at":"15 Oct 2026 09:00"`), trustedAnchor},
		{"more bytes than a ledger may carry", valid + strings.Repeat(" ", store.MaxLedgerBytes), trustedAnchor},
		{"more entries than a ledger may carry", doc(many...), trustedAnchor},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := store.DecodeDeletionLedger(strings.NewReader(c.doc), c.trusted)
			if !errors.Is(err, store.ErrLedgerInvalid) {
				t.Fatalf("DecodeDeletionLedger = %s, want ErrLedgerInvalid", withheld(err))
			}
			for _, quoted := range []string{accountID, subject, deletionID, other, "example.test", ledgerIssuer, foreignIssuer} {
				if strings.Contains(err.Error(), quoted) {
					t.Fatal("the refusal quotes the document")
				}
			}
		})
	}
}
