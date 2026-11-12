package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
)

const recoveryFixture = "8ef03b5802220e3509ea9cc6a5b9811b902ddcaee6040cb3e9b5346f9fbb7d43"

func TestPostgresAccountErasureIsAtomicDurableAndOwnerBound(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, adult := setup(t, s)
	child, err := s.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: "delete-all-child", Kind: "ANAK", Lang: "id", CreatedBy: adult.ID, Synthetic: true})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Append(ctx, owner, adult.ID, []string{event(9501)}); err != nil {
		t.Fatal(err)
	}
	foreign, err := s.Activate(ctx, "foreign-account-erasure", t.Name())
	if err != nil {
		t.Fatal(err)
	}
	request := "e1fe486e-4437-4edb-8236-6a14fbf1df27"
	if _, err = s.BeginAccountDeletion(ctx, owner, "foreign-account-erasure", t.Name(), request, recoveryFixture); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign identity", err)
	}
	for _, token := range []string{"", "short", strings.Repeat("0", 64), strings.ToUpper(recoveryFixture)} {
		if _, err = s.BeginAccountDeletion(ctx, owner, "test-issuer", t.Name(), request, token); !errors.Is(err, ErrInvalid) {
			t.Fatal("weak recovery proof accepted", err)
		}
	}
	receipt, err := s.BeginAccountDeletion(ctx, owner, "test-issuer", t.Name(), request, recoveryFixture)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Scope != "account" || receipt.Status != "identity_deletion_pending" || receipt.RequestID != request || receipt.AppDataErasedAt.IsZero() || receipt.IdentityDeletedAt != nil {
		t.Fatalf("receipt %#v", receipt)
	}
	for _, table := range []string{"answer_events", "sync_consents", "learners"} {
		column := "learner_id"
		if table == "learners" {
			column = "id"
		}
		var count int
		if err = s.pool.QueryRow(ctx, "SELECT count(*) FROM "+table+" WHERE "+column+" IN ($1,$2)", adult.ID, child.ID).Scan(&count); err != nil || count != 0 {
			t.Fatal(table, count, err)
		}
	}
	again, err := s.BeginAccountDeletion(ctx, owner, "test-issuer", t.Name(), request, recoveryFixture)
	if err != nil || again != receipt {
		t.Fatal("retry changed receipt", again, err)
	}
	if _, err = s.BeginAccountDeletion(ctx, owner, "test-issuer", t.Name(), request, strings.Repeat("a", 64)); !errors.Is(err, ErrConflict) {
		t.Fatal("recovery secret replaced", err)
	}
	if _, err = s.BeginAccountDeletion(ctx, owner, "test-issuer", t.Name(), "e2fe486e-4437-4edb-8236-6a14fbf1df27", recoveryFixture); !errors.Is(err, ErrConflict) {
		t.Fatal("duplicate account job", err)
	}
	if got, err := s.AccountDeletionStatus(ctx, request, recoveryFixture); err != nil || got != receipt {
		t.Fatal("status recovery", got, err)
	}
	for _, token := range []string{strings.Repeat("a", 64), "", strings.Repeat("0", 64)} {
		if _, err = s.AccountDeletionStatus(ctx, request, token); !errors.Is(err, ErrNotFound) {
			t.Fatal("invalid proof exposed status", err)
		}
	}
	if _, err = s.Account(ctx, "test-issuer", t.Name()); !errors.Is(err, ErrAccountDeleted) {
		t.Fatal("stale account access", err)
	}
	if _, err = s.Activate(ctx, "test-issuer", t.Name()); !errors.Is(err, ErrAccountDeleted) {
		t.Fatal("stale reactivation", err)
	}
	if _, err = s.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: "new-after-account-erasure", Kind: "ADULT", Lang: "id", Synthetic: true}); !errors.Is(err, ErrAccountDeleted) {
		t.Fatal("resurrection", err)
	}
	if _, err = s.CreateProfile(ctx, foreign, ProfileInput{ClientLearnerID: "independent-profile", Kind: "ADULT", Lang: "id", Synthetic: true}); err != nil {
		t.Fatal("foreign affected", err)
	}
}
func TestPostgresAccountDeletionLeaseRetryAndLateWorker(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, err := s.Activate(ctx, "lease-issuer", t.Name(), true)
	if err != nil {
		t.Fatal(err)
	}
	request := "e3fe486e-4437-4edb-8236-6a14fbf1df27"
	receipt, err := s.BeginAccountDeletion(ctx, owner, "lease-issuer", t.Name(), request, recoveryFixture)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.ClaimAccountDeletion(ctx, "lease-issuer")
	if err != nil || first == nil || first.DeletionID != receipt.DeletionID || first.Attempts != 1 {
		t.Fatal("claim", first, err)
	}
	if second, err := s.ClaimAccountDeletion(ctx, "lease-issuer"); err != nil || second != nil {
		t.Fatal("duplicate active lease", second, err)
	}
	if err = s.FinishAccountDeletion(ctx, first.DeletionID, first.LeaseID, false); err != nil {
		t.Fatal(err)
	}
	if got, err := s.AccountDeletionStatus(ctx, request, recoveryFixture); err != nil || got.Status != "identity_deletion_pending" {
		t.Fatal("failure claimed complete", got, err)
	}
	if second, err := s.ClaimAccountDeletion(ctx, "lease-issuer"); err != nil || second != nil {
		t.Fatal("backoff bypass", second, err)
	}
	// Advance only this disposable fixture's retry clock using its database owner.
	if _, err = s.pool.Exec(ctx, `UPDATE public.account_deletions SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE deletion_id=$1`, receipt.DeletionID); err != nil {
		t.Fatal(err)
	}
	second, err := s.ClaimAccountDeletion(ctx, "lease-issuer")
	if err != nil || second == nil || second.LeaseID == first.LeaseID || second.Attempts != 2 {
		t.Fatal("retry lease", second, err)
	}
	if err = s.FinishAccountDeletion(ctx, first.DeletionID, first.LeaseID, true); !errors.Is(err, ErrConflict) {
		t.Fatal("late worker changed new lease", err)
	}
	if err = s.FinishAccountDeletion(ctx, second.DeletionID, second.LeaseID, true); err != nil {
		t.Fatal(err)
	}
	if got, err := s.AccountDeletionStatus(ctx, request, recoveryFixture); err != nil || got.Status != "completed" || got.IdentityDeletedAt == nil {
		t.Fatal("completion", got, err)
	}
	if third, err := s.ClaimAccountDeletion(ctx, "lease-issuer"); err != nil || third != nil {
		t.Fatal("completed requeued", third, err)
	}
}
func TestPostgresAccountErasureSerializesCreatesAndUploads(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	owner, adult := setup(t, s)
	failures := make(chan error, 30)
	var wg sync.WaitGroup
	for n := 0; n < 12; n++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := s.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: fmt.Sprintf("account-racing-%d", n), Kind: "ADULT", Lang: "id", Synthetic: true})
			if err != nil && !errors.Is(err, ErrAccountDeleted) {
				failures <- err
			}
		}(n)
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			_, err := s.Append(ctx, owner, adult.ID, []string{event(9600 + n)})
			if err != nil && !errors.Is(err, ErrNotFound) {
				failures <- err
			}
		}(n)
	}
	_, err := s.BeginAccountDeletion(ctx, owner, "test-issuer", t.Name(), "e4fe486e-4437-4edb-8236-6a14fbf1df27", recoveryFixture)
	if err != nil {
		t.Fatal(err)
	}
	wg.Wait()
	close(failures)
	for err := range failures {
		t.Error(err)
	}
	var n int
	if err = s.pool.QueryRow(ctx, `SELECT count(*) FROM learners WHERE owner_id=$1`, owner).Scan(&n); err != nil || n != 0 {
		t.Fatal("racing learner survived", n, err)
	}
}

func TestPostgresAccountErasureCrashLeaseRecoveryAndConcurrentClaim(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	issuer := "crash-lease-issuer"
	owner, err := s.Activate(ctx, issuer, t.Name(), true)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := s.BeginAccountDeletion(ctx, owner, issuer, t.Name(), "e5fe486e-4437-4edb-8236-6a14fbf1df27", recoveryFixture)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	claimed := make(chan *AccountDeletionJob, 12)
	errs := make(chan error, 12)
	for n := 0; n < 12; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			job, err := s.ClaimAccountDeletion(ctx, issuer)
			if err != nil {
				errs <- err
			}
			if job != nil {
				claimed <- job
			}
		}()
	}
	wg.Wait()
	close(claimed)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if len(claimed) != 1 {
		t.Fatal("concurrent provider leases", len(claimed))
	}
	old := <-claimed
	// Simulate a process dying after provider deletion but before receipt persistence.
	if _, err = s.pool.Exec(ctx, `UPDATE public.account_deletions SET lease_until=clock_timestamp()-interval '1 second' WHERE deletion_id=$1`, receipt.DeletionID); err != nil {
		t.Fatal(err)
	}
	next, err := s.ClaimAccountDeletion(ctx, issuer)
	if err != nil || next == nil || next.LeaseID == old.LeaseID || next.Attempts != 2 {
		t.Fatal("crash recovery", next, err)
	}
	if err = s.FinishAccountDeletion(ctx, old.DeletionID, old.LeaseID, true); !errors.Is(err, ErrConflict) {
		t.Fatal("expired worker overwrote receipt", err)
	}
	if err = s.FinishAccountDeletion(ctx, next.DeletionID, next.LeaseID, true); err != nil {
		t.Fatal(err)
	}
}

func TestPostgresRecoveryProofCollisionRollsBackEveryDeletion(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	issuer := "collision-issuer"
	first, err := s.Activate(ctx, issuer, "first-"+t.Name())
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Activate(ctx, issuer, "second-"+t.Name())
	if err != nil {
		t.Fatal(err)
	}
	learner, err := s.CreateProfile(ctx, second, ProfileInput{ClientLearnerID: "collision-survivor", Kind: "ADULT", Lang: "id", Synthetic: true})
	if err != nil {
		t.Fatal(err)
	}
	request := "e6fe486e-4437-4edb-8236-6a14fbf1df27"
	if _, err = s.BeginAccountDeletion(ctx, first, issuer, "first-"+t.Name(), request, recoveryFixture); err != nil {
		t.Fatal(err)
	}
	if _, err = s.BeginAccountDeletion(ctx, second, issuer, "second-"+t.Name(), request, recoveryFixture); !errors.Is(err, ErrConflict) {
		t.Fatal("collision accepted", err)
	}
	if _, err = s.Account(ctx, issuer, "second-"+t.Name()); err != nil {
		t.Fatal("failed transaction tombstoned account", err)
	}
	if profiles, err := s.Profiles(ctx, second); err != nil || len(profiles) != 1 || profiles[0].ID != learner.ID {
		t.Fatal("failed transaction erased learner", profiles, err)
	}
}
