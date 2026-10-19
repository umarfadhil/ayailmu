package store

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	// ErrImportIDReused reports an import ID the account already used for a different request.
	ErrImportIDReused = errors.New("store: import ID already used for a different request")
	// ErrSourceAlreadyLinked reports an explicit target other than the profile the source is linked to.
	ErrSourceAlreadyLinked = errors.New("store: source already linked to another profile")
)

// NewProfile is the adult profile an import creates: settings and consent, nothing identifying.
type NewProfile struct {
	Settings       Settings
	ConsentVersion string
	ConsentAt      time.Time
}

// ImportInput is a validated guest import. NewProfile nil means TargetProfileID names the target; an
// empty or malformed ID is then treated as a profile the account does not own.
type ImportInput struct {
	AccountID       string
	ImportID        string
	RequestSHA256   [32]byte
	Source          Source
	TargetProfileID string
	NewProfile      *NewProfile
	// Events are validated, in request order, and all come from Source.
	Events []PendingEvent
	// BeforeCommit is the test seam documented on server.Options; nil in production.
	BeforeCommit func(ctx context.Context)
}

// ImportReceipt is stored with the import and returned again for every replay of it.
type ImportReceipt struct {
	ImportID       string `json:"import_id"`
	ProfileID      string `json:"profile_id"`
	ProfileCreated bool   `json:"profile_created"`
	Replayed       bool   `json:"replayed"`
	Stored         int    `json:"stored"`
	Identical      int    `json:"identical"`
	HighSeq        int64  `json:"high_seq"`
	EventIDsSHA256 string `json:"event_ids_sha256"`
	CommittedAt    string `json:"committed_at"`
}

// ImportResult is a committed or replayed import or, when Conflicted, an import rolled back because an
// event conflicts with a stored one. Outcomes has one entry per event, except on replay.
type ImportResult struct {
	Receipt    ImportReceipt
	Outcomes   []EventOutcome
	Conflicted bool
}

// LookupImport finds the account's earlier import with this ID: its receipt when the request hash
// matches, ErrImportIDReused when it does not, found false when there is none. Import repeats the check
// under its lock, so a concurrent first attempt is still handled exactly once.
func (s *Store) LookupImport(ctx context.Context, accountID, importID string, requestSHA256 [32]byte) (ImportReceipt, bool, error) {
	return storedImport(ctx, s.pool, accountID, importID, requestSHA256)
}

// Import runs a guest import in one transaction, serialized per account by an advisory lock. The same
// import ID with the same request hash replays the stored receipt; with another hash it is
// ErrImportIDReused. The account's existing link of the source then wins, so a lost import ID cannot
// create a second profile. An explicit target must be the account's own profile (else ErrNotFound) and
// agree with that link (else ErrSourceAlreadyLinked); otherwise the import creates the new profile and
// links the source. Events are persisted under the profile row lock, and any conflict rolls back
// everything, the new profile and link included.
//
// An erasure takes the same advisory lock first, so it waits for an import holding the lock and erases
// what it committed; an import that got the lock after an erasure committed finds the deletion recorded
// and returns ErrAccountDeleted, writing nothing.
func (s *Store) Import(ctx context.Context, in ImportInput) (ImportResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ImportResult{}, fmt.Errorf("store: import: %w", err)
	}
	defer tx.Rollback(ctx) // a no-op after Commit
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", accountLockKey(s.schema, in.AccountID)); err != nil {
		return ImportResult{}, fmt.Errorf("store: import lock: %w", err)
	}
	if deleted, err := accountDeleted(ctx, tx, in.AccountID); err != nil || deleted {
		if err == nil {
			err = ErrAccountDeleted
		}
		return ImportResult{}, err
	}
	if receipt, found, err := storedImport(ctx, tx, in.AccountID, in.ImportID, in.RequestSHA256); err != nil || found {
		receipt.Replayed = found
		return ImportResult{Receipt: receipt}, err
	}
	profileID, created, err := resolveTarget(ctx, tx, in)
	if err != nil {
		return ImportResult{}, err
	}
	var highSeq int64
	var receivedAt time.Time
	if err := tx.QueryRow(ctx, `SELECT high_seq, now() FROM profiles WHERE profile_id = $1::uuid AND account_id = $2::uuid FOR UPDATE`,
		profileID, in.AccountID).Scan(&highSeq, &receivedAt); err != nil {
		return ImportResult{}, fmt.Errorf("store: lock profile: %w", err)
	}
	plan, err := planEvents(ctx, tx, profileID, highSeq, in.Events, receivedAt)
	if err != nil {
		return ImportResult{}, err
	}
	if plan.conflicts > 0 {
		return ImportResult{Outcomes: plan.outcomes, Conflicted: true}, nil
	}
	importID := in.ImportID
	if err := insertPlanned(ctx, tx, profileID, in.Events, plan, receivedAt, &importID); err != nil {
		return ImportResult{}, err
	}
	var committedAt time.Time
	if err := tx.QueryRow(ctx, "SELECT clock_timestamp()").Scan(&committedAt); err != nil {
		return ImportResult{}, fmt.Errorf("store: import: %w", err)
	}
	receipt := ImportReceipt{ImportID: in.ImportID, ProfileID: profileID, ProfileCreated: created, Stored: len(plan.inserts),
		Identical: plan.identical, HighSeq: plan.highSeq, EventIDsSHA256: eventIDsSHA256(in.Events), CommittedAt: FormatTime(committedAt)}
	text, err := json.Marshal(receipt)
	if err != nil {
		return ImportResult{}, fmt.Errorf("store: import receipt: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO imports (account_id, import_id, request_sha256, profile_id, receipt)
		VALUES ($1::uuid, $2, $3, $4::uuid, $5)`, in.AccountID, in.ImportID, in.RequestSHA256[:], profileID, string(text)); err != nil {
		return ImportResult{}, fmt.Errorf("store: record import: %w", err)
	}
	if in.BeforeCommit != nil {
		in.BeforeCommit(ctx)
	}
	if err := tx.Commit(ctx); err != nil {
		return ImportResult{}, fmt.Errorf("store: commit import: %w", err)
	}
	return ImportResult{Receipt: receipt, Outcomes: plan.outcomes}, nil
}

// storedImport returns the receipt of the account's earlier import with this ID and request hash.
func storedImport(ctx context.Context, q querier, accountID, importID string, requestSHA256 [32]byte) (ImportReceipt, bool, error) {
	var sum []byte
	var text string
	err := q.QueryRow(ctx, `SELECT request_sha256, receipt FROM imports WHERE account_id = $1::uuid AND import_id = $2`,
		accountID, importID).Scan(&sum, &text)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ImportReceipt{}, false, nil
	case err != nil:
		return ImportReceipt{}, false, fmt.Errorf("store: read import: %w", err)
	case !bytes.Equal(sum, requestSHA256[:]):
		return ImportReceipt{}, false, ErrImportIDReused
	}
	var receipt ImportReceipt
	if err := json.Unmarshal([]byte(text), &receipt); err != nil {
		return ImportReceipt{}, false, fmt.Errorf("store: read import receipt: %w", err)
	}
	return receipt, true, nil
}

// resolveTarget finds or creates the import's profile and links the source to it unless it was linked
// already. It reports whether it created the profile.
func resolveTarget(ctx context.Context, tx pgx.Tx, in ImportInput) (string, bool, error) {
	var linked string
	err := tx.QueryRow(ctx, `SELECT profile_id::text FROM profile_sources
		WHERE account_id = $1::uuid AND app = $2 AND install_id = $3 AND local_profile_id = $4`,
		in.AccountID, in.Source.App, in.Source.InstallID, in.Source.LocalProfileID).Scan(&linked)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", false, fmt.Errorf("store: read source link: %w", err)
	}
	profileID, created := linked, false
	switch {
	case in.NewProfile == nil:
		owned, err := ownsProfile(ctx, tx, in.AccountID, in.TargetProfileID)
		if err != nil {
			return "", false, err
		}
		if !owned {
			return "", false, ErrNotFound
		}
		target := strings.ToLower(in.TargetProfileID)
		if linked != "" && linked != target {
			return "", false, ErrSourceAlreadyLinked
		}
		profileID = target
	case linked != "":
		// A retry whose import ID was lost: the device keeps its profile, and the new-profile request is
		// not applied.
	default:
		np := in.NewProfile
		if err := tx.QueryRow(ctx, `INSERT INTO profiles (account_id, kind, instruction_lang, session_minutes, arabic_scale,
			consent_version, consent_at) VALUES ($1::uuid, 'adult', $2, $3, $4, $5, $6) RETURNING profile_id::text`,
			in.AccountID, np.Settings.InstructionLang, np.Settings.SessionMinutes, np.Settings.ArabicScale,
			np.ConsentVersion, np.ConsentAt).Scan(&profileID); err != nil {
			return "", false, fmt.Errorf("store: create profile: %w", err)
		}
		created = true
	}
	if linked == "" {
		if _, err := tx.Exec(ctx, `INSERT INTO profile_sources (account_id, profile_id, app, install_id, local_profile_id)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5)`, in.AccountID, profileID, in.Source.App, in.Source.InstallID,
			in.Source.LocalProfileID); err != nil {
			return "", false, fmt.Errorf("store: link source: %w", err)
		}
	}
	return profileID, created, nil
}

// eventIDsSHA256 is the receipt checksum: SHA-256 of every event ID the import carried, repeats
// included, sorted bytewise and joined by newlines, in lowercase hex.
func eventIDsSHA256(events []PendingEvent) string {
	ids := make([]string, len(events))
	for i, pe := range events {
		ids[i] = pe.Event.EventID
	}
	slices.Sort(ids)
	sum := sha256.Sum256([]byte(strings.Join(ids, "\n")))
	return hex.EncodeToString(sum[:])
}
