//go:build infra_staging

package stagingenv_test

// Cross-check of the infra manifest validator against the application's real production-staging guards. The Python test
// writes INFRA_STAGING_CASES: a JSON list of {name, env, expect}. expect "ok" means config.Load must accept the complete
// environment as ModeProduction/staging; "refuse" means it must reject it. A missing file fails; nothing is skipped.
// The build tag keeps the application's own `go test ./...` unchanged:
// run it with `go test -tags infra_staging ./infra/stagingenv/`.

import (
	"encoding/json"
	"errors"
	"os"
	"testing"

	"ayailmu.local/backend/internal/config"
)

type staginCase struct {
	Name   string            `json:"name"`
	Env    map[string]string `json:"env"`
	Expect string            `json:"expect"`
}

func TestRenderedStagingEnvironmentAgainstTheRealLoader(t *testing.T) {
	path := os.Getenv("INFRA_STAGING_CASES")
	if path == "" {
		t.Fatal("INFRA_STAGING_CASES is not set: run infra/supabase/tests/test_ayangaji_local.py; refusing to skip")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var cases []staginCase
	if err := json.Unmarshal(raw, &cases); err != nil || len(cases) == 0 {
		t.Fatal("no cases")
	}
	for _, c := range cases {
		t.Run(c.Name, func(t *testing.T) {
			cfg, err := config.Load(func(k string) (string, bool) { v, ok := c.Env[k]; return v, ok })
			switch c.Expect {
			case "ok":
				if err != nil {
					t.Fatalf("config.Load refused a rendered environment: %v", errors.Unwrap(err))
				}
				if cfg.Mode != config.ModeProduction || len(cfg.DBHosts) != 1 || cfg.Schema == "" {
					t.Fatalf("unexpected config: mode=%s hosts=%d", cfg.Mode, len(cfg.DBHosts))
				}
			case "refuse":
				if err == nil {
					t.Fatal("config.Load accepted an environment the infra validator refuses")
				}
			default:
				t.Fatalf("bad expectation %q", c.Expect)
			}
		})
	}
}
