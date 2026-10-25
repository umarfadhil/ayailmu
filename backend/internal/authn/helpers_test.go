package authn_test

// Helpers shared by the default build's tests and the legacy emulator tests of authn_test.go, which build only with
// the firebase_emulator tag. randomHex is moved here verbatim from that file.

import (
	"crypto/rand"
	"encoding/hex"
	"testing"
)

func randomHex(t *testing.T, n int) string {
	t.Helper()
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		t.Fatalf("random: %v", err)
	}
	return hex.EncodeToString(b)
}
