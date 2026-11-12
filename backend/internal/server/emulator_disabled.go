//go:build !firebase_emulator

package server

import (
	"context"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
)

// newEmulatorVerifier refuses ModeEmulator in a default build, which has no Firebase Auth emulator verifier: only
// the firebase_emulator build tag includes it. New returns the refusal before it opens the store, so no schema is
// created and nothing serves.
func newEmulatorVerifier(context.Context, config.Config) (accountVerifier, error) {
	return nil, authn.ErrEmulatorDisabled
}
