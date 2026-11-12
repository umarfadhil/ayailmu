package main

import (
	"github.com/umarfadhil/ayailmu/backend-umar/internal/api"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAccountErasureConfigFailsClosedWithoutExplicitNormalGoTrueInputs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "admin-fixture")
	if err := os.WriteFile(path, []byte("isolated-account-erasure-token\n"), 0600); err != nil {
		t.Fatal(err)
	}
	base := map[string]string{"UMAR_ACCOUNT_ERASURE_ENABLED": "true", "UMAR_AUTH_ADMIN_ORIGIN": "https://auth.example.invalid", "UMAR_AUTH_ADMIN_TOKEN_FILE": path}
	read := func(values map[string]string) func(string) string { return func(k string) string { return values[k] } }
	for _, tc := range []struct {
		name, flag, origin, file, provider string
		mode                               api.DeploymentDataMode
		ok                                 bool
	}{
		{"good", "true", base["UMAR_AUTH_ADMIN_ORIGIN"], path, "gotrue", api.DeploymentNormalOnly, true},
		{"bad toggle", "yes", base["UMAR_AUTH_ADMIN_ORIGIN"], path, "gotrue", api.DeploymentNormalOnly, false},
		{"missing origin", "true", "", path, "gotrue", api.DeploymentNormalOnly, false},
		{"HTTP origin", "true", "http://127.0.0.1:1", path, "gotrue", api.DeploymentNormalOnly, false},
		{"missing token", "true", base["UMAR_AUTH_ADMIN_ORIGIN"], "", "gotrue", api.DeploymentNormalOnly, false},
		{"other provider", "true", base["UMAR_AUTH_ADMIN_ORIGIN"], path, "keycloak", api.DeploymentNormalOnly, false},
		{"lab mode", "true", base["UMAR_AUTH_ADMIN_ORIGIN"], path, "gotrue", api.DeploymentSyntheticLab, false},
		{"unused authority", "false", base["UMAR_AUTH_ADMIN_ORIGIN"], path, "gotrue", api.DeploymentNormalOnly, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := map[string]string{"UMAR_ACCOUNT_ERASURE_ENABLED": tc.flag, "UMAR_AUTH_ADMIN_ORIGIN": tc.origin, "UMAR_AUTH_ADMIN_TOKEN_FILE": tc.file}
			p, err := accountErasureProvider(read(env), tc.mode, tc.provider, "https://issuer.example.invalid")
			if (err == nil) != tc.ok || tc.ok && p == nil {
				t.Fatal("configuration result", err)
			}
			if err != nil && (strings.Contains(err.Error(), "isolated-account-erasure-token") || strings.Contains(err.Error(), path)) {
				t.Fatal("secret detail in error")
			}
		})
	}
	if p, err := accountErasureProvider(read(nil), api.DeploymentNormalOnly, "gotrue", "https://issuer.example.invalid"); err != nil || p != nil {
		t.Fatal("explicitly disabled default", err)
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := accountErasureProvider(read(base), api.DeploymentNormalOnly, "gotrue", "https://issuer.example.invalid"); err == nil {
		t.Fatal("world-readable credential accepted")
	}
}
