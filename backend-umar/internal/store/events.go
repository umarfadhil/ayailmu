package store

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
	"slices"
)

type Receipt struct {
	AnswerID       string `json:"answer_id"`
	Sequence       int64  `json:"sequence"`
	Duplicate      bool   `json:"duplicate"`
	RegistryStatus string `json:"registry_status"`
}
type Record struct {
	Sequence       int64  `json:"sequence"`
	Payload        string `json:"payload"`
	RegistryStatus string `json:"registry_status"`
}
type Page struct {
	Events     []Record `json:"events"`
	NextCursor int64    `json:"next_cursor"`
	HasMore    bool     `json:"has_more"`
}

func (s *Store) registration(e native.Event, p Profile) (string, error) {
	pack, ok := s.registry.Find(e.Track, e.ContentVersion)
	if !p.Synthetic && (!ok || pack.Synthetic || e.ReviewStatus != "approved") {
		return "", ErrInvalid
	}
	if !ok {
		return "unregistered", nil
	}
	if !slices.Contains(pack.Audiences, p.Audience) || !slices.Contains(pack.InstructionLangs, e.Lang) {
		return "", ErrInvalid
	}
	item, ok := pack.Items[e.ItemID]
	if !ok {
		if !p.Synthetic {
			return "", ErrInvalid
		}
		return "unregistered", nil
	}
	if item.Type != e.ItemType || item.Unit != e.Unit || item.Pool != e.Pool || item.ReviewStatus != e.ReviewStatus {
		return "", ErrInvalid
	}
	if pack.RulesVersion != e.RulesVersion {
		if !p.Synthetic {
			return "", ErrInvalid
		}
		return "unregistered", nil
	}
	return "registered", nil
}
func (s *Store) Append(ctx context.Context, owner, id string, payloads []string, requiredConsentVersion ...string) ([]Receipt, error) {
	if len(payloads) == 0 || len(payloads) > 100 {
		return nil, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	p, seq, err := owned(ctx, tx, owner, id)
	if err != nil {
		return nil, err
	}
	if err = consented(ctx, tx, p, requiredConsentVersion...); err != nil {
		return nil, err
	}
	out := make([]Receipt, 0, len(payloads))
	for _, payload := range payloads {
		e, err := native.ParseForMode([]byte(payload), p.Kind == "ANAK", p.Synthetic)
		if err != nil || e.LearnerID != p.ClientLearnerID {
			return nil, ErrInvalid
		}
		status, err := s.registration(e, p)
		if err != nil {
			return nil, err
		}
		sum := hash([]byte(payload))
		r := Receipt{AnswerID: e.AnswerID, RegistryStatus: status}
		var existingHash string
		var bytes []byte
		err = tx.QueryRow(ctx, `SELECT sequence,sha256,payload,registry_status FROM answer_events WHERE learner_id=$1 AND answer_id=$2`, id, e.AnswerID).Scan(&r.Sequence, &existingHash, &bytes, &r.RegistryStatus)
		if err == nil {
			if existingHash != sum || string(bytes) != payload {
				return nil, ErrConflict
			}
			r.Duplicate = true
			out = append(out, r)
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		seq++
		r.Sequence = seq
		if _, err = tx.Exec(ctx, `INSERT INTO answer_events(learner_id,sequence,answer_id,payload,sha256,registry_status) VALUES($1,$2,$3,$4,$5,$6)`, id, seq, e.AnswerID, []byte(payload), sum, status); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	if _, err = tx.Exec(ctx, `UPDATE learners SET next_sequence=$2 WHERE id=$1`, id, seq); err != nil {
		return nil, err
	}
	return out, tx.Commit(ctx)
}
func (s *Store) Pull(ctx context.Context, owner, id string, after int64, limit int, requiredConsentVersion ...string) (Page, error) {
	page := Page{Events: []Record{}, NextCursor: after}
	if after < 0 || limit < 1 || limit > 100 {
		return page, ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return page, err
	}
	defer tx.Rollback(ctx)
	profile, _, err := owned(ctx, tx, owner, id)
	if err != nil {
		return page, err
	}
	if err = consented(ctx, tx, profile, requiredConsentVersion...); err != nil {
		return page, err
	}
	rows, err := tx.Query(ctx, `SELECT sequence,payload,registry_status FROM answer_events WHERE learner_id=$1 AND sequence>$2 ORDER BY sequence LIMIT $3`, id, after, limit+1)
	if err != nil {
		return page, err
	}
	for rows.Next() {
		var r Record
		var b []byte
		if err = rows.Scan(&r.Sequence, &b, &r.RegistryStatus); err != nil {
			rows.Close()
			return page, err
		}
		r.Payload = string(b)
		page.Events = append(page.Events, r)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return page, err
	}
	if len(page.Events) > limit {
		page.HasMore = true
		page.Events = page.Events[:limit]
	}
	if len(page.Events) > 0 {
		page.NextCursor = page.Events[len(page.Events)-1].Sequence
	}
	return page, tx.Commit(ctx)
}
