package generalingress

import (
	"bytes"
	"context"
	"testing"
)

func TestOpaqueIdentityBindingCanonicalizesAndPinsFixtureKey(t *testing.T) {
	// Public RFC 4231 case-6 test vector bytes, never a service credential.
	k, err := NewHMACKeyer(true, "public-rfc4231-fixture", "ayailmu", bytes.Repeat([]byte{0xaa}, 131))
	if err != nil {
		t.Fatal(err)
	}
	a, _ := k.Key("recipient", "First@Example.invalid")
	b, _ := k.Key("recipient", "first@example.invalid")
	if a != b || len(a) != 64 || a == "first@example.invalid" {
		t.Fatal("recipient binding unstable")
	}
	x, _ := k.Key("ip", "192.0.2.1")
	y, _ := k.Key("ip", "::ffff:192.0.2.1")
	if x != y || x == a {
		t.Fatal("IP alias or namespace bypass")
	}
	other, _ := NewHMACKeyer(true, "public-rfc4231-fixture", "ayailmu", bytes.Repeat([]byte{0xbb}, 131))
	if other.PolicyBinding() == k.PolicyBinding() {
		t.Fatal("changed key not detected")
	}
	p, _, rt, _, _ := adapterFixture(t)
	p.keyer = k
	if err := p.Mail(context.Background(), MailRequest{Action: "recover", Email: "first@example.invalid", Peer: "192.0.2.1", RequestID: "changed-key"}); err == nil || rt.calls != 0 {
		t.Fatal("different identity binding used old ledger")
	}
	if _, err := NewHMACKeyer(false, "unset", "ayailmu", nil); err == nil {
		t.Fatal("unconfigured keyer enabled")
	}
}
