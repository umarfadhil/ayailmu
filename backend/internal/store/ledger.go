package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

// The deletion ledger: an account deletion's identity and record, exported from one database and replayed into another,
// such as a restore of an older snapshot. A restored snapshot can hold an account's data again (resurrected) although a
// newer, independently kept ledger records its deletion; replaying the ledger erases that data again and keeps the
// account's tombstone, before anything serves the restored data. The operator tool cmd/ayailmu-ledger does both.

// LedgerFormat names version 1 of the deletion ledger document.
const LedgerFormat = "ayailmu-deletion-ledger-1"

// Bounds of a ledger. A replay takes one advisory lock per entry in one transaction, and every such lock occupies a slot
// of PostgreSQL's shared lock table, so the entries are bounded well below its default size. A document is bounded in
// bytes as read, before it is parsed.
const (
	MaxLedgerEntries = 1000
	MaxLedgerBytes   = 2 << 20
)

const (
	// ledgerAuthMode is the one account auth mode a ledger can belong to: its subjects are Auth's user IDs, canonical
	// UUIDs.
	ledgerAuthMode = "local-supabase"
	// maxLedgerIssuerBytes bounds the trusted issuer as package config bounds AYA_SUPABASE_ISSUER.
	maxLedgerIssuerBytes = 256
	// nilLedgerID is the nil UUID, which names no account, identity or deletion.
	nilLedgerID = "00000000-0000-0000-0000-000000000000"
)

var (
	// ErrLedgerInvalid wraps every refusal of a ledger itself, decoded or built: another format; more than
	// MaxLedgerBytes or MaxLedgerEntries; a member missing, unknown (an email, say) or repeated, or trailing data; an
	// account, deletion or subject ID that is not a canonical lowercase UUID (or is the nil UUID); an auth mode or
	// issuer, of the document or of an entry, other than the trusted ones; two entries of one account, one identity or one
	// deletion; a negative count; or identity metadata without an attempt (a confirmation or failure time while the
	// attempts are 0). Nothing is read from or written to a database for it.
	ErrLedgerInvalid = errors.New("store: the deletion ledger is not a valid ledger of the trusted identity provider")
	// ErrLedgerTooLarge reports an export of a database that records more deletions than one ledger may carry. Nothing
	// is exported: a ledger is never truncated.
	ErrLedgerTooLarge = errors.New("store: the database records more deletions than one ledger may carry")
	// ErrLedgerForeignAccount reports an export of a database that records a deletion of an account of another auth mode
	// or issuer than the trusted ones: a ledger without it would silently leave that deletion unreplayed.
	ErrLedgerForeignAccount = errors.New("store: the database records a deletion of an account of another auth mode or issuer")
	// ErrLedgerConflict reports a ledger entry that contradicts the database: its account ID is another identity's
	// account, its identity is another account's, its account's recorded deletion is another deletion, or its deletion
	// ID is another account's. The whole replay is refused before anything is written.
	ErrLedgerConflict = errors.New("store: a ledger entry contradicts the database's accounts or deletion records")
	// ErrLedgerReplayFailed reports a replay that failed before COMMIT. Its transaction rolled back: nothing was erased
	// or recorded. It wraps the cause, whose class may be logged.
	ErrLedgerReplayFailed = errors.New("store: the ledger replay failed and was rolled back")
)

// The fixed reasons a ledger is refused for (ErrLedgerInvalid). None quotes the ledger.
const (
	faultTrusted  = "the trusted provider is not the local-supabase auth mode with an issuer of visible ASCII"
	faultUnread   = "the document could not be read"
	faultTooLarge = "the document is larger than a ledger may be"
	faultShape    = "the document is not one JSON object of exactly the documented members, at every level"
	faultTime     = "a time is not RFC 3339 in UTC as the ledger writes it"
	faultCount    = "a count is not an integer from 0 to the most its column holds"
	faultTooMany  = "the ledger carries more entries than a ledger may"
	faultFormat   = "the document is of another format"
	faultProvider = "the ledger or an entry belongs to another auth mode or issuer than the trusted ones"
	faultID       = "an account, subject or deletion ID is not a canonical lowercase UUID, or is the nil UUID"
	faultTwice    = "the ledger names one account, identity or deletion twice"
	faultIdentity = "an entry records an identity confirmation or failure without an attempt"
)

// The fixed reasons a ledger entry contradicts the database (ErrLedgerConflict). None quotes the entry.
const (
	conflictAccount  = "an entry's account ID is another identity's account, or an account of another auth mode"
	conflictIdentity = "an entry's identity is another account's"
	conflictRecord   = "an entry's account records another deletion"
	conflictDeletion = "an entry's deletion ID is another account's"
)

// LedgerAnchor is the identity provider a ledger belongs to: an account auth mode ("local-supabase") and the exact issuer
// of its tokens. It is configured explicitly by the operator and never derived from a ledger, a token or an email.
type LedgerAnchor struct {
	AuthMode string
	Issuer   string
}

// Ledger is a deletion ledger: every deletion one database recorded, at one snapshot, for one trusted provider.
type Ledger struct {
	// Format is LedgerFormat.
	Format string
	// ExportedAt is the time of the export's snapshot.
	ExportedAt time.Time
	// Anchor is the provider every entry belongs to.
	Anchor LedgerAnchor
	// Entries are the deletions, in account ID order on export.
	Entries []LedgerEntry
}

// LedgerEntry is one account deletion: the account's anchor (its ID, auth mode, issuer, provider subject and creation
// time, which the accounts row keeps after a deletion) and its deletion record (migration 0002). It holds no email,
// name, password, token or credential: the database has none.
type LedgerEntry struct {
	AccountID        string
	AuthMode         string
	Issuer           string
	Subject          string
	AccountCreatedAt time.Time
	DeletionID       string
	// RequestedAt is the time of the original erasure transaction.
	RequestedAt time.Time
	// The rows the original erasure removed: profiles, device links (profile_sources), events and imports.
	Profiles    int
	DeviceLinks int
	Events      int64
	Imports     int
	// The identity-provider step as recorded: the attempts, the first confirmation, and the latest failure.
	IdentityAttempts      int
	IdentityDeletedAt     *time.Time
	IdentityLastFailureAt *time.Time
}

// ReplayedDeletion is what a replay did for one ledger entry.
type ReplayedDeletion struct {
	AccountID  string
	DeletionID string
	// AnchorCreated reports that the database held no row of the account, so the replay created it exactly from the
	// entry: account ID, auth mode, issuer, subject and creation time.
	AnchorCreated bool
	// RecordCreated reports that the database held no deletion record of the account, so the replay wrote the entry's.
	RecordCreated bool
	// The rows of the account the replay erased: what the database held again, whatever its record said.
	Profiles    int
	DeviceLinks int
	Events      int64
	Imports     int
	// Deletion is the account's deletion record after the replay merged the entry into it.
	Deletion Deletion
}

// ReplayReport is a committed replay: one ReplayedDeletion per ledger entry, in account ID order.
type ReplayReport struct {
	Deletions []ReplayedDeletion
}

// ledgerDoc is the ledger document as EncodeDeletionLedger writes it: its members, and each entry's, in the documented
// order.
type ledgerDoc struct {
	Format     string           `json:"format"`
	ExportedAt string           `json:"exported_at"`
	AuthMode   string           `json:"auth_mode"`
	Issuer     string           `json:"issuer"`
	Deletions  []ledgerEntryDoc `json:"deletions"`
}

type ledgerEntryDoc struct {
	AccountID        string            `json:"account_id"`
	AuthMode         string            `json:"auth_mode"`
	Issuer           string            `json:"issuer"`
	Subject          string            `json:"subject"`
	AccountCreatedAt string            `json:"account_created_at"`
	DeletionID       string            `json:"deletion_id"`
	RequestedAt      string            `json:"requested_at"`
	Erased           ledgerErasedDoc   `json:"erased"`
	Identity         ledgerIdentityDoc `json:"identity"`
}

type ledgerErasedDoc struct {
	Profiles    int   `json:"profiles"`
	DeviceLinks int   `json:"device_links"`
	Events      int64 `json:"events"`
	Imports     int   `json:"imports"`
}

// ledgerIdentityDoc writes an unset time as null: the member is always there.
type ledgerIdentityDoc struct {
	Attempts      int     `json:"attempts"`
	DeletedAt     *string `json:"deleted_at"`
	LastFailureAt *string `json:"last_failure_at"`
}

// ExportDeletionLedger reads every recorded deletion, with its account's anchor, from one read-only REPEATABLE READ
// snapshot: it never writes, so a session whose every transaction is read-only can run it. Every deletion must belong
// to trusted (else ErrLedgerForeignAccount), and there may be at most MaxLedgerEntries (else ErrLedgerTooLarge); either
// refusal exports nothing. Entries are in account ID order, and ExportedAt is the snapshot's time. A trusted provider
// that is not a local-supabase issuer, or a recorded deletion that a ledger cannot carry (a subject that is not a
// canonical UUID, say), refuses the whole export with ErrLedgerInvalid.
func (s *Store) ExportDeletionLedger(ctx context.Context, trusted LedgerAnchor) (Ledger, error) {
	if !validAnchor(trusted) {
		return Ledger{}, invalidLedger(faultTrusted)
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return Ledger{}, fmt.Errorf("store: export the deletion ledger: %w", err)
	}
	defer tx.Rollback(ctx) // read only: nothing to commit
	l := Ledger{Format: LedgerFormat, Anchor: trusted}
	var recorded, foreign int
	if err := tx.QueryRow(ctx, `SELECT now(), count(*), count(*) FILTER (WHERE a.auth_mode <> $1 OR a.issuer <> $2)
		FROM account_deletions d JOIN accounts a ON a.account_id = d.account_id`, trusted.AuthMode, trusted.Issuer).
		Scan(&l.ExportedAt, &recorded, &foreign); err != nil {
		return Ledger{}, fmt.Errorf("store: export the deletion ledger: %w", err)
	}
	switch {
	case foreign > 0:
		return Ledger{}, ErrLedgerForeignAccount
	case recorded > MaxLedgerEntries:
		return Ledger{}, ErrLedgerTooLarge
	}
	// The snapshot still holds exactly the rows it counted; the limit bounds the read all the same.
	rows, err := tx.Query(ctx, `SELECT a.account_id::text, a.auth_mode, a.issuer, a.subject, a.created_at, d.deletion_id::text,
		d.requested_at, d.erased_profiles, d.erased_device_links, d.erased_events, d.erased_imports, d.identity_attempts,
		d.identity_deleted_at, d.identity_last_failure_at
		FROM account_deletions d JOIN accounts a ON a.account_id = d.account_id ORDER BY a.account_id LIMIT $1`, MaxLedgerEntries+1)
	if err != nil {
		return Ledger{}, fmt.Errorf("store: export the deletion ledger: %w", err)
	}
	l.Entries, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (LedgerEntry, error) {
		var e LedgerEntry
		err := row.Scan(&e.AccountID, &e.AuthMode, &e.Issuer, &e.Subject, &e.AccountCreatedAt, &e.DeletionID, &e.RequestedAt,
			&e.Profiles, &e.DeviceLinks, &e.Events, &e.Imports, &e.IdentityAttempts, &e.IdentityDeletedAt, &e.IdentityLastFailureAt)
		e.AccountCreatedAt, e.RequestedAt = e.AccountCreatedAt.UTC(), e.RequestedAt.UTC()
		e.IdentityDeletedAt, e.IdentityLastFailureAt = inUTC(e.IdentityDeletedAt), inUTC(e.IdentityLastFailureAt)
		return e, err
	})
	if err != nil {
		return Ledger{}, fmt.Errorf("store: export the deletion ledger: %w", err)
	}
	if len(l.Entries) > MaxLedgerEntries {
		return Ledger{}, ErrLedgerTooLarge
	}
	l.ExportedAt = l.ExportedAt.UTC()
	if fault := ledgerFault(l, trusted); fault != "" {
		return Ledger{}, fmt.Errorf("%w: the database records a deletion that a ledger cannot carry (%s)", ErrLedgerInvalid, fault)
	}
	return l, nil
}

// EncodeDeletionLedger writes l as its one JSON document: the members format, exported_at, auth_mode, issuer and
// deletions, and per entry account_id, auth_mode, issuer, subject, account_created_at, deletion_id, requested_at, erased
// (profiles, device_links, events, imports) and identity (attempts, deleted_at, last_failure_at; null when unset), in
// that order, every time as FormatTime renders it, and a final newline. DecodeDeletionLedger reads it back unchanged.
// A ledger that is not a valid ledger of its own anchor, or whose document would exceed MaxLedgerBytes, is refused with
// ErrLedgerInvalid and nothing is written.
func EncodeDeletionLedger(w io.Writer, l Ledger) error {
	if fault := ledgerFault(l, l.Anchor); fault != "" {
		return invalidLedger(fault)
	}
	doc := ledgerDoc{Format: l.Format, ExportedAt: FormatTime(l.ExportedAt), AuthMode: l.Anchor.AuthMode, Issuer: l.Anchor.Issuer,
		Deletions: make([]ledgerEntryDoc, 0, len(l.Entries))}
	for _, e := range l.Entries {
		erased := ledgerErasedDoc{Profiles: e.Profiles, DeviceLinks: e.DeviceLinks, Events: e.Events, Imports: e.Imports}
		identity := ledgerIdentityDoc{Attempts: e.IdentityAttempts, DeletedAt: formatOptional(e.IdentityDeletedAt),
			LastFailureAt: formatOptional(e.IdentityLastFailureAt)}
		doc.Deletions = append(doc.Deletions, ledgerEntryDoc{AccountID: e.AccountID, AuthMode: e.AuthMode, Issuer: e.Issuer,
			Subject: e.Subject, AccountCreatedAt: FormatTime(e.AccountCreatedAt), DeletionID: e.DeletionID,
			RequestedAt: FormatTime(e.RequestedAt), Erased: erased, Identity: identity})
	}
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(doc); err != nil {
		return fmt.Errorf("store: encode the deletion ledger: %w", err)
	}
	if buf.Len() > MaxLedgerBytes {
		return invalidLedger(faultTooLarge)
	}
	if _, err := w.Write(buf.Bytes()); err != nil {
		return fmt.Errorf("store: write the deletion ledger: %w", err)
	}
	return nil
}

// DecodeDeletionLedger reads one ledger document of at most MaxLedgerBytes from r and checks it strictly against
// trusted. Any refusal wraps ErrLedgerInvalid and quotes nothing of the document.
//
// The document must be valid UTF-8 and exactly one JSON object, with nothing after it but white space. Member names
// match exactly and case-sensitively, at every level, none missing, unknown or repeated. Counts are integers written as
// plain digits, within their columns' range. Times are strings exactly as FormatTime renders them: RFC 3339 in UTC.
func DecodeDeletionLedger(r io.Reader, trusted LedgerAnchor) (Ledger, error) {
	if !validAnchor(trusted) {
		return Ledger{}, invalidLedger(faultTrusted)
	}
	raw, err := io.ReadAll(io.LimitReader(r, MaxLedgerBytes+1))
	switch {
	case err != nil:
		return Ledger{}, invalidLedger(faultUnread)
	case len(raw) > MaxLedgerBytes:
		return Ledger{}, invalidLedger(faultTooLarge)
	}
	l, fault := parseLedger(raw)
	if fault == "" {
		fault = ledgerFault(l, trusted)
	}
	if fault != "" {
		return Ledger{}, invalidLedger(fault)
	}
	return l, nil
}

// ReplayDeletionLedger re-applies every deletion of l to this database, which may be a restore of an older snapshot.
//
// It first checks l against trusted as DecodeDeletionLedger does (ErrLedgerInvalid). Then, in one READ COMMITTED
// transaction, it takes each entry's locks in the order every writer of an account agrees on (EraseAccount): the
// account's advisory lock (accountLockKey), then the account row (FOR UPDATE), then every profile row of the account in
// profile_id order (FOR UPDATE); it never takes an account row before that account's advisory lock. It checks every
// entry's mapping before it erases anything: the account ID must be no other identity's account, the identity no other
// account's, a recorded deletion of the account the entry's own, and the entry's deletion ID no other account's;
// otherwise it refuses the whole replay with ErrLedgerConflict, having written nothing.
//
// For each entry it keeps the account row, or creates it exactly from the entry when the database has none, and erases
// the account's events, imports, device links and profiles, even when the database already records the deletion and
// its identity's confirmation: unlike EraseAccount, which returns early on a recorded deletion, a replay never trusts a
// tombstone to mean the data is gone. It writes the entry's deletion record where there is none, and otherwise merges
// it monotonically, so an older ledger never regresses a newer record: the erased counts and the identity attempts are
// the greater, the confirmation the earliest recorded and the last failure the latest; the recorded erasure time stays.
// No other account's row is read for writing or changed. A second replay of the same ledger erases nothing and changes
// no record. A ledger without entries changes nothing.
//
// A failure before COMMIT wraps ErrLedgerReplayFailed: nothing was erased or recorded. That includes an identity that a
// concurrent first sign-in gave an account after its mapping was checked: creating the entry's account row then fails,
// and running the replay again refuses the entry with ErrLedgerConflict. A failed COMMIT is returned as it is, because
// its outcome is unknown; running the replay again is safe.
func (s *Store) ReplayDeletionLedger(ctx context.Context, trusted LedgerAnchor, l Ledger) (ReplayReport, error) {
	if fault := ledgerFault(l, trusted); fault != "" {
		return ReplayReport{}, invalidLedger(fault)
	}
	if len(l.Entries) == 0 {
		return ReplayReport{}, nil
	}
	entries := slices.Clone(l.Entries)
	slices.SortFunc(entries, func(a, b LedgerEntry) int { return strings.Compare(a.AccountID, b.AccountID) })
	failed := func(err error) (ReplayReport, error) {
		return ReplayReport{}, fmt.Errorf("%w: %w", ErrLedgerReplayFailed, err)
	}
	// READ COMMITTED whatever the session's default: under REPEATABLE READ the snapshot would date from before a lock
	// wait, and the erasure would miss what the writer that held the lock committed.
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return failed(err)
	}
	defer tx.Rollback(ctx) // a no-op after Commit; it also ends a refused replay, which wrote nothing
	// Every mapping is checked, holding each account's advisory lock and row, before anything is written.
	held := make([]heldAccount, len(entries))
	for i, e := range entries {
		h, conflict, err := s.holdAccount(ctx, tx, e)
		switch {
		case err != nil:
			return failed(err)
		case conflict != "":
			return ReplayReport{}, fmt.Errorf("%w: %s", ErrLedgerConflict, conflict)
		}
		held[i] = h
	}
	report := ReplayReport{Deletions: make([]ReplayedDeletion, 0, len(entries))}
	for i, e := range entries {
		d, err := replayEntry(ctx, tx, e, held[i])
		if err != nil {
			return failed(err)
		}
		report.Deletions = append(report.Deletions, d)
	}
	if err := tx.Commit(ctx); err != nil {
		return ReplayReport{}, fmt.Errorf("store: commit the ledger replay: %w", err)
	}
	return report, nil
}

// heldAccount is what holdAccount found of an entry's account: whether its row and its deletion record exist.
type heldAccount struct{ anchored, recorded bool }

// holdAccount takes the entry's first two account locks in EraseAccount's order, the account's advisory lock and then
// its row, and checks the entry's mapping against the database: an account row of the entry's ID must be the entry's
// identity under its auth mode, the identity no other account's, a recorded deletion of the account the entry's own, and
// the entry's deletion ID no other account's. It writes nothing. It returns the fixed reason of a contradiction, if
// any.
func (s *Store) holdAccount(ctx context.Context, tx pgx.Tx, e LedgerEntry) (heldAccount, string, error) {
	var h heldAccount
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", accountLockKey(s.schema, e.AccountID)); err != nil {
		return h, "", err
	}
	var mode, issuer, subject string
	err := tx.QueryRow(ctx, `SELECT auth_mode, issuer, subject FROM accounts WHERE account_id = $1::uuid FOR UPDATE`, e.AccountID).
		Scan(&mode, &issuer, &subject)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
	case err != nil:
		return h, "", err
	case mode != e.AuthMode || issuer != e.Issuer || subject != e.Subject:
		return h, conflictAccount, nil
	default:
		h.anchored = true
	}
	// The identity is (issuer, subject), unique among accounts; the deletion ID is unique among records.
	var identityOwner, recordedDeletion, deletionOwner *string
	if err := tx.QueryRow(ctx, `SELECT (SELECT account_id::text FROM accounts WHERE issuer = $2 AND subject = $3),
		(SELECT deletion_id::text FROM account_deletions WHERE account_id = $1::uuid),
		(SELECT account_id::text FROM account_deletions WHERE deletion_id = $4::uuid)`,
		e.AccountID, e.Issuer, e.Subject, e.DeletionID).Scan(&identityOwner, &recordedDeletion, &deletionOwner); err != nil {
		return h, "", err
	}
	switch {
	case identityOwner != nil && *identityOwner != e.AccountID:
		return h, conflictIdentity, nil
	case recordedDeletion != nil && *recordedDeletion != e.DeletionID:
		return h, conflictRecord, nil
	case deletionOwner != nil && *deletionOwner != e.AccountID:
		return h, conflictDeletion, nil
	}
	h.recorded = recordedDeletion != nil
	return h, "", nil
}

// replayEntry re-applies one entry whose account holdAccount holds: it creates the account row exactly from the entry
// when there is none, takes the account's profile rows in profile_id order, erases the account's events, imports,
// device links and profiles whatever its record says, and writes the entry's deletion record or merges it into the
// recorded one.
func replayEntry(ctx context.Context, tx pgx.Tx, e LedgerEntry, h heldAccount) (ReplayedDeletion, error) {
	r := ReplayedDeletion{AccountID: e.AccountID, DeletionID: e.DeletionID, AnchorCreated: !h.anchored, RecordCreated: !h.recorded}
	if r.AnchorCreated {
		if _, err := tx.Exec(ctx, `INSERT INTO accounts (account_id, auth_mode, issuer, subject, created_at)
			VALUES ($1::uuid, $2, $3, $4, $5)`, e.AccountID, e.AuthMode, e.Issuer, e.Subject, e.AccountCreatedAt); err != nil {
			return ReplayedDeletion{}, err
		}
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM profiles WHERE account_id = $1::uuid ORDER BY profile_id FOR UPDATE`, e.AccountID); err != nil {
		return ReplayedDeletion{}, err
	}
	// Each statement reads after the locks above were granted, so it sees every row a writer that held one of them
	// committed.
	var profiles, links, imports int64
	for _, step := range []struct {
		sql     string
		deleted *int64
	}{
		{`DELETE FROM events WHERE profile_id IN (SELECT profile_id FROM profiles WHERE account_id = $1::uuid)`, &r.Events},
		{`DELETE FROM imports WHERE account_id = $1::uuid`, &imports},
		{`DELETE FROM profile_sources WHERE account_id = $1::uuid`, &links},
		{`DELETE FROM profiles WHERE account_id = $1::uuid`, &profiles},
	} {
		tag, err := tx.Exec(ctx, step.sql, e.AccountID)
		if err != nil {
			return ReplayedDeletion{}, err
		}
		*step.deleted = tag.RowsAffected()
	}
	r.Profiles, r.DeviceLinks, r.Imports = int(profiles), int(links), int(imports)
	var row pgx.Row
	if r.RecordCreated {
		row = tx.QueryRow(ctx, `INSERT INTO account_deletions (account_id, deletion_id, requested_at, erased_profiles,
			erased_device_links, erased_events, erased_imports, identity_attempts, identity_deleted_at, identity_last_failure_at)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING `+deletionColumns,
			e.AccountID, e.DeletionID, e.RequestedAt, e.Profiles, e.DeviceLinks, e.Events, e.Imports, e.IdentityAttempts,
			e.IdentityDeletedAt, e.IdentityLastFailureAt)
	} else {
		// greatest and least ignore NULL: an unset time never replaces a recorded one.
		row = tx.QueryRow(ctx, `UPDATE account_deletions SET erased_profiles = greatest(erased_profiles, $3),
			erased_device_links = greatest(erased_device_links, $4), erased_events = greatest(erased_events, $5),
			erased_imports = greatest(erased_imports, $6), identity_attempts = greatest(identity_attempts, $7),
			identity_deleted_at = least(identity_deleted_at, $8), identity_last_failure_at = greatest(identity_last_failure_at, $9)
			WHERE account_id = $1::uuid AND deletion_id = $2::uuid RETURNING `+deletionColumns,
			e.AccountID, e.DeletionID, e.Profiles, e.DeviceLinks, e.Events, e.Imports, e.IdentityAttempts, e.IdentityDeletedAt,
			e.IdentityLastFailureAt)
	}
	d, err := scanDeletion(row)
	if err != nil {
		return ReplayedDeletion{}, err
	}
	r.Deletion = d
	return r, nil
}

// ledgerFault returns the fixed reason l is not a valid ledger of trusted, or "" when it is one: the format, the
// provider of the document and of every entry, canonical IDs, each account, identity and deletion named once, the
// bounds and counts, and identity metadata only beside an attempt. It applies to a decoded and a built ledger alike.
func ledgerFault(l Ledger, trusted LedgerAnchor) string {
	switch {
	case !validAnchor(trusted):
		return faultTrusted
	case l.Format != LedgerFormat:
		return faultFormat
	case l.Anchor != trusted:
		return faultProvider
	case len(l.Entries) > MaxLedgerEntries:
		return faultTooMany
	}
	accounts := make(map[string]bool, len(l.Entries))
	subjects := make(map[string]bool, len(l.Entries))
	deletions := make(map[string]bool, len(l.Entries))
	for _, e := range l.Entries {
		counts := columnCount(e.Profiles) && columnCount(e.DeviceLinks) && e.Events >= 0 && columnCount(e.Imports) &&
			columnCount(e.IdentityAttempts)
		switch {
		case e.AuthMode != trusted.AuthMode || e.Issuer != trusted.Issuer:
			return faultProvider
		case !canonicalID(e.AccountID) || !canonicalID(e.Subject) || !canonicalID(e.DeletionID):
			return faultID
		case accounts[e.AccountID] || subjects[e.Subject] || deletions[e.DeletionID]:
			return faultTwice
		case !counts:
			return faultCount
		case e.IdentityAttempts == 0 && (e.IdentityDeletedAt != nil || e.IdentityLastFailureAt != nil):
			return faultIdentity
		}
		accounts[e.AccountID], subjects[e.Subject], deletions[e.DeletionID] = true, true, true
	}
	return ""
}

// validAnchor reports whether a is a provider a ledger can belong to: the local-supabase auth mode, and an issuer of 1
// to maxLedgerIssuerBytes bytes of visible ASCII, as package config takes AYA_SUPABASE_ISSUER.
func validAnchor(a LedgerAnchor) bool {
	if a.AuthMode != ledgerAuthMode || a.Issuer == "" || len(a.Issuer) > maxLedgerIssuerBytes {
		return false
	}
	for i := 0; i < len(a.Issuer); i++ {
		if c := a.Issuer[i]; c <= ' ' || c > '~' {
			return false
		}
	}
	return true
}

// canonicalID accepts a UUID written canonically, lowercase hex digits in 8-4-4-4-12 groups, other than the nil UUID:
// the form PostgreSQL renders a uuid in, and Auth its user IDs.
func canonicalID(s string) bool {
	if len(s) != len(nilLedgerID) || s == nilLedgerID {
		return false
	}
	for i := 0; i < len(s); i++ {
		switch c := s[i]; i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				return false
			}
		}
	}
	return true
}

// columnCount accepts a count an integer column of a deletion record holds: 0 to math.MaxInt32.
func columnCount(n int) bool {
	return n >= 0 && n <= math.MaxInt32
}

func invalidLedger(fault string) error {
	return fmt.Errorf("%w: %s", ErrLedgerInvalid, fault)
}

// formatOptional renders an optional time as FormatTime does; unset stays unset.
func formatOptional(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := FormatTime(*t)
	return &s
}

// inUTC is an optional time in UTC; unset stays unset.
func inUTC(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// parseLedger reads raw as one ledger document: valid UTF-8, a JSON object of exactly the documented members at every
// level, each value of its type, and nothing after it. It returns the fixed reason raw is not one; what the values
// mean, ledgerFault checks.
func parseLedger(raw []byte) (Ledger, string) {
	if !utf8.Valid(raw) {
		return Ledger{}, faultShape
	}
	var r ledgerReader
	top := r.object(raw, "format", "exported_at", "auth_mode", "issuer", "deletions")
	l := Ledger{Format: r.text(top["format"]), ExportedAt: r.timestamp(top["exported_at"]),
		Anchor: LedgerAnchor{AuthMode: r.text(top["auth_mode"]), Issuer: r.text(top["issuer"])}}
	for _, entry := range r.array(top["deletions"]) {
		m := r.object(entry, "account_id", "auth_mode", "issuer", "subject", "account_created_at", "deletion_id", "requested_at",
			"erased", "identity")
		erased := r.object(m["erased"], "profiles", "device_links", "events", "imports")
		identity := r.object(m["identity"], "attempts", "deleted_at", "last_failure_at")
		l.Entries = append(l.Entries, LedgerEntry{AccountID: r.text(m["account_id"]), AuthMode: r.text(m["auth_mode"]),
			Issuer: r.text(m["issuer"]), Subject: r.text(m["subject"]), AccountCreatedAt: r.timestamp(m["account_created_at"]),
			DeletionID: r.text(m["deletion_id"]), RequestedAt: r.timestamp(m["requested_at"]),
			Profiles: r.smallCount(erased["profiles"]), DeviceLinks: r.smallCount(erased["device_links"]),
			Events: r.count(erased["events"], math.MaxInt64), Imports: r.smallCount(erased["imports"]),
			IdentityAttempts: r.smallCount(identity["attempts"]), IdentityDeletedAt: r.optionalTimestamp(identity["deleted_at"]),
			IdentityLastFailureAt: r.optionalTimestamp(identity["last_failure_at"])})
	}
	if r.fault != "" {
		return Ledger{}, r.fault
	}
	return l, ""
}

// ledgerReader reads the values of a ledger document and keeps the first fault it meets; after one, every read returns
// the zero value.
type ledgerReader struct{ fault string }

// object reads raw as one JSON object of exactly the members names (jsonObject).
func (r *ledgerReader) object(raw []byte, names ...string) map[string]json.RawMessage {
	if r.fault != "" {
		return nil
	}
	m, ok := jsonObject(raw, names)
	if !ok {
		r.fault = faultShape
	}
	return m
}

// array reads raw as one JSON array of at most MaxLedgerEntries elements.
func (r *ledgerReader) array(raw []byte) []json.RawMessage {
	if r.fault != "" {
		return nil
	}
	elems, isArray, tooMany := jsonArray(raw, MaxLedgerEntries)
	switch {
	case tooMany:
		r.fault = faultTooMany
	case !isArray:
		r.fault = faultShape
	}
	return elems
}

// text reads raw as a JSON string.
func (r *ledgerReader) text(raw []byte) string {
	if r.fault != "" {
		return ""
	}
	s, ok := jsonText(raw)
	if !ok {
		r.fault = faultShape
	}
	return s
}

// timestamp reads raw as a JSON string holding a time exactly as FormatTime renders it: RFC 3339 in UTC.
func (r *ledgerReader) timestamp(raw []byte) time.Time {
	if r.fault != "" {
		return time.Time{}
	}
	s, ok := jsonText(raw)
	t, err := time.Parse(time.RFC3339Nano, s)
	if !ok || err != nil || FormatTime(t) != s {
		r.fault = faultTime
		return time.Time{}
	}
	return t.UTC()
}

// optionalTimestamp reads raw as null or a timestamp.
func (r *ledgerReader) optionalTimestamp(raw []byte) *time.Time {
	if r.fault != "" || string(raw) == "null" {
		return nil
	}
	t := r.timestamp(raw)
	return &t
}

// count reads raw as a JSON integer from 0 to limit, written as plain digits: no sign, fraction or exponent.
func (r *ledgerReader) count(raw []byte, limit int64) int64 {
	if r.fault != "" {
		return 0
	}
	ok := len(raw) > 0
	for _, c := range raw {
		ok = ok && c >= '0' && c <= '9'
	}
	n, err := strconv.ParseInt(string(raw), 10, 64)
	if !ok || err != nil || n > limit {
		r.fault = faultCount
		return 0
	}
	return n
}

// smallCount reads raw as a count of an integer column: 0 to math.MaxInt32.
func (r *ledgerReader) smallCount(raw []byte) int {
	return int(r.count(raw, math.MaxInt32))
}

// jsonObject splits raw, one JSON object with nothing after it but white space, into its members, keeping each value's
// exact bytes. The members must be exactly names, none repeated. Names are compared exactly, after unescaping:
// decoding into a struct would match "Subject" to "subject", and let a repeated member replace the first.
func jsonObject(raw []byte, names []string) (map[string]json.RawMessage, bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('{') {
		return nil, false
	}
	members := make(map[string]json.RawMessage, len(names))
	for dec.More() {
		tok, err := dec.Token()
		name, isName := tok.(string)
		if err != nil || !isName || !slices.Contains(names, name) {
			return nil, false
		}
		if _, repeated := members[name]; repeated {
			return nil, false
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false
		}
		members[name] = v
	}
	if tok, err := dec.Token(); err != nil || tok != json.Delim('}') {
		return nil, false
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, false // trailing data, a second document included
	}
	return members, len(members) == len(names)
}

// jsonArray splits raw, one JSON array, into its elements' exact bytes. isArray is false for anything else; tooMany
// reports more than limit elements, without reading the rest.
func jsonArray(raw []byte, limit int) (elems []json.RawMessage, isArray, tooMany bool) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if tok, err := dec.Token(); err != nil || tok != json.Delim('[') {
		return nil, false, false
	}
	for dec.More() {
		if len(elems) == limit {
			return nil, true, true
		}
		var v json.RawMessage
		if err := dec.Decode(&v); err != nil {
			return nil, false, false
		}
		elems = append(elems, v)
	}
	if tok, err := dec.Token(); err != nil || tok != json.Delim(']') {
		return nil, false, false
	}
	return elems, true, false
}

// jsonText reads raw as a JSON string. The document was checked to be UTF-8, so the decoder substitutes nothing but an
// escaped lone surrogate, which no value a ledger accepts can hold.
func jsonText(raw []byte) (string, bool) {
	if len(raw) == 0 || raw[0] != '"' {
		return "", false
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}
