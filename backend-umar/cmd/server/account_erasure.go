package main

import (
	"errors"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/api"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/identityerase"
	"io"
	"os"
	"strings"
)

// accountErasureProvider reads only explicitly configured existing server authority.
// It creates no credential, changes no access and makes no provider request.
func accountErasureProvider(env func(string) string, mode api.DeploymentDataMode, provider, issuer string) (*identityerase.Provider, error) {
	refused := errors.New("account erasure configuration incomplete or unsafe")
	flag, origin, path := env("UMAR_ACCOUNT_ERASURE_ENABLED"), env("UMAR_AUTH_ADMIN_ORIGIN"), env("UMAR_AUTH_ADMIN_TOKEN_FILE")
	if flag == "" || flag == "false" {
		if origin != "" || path != "" {
			return nil, refused
		}
		return nil, nil
	}
	if flag != "true" || mode != api.DeploymentNormalOnly || provider != "gotrue" || origin == "" || path == "" {
		return nil, refused
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, refused
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 16384 {
		return nil, refused
	}
	raw, err := io.ReadAll(io.LimitReader(file, 16385))
	if err != nil || len(raw) > 16384 {
		return nil, refused
	}
	adapter, err := identityerase.New(identityerase.Config{Issuer: issuer, AdminOrigin: origin, AdminToken: strings.TrimSpace(string(raw))})
	if err != nil {
		return nil, refused
	}
	return adapter, nil
}
