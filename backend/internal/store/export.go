package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// exportPageRows bounds each read of an export. Every kind of row is read in key order, one page at a
// time, from the export's one snapshot, and each row is handed on as it arrives: an export never loads
// every row first, and one that stops early leaves at most the rest of a page unread.
const exportPageRows = 64

// noProfileID is below every generated profile ID, so the first page of profiles starts after it.
const noProfileID = "00000000-0000-0000-0000-000000000000"

// ExportedAccount is the account row.
type ExportedAccount struct {
	AccountID string
	AuthMode  string
	Issuer    string
	Subject   string
	CreatedAt time.Time
}

// ExportedProfile is one profile row: every column but the account ID.
type ExportedProfile struct {
	ProfileID      string
	Kind           string
	Revision       int64
	HighSeq        int64
	Settings       Settings
	ConsentVersion string
	ConsentAt      time.Time
	CreatedAt      time.Time
}

// ExportedSource is one device link of a profile.
type ExportedSource struct {
	Source
	LinkedAt time.Time
}

// ExportedImport is one import record of a profile, with its receipt text exactly as stored.
type ExportedImport struct {
	ImportID      string
	RequestSHA256 [32]byte
	Receipt       []byte
	CreatedAt     time.Time
}

// ExportedEvent is one stored event with the columns pull leaves out.
type ExportedEvent struct {
	StoredEvent
	LocalDate time.Time
	ImportID  *string
}

// Export reads one account's rows from one read-only REPEATABLE READ snapshot. Its methods read one
// kind of row in key order and hand each row to each. An error from each stops the reading and is
// returned as it is. Sources, Imports and Events call each while their page is still being read, so
// each must not use the export itself.
type Export struct {
	tx pgx.Tx
	// At is the time of the snapshot's transaction.
	At      time.Time
	Account ExportedAccount
}

// ExportAccount opens the snapshot, reads the account row and hands the export to write, which reads
// the rest. It returns ErrAccountDeleted, reading nothing more, when the snapshot holds the account's
// deletion.
func (s *Store) ExportAccount(ctx context.Context, accountID string, write func(*Export) error) error {
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("store: export: %w", err)
	}
	defer tx.Rollback(ctx) // read only: nothing to commit
	x := &Export{tx: tx}
	a := &x.Account
	var deleted bool
	if err := tx.QueryRow(ctx, `SELECT a.account_id::text, a.auth_mode, a.issuer, a.subject, a.created_at, now(),
		EXISTS (SELECT 1 FROM account_deletions d WHERE d.account_id = a.account_id)
		FROM accounts a WHERE a.account_id = $1::uuid`, accountID).
		Scan(&a.AccountID, &a.AuthMode, &a.Issuer, &a.Subject, &a.CreatedAt, &x.At, &deleted); err != nil {
		return fmt.Errorf("store: export account: %w", err)
	}
	if deleted {
		return ErrAccountDeleted
	}
	return write(x)
}

// Profiles hands each profile of the account to each, in profile_id order. A page of profiles is read
// whole before each sees it, because each reads the profile's own rows with further queries.
func (x *Export) Profiles(ctx context.Context, each func(ExportedProfile) error) error {
	after := noProfileID
	for {
		page, err := x.profilePage(ctx, after)
		if err != nil {
			return err
		}
		for _, p := range page {
			if err := each(p); err != nil {
				return err
			}
		}
		if len(page) < exportPageRows {
			return nil
		}
		after = page[len(page)-1].ProfileID
	}
}

func (x *Export) profilePage(ctx context.Context, after string) ([]ExportedProfile, error) {
	rows, err := x.tx.Query(ctx, `SELECT profile_id::text, kind, revision, high_seq, instruction_lang, session_minutes,
		arabic_scale, consent_version, consent_at, created_at FROM profiles
		WHERE account_id = $1::uuid AND profile_id > $2::uuid ORDER BY profile_id LIMIT $3`, x.Account.AccountID, after, exportPageRows)
	if err != nil {
		return nil, fmt.Errorf("store: export profiles: %w", err)
	}
	defer rows.Close()
	var page []ExportedProfile
	for rows.Next() {
		var p ExportedProfile
		if err := rows.Scan(&p.ProfileID, &p.Kind, &p.Revision, &p.HighSeq, &p.Settings.InstructionLang, &p.Settings.SessionMinutes,
			&p.Settings.ArabicScale, &p.ConsentVersion, &p.ConsentAt, &p.CreatedAt); err != nil {
			return nil, fmt.Errorf("store: export profiles: %w", err)
		}
		page = append(page, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: export profiles: %w", err)
	}
	return page, nil
}

// Sources hands each device link of the profile to each, in (app, install_id, local_profile_id) order.
func (x *Export) Sources(ctx context.Context, profileID string, each func(ExportedSource) error) error {
	return readPages(Source{}, func(after Source) (pgx.Rows, error) {
		rows, err := x.tx.Query(ctx, `SELECT app, install_id, local_profile_id, linked_at FROM profile_sources
			WHERE account_id = $1::uuid AND profile_id = $2::uuid
			AND (app, install_id, local_profile_id) > ($3::text, $4::text, $5::text)
			ORDER BY app, install_id, local_profile_id LIMIT $6`,
			x.Account.AccountID, profileID, after.App, after.InstallID, after.LocalProfileID, exportPageRows)
		if err != nil {
			return nil, fmt.Errorf("store: export sources: %w", err)
		}
		return rows, nil
	}, func(rows pgx.Rows) (Source, error) {
		var src ExportedSource
		if err := rows.Scan(&src.App, &src.InstallID, &src.LocalProfileID, &src.LinkedAt); err != nil {
			return Source{}, fmt.Errorf("store: export sources: %w", err)
		}
		return src.Source, each(src)
	})
}

// Imports hands each import record of the profile to each, in import_id order.
func (x *Export) Imports(ctx context.Context, profileID string, each func(ExportedImport) error) error {
	return readPages("", func(after string) (pgx.Rows, error) {
		rows, err := x.tx.Query(ctx, `SELECT import_id, request_sha256, receipt, created_at FROM imports
			WHERE account_id = $1::uuid AND profile_id = $2::uuid AND import_id > $3 ORDER BY import_id LIMIT $4`,
			x.Account.AccountID, profileID, after, exportPageRows)
		if err != nil {
			return nil, fmt.Errorf("store: export imports: %w", err)
		}
		return rows, nil
	}, func(rows pgx.Rows) (string, error) {
		var imp ExportedImport
		var sum []byte
		var receipt string
		if err := rows.Scan(&imp.ImportID, &sum, &receipt, &imp.CreatedAt); err != nil {
			return "", fmt.Errorf("store: export imports: %w", err)
		}
		copy(imp.RequestSHA256[:], sum)
		imp.Receipt = []byte(receipt)
		return imp.ImportID, each(imp)
	})
}

// Events hands each event of the profile to each, in seq order, with its exact payload text.
func (x *Export) Events(ctx context.Context, profileID string, each func(ExportedEvent) error) error {
	return readPages(int64(0), func(after int64) (pgx.Rows, error) {
		rows, err := x.tx.Query(ctx, `SELECT `+storedEventColumns+`, local_date, import_id FROM events
			WHERE profile_id = $1::uuid AND seq > $2 ORDER BY seq LIMIT $3`, profileID, after, exportPageRows)
		if err != nil {
			return nil, fmt.Errorf("store: export events: %w", err)
		}
		return rows, nil
	}, func(rows pgx.Rows) (int64, error) {
		var e ExportedEvent
		var err error
		if e.StoredEvent, err = scanStoredEvent(rows, &e.LocalDate, &e.ImportID); err != nil {
			return 0, fmt.Errorf("store: export events: %w", err)
		}
		return e.Seq, each(e)
	})
}

// readPages reads rows a page at a time: query returns the page after a key, and row scans one row,
// hands it on and returns its key. It stops after a short page or at the first error.
func readPages[K any](first K, query func(after K) (pgx.Rows, error), row func(pgx.Rows) (K, error)) error {
	after := first
	for {
		rows, err := query(after)
		if err != nil {
			return err
		}
		n := 0
		for rows.Next() {
			key, err := row(rows)
			if err != nil {
				rows.Close()
				return err
			}
			after = key
			n++
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("store: export: %w", err)
		}
		if n < exportPageRows {
			return nil
		}
	}
}
