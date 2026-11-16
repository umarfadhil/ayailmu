package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
)

func startupEnvironment(t *testing.T) {
	t.Helper()
	for key, value := range map[string]string{
		"UMAR_LISTEN": "127.0.0.1:0", "UMAR_AUTH_PROVIDER": "gotrue",
		"UMAR_PUBLIC_ORIGIN": "", "UMAR_OIDC_ISSUER": "https://identity.example.invalid",
		"UMAR_OIDC_JWKS_URL": "https://identity.example.invalid/.well-known/jwks.json",
		"UMAR_DATA_MODE":     "NORMAL_ONLY", "UMAR_NORMAL_RELEASE_READY": "true",
		"UMAR_NORMAL_DECLARATION_VERSION": "fixture-adult-v1", "UMAR_NORMAL_SYNC_POLICY_VERSION": "fixture-sync-v1",
		"UMAR_MIGRATE_ON_START": "false", "UMAR_DATABASE_URL": "postgres://%",
		"UMAR_REVIEWED_REGISTRY_PATH": "", "UMAR_REVIEWED_REGISTRY_SHA256": "", "UMAR_REVIEWED_REGISTRY_SOURCE_COMMIT": "",
	} {
		t.Setenv(key, value)
	}
}

func reviewedSelection(t *testing.T) (string, string, string) {
	t.Helper()
	path, err := filepath.Abs("../../candidates/reviewed-math/finalized-registry.json")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	return path, hex.EncodeToString(sum[:]), "b6e0d6123cb359436f83ce3ae0685198ee13a815"
}

// run must reject the registry before reaching the deliberately invalid DB URL.
// OIDC key discovery is lazy; this path creates no listener or network request.
func TestRunRejectsInvalidReviewedSelectionBeforeDatabaseStartup(t *testing.T) {
	for _, kind := range []string{"missing-selection", "missing-file", "missing-hash", "wrong-hash", "wrong-source"} {
		t.Run(kind, func(t *testing.T) {
			startupEnvironment(t)
			path, pin, source := reviewedSelection(t)
			switch kind {
			case "missing-selection":
				path, pin, source = "", "", ""
			case "missing-file":
				path = filepath.Join(t.TempDir(), "missing-registry.json")
			case "missing-hash":
				pin = ""
			case "wrong-hash":
				pin = strings.Repeat("0", 64)
			case "wrong-source":
				source = strings.Repeat("0", 40)
			}
			t.Setenv("UMAR_REVIEWED_REGISTRY_PATH", path)
			t.Setenv("UMAR_REVIEWED_REGISTRY_SHA256", pin)
			t.Setenv("UMAR_REVIEWED_REGISTRY_SOURCE_COMMIT", source)
			if err := run(); err == nil || err.Error() != "catalog initialization failed" {
				t.Fatalf("startup ignored invalid reviewed selection: %v", err)
			}
		})
	}
}

func configureReviewedSelection(t *testing.T) {
	t.Helper()
	path, pin, source := reviewedSelection(t)
	t.Setenv("UMAR_REVIEWED_REGISTRY_PATH", path)
	t.Setenv("UMAR_REVIEWED_REGISTRY_SHA256", pin)
	t.Setenv("UMAR_REVIEWED_REGISTRY_SOURCE_COMMIT", source)
}

func TestStartupSelectsExactReviewedRegistryAndRunReachesDatabaseValidation(t *testing.T) {
	startupEnvironment(t)
	configureReviewedSelection(t)
	_, pin, source := reviewedSelection(t)
	if pin != "11753bbc33b789fec5e778044400e71fe98e46b2836216e9da6252c465a46afb" {
		t.Fatal("reviewed manifest fixture drift")
	}
	r, err := startupRegistry(true)
	if err != nil || r.SourceCommit != source || len(r.Packs) != 1 {
		t.Fatal("startup did not select reviewed deployment", err)
	}
	p := r.Packs[0]
	if p.Track != "mat-a-local" || p.ContentVersion != "mat-a-local-pemula-0.3" || len(p.Items) != 14 || p.Synthetic || p.SHA256 != "7ed58f9684e68f6fef43fcd9ea3e65ff50e530663cec495f207bce20b1bcab0c" {
		t.Fatal("startup exposed a different pack or broader catalog")
	}
	for _, item := range p.Items {
		if item.ReviewStatus != "approved" {
			t.Fatal("startup exposed draft metadata")
		}
	}
	if err := run(); err == nil || err.Error() != "invalid database configuration" {
		t.Fatalf("valid registry did not advance to explicit DB validation: %v", err)
	}
}

func TestStartupDefaultCompatibilityNeverOverridesNormalSelection(t *testing.T) {
	startupEnvironment(t)
	r, err := startupRegistry(false)
	if err != nil || len(r.Packs) != 73 {
		t.Fatal("unready/lab embedded compatibility changed", err)
	}
	if _, err := startupRegistry(true); err == nil {
		t.Fatal("normal release silently used embedded catalog")
	}
	configureReviewedSelection(t)
	t.Setenv("UMAR_NORMAL_RELEASE_READY", "false")
	if err := run(); err == nil || err.Error() != "catalog initialization failed" {
		t.Fatalf("explicit registry was accepted outside normal release: %v", err)
	}
	t.Setenv("UMAR_NORMAL_RELEASE_READY", "true")
	t.Setenv("UMAR_DATA_MODE", "SYNTHETIC_LAB")
	if err := run(); err == nil || err.Error() != "UMAR_DATA_MODE must be NORMAL_ONLY" {
		t.Fatalf("server started in synthetic mode: %v", err)
	}
	t.Setenv("UMAR_DATA_MODE", "NORMAL_ONLY")
	t.Setenv("UMAR_AUTH_PROVIDER", "keycloak")
	if err := run(); err == nil || err.Error() != "UMAR_AUTH_PROVIDER must be gotrue" {
		t.Fatalf("server started with a non-GoTrue provider: %v", err)
	}
}

func TestRunRefusesDraftSyntheticAndMalformedManifestEvenWithMatchingChecksum(t *testing.T) {
	for _, kind := range []string{"draft", "synthetic", "missing-items", "malformed"} {
		t.Run(kind, func(t *testing.T) {
			startupEnvironment(t)
			path, _, source := reviewedSelection(t)
			raw, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var r catalog.Registry
			if err := json.Unmarshal(raw, &r); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "draft":
				for id, item := range r.Packs[0].Items {
					item.ReviewStatus = "draft"
					r.Packs[0].Items[id] = item
					break
				}
			case "synthetic":
				r.Packs[0].Synthetic = true
			case "missing-items":
				r.Packs[0].Items = nil
			}
			raw, err = json.Marshal(r)
			if err != nil {
				t.Fatal(err)
			}
			if kind == "malformed" {
				raw = []byte(`{"source_commit":`)
			}
			path = filepath.Join(t.TempDir(), "invalid-registry.json")
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			sum := sha256.Sum256(raw)
			t.Setenv("UMAR_REVIEWED_REGISTRY_PATH", path)
			t.Setenv("UMAR_REVIEWED_REGISTRY_SHA256", hex.EncodeToString(sum[:]))
			t.Setenv("UMAR_REVIEWED_REGISTRY_SOURCE_COMMIT", source)
			if err := run(); err == nil || err.Error() != "catalog initialization failed" {
				t.Fatalf("invalid manifest reached database startup: %v", err)
			}
		})
	}
}
