package generalingress

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOrdinaryRuntimeDoesNotExpireButProviderCredentialsStillDo(t *testing.T) {
	c, e, f, clock := runtimeFixture(t)
	raw, _ := json.Marshal(c)
	if strings.Contains(string(raw), "Deadline") || strings.Contains(string(raw), "Simulation") {
		t.Fatal("test lifetime/mode leaked into ordinary config")
	}
	clock.advance(8 * 24 * time.Hour)
	if e.Handle(context.Background(), req("GET", "/healthz", "")).Status != 200 {
		t.Fatal("ordinary application expired")
	}
	if e.Handle(context.Background(), authed("GET", "/user", "", "a-access")).Status != 401 {
		t.Fatal("expired provider credential accepted")
	}
	f.issue("fresh", userA, sidA, "first@example.invalid", "password")
	user := f.p.users["fresh-access"]
	user.ConfirmedAt = "2026-01-01T00:00:00Z"
	f.p.users["fresh-access"] = user
	if e.Handle(context.Background(), req("POST", "/token?grant_type=password", `{"email":"first@example.invalid","password":"synthetic-password-123"}`)).Status != 200 {
		t.Fatal("fresh login blocked by old service age")
	}
}
func TestOrdinaryProxyRestartUsesExistingVerifiedProviderAuthority(t *testing.T) {
	c, e, f, _ := runtimeFixture(t)
	first := e.Handle(context.Background(), req("POST", "/token?grant_type=password", `{"email":"first@example.invalid","password":"synthetic-password-123"}`))
	if first.Status != 200 {
		t.Fatal("login failed")
	}
	e.Stop()
	restored, err := NewRuntime(c, f.c, f.v, f.p, f.b)
	if err != nil {
		t.Fatal(err)
	}
	if restored.Handle(context.Background(), authed("GET", "/user", "", first.Session.AccessToken)).Status != 200 {
		t.Fatal("valid provider session depended on old proxy RAM")
	}
	f.p.sessions["refresh:"+first.Session.RefreshToken] = Session{AccessToken: "a-access", RefreshToken: "rotated-refresh"}
	if restored.Handle(context.Background(), req("POST", "/token?grant_type=refresh_token", `{"refresh_token":"a-refresh"}`)).Status != 200 {
		t.Fatal("provider refresh depended on proxy RAM")
	}
	f.v.fail = true
	if restored.Handle(context.Background(), authed("GET", "/user", "", "a-access")).Status != 401 {
		t.Fatal("provider verification bypassed")
	}
}
func TestOrdinaryPublicURLDoesNotRotateTrustedIssuerOrOwnerIdentity(t *testing.T) {
	c, _, f, clock := runtimeFixture(t)
	c.Policy.Issuer = "https://identity.example.invalid"
	for token, claims := range f.v.claims {
		claims.Issuer = c.Policy.Issuer
		f.v.claims[token] = claims
	}
	e, err := NewRuntime(c, clock, f.v, f.p, f.b)
	if err != nil {
		t.Fatal("distinct configured trusted issuer refused", err)
	}
	if e.Handle(context.Background(), authed("GET", "/user", "", "a-access")).Status != 200 {
		t.Fatal("existing verified identity refused")
	}
	claims := f.v.claims["a-access"]
	claims.Issuer = "https://untrusted.example.invalid"
	f.v.claims["a-access"] = claims
	if e.Handle(context.Background(), authed("GET", "/user", "", "a-access")).Status != 401 {
		t.Fatal("unconfigured issuer accepted")
	}
}
func TestOrdinaryMailQuotaRenewsWithoutForgettingAmbiguousOperation(t *testing.T) {
	now := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	keyer, err := NewRuntimeKeyer(true, "public-fixture", "ordinary-fixture", bytes.Repeat([]byte{0xaa}, 131))
	if err != nil {
		t.Fatal(err)
	}
	disk, err := NewFileJournal(filepath.Join(t.TempDir(), "ledger"))
	if err != nil {
		t.Fatal(err)
	}
	policy := BudgetPolicy{Scope: "ordinary-fixture", Global: 2, RecipientHour: 2, IPHour: 2, Cooldown: time.Second, IdentityBinding: keyer.PolicyBinding()}
	b, err := NewRuntimeBudget(true, policy, disk)
	if err != nil || b.Initialize(context.Background(), now) != nil {
		t.Fatal("ordinary ledger still requires terminal expiry")
	}
	recipient, _ := keyer.Key("recipient", "first@example.invalid")
	ip, _ := keyer.Key("ip", "192.0.2.1")
	if b.Reserve(context.Background(), "operation-one", recipient, ip, now) != nil || b.Reserve(context.Background(), "operation-two", recipient, ip, now.Add(2*time.Second)) != nil {
		t.Fatal("reservation failed")
	}
	if b.Reserve(context.Background(), "operation-three", recipient, ip, now.Add(4*time.Second)) != ErrBudget {
		t.Fatal("cost limit bypassed")
	}
	later := now.Add(25 * time.Hour)
	restarted, _ := NewRuntimeBudget(true, policy, disk)
	if restarted.Check(context.Background(), later) != nil {
		t.Fatal("accounting cannot resume after a day")
	}
	if restarted.Reserve(context.Background(), "operation-one", recipient, ip, later) != ErrReplay {
		t.Fatal("ambiguous operation replayed across quota window")
	}
	if restarted.Reserve(context.Background(), "operation-three", recipient, ip, later) != nil {
		t.Fatal("daily cost allocation became permanent lockout")
	}
}

func TestOrdinaryAuthRateCacheDoesNotBecomeALifetimeUserLimit(t *testing.T) {
	c, _, f, clock := runtimeFixture(t)
	c.Policy.MaxState = 2
	e, err := NewRuntime(c, clock, f.v, f.p, f.b)
	if err != nil {
		t.Fatal(err)
	}
	login := func(address string) int {
		return e.Handle(context.Background(), req("POST", "/token?grant_type=password", `{"email":"`+address+`","password":"synthetic-password-123"}`)).Status
	}
	if login("first@example.invalid") != 200 {
		t.Fatal("first login failed")
	}
	clock.advance(61 * time.Second)
	if login("second@example.invalid") != 200 {
		t.Fatal("expired rate cache became permanent account cap")
	}
}
