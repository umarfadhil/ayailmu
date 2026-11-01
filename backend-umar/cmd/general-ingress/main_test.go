package main

import (
	"bytes"
	ingress "github.com/umarfadhil/ayailmu/backend-umar/internal/generalingress"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestPrivateInputReaderOnlyReadsOwnedRestrictiveSyntheticFile(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "public-fixture-bytes")
	fixture := bytes.Repeat([]byte{0xaa}, 131) // public RFC 4231 bytes, not a credential
	if os.WriteFile(path, fixture, 0600) != nil {
		t.Fatal("fixture unavailable")
	}
	got, err := privateBytes(path)
	if err != nil || !bytes.Equal(got, fixture) {
		t.Fatal("private reader failed")
	}
	if os.Chmod(path, 0644) != nil {
		t.Fatal("fixture permissions unavailable")
	}
	if _, err = privateBytes(path); err == nil {
		t.Fatal("shared mode accepted")
	}
	os.Chmod(path, 0600)
	link := filepath.Join(root, "link")
	if os.Symlink(path, link) != nil {
		t.Fatal("fixture symlink unavailable")
	}
	if _, err = privateBytes(link); err == nil {
		t.Fatal("symlink accepted")
	}
	hard := filepath.Join(root, "hard")
	if os.Link(path, hard) != nil {
		t.Fatal("fixture hardlink unavailable")
	}
	if _, err = privateBytes(path); err == nil {
		t.Fatal("hardlinked secret source accepted")
	}
}
func TestAccountingSetupIsExplicitFreshOnlyAndNeverResets(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "public-fixture-bytes")
	os.WriteFile(path, bytes.Repeat([]byte{0xaa}, 131), 0600)
	now := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC)
	c := ingress.RuntimeConfig{Enabled: true, Listen: "127.0.0.1:58480", UpstreamOrigin: "https://localhost:58443", CAHash: string(bytes.Repeat([]byte{'a'}, 64)), Revocation: ingress.AllowBoundedJWT, MaxAccessWindow: time.Hour, Policy: ingress.RuntimePolicy{MailEnabled: true, Origin: "https://general.example.invalid", Issuer: "https://general.example.invalid", Audience: "authenticated", MaxConcurrent: 2, MaxState: 100, MailGlobal: 2, MailRecipientHour: 2, MailIPHour: 2, MailCooldown: time.Minute, AuthIPMinute: 10, AuthRecipientMinute: 10, DeclarationVersion: "fixture-adult-v1", ConsentVersion: "fixture-sync-v1"}}
	dir := filepath.Join(root, "ledger")
	if _, _, err := accounting(c, now, path, dir, "public-fixture", "runtime-fixture", false); err == nil {
		t.Fatal("startup initialized missing ledger")
	}
	if _, _, err := accounting(c, now, path, dir, "public-fixture", "runtime-fixture", true); err != nil {
		t.Fatal("explicit fixture initialization failed", err)
	}
	if _, _, err := accounting(c, now, path, dir, "public-fixture", "runtime-fixture", true); err == nil {
		t.Fatal("existing ledger reset")
	}
	if _, _, err := accounting(c, now, path, dir, "public-fixture", "runtime-fixture", false); err != nil {
		t.Fatal("policy restore failed", err)
	}
	c.Policy.MailGlobal = 3
	if _, _, err := accounting(c, now, path, dir, "public-fixture", "runtime-fixture", false); err == nil {
		t.Fatal("policy silently replaced")
	}
	c.Enabled = false
	missing := filepath.Join(root, "must-not-exist")
	if _, _, err := accounting(c, now, "not-read", missing, "unset", "unset", true); err == nil {
		t.Fatal("disabled initialization allowed")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("disabled path touched store")
	}
}
