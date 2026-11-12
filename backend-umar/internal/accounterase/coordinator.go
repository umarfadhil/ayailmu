// Package accounterase coordinates durable app and provider account erasure.
package accounterase

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
)

var ErrUnavailable = errors.New("account erasure unavailable")
var ErrFreshAuth = errors.New("fresh authentication required")
var canonicalID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

func validID(s string) bool {
	return canonicalID.MatchString(s) && s != "00000000-0000-0000-0000-000000000000"
}

type Provider interface {
	Issuer() string
	DeleteIdentity(context.Context, string, string) error
}
type Request struct {
	AccountID     string `json:"account_id"`
	RequestID     string `json:"request_id"`
	RecoveryToken string `json:"recovery_token"`
	Confirmed     bool   `json:"confirmed"`
}

func (Request) String() string     { return "accounterase.Request{redacted}" }
func (r Request) GoString() string { return r.String() }

type Coordinator struct {
	s      *store.Store
	p      Provider
	issuer string
}

func New(s *store.Store, p Provider) (*Coordinator, error) {
	if s == nil || p == nil || p.Issuer() == "" {
		return nil, ErrUnavailable
	}
	return &Coordinator{s: s, p: p, issuer: p.Issuer()}, nil
}

// Begin makes no provider request. It atomically erases app data and records the job
// before returning pending. The native caller must persist its recovery proof first.
func (c *Coordinator) Begin(ctx context.Context, principal auth.Principal, in Request) (store.AccountDeletionStatus, error) {
	if c == nil || c.s == nil || c.p == nil {
		return store.AccountDeletionStatus{}, ErrUnavailable
	}
	if !in.Confirmed || !validID(in.AccountID) || !validID(in.RequestID) || !store.ValidRecoveryProof(in.RecoveryToken) {
		return store.AccountDeletionStatus{}, store.ErrInvalid
	}
	if principal.Issuer != c.issuer || !validID(principal.Subject) {
		return store.AccountDeletionStatus{}, store.ErrNotFound
	}
	if !principal.Fresh(time.Now()) {
		return store.AccountDeletionStatus{}, ErrFreshAuth
	}
	account, err := c.s.AccountForErasure(ctx, principal.Issuer, principal.Subject)
	if errors.Is(err, store.ErrAccount) {
		return store.AccountDeletionStatus{}, store.ErrNotFound
	}
	if err != nil {
		return store.AccountDeletionStatus{}, err
	}
	if account.ID != in.AccountID || account.Synthetic {
		return store.AccountDeletionStatus{}, store.ErrNotFound
	}
	return c.s.BeginAccountDeletion(ctx, account.ID, principal.Issuer, principal.Subject, in.RequestID, in.RecoveryToken)
}

// Status uses only a proof for this one receipt. It cannot create/advance a job, read
// personal content, sign in or regain access to a deleted account.
func (c *Coordinator) Status(ctx context.Context, request, proof string) (store.AccountDeletionStatus, error) {
	if c == nil || c.s == nil {
		return store.AccountDeletionStatus{}, ErrUnavailable
	}
	return c.s.AccountDeletionStatus(ctx, request, proof)
}

// ProcessNext leases one due normal-account job for this exact provider issuer. A
// process crash or lost provider response leaves a durable retry, never completion.
func (c *Coordinator) ProcessNext(ctx context.Context) (bool, error) {
	if c == nil || c.s == nil || c.p == nil || ctx.Err() != nil {
		return false, ErrUnavailable
	}
	job, err := c.s.ClaimAccountDeletion(ctx, c.issuer)
	if err != nil {
		return false, ErrUnavailable
	}
	if job == nil {
		return false, nil
	}
	providerContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	confirmed := false
	if job.Issuer == c.issuer && validID(job.Subject) {
		confirmed = c.p.DeleteIdentity(providerContext, job.Issuer, job.Subject) == nil
	}
	cancel()
	// Persist a known outcome even if the initiating process context was cancelled.
	// No additional provider action occurs here, and the write is independently bounded.
	saveContext, saveCancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer saveCancel()
	if c.s.FinishAccountDeletion(saveContext, job.DeletionID, job.LeaseID, confirmed) != nil {
		return true, ErrUnavailable
	}
	return true, nil
}

// Run is started only by an explicitly configured runtime. Work survives shutdown in
// Postgres; failures remain pending with bounded exponential backoff and lease recovery.
func retryDelay(failures int) time.Duration {
	if failures < 1 {
		return 5 * time.Second
	}
	if failures > 5 {
		return 30 * time.Second
	}
	return time.Second * time.Duration(1<<uint(failures-1))
}
func (c *Coordinator) Run(ctx context.Context) error {
	if c == nil || c.s == nil || c.p == nil {
		return ErrUnavailable
	}
	failures := 0
	for {
		if ctx.Err() != nil {
			return nil
		}
		worked, err := c.ProcessNext(ctx)
		if err != nil {
			if failures < 6 {
				failures++
			}
		} else {
			failures = 0
		}
		if worked && err == nil {
			continue
		}
		// A transient database outage cannot silently strand durable Auth erasure jobs.
		timer := time.NewTimer(retryDelay(failures))
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil
		case <-timer.C:
		}
	}
}
