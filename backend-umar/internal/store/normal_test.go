package store

import (
	"context"
	"errors"
	"testing"
)

func TestPostgresNormalDeclarationVersionRoundTripAndModeConflict(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	id, err := s.ActivateWithDeclaration(ctx, "normal-issuer", t.Name(), "owner-declaration-fixture-v2", false)
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.ActivateWithDeclaration(ctx, "normal-issuer", t.Name(), "owner-declaration-fixture-v2", false)
	if err != nil || again != id {
		t.Fatal("normal activation was not idempotent", err)
	}
	var version string
	var synthetic bool
	if err = s.pool.QueryRow(ctx, "SELECT declaration_version,synthetic FROM accounts WHERE id=$1", id).Scan(&version, &synthetic); err != nil {
		t.Fatal(err)
	}
	if version != "owner-declaration-fixture-v2" || synthetic {
		t.Fatalf("declaration/mode not persisted: %q %t", version, synthetic)
	}
	if _, err = s.ActivateWithDeclaration(ctx, "normal-issuer", t.Name(), "owner-declaration-fixture-v3", false); !errors.Is(err, ErrConflict) {
		t.Fatal("changed declaration silently accepted", err)
	}
	if _, err = s.Activate(ctx, "normal-issuer", t.Name()); !errors.Is(err, ErrConflict) {
		t.Fatal("normal account crossed into synthetic mode", err)
	}
}
