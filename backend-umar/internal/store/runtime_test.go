package store

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
)

func TestRestrictedRuntimeLifecycleAndPermissions(t *testing.T) {
	admin := testStore(t)
	ctx := context.Background()
	role := fmt.Sprintf("umar_runtime_test_%d", time.Now().UnixNano())
	quoted := pgx.Identifier{role}.Sanitize()
	if _, err := admin.pool.Exec(ctx, "CREATE ROLE "+quoted+" NOLOGIN NOINHERIT"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// This unique NOLOGIN role exists only in the disposable test cluster/database.
		if _, err := admin.pool.Exec(ctx, "DROP OWNED BY "+quoted+"; DROP ROLE "+quoted); err != nil {
			t.Error("test role cleanup", err)
		}
	})
	grants, err := os.ReadFile("../../deploy/runtime-grants.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = admin.pool.Exec(ctx, strings.ReplaceAll(string(grants), `:"runtime_role"`, quoted)); err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(os.Getenv("UMAR_TEST_DATABASE_URL"))
	query := parsed.Query()
	query.Set("role", role)                    // Exercise privileges with a temporary NOLOGIN role; create no password.
	query.Set("search_path", "pg_temp,public") // Open must override this unsafe caller path.
	parsed.RawQuery = query.Encode()
	runtime, err := Open(ctx, parsed.String(), admin.registry)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(runtime.Close)
	var actualRole, path string
	if err = runtime.pool.QueryRow(ctx, "SELECT current_user,current_setting('search_path')").Scan(&actualRole, &path); err != nil || actualRole != role || path != "public, pg_temp" {
		t.Fatalf("runtime identity/search path: %q %q %v", actualRole, path, err)
	}
	if err = runtime.Prepare(ctx, false); err != nil {
		t.Fatal("read-only runtime startup", err)
	}
	if err = runtime.Prepare(ctx, true); err == nil {
		t.Fatal("runtime must not run migrations")
	}
	owner, learner := setup(t, runtime)
	if again, err := runtime.Activate(ctx, "test-issuer", t.Name()); err != nil || again != owner {
		t.Fatal("idempotent account activation", err)
	}
	// Concurrent idempotent activation/profile creation must work without any account UPDATE.
	var workers sync.WaitGroup
	results := make(chan string, 12)
	failures := make(chan error, 12)
	for range 12 {
		workers.Go(func() {
			id, err := runtime.Activate(ctx, "concurrent-test-issuer", t.Name())
			if err == nil {
				var p Profile
				p, err = runtime.CreateProfile(ctx, id, ProfileInput{ClientLearnerID: "concurrent-native", Kind: "ADULT", Lang: "id", Synthetic: true})
				results <- id + ":" + p.ID
			}
			failures <- err
		})
	}
	workers.Wait()
	close(results)
	close(failures)
	for err := range failures {
		if err != nil {
			t.Fatal("concurrent activation/profile replay", err)
		}
	}
	identities := map[string]bool{}
	for identity := range results {
		identities[identity] = true
	}
	if len(identities) != 1 {
		t.Fatalf("concurrent replay produced different identities: %v", identities)
	}
	child, err := runtime.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: "fabricated-child", Kind: "ANAK", Lang: "id", CreatedBy: learner.ID, Synthetic: true})
	if err != nil || child.CreatedBy != learner.ID {
		t.Fatal("same-owner guardian binding", err)
	}
	if _, err = runtime.Append(ctx, owner, learner.ID, []string{event(7001)}); err != nil {
		t.Fatal("append under restricted role", err)
	}
	if receipts, err := runtime.Append(ctx, owner, learner.ID, []string{event(7001)}); err != nil || !receipts[0].Duplicate {
		t.Fatal("replay under restricted role", err)
	}
	other, err := runtime.Activate(ctx, "other-issuer", t.Name())
	if err != nil || other == owner {
		t.Fatal("issuer must remain part of identity", err)
	}
	if _, err = runtime.Pull(ctx, other, learner.ID, 0, 10); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign owner could read history", err)
	}
	if err = runtime.Consent(ctx, owner, learner.ID, false, "synthetic-sync-v1"); err != nil {
		t.Fatal(err)
	}
	if _, err = runtime.Append(ctx, owner, learner.ID, []string{event(7002)}); !errors.Is(err, ErrConsent) {
		t.Fatal("withdrawal must stop uploads", err)
	}
	if err = runtime.Consent(ctx, owner, learner.ID, true, "synthetic-sync-v1"); err != nil {
		t.Fatal(err)
	}
	if page, err := runtime.Pull(ctx, owner, learner.ID, 0, 10); err != nil || len(page.Events) != 1 {
		t.Fatal("immutable history after regrant", err)
	}
	for _, statement := range []string{
		"CREATE TABLE public.runtime_cannot_create(id int)",
		"ALTER TABLE public.answer_events DISABLE TRIGGER immutable_answer",
		"DELETE FROM public.answer_events WHERE false",
		"TRUNCATE public.answer_events",
		"UPDATE public.answer_events SET payload=payload WHERE false",
		"UPDATE public.learners SET owner_id=owner_id WHERE false",
		"UPDATE public.accounts SET subject=subject WHERE false",
		"UPDATE public.accounts SET issuer=issuer WHERE false",
		"INSERT INTO public.schema_migrations(version,sha256) VALUES('forbidden',repeat('0',64))",
		"DELETE FROM public.pack_versions WHERE false",
		"SELECT recovery_hash FROM public.account_deletions",
		"UPDATE public.account_deletions SET identity_deleted_at=clock_timestamp() WHERE false",
		"UPDATE public.accounts SET erasure_requested_at=NULL WHERE false",
		"DELETE FROM public.account_deletions WHERE false",
	} {
		_, err = runtime.pool.Exec(ctx, statement)
		var denied *pgconn.PgError
		if !errors.As(err, &denied) || denied.Code != "42501" {
			t.Fatalf("expected permission denial for %s: %v", statement, err)
		}
	}
	// Only the narrow erasure function may delete; arbitrary SQL remains denied.
	if _, err = runtime.DeleteLearner(ctx, owner, learner.ID, "aafe486e-4437-4edb-8236-6a14fbf1df27"); !errors.Is(err, ErrDependents) {
		t.Fatal("runtime parent erasure bypassed dependents", err)
	}
	if _, err = runtime.DeleteLearner(ctx, owner, child.ID, "abfe486e-4437-4edb-8236-6a14fbf1df27"); err != nil {
		t.Fatal("runtime child erasure", err)
	}
	if _, err = runtime.DeleteLearner(ctx, owner, learner.ID, "aafe486e-4437-4edb-8236-6a14fbf1df27"); err != nil {
		t.Fatal("runtime erasure", err)
	}
	if _, err = runtime.CreateProfile(ctx, owner, ProfileInput{ClientLearnerID: learner.ClientLearnerID, Kind: "ADULT", Lang: "id", Synthetic: true}); !errors.Is(err, ErrDeleted) {
		t.Fatal("runtime resurrected erased learner", err)
	}
	if _, err = runtime.pool.Exec(ctx, `SET ayailmu.erasure_authorized='on'; DELETE FROM public.answer_events WHERE false`); err == nil {
		t.Fatal("caller-controlled erasure flag authorized direct DELETE")
	}
	// Account state also changes only through narrow functions, not runtime table writes.
	accountOwner, err := runtime.Activate(ctx, "runtime-erasure-issuer", t.Name(), true)
	if err != nil {
		t.Fatal(err)
	}
	requestID := "acfe486e-4437-4edb-8236-6a14fbf1df27"
	receipt, err := runtime.BeginAccountDeletion(ctx, accountOwner, "runtime-erasure-issuer", t.Name(), requestID, recoveryFixture)
	if err != nil {
		t.Fatal("restricted account erasure", err)
	}
	if _, err = runtime.pool.Exec(ctx, `INSERT INTO public.learners(owner_id,client_learner_id,kind,audience,lang,synthetic) VALUES($1,'forbidden-after-erasure','ADULT','adults','id',false)`, accountOwner); err == nil {
		t.Fatal("direct insert resurrected deleted account")
	}
	job, err := runtime.ClaimAccountDeletion(ctx, "runtime-erasure-issuer")
	if err != nil || job == nil || job.DeletionID != receipt.DeletionID {
		t.Fatal("restricted claim", job, err)
	}
	if err = runtime.FinishAccountDeletion(ctx, job.DeletionID, job.LeaseID, true); err != nil {
		t.Fatal("restricted finish", err)
	}
	if got, err := runtime.AccountDeletionStatus(ctx, requestID, recoveryFixture); err != nil || got.Status != "completed" {
		t.Fatal("restricted receipt", got, err)
	}
	// Inherited/excessive rights must be rejected instead of trusting the grant template alone.
	if _, err = admin.pool.Exec(ctx, "GRANT DELETE ON public.accounts TO "+quoted); err != nil {
		t.Fatal(err)
	}
	if err = runtime.Prepare(ctx, false); err == nil {
		t.Fatal("unsafe effective runtime privilege accepted")
	}
	if _, err = admin.pool.Exec(ctx, "REVOKE DELETE ON public.accounts FROM "+quoted+"; REVOKE INSERT ON public.sync_consents FROM "+quoted); err != nil {
		t.Fatal(err)
	}
	if err = runtime.Prepare(ctx, false); err == nil {
		t.Fatal("missing runtime privilege accepted")
	}
}

func TestSchemaVerificationRejectsUnexpectedVersionsAndProvenance(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	if err := s.VerifySchema(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, "INSERT INTO public.schema_migrations(version,sha256) VALUES('future-test',repeat('0',64))"); err != nil {
		t.Fatal(err)
	}
	defer s.pool.Exec(ctx, "DELETE FROM public.schema_migrations WHERE version='future-test'")
	if err := s.VerifySchema(ctx); err == nil {
		t.Fatal("newer database silently accepted")
	}
	if _, err := s.pool.Exec(ctx, "DELETE FROM public.schema_migrations WHERE version='future-test'"); err != nil {
		t.Fatal(err)
	}
	registry, _ := catalog.Load()
	registry.Packs[0].RulesVersion = "mismatched-test-rules"
	wrong := &Store{pool: s.pool, registry: registry}
	if err := wrong.VerifySchema(ctx); err == nil {
		t.Fatal("changed registry metadata silently accepted")
	}
	if err := s.Prepare(ctx, false); err == nil {
		t.Fatal("database owner accepted as a restricted runtime role")
	}
}
