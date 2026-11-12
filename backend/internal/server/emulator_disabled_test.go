//go:build !firebase_emulator

package server_test

// Firebase isolation, Phase 6 RED. Only a build with the firebase_emulator tag carries the legacy Firebase Auth emulator
// verifier and its SDK. The default build refuses emulator mode: a complete, valid emulator configuration (the demo
// project, the owned loopback emulator as the process's own, the isolated loopback PostgreSQL (AYA_TEST_DATABASE_URL) in
// a fresh aya_t_ schema) fails with authn.ErrEmulatorDisabled before the database is touched, so no schema is created
// and nothing can serve. Nothing contacts the emulator, and no DSN is printed.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/server"
)

// ownedEmulatorHost is the owned local Auth emulator's loopback address. The refused configuration names it and the
// process environment carries it, as the legacy verifier requires; nothing contacts it.
const ownedEmulatorHost = "127.0.0.1:9099"

func TestDefaultBuildRefusesFirebaseEmulatorMode(t *testing.T) {
	dbURL := testDatabase(t)
	t.Setenv(config.EnvEmulatorHost, ownedEmulatorHost)
	schema := newSchemaName(t)
	probe := fixturePool(t, dbURL, schema)
	t.Cleanup(func() {
		dropSchema(t, probe, schema)
		probe.Close()
	})
	env := serviceEnv(dbURL, ownedEmulatorHost, schema, "127.0.0.1:8091")
	if _, err := config.Load(lookupIn(env)); err != nil {
		t.Fatalf("the emulator configuration is not valid: %s", quiet(err, dbURL))
	}

	svc, err := server.New(context.Background(), lookupIn(env), server.Options{})
	if svc != nil {
		svc.Close()
		t.Error("server.New built an emulator-mode service: this build still carries the Firebase emulator verifier")
	}
	if schemaExists(t, probe, schema) {
		t.Error("the refused emulator configuration created its schema")
	}
	if !errors.Is(err, authn.ErrEmulatorDisabled) {
		t.Fatalf("server.New error = %s, want authn.ErrEmulatorDisabled", quiet(err, dbURL))
	}
	if strings.Contains(err.Error(), dbURL) {
		t.Fatal("the refusal quotes the database URL")
	}
}
