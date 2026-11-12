package accounterase

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
	"os"
	"sync"
	"testing"
	"time"
)

const proof = "8ef03b5802220e3509ea9cc6a5b9811b902ddcaee6040cb3e9b5346f9fbb7d43"
const actor = "20000000-0000-0000-0000-000000000001"

type fixtureProvider struct {
	mu      sync.Mutex
	issuer  string
	calls   int
	failure bool
}

func (p *fixtureProvider) Issuer() string { return p.issuer }
func (p *fixtureProvider) DeleteIdentity(_ context.Context, issuer, subject string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.calls++
	if issuer != p.issuer || subject != actor {
		return errors.New("wrong fixture identity")
	}
	if p.failure {
		return errors.New("private provider detail")
	}
	return nil
}
func fixture(t *testing.T) (*store.Store, *Coordinator, *fixtureProvider, auth.Principal, Request) {
	t.Helper()
	database := os.Getenv("UMAR_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("isolated Postgres required")
	}
	registry, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	s, err := store.Open(context.Background(), database, registry)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	if err = s.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	p := &fixtureProvider{issuer: "https://" + t.Name() + ".invalid"}
	c, err := New(s, p)
	if err != nil {
		t.Fatal(err)
	}
	principal := auth.Principal{Issuer: p.issuer, Subject: actor, AuthTime: time.Now().Unix()}
	owner, err := s.Activate(context.Background(), p.issuer, actor, true)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(t.Name()))
	request := fmt.Sprintf("%x-%x-%x-%x-%x", sum[0:4], sum[4:6], sum[6:8], sum[8:10], sum[10:16])
	return s, c, p, principal, Request{AccountID: owner, RequestID: request, RecoveryToken: proof, Confirmed: true}
}
func TestCoordinatorDurablePendingBeforeProviderAndStatusAfterIdentityGone(t *testing.T) {
	s, c, p, principal, input := fixture(t)
	ctx := context.Background()
	receipt, err := c.Begin(ctx, principal, input)
	if err != nil || receipt.Status != "identity_deletion_pending" || p.calls != 0 {
		t.Fatal("begin must be durable only", receipt, err)
	}
	if _, err = s.Account(ctx, principal.Issuer, principal.Subject); !errors.Is(err, store.ErrAccountDeleted) {
		t.Fatal("old account usable", err)
	}
	// Process restart: only durable store state is needed to finish the provider step.
	c, err = New(s, p)
	if err != nil {
		t.Fatal(err)
	}
	worked, err := c.ProcessNext(ctx)
	if err != nil || !worked || p.calls != 1 {
		t.Fatal("provider step", worked, err)
	}
	got, err := c.Status(ctx, input.RequestID, proof)
	if err != nil || got.Status != "completed" || got.IdentityDeletedAt == nil || got.DeletionID != receipt.DeletionID {
		t.Fatal("proof-only status", got, err)
	}
	if _, err = c.Status(ctx, input.RequestID, "invalid"); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("bad proof status", err)
	}
	if worked, err = c.ProcessNext(ctx); err != nil || worked || p.calls != 1 {
		t.Fatal("duplicate provider deletion", worked, err)
	}
}
func TestCoordinatorFailureStaysPendingAndUnconfirmedActionsDoNothing(t *testing.T) {
	s, c, p, principal, input := fixture(t)
	ctx := context.Background()
	denied := input
	denied.Confirmed = false
	if _, err := c.Begin(ctx, principal, denied); !errors.Is(err, store.ErrInvalid) {
		t.Fatal("missing confirmation", err)
	}
	stale := principal
	stale.AuthTime -= 600
	if _, err := c.Begin(ctx, stale, input); !errors.Is(err, ErrFreshAuth) {
		t.Fatal("stale auth", err)
	}
	foreign := principal
	foreign.Subject = "20000000-0000-0000-0000-000000000002"
	if _, err := c.Begin(ctx, foreign, input); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("foreign owner", err)
	}
	if _, err := s.Account(ctx, principal.Issuer, principal.Subject); err != nil {
		t.Fatal("refusal altered account", err)
	}
	p.failure = true
	if _, err := c.Begin(ctx, principal, input); err != nil {
		t.Fatal(err)
	}
	if worked, err := c.ProcessNext(ctx); err != nil || !worked || p.calls != 1 {
		t.Fatal("retry scheduling", worked, err)
	}
	if got, err := c.Status(ctx, input.RequestID, proof); err != nil || got.Status != "identity_deletion_pending" || got.IdentityDeletedAt != nil {
		t.Fatal("failure claimed success", got, err)
	}
	if worked, err := c.ProcessNext(ctx); err != nil || worked || p.calls != 1 {
		t.Fatal("backoff not retained", worked, err)
	}
	if again, err := c.Begin(ctx, principal, input); err != nil || again.Status != "identity_deletion_pending" {
		t.Fatal("request replay", again, err)
	}
}
func TestCoordinatorRequiresConfiguredProvider(t *testing.T) {
	if _, err := New(nil, nil); !errors.Is(err, ErrUnavailable) {
		t.Fatal("unconfigured erasure accepted", err)
	}
}

func TestWorkerRetryDelayIsBoundedAndShutdownInterruptsWait(t *testing.T) {
	for n, want := range []time.Duration{5, 1, 2, 4, 8, 16, 30, 30} {
		if got := retryDelay(n); got != want*time.Second {
			t.Fatal(n, got)
		}
	}
	_, c, _, _, _ := fixture(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	start := time.Now()
	if err := c.Run(ctx); err != nil || time.Since(start) > time.Second {
		t.Fatal("cancelled worker", err)
	}
}

func TestWorkerRunCompletesDurableJobAndStopsWithoutNewActions(t *testing.T) {
	_, c, _, principal, input := fixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if _, err := c.Begin(ctx, principal, input); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- c.Run(ctx) }()
	for {
		receipt, err := c.Status(ctx, input.RequestID, proof)
		if err == nil && receipt.Status == "completed" {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("worker did not complete fixture job")
		case <-time.After(5 * time.Millisecond):
		}
	}
	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("worker did not stop")
	}
}
