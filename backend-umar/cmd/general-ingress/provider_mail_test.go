package main

import (
	ingress "github.com/umarfadhil/ayailmu/backend-umar/internal/generalingress"
	"testing"
	"time"
)

func TestOrdinaryMailStartupNeedsNoAccountingFiles(t *testing.T) {
	now := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	c := ingress.RuntimeConfig{Enabled: true, Listen: "127.0.0.1:58480", UpstreamOrigin: "https://localhost:58443", CAHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", Revocation: ingress.AllowBoundedJWT, MaxAccessWindow: time.Hour, Policy: ingress.RuntimePolicy{MailEnabled: true, Origin: "https://general.example.invalid", Issuer: "https://identity.example.invalid", Audience: "authenticated", MaxConcurrent: 2, MaxState: 100, MailGlobal: 0, MailRecipientHour: 5, MailIPHour: 20, MailCooldown: time.Minute, AuthIPMinute: 20, AuthRecipientMinute: 5, DeclarationVersion: "fixture-adult-v1", ConsentVersion: "fixture-sync-v1"}}
	b, k, e := accounting(c, now, "", "", "", "", false)
	if e != nil || b != nil || k != nil {
		t.Fatalf("ordinary provider-managed mail demands local key/journal: %v", e)
	}
	if _, _, e = accounting(c, now, "missing-explicit-key", "", "", "", false); e == nil {
		t.Fatal("partial explicit durable configuration silently fell back")
	}
	if _, _, e = accounting(c, now, "", "", "", "", true); e == nil {
		t.Fatal("initialization without explicit durable arguments accepted")
	}
}
