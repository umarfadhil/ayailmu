package generalingress

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProviderManagedMailDoesNotRequireAccountingState(t *testing.T) {
	c, old, _, transport, clock := runtimeAdapterFixture(t)
	c.Policy.MailEnabled = true
	p, _, err := runtimeAdapters(c, clock, transport, old.reader, nil, nil, nil)
	if err != nil {
		t.Fatalf("ordinary mail still requires a dedicated key/journal: %v", err)
	}
	if err := p.Mail(context.Background(), MailRequest{Action: "signup", Email: "first@example.invalid", Password: "synthetic-password-123", RequestID: "ordinary-mail-one", Peer: "192.0.2.1"}); err != nil {
		t.Fatalf("valid ordinary signup did not reach the provider: %v", err)
	}
}

func ordinaryMailFixture(t *testing.T, capacity int) (RuntimeConfig, *HTTPProvider, *HTTPBackend, *roundTripDouble, *testClock) {
	t.Helper()
	c, prior, _, transport, clock := runtimeAdapterFixture(t)
	c.Policy.MailEnabled = true
	c.Policy.MailGlobal = 0 // provider, not proxy RAM, owns the aggregate allowance
	c.Policy.MailRecipientHour, c.Policy.MailIPHour = 100, 100
	c.Policy.MailCooldown = time.Second
	c.Policy.MaxState = capacity
	p, b, err := runtimeAdapters(c, clock, transport, prior.reader, nil, nil, nil)
	if err != nil {
		t.Fatalf("ordinary mail composition: %v", err)
	}
	return c, p, b, transport, clock
}

func mailInput(id string) MailRequest {
	return MailRequest{Action: "recover", Email: "first@example.invalid", RequestID: id, Peer: "192.0.2.1"}
}

func TestProviderMailOutcomeClassification(t *testing.T) {
	for _, tc := range []struct {
		name     string
		upstream int
		network  bool
		want     int
		code     string
	}{
		{"success", 200, false, 202, "confirmation_or_recovery_requested"},
		{"explicit throttle", 429, false, 429, "retry_later"},
		{"invalid request", 400, false, 400, "invalid_request"},
		{"rejected authentication", 401, false, 401, "unauthorized"},
		{"response lost", 0, true, 503, "mail_outcome_unknown"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, p, b, transport, clock := ordinaryMailFixture(t, 20)
			original := transport.call
			transport.call = func(q *http.Request) (*http.Response, error) {
				if tc.network {
					return nil, errors.New("synthetic connection outcome unknown")
				}
				r, e := original(q)
				r.StatusCode = tc.upstream
				r.Body = io.NopCloser(strings.NewReader(`{"error_code":"invalid_request"}`))
				return r, e
			}
			e, err := NewRuntime(c, clock, p, p, b)
			if err != nil {
				t.Fatal(err)
			}
			r := e.Handle(context.Background(), req("POST", "/recover", `{"email":"first@example.invalid"}`))
			if r.Status != tc.want || r.Code != tc.code {
				t.Fatalf("got %d/%s, want %d/%s", r.Status, r.Code, tc.want, tc.code)
			}
		})
	}
}

func TestProviderRetryAfterIsBoundedAndNeverReflectsRawHeaders(t *testing.T) {
	for _, tc := range []struct{ header, want string }{{"120", "120"}, {"3600", "3600"}, {"0", "60"}, {"-1", "60"}, {"3601", "60"}, {"tomorrow/private-value", "60"}, {"99999999999999999999999", "60"}} {
		t.Run(tc.header, func(t *testing.T) {
			c, p, b, transport, clock := runtimeAdapterFixture(t)
			original := transport.call
			transport.call = func(q *http.Request) (*http.Response, error) {
				r, e := original(q)
				r.StatusCode = 429
				r.Header.Set("Retry-After", tc.header)
				return r, e
			}
			e, err := NewRuntime(c, clock, p, p, b)
			if err != nil {
				t.Fatal(err)
			}
			h, err := NewRuntimeHandler(c, e)
			if err != nil {
				t.Fatal(err)
			}
			q := httptest.NewRequest("POST", "/token?grant_type=password", strings.NewReader(`{"email":"first@example.invalid","password":"synthetic-password-123"}`))
			q.Host = "general-beta.example.invalid"
			q.RemoteAddr = "192.0.2.1:1234"
			q.TLS = &tls.ConnectionState{HandshakeComplete: true}
			q.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, q)
			if w.Code != 429 || w.Header().Get("Retry-After") != tc.want {
				t.Fatalf("unsafe/lost throttle: %d header=%q", w.Code, w.Header().Get("Retry-After"))
			}
		})
	}
}

func TestProviderMailCoalescesConcurrentAndUnknownAttempts(t *testing.T) {
	_, p, _, transport, clock := ordinaryMailFixture(t, 10)
	entered, release := make(chan struct{}), make(chan struct{})
	original := transport.call
	transport.call = func(q *http.Request) (*http.Response, error) { close(entered); <-release; return original(q) }
	first := make(chan error, 1)
	go func() { first <- p.Mail(context.Background(), mailInput("same-mail-id")) }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		close(release)
		t.Fatal("provider was not reached")
	}
	second := make(chan error, 1)
	go func() { second <- p.Mail(context.Background(), mailInput("same-mail-id")) }()
	select {
	case err := <-second:
		if !errors.Is(err, ErrReplay) {
			close(release)
			t.Fatal("in-flight duplicate was not coalesced", err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("duplicate waited on provider")
	}
	close(release)
	if err := <-first; err != nil {
		t.Fatal(err)
	}
	clock.advance(2 * time.Second)
	transport.call = func(*http.Request) (*http.Response, error) { return nil, errors.New("synthetic response loss") }
	if p.Mail(context.Background(), mailInput("lost-mail-id")) == nil {
		t.Fatal("unknown send claimed success")
	}
	if !errors.Is(p.Mail(context.Background(), mailInput("lost-mail-id")), ErrReplay) {
		t.Fatal("unknown attempt automatically dispatched twice")
	}
}

func TestProviderMailBindsPayloadAndEvictsOnlyExpiredRecords(t *testing.T) {
	_, p, _, transport, clock := ordinaryMailFixture(t, 1)
	if err := p.Mail(context.Background(), mailInput("first-id")); err != nil {
		t.Fatal(err)
	}
	changed := mailInput("first-id")
	changed.Email = "second@example.invalid"
	var conflict *wireFailure
	if !errors.As(p.Mail(context.Background(), changed), &conflict) || conflict.status != 409 || conflict.code != "idempotency_conflict" {
		t.Fatal("operation reuse did not identify the changed account/body")
	}
	clock.advance(2 * time.Second)
	if p.Mail(context.Background(), mailInput("second-id")) == nil {
		t.Fatal("unexpired operation was evicted to admit another")
	}
	if transport.calls != 1 {
		t.Fatal("rejected/capacity requests reached provider")
	}
	clock.advance(24 * time.Hour)
	if err := p.Mail(context.Background(), mailInput("second-id")); err != nil {
		t.Fatal("expired record became a lifetime cap", err)
	}
	if transport.calls != 2 {
		t.Fatal("new post-expiry operation missing")
	}
}

func TestProviderManagedRestartDoesNotClaimDurableReplayOrRejectProviderState(t *testing.T) {
	c, p, _, transport, clock := ordinaryMailFixture(t, 10)
	if err := p.Mail(context.Background(), mailInput("restart-id")); err != nil {
		t.Fatal(err)
	}
	restarted, _, err := runtimeAdapters(c, clock, transport, p.reader, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = restarted.Mail(context.Background(), mailInput("restart-id")); err != nil {
		t.Fatal("restart pretended to retain a durable replay record", err)
	}
	if transport.calls != 2 {
		t.Fatal("restart semantics did not reach authoritative provider")
	}
}

func TestExplicitProvider429RemainsRetryLater(t *testing.T) {
	c, p, b, transport, clock := runtimeAdapterFixture(t)
	original := transport.call
	transport.call = func(req *http.Request) (*http.Response, error) {
		r, err := original(req)
		r.StatusCode = 429
		r.Header.Set("Retry-After", "120")
		r.Body = io.NopCloser(strings.NewReader(`{"error_code":"over_request_rate_limit"}`))
		return r, err
	}
	e, err := NewRuntime(c, clock, p, p, b)
	if err != nil {
		t.Fatal(err)
	}
	r := e.Handle(context.Background(), req("POST", "/token?grant_type=password", `{"email":"first@example.invalid","password":"synthetic-password-123"}`))
	if r.Status != 429 || r.Code != "retry_later" {
		t.Fatalf("known provider rejection became uncertain: status=%d code=%s", r.Status, r.Code)
	}
}

func TestKnownThrottleCanRetrySameIntentOnlyAfterItsBoundedDelay(t *testing.T) {
	_, p, _, transport, clock := ordinaryMailFixture(t, 10)
	original := transport.call
	transport.call = func(q *http.Request) (*http.Response, error) {
		r, e := original(q)
		if transport.calls == 1 {
			r.StatusCode = 429
			r.Header.Set("Retry-After", "120")
		}
		return r, e
	}
	in := mailInput("throttle-retry")
	if err := p.Mail(context.Background(), in); err == nil {
		t.Fatal("throttle became success")
	}
	clock.advance(119 * time.Second)
	if err := p.Mail(context.Background(), in); err == nil || transport.calls != 1 {
		t.Fatal("early retry dispatched")
	}
	clock.advance(time.Second)
	if err := p.Mail(context.Background(), in); err != nil || transport.calls != 2 {
		t.Fatal("explicit post-delay retry did not reach provider", err)
	}
}

func TestOrdinaryMailClockRollbackAndCancelledAdmissionDoNotDispatch(t *testing.T) {
	_, p, _, transport, clock := ordinaryMailFixture(t, 10)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if p.Mail(ctx, mailInput("cancelled-before-dispatch")) == nil || transport.calls != 0 {
		t.Fatal("cancelled request dispatched")
	}
	if p.Mail(context.Background(), mailInput("cancelled-before-dispatch")) != nil {
		t.Fatal("pre-dispatch cancellation poisoned a fresh user retry")
	}
	clock.advance(-time.Second)
	if p.Mail(context.Background(), mailInput("clock-backwards")) == nil || transport.calls != 1 {
		t.Fatal("clock rollback bypassed admission")
	}
}

func TestExplicitCorruptDurableStateCannotBecomeProviderManaged(t *testing.T) {
	c, prior, _, transport, clock := runtimeAdapterFixture(t)
	c.Policy.MailEnabled = true
	keyer, err := NewRuntimeKeyer(true, "public-fixture", "fixture", []byte("public-test-only-key-material-32!"))
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(t.TempDir(), "ledger")
	disk, err := NewFileJournal(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewRuntimeBudget(true, BudgetPolicy{Scope: "fixture", Global: c.Policy.MailGlobal, RecipientHour: c.Policy.MailRecipientHour, IPHour: c.Policy.MailIPHour, Cooldown: c.Policy.MailCooldown, IdentityBinding: keyer.PolicyBinding()}, disk)
	if err != nil || b.Initialize(context.Background(), clock.Now()) != nil {
		t.Fatal("temporary durable fixture unavailable", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte("corrupt fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := runtimeAdapters(c, clock, transport, prior.reader, nil, b, keyer); err == nil || transport.calls != 0 {
		t.Fatal("corrupt explicit journal silently fell back or contacted provider")
	}
}
