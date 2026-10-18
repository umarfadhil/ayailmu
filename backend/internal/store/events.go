package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"ayailmu.local/backend/internal/envelope"
)

// Results of persisting one event.
const (
	ResultStored    = "stored"
	ResultIdentical = "identical"
	ResultConflict  = "conflict"
)

// ErrSourceNotLinked reports an event whose device profile is not linked to the profile.
var ErrSourceNotLinked = errors.New("store: an event's source is not linked to the profile")

// PendingEvent is a validated envelope with the clock flags computed when it was received.
type PendingEvent struct {
	Event      envelope.Event
	ClockFlags []string
}

// EventOutcome is what persisting one event did. For a stored or identical event every field describes
// the stored copy, which is the first one accepted; for a conflict, Seq and StoredSHA256 do.
type EventOutcome struct {
	Result           string
	Seq              int64
	ReceivedAt       time.Time
	StoredSHA256     [32]byte
	CurriculumStatus string
	ClockFlags       []string
}

// IngestInput is one profile's batch of validated events.
type IngestInput struct {
	AccountID string
	ProfileID string
	// Events are the batch's valid events, in request order.
	Events []PendingEvent
	// BeforeCommit is the test seam documented on server.Options; nil in production.
	BeforeCommit func(ctx context.Context)
}

// IngestResult has one outcome per event and the profile's high_seq after the batch.
type IngestResult struct {
	Outcomes []EventOutcome
	HighSeq  int64
}

// Ingest stores one batch in a transaction under the profile row lock. It returns ErrNotFound when the
// account does not own the profile, and ErrSourceNotLinked, writing nothing, when any event comes from
// a device profile not linked to it. An identical event keeps the stored copy, a conflicting one leaves
// it untouched, and only new events advance high_seq.
func (s *Store) Ingest(ctx context.Context, in IngestInput) (IngestResult, error) {
	if !validUUID(in.ProfileID) {
		return IngestResult{}, ErrNotFound
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return IngestResult{}, fmt.Errorf("store: ingest: %w", err)
	}
	defer tx.Rollback(ctx) // a no-op after Commit
	lock := " FOR UPDATE"
	if len(in.Events) == 0 {
		lock = "" // nothing to write, so no need to wait for the profile's writers
	}
	var highSeq int64
	var receivedAt time.Time
	err = tx.QueryRow(ctx, `SELECT high_seq, now() FROM profiles WHERE profile_id = $1::uuid AND account_id = $2::uuid`+lock,
		in.ProfileID, in.AccountID).Scan(&highSeq, &receivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return IngestResult{}, ErrNotFound
	}
	if err != nil {
		return IngestResult{}, fmt.Errorf("store: lock profile: %w", err)
	}
	if len(in.Events) == 0 {
		return IngestResult{HighSeq: highSeq}, nil
	}
	sources, err := profileSources(ctx, tx, in.AccountID, in.ProfileID)
	if err != nil {
		return IngestResult{}, err
	}
	linked := make(map[Source]bool, len(sources))
	for _, src := range sources {
		linked[src] = true
	}
	for _, pe := range in.Events {
		src := pe.Event.Source
		if !linked[Source{App: src.App, InstallID: src.InstallID, LocalProfileID: src.LocalProfileID}] {
			return IngestResult{}, ErrSourceNotLinked
		}
	}
	plan, err := planEvents(ctx, tx, in.ProfileID, highSeq, in.Events, receivedAt)
	if err != nil {
		return IngestResult{}, err
	}
	if err := insertPlanned(ctx, tx, in.ProfileID, in.Events, plan, receivedAt, nil); err != nil {
		return IngestResult{}, err
	}
	if in.BeforeCommit != nil {
		in.BeforeCommit(ctx)
	}
	if err := tx.Commit(ctx); err != nil {
		return IngestResult{}, fmt.Errorf("store: commit events: %w", err)
	}
	return IngestResult{Outcomes: plan.outcomes, HighSeq: plan.highSeq}, nil
}

// StoredEvent is an event as stored: the first accepted copy's envelope fields and exact payload text,
// with its receipt.
type StoredEvent struct {
	Seq              int64
	EventID          string
	Kind             string
	Schema           string
	SchemaVersion    int
	Curriculum       envelope.Curriculum
	CurriculumStatus string
	Source           envelope.Source
	Payload          []byte
	SemanticSHA256   [32]byte
	ClockFlags       []string
	OccurredAt       time.Time
	ReceivedAt       time.Time
}

// Page is one pull result.
type Page struct {
	Events    []StoredEvent
	NextAfter int64
	HighSeq   int64
	HasMore   bool
}

// Pull reads up to limit events after the cursor in sequence order, of one family or of every family
// when family is "", together with the profile's high_seq, from one snapshot. Unregistered events are
// included. NextAfter is the last returned sequence number, or after when none is returned.
func (s *Store) Pull(ctx context.Context, accountID, profileID string, after int64, limit int, family string) (Page, error) {
	var page Page
	err := s.snapshot(ctx, accountID, profileID, func(tx pgx.Tx, highSeq int64) error {
		rows, err := tx.Query(ctx, `SELECT `+storedEventColumns+` FROM events
			WHERE profile_id = $1::uuid AND seq > $2 AND ($3::text = '' OR family = $3::text) ORDER BY seq LIMIT $4`,
			profileID, after, family, limit+1)
		if err != nil {
			return fmt.Errorf("store: pull: %w", err)
		}
		events, err := scanStoredEvents(rows)
		if err != nil {
			return fmt.Errorf("store: pull: %w", err)
		}
		page = Page{Events: events, NextAfter: after, HighSeq: highSeq}
		if len(events) > limit {
			page.Events, page.HasMore = events[:limit], true
		}
		if n := len(page.Events); n > 0 {
			page.NextAfter = page.Events[n-1].Seq
		}
		return nil
	})
	return page, err
}

// FamilyEvents reads every event of one family in learning order, occurred_at and then event_id
// bytewise, with the profile's high_seq, from one snapshot.
func (s *Store) FamilyEvents(ctx context.Context, accountID, profileID, family string) ([]StoredEvent, int64, error) {
	var events []StoredEvent
	var asOfSeq int64
	err := s.snapshot(ctx, accountID, profileID, func(tx pgx.Tx, highSeq int64) error {
		rows, err := tx.Query(ctx, `SELECT `+storedEventColumns+` FROM events
			WHERE profile_id = $1::uuid AND family = $2 ORDER BY occurred_at, event_id`, profileID, family)
		if err != nil {
			return fmt.Errorf("store: read family events: %w", err)
		}
		events, err = scanStoredEvents(rows)
		if err != nil {
			return fmt.Errorf("store: read family events: %w", err)
		}
		asOfSeq = highSeq
		return nil
	})
	return events, asOfSeq, err
}

// snapshot reads the profile's high_seq and then runs read, both in one read-only REPEATABLE READ
// transaction, so they see one committed state; it never waits for writers. It returns ErrNotFound when
// the account does not own the profile.
func (s *Store) snapshot(ctx context.Context, accountID, profileID string, read func(tx pgx.Tx, highSeq int64) error) error {
	if !validUUID(profileID) {
		return ErrNotFound
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("store: read events: %w", err)
	}
	defer tx.Rollback(ctx) // read only: nothing to commit
	var highSeq int64
	err = tx.QueryRow(ctx, `SELECT high_seq FROM profiles WHERE profile_id = $1::uuid AND account_id = $2::uuid`,
		profileID, accountID).Scan(&highSeq)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("store: read events: %w", err)
	}
	return read(tx, highSeq)
}

const storedEventColumns = `seq, event_id, kind, record_schema, schema_version, family, track, content_version, rules_version,
	curriculum_status, source_app, source_install_id, source_app_version, source_local_profile_id, payload_raw, semantic_sha256,
	clock_flags, occurred_at, received_at`

func scanStoredEvents(rows pgx.Rows) ([]StoredEvent, error) {
	defer rows.Close()
	var events []StoredEvent
	for rows.Next() {
		var e StoredEvent
		var payload string
		var sum []byte
		if err := rows.Scan(&e.Seq, &e.EventID, &e.Kind, &e.Schema, &e.SchemaVersion, &e.Curriculum.Family, &e.Curriculum.Track,
			&e.Curriculum.ContentVersion, &e.Curriculum.RulesVersion, &e.CurriculumStatus, &e.Source.App, &e.Source.InstallID,
			&e.Source.AppVersion, &e.Source.LocalProfileID, &payload, &sum, &e.ClockFlags, &e.OccurredAt, &e.ReceivedAt); err != nil {
			return nil, err
		}
		e.Payload = []byte(payload)
		copy(e.SemanticSHA256[:], sum)
		e.ClockFlags = nonNil(e.ClockFlags)
		events = append(events, e)
	}
	return events, rows.Err()
}

// eventPlan classifies a profile's incoming events against what it already holds.
type eventPlan struct {
	outcomes  []EventOutcome // one per event, in input order
	inserts   []int          // indexes of the events to insert
	highSeq   int64          // the profile's high_seq after the inserts
	identical int
	conflicts int
}

// planEvents runs under the profile row lock the caller holds. An event whose ID the profile already
// holds, stored earlier or earlier in the same input, is identical when its semantic hash matches and a
// conflict otherwise; every other event gets the next sequence number. Because the lock serializes the
// profile's writers, sequence numbers are gapless and follow commit order.
func planEvents(ctx context.Context, tx pgx.Tx, profileID string, highSeq int64, events []PendingEvent, receivedAt time.Time) (eventPlan, error) {
	known, err := storedOutcomes(ctx, tx, profileID, events)
	if err != nil {
		return eventPlan{}, err
	}
	plan := eventPlan{outcomes: make([]EventOutcome, len(events)), highSeq: highSeq}
	for i, pe := range events {
		ev := pe.Event
		if prev, ok := known[ev.EventID]; ok {
			o := prev
			if prev.StoredSHA256 == ev.SemanticSHA256 {
				o.Result = ResultIdentical
				plan.identical++
			} else {
				o.Result = ResultConflict
				plan.conflicts++
			}
			plan.outcomes[i] = o
			continue
		}
		plan.highSeq++
		o := EventOutcome{Result: ResultStored, Seq: plan.highSeq, ReceivedAt: receivedAt, StoredSHA256: ev.SemanticSHA256,
			CurriculumStatus: ev.CurriculumStatus, ClockFlags: nonNil(pe.ClockFlags)}
		plan.outcomes[i] = o
		plan.inserts = append(plan.inserts, i)
		known[ev.EventID] = o
	}
	return plan, nil
}

// storedOutcomes returns the profile's stored copies of the events' IDs, keyed by event ID.
func storedOutcomes(ctx context.Context, tx pgx.Tx, profileID string, events []PendingEvent) (map[string]EventOutcome, error) {
	known := make(map[string]EventOutcome, len(events))
	if len(events) == 0 {
		return known, nil
	}
	ids := make([]string, len(events))
	for i, pe := range events {
		ids[i] = pe.Event.EventID
	}
	rows, err := tx.Query(ctx, `SELECT event_id, seq, semantic_sha256, received_at, curriculum_status, clock_flags
		FROM events WHERE profile_id = $1::uuid AND event_id = ANY($2)`, profileID, ids)
	if err != nil {
		return nil, fmt.Errorf("store: read stored events: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var sum []byte
		var o EventOutcome
		if err := rows.Scan(&id, &o.Seq, &sum, &o.ReceivedAt, &o.CurriculumStatus, &o.ClockFlags); err != nil {
			return nil, fmt.Errorf("store: read stored events: %w", err)
		}
		copy(o.StoredSHA256[:], sum)
		o.ClockFlags = nonNil(o.ClockFlags)
		known[id] = o
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: read stored events: %w", err)
	}
	return known, nil
}

const insertEvent = `INSERT INTO events (profile_id, seq, event_id, kind, record_schema, schema_version, family, track,
	content_version, rules_version, curriculum_status, occurred_at, local_date, clock_flags, payload_raw, semantic_sha256,
	source_app, source_install_id, source_app_version, source_local_profile_id, import_id, received_at)
	VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, $14, $15, $16, $17, $18, $19, $20, $21, $22)`

// insertPlanned writes the planned new events and the profile's new high_seq in one round trip. Each
// payload is stored as its exact received text; the source stored is the first accepted copy's.
func insertPlanned(ctx context.Context, tx pgx.Tx, profileID string, events []PendingEvent, plan eventPlan, receivedAt time.Time, importID *string) error {
	if len(plan.inserts) == 0 {
		return nil
	}
	b := &pgx.Batch{}
	for _, i := range plan.inserts {
		ev := events[i].Event
		b.Queue(insertEvent, profileID, plan.outcomes[i].Seq, ev.EventID, ev.Kind, ev.Schema, ev.SchemaVersion,
			ev.Curriculum.Family, ev.Curriculum.Track, ev.Curriculum.ContentVersion, ev.Curriculum.RulesVersion,
			ev.CurriculumStatus, ev.Facts.OccurredAt, ev.Facts.LocalDate, plan.outcomes[i].ClockFlags, string(ev.Payload),
			ev.SemanticSHA256[:], ev.Source.App, ev.Source.InstallID, ev.Source.AppVersion, ev.Source.LocalProfileID,
			importID, receivedAt)
	}
	b.Queue(`UPDATE profiles SET high_seq = $2 WHERE profile_id = $1::uuid`, profileID, plan.highSeq)
	br := tx.SendBatch(ctx, b)
	for range b.Len() {
		if _, err := br.Exec(); err != nil {
			br.Close()
			return fmt.Errorf("store: write events: %w", err)
		}
	}
	if err := br.Close(); err != nil {
		return fmt.Errorf("store: write events: %w", err)
	}
	return nil
}

// nonNil keeps an empty list an empty array: clock_flags is NOT NULL, and responses show [].
func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
