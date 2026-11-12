package store

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

func TestPostgresLearnerErasureRemovesRowsAndPreventsReplay(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, learner := setup(t, s)
	if _, err := s.Append(ctx, owner, learner.ID, []string{event(9101)}); err != nil {
		t.Fatal(err)
	}
	foreign, err := s.Activate(ctx, "foreign-erasure-issuer", t.Name())
	if err != nil {
		t.Fatal(err)
	}
	request := "a1fe486e-4437-4edb-8236-6a14fbf1df27"
	if _, err = s.DeleteLearner(ctx, foreign, learner.ID, request); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign deletion", err)
	}
	receipt, err := s.DeleteLearner(ctx, owner, learner.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Scope != "learner" || receipt.LearnerID != learner.ID || receipt.RequestID != request || receipt.DeletionID == "" || receipt.CompletedAt.IsZero() {
		t.Fatalf("receipt: %#v", receipt)
	}
	again, err := s.DeleteLearner(ctx, owner, learner.ID, request)
	if err != nil || again != receipt {
		t.Fatalf("receipt replay: %#v %v", again, err)
	}
	for _, table := range []string{"answer_events", "sync_consents", "learners"} {
		key := "learner_id"
		if table == "learners" {
			key = "id"
		}
		var count int
		if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE "+key+"=$1", learner.ID).Scan(&count); err != nil || count != 0 {
			t.Fatalf("%s rows remain: %d %v", table, count, err)
		}
	}
	if _, err = s.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: learner.ClientLearnerID, Kind: "ADULT", Lang: "id", Synthetic: true}); !errors.Is(err, ErrDeleted) {
		t.Fatal("deleted identity recreated", err)
	}
	other, err := s.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: "new-explicit-profile", Kind: "ADULT", Lang: "id", Synthetic: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DeleteLearner(ctx, owner, other.ID, request); !errors.Is(err, ErrConflict) {
		t.Fatal("reused request deleted another target", err)
	}
	if _, err = s.Pull(ctx, owner, learner.ID, 0, 10); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted read", err)
	}
	if _, err = s.Append(ctx, owner, learner.ID, []string{event(9102)}); !errors.Is(err, ErrNotFound) {
		t.Fatal("deleted upload", err)
	}
	if _, err = s.CreateProfile(ctx, foreign, ProfileInput{ClientLearnerID: learner.ClientLearnerID, Kind: "ADULT", Lang: "id", Synthetic: true}); err != nil {
		t.Fatal("foreign owner's independent client identity was tombstoned", err)
	}
}

func TestPostgresLearnerErasureDoesNotImplicitlyDeleteChildren(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, adult := setup(t, s)
	child, err := s.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: "erasure-child", Kind: "ANAK", Lang: "en", CreatedBy: adult.ID, Synthetic: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.DeleteLearner(ctx, owner, adult.ID, "b1fe486e-4437-4edb-8236-6a14fbf1df27"); !errors.Is(err, ErrDependents) {
		t.Fatal("parent silently deleted children", err)
	}
	profiles, err := s.Profiles(ctx, owner)
	if err != nil || len(profiles) != 2 {
		t.Fatal("failed deletion changed profiles", profiles, err)
	}
	if _, err = s.DeleteLearner(ctx, owner, child.ID, "b2fe486e-4437-4edb-8236-6a14fbf1df27"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.DeleteLearner(ctx, owner, adult.ID, "b1fe486e-4437-4edb-8236-6a14fbf1df27"); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresLearnerErasureSerializesWithUploadAndCreation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, learner := setup(t, s)
	var wg sync.WaitGroup
	failures := make(chan error, 31)
	for n := 0; n < 30; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := s.Append(ctx, owner, learner.ID, []string{event(9200 + n)})
			if err != nil && !errors.Is(err, ErrNotFound) {
				failures <- err
			}
		}(n)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, err := s.DeleteLearner(ctx, owner, learner.ID, "c1fe486e-4437-4edb-8236-6a14fbf1df27")
		if err != nil {
			failures <- err
		}
	}()
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	var count int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM answer_events WHERE learner_id=$1`, learner.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("racing upload survived deletion", count, err)
	}
	for n := 0; n < 10; n++ {
		if _, err := s.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: learner.ClientLearnerID, Kind: "ADULT", Lang: "id", Synthetic: true}); !errors.Is(err, ErrDeleted) {
			t.Fatal("creation replay resurrected learner", err)
		}
	}
}

func TestPostgresLearnerErasureRestoresImmutableHistoryGuard(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, learner := setup(t, s)
	other, err := s.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: "other-erasure-history", Kind: "ADULT", Lang: "id", Synthetic: true})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Consent(ctx, owner, other.ID, true, "synthetic-sync-v1"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Append(ctx, owner, other.ID, []string{strings.Replace(event(9300), `"learner_id":"lrn-native"`, `"learner_id":"other-erasure-history"`, 1)}); err != nil {
		t.Fatal(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT * FROM erase_learner($1,$2,$3)`, owner, learner.ID, "d1fe486e-4437-4edb-8236-6a14fbf1df27"); err != nil {
		t.Fatal(err)
	}
	var flag string
	if err = tx.QueryRow(ctx, `SELECT current_setting('ayailmu.erasure_authorized',true)`).Scan(&flag); err != nil || flag == "on" {
		t.Fatal("authorization flag leaked", flag, err)
	}
	if _, err = tx.Exec(ctx, `DELETE FROM answer_events WHERE learner_id=$1`, other.ID); err == nil {
		t.Fatal("unrelated direct history deletion allowed")
	}
}

func TestPostgresLearnerErasureIgnoresTemporarySchemaShadows(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, learner := setup(t, s)
	if _, err := s.Append(ctx, owner, learner.ID, []string{event(9301)}); err != nil {
		t.Fatal(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `CREATE TEMP TABLE pg_class (oid oid,relowner oid); CREATE TEMP TABLE learners(id uuid); CREATE TEMP TABLE answer_events(id uuid); CREATE TEMP TABLE sync_consents(id uuid); CREATE TEMP TABLE server_deletions(id uuid)`); err != nil {
		t.Fatal(err)
	}
	var id string
	if err = tx.QueryRow(ctx, `SELECT deletion_id::text FROM public.erase_learner($1,$2,$3)`, owner, learner.ID, "d2fe486e-4437-4edb-8236-6a14fbf1df27").Scan(&id); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM public.learners WHERE id=$1`, learner.ID).Scan(&count); err != nil || count != 0 {
		t.Fatal("shadowed erasure", count, err)
	}
}
