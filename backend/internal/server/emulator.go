//go:build firebase_emulator

package server

import (
	"context"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
)

// newEmulatorVerifier builds ModeEmulator's verifier: the legacy Firebase Auth emulator verifier, which only a
// build with the firebase_emulator tag includes.
func newEmulatorVerifier(ctx context.Context, cfg config.Config) (accountVerifier, error) {
	v, err := authn.NewEmulatorVerifier(ctx, authn.EmulatorConfig{ProjectID: cfg.ProjectID, EmulatorHost: cfg.EmulatorHost})
	if err != nil {
		return nil, err
	}
	return v, nil
}
