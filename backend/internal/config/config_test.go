package config_test

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/config"
)

// fakePassword is a synthetic marker, not a credential: tests prove it never appears in output.
const fakePassword = "fake-pw-not-real-7731"

func baseEnv() map[string]string {
	return map[string]string{
		config.EnvMode:         config.ModeEmulator,
		config.EnvDatabaseURL:  "postgres://aya_example:" + fakePassword + "@127.0.0.1:6543/aya_example",
		config.EnvProjectID:    "demo-ayailmu",
		config.EnvEmulatorHost: "127.0.0.1:9099",
	}
}

func lookupIn(env map[string]string) func(string) (string, bool) {
	return func(k string) (string, bool) {
		v, ok := env[k]
		return v, ok
	}
}

func TestLoadAcceptsLocalEmulatorSetupWithDefaults(t *testing.T) {
	env := baseEnv()
	cfg, err := config.Load(lookupIn(env))
	if err != nil {
		t.Fatalf("Load(local emulator setup): %v", err)
	}
	if cfg.Mode != config.ModeEmulator {
		t.Errorf("Mode = %q, want %q", cfg.Mode, config.ModeEmulator)
	}
	if cfg.Listen != config.DefaultListen {
		t.Errorf("Listen = %q, want default %q", cfg.Listen, config.DefaultListen)
	}
	if cfg.Listen != "127.0.0.1:8091" {
		t.Errorf("Listen = %q, want the strict loopback default 127.0.0.1:8091", cfg.Listen)
	}
	if got, want := strings.Join(cfg.AllowedHosts, ","), "127.0.0.1:8091,localhost:8091"; got != want {
		t.Errorf("AllowedHosts = %q, want %q", got, want)
	}
	if cfg.Schema != config.DefaultSchema {
		t.Errorf("Schema = %q, want default %q", cfg.Schema, config.DefaultSchema)
	}
	if cfg.ProjectID != "demo-ayailmu" || cfg.EmulatorHost != "127.0.0.1:9099" {
		t.Errorf("ProjectID/EmulatorHost = %q/%q", cfg.ProjectID, cfg.EmulatorHost)
	}
	if cfg.DatabaseURL.Reveal() != env[config.EnvDatabaseURL] {
		t.Errorf("DatabaseURL.Reveal() does not return the configured value")
	}
	for _, s := range []string{
		fmt.Sprintf("%v", cfg), fmt.Sprintf("%+v", cfg), fmt.Sprintf("%#v", cfg),
		fmt.Sprintf("%s", cfg.DatabaseURL), fmt.Sprintf("%q", cfg.DatabaseURL), fmt.Sprintf("%x", cfg.DatabaseURL),
		cfg.DatabaseURL.String(),
	} {
		if strings.Contains(s, fakePassword) || strings.Contains(s, "aya_example:") {
			t.Fatalf("formatted configuration leaks the database URL")
		}
	}
}

func TestLoadAcceptsOtherLocalForms(t *testing.T) {
	cases := []struct {
		name      string
		set       map[string]string
		wantHosts string
	}{
		{"IPv6 loopback listener", map[string]string{config.EnvListen: "[::1]:8091"}, "[::1]:8091,localhost:8091"},
		{"other 127/8 listener", map[string]string{config.EnvListen: "127.0.0.2:9000"}, "127.0.0.2:9000,localhost:9000"},
		{"Unix-socket database", map[string]string{config.EnvDatabaseURL: "host=/tmp dbname=aya_example user=aya_example"}, "127.0.0.1:8091,localhost:8091"},
		{"IPv6 loopback database", map[string]string{config.EnvDatabaseURL: "postgres://aya_example:" + fakePassword + "@[::1]:6543/aya_example"}, "127.0.0.1:8091,localhost:8091"},
		{"test schema name", map[string]string{config.EnvSchema: "aya_t_0a1b2c3d4e5f"}, "127.0.0.1:8091,localhost:8091"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			env := baseEnv()
			for k, v := range c.set {
				env[k] = v
			}
			cfg, err := config.Load(lookupIn(env))
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if got := strings.Join(cfg.AllowedHosts, ","); got != c.wantHosts {
				t.Errorf("AllowedHosts = %q, want %q", got, c.wantHosts)
			}
			if s, ok := c.set[config.EnvSchema]; ok && cfg.Schema != s {
				t.Errorf("Schema = %q, want %q", cfg.Schema, s)
			}
		})
	}
}

func TestLoadRefusesUnsafeOrUnsupportedSetups(t *testing.T) {
	cases := []struct {
		name  string
		set   map[string]string
		unset []string
		want  error
	}{
		{"production mode", map[string]string{config.EnvMode: config.ModeProduction}, nil, config.ErrProductionRefused},
		{"unknown mode", map[string]string{config.EnvMode: "staging"}, nil, config.ErrInvalidMode},
		{"mode missing", nil, []string{config.EnvMode}, config.ErrMissing},
		{"listen without host", map[string]string{config.EnvListen: ":8091"}, nil, config.ErrNotLoopback},
		{"listen on every IPv4 interface", map[string]string{config.EnvListen: "0.0.0.0:8091"}, nil, config.ErrNotLoopback},
		{"listen on every IPv6 interface", map[string]string{config.EnvListen: "[::]:8091"}, nil, config.ErrNotLoopback},
		{"listen by hostname", map[string]string{config.EnvListen: "localhost:8091"}, nil, config.ErrNotLoopback},
		{"listen on a LAN address", map[string]string{config.EnvListen: "192.168.1.20:8091"}, nil, config.ErrNotLoopback},
		{"listen without port", map[string]string{config.EnvListen: "127.0.0.1"}, nil, config.ErrNotLoopback},
		{"listen on port zero", map[string]string{config.EnvListen: "127.0.0.1:0"}, nil, config.ErrNotLoopback},
		{"non-demo Firebase project", map[string]string{config.EnvProjectID: "ayailmu-prod"}, nil, config.ErrNotDemoProject},
		{"Firebase project missing", nil, []string{config.EnvProjectID}, config.ErrMissing},
		{"emulator host missing", nil, []string{config.EnvEmulatorHost}, config.ErrMissing},
		{"emulator on a LAN address", map[string]string{config.EnvEmulatorHost: "10.0.0.5:9099"}, nil, config.ErrNotLoopback},
		{"emulator by hostname", map[string]string{config.EnvEmulatorHost: "localhost:9099"}, nil, config.ErrNotLoopback},
		{"database URL missing", nil, []string{config.EnvDatabaseURL}, config.ErrMissing},
		{"database on a remote host", map[string]string{config.EnvDatabaseURL: "postgres://aya_example:" + fakePassword + "@db.example.com:5432/aya_example"}, nil, config.ErrDatabaseNotLocal},
		{"database on a LAN address", map[string]string{config.EnvDatabaseURL: "postgres://aya_example:" + fakePassword + "@10.0.0.7:5432/aya_example"}, nil, config.ErrDatabaseNotLocal},
		{"database by hostname", map[string]string{config.EnvDatabaseURL: "postgres://aya_example:" + fakePassword + "@localhost:6543/aya_example"}, nil, config.ErrDatabaseNotLocal},
		{"database with a remote fallback host", map[string]string{config.EnvDatabaseURL: "postgres://aya_example:" + fakePassword + "@127.0.0.1:6543,db.example.com:5432/aya_example"}, nil, config.ErrDatabaseNotLocal},
		{"schema public", map[string]string{config.EnvSchema: "public"}, nil, config.ErrInvalidSchema},
		{"schema pg_catalog", map[string]string{config.EnvSchema: "pg_catalog"}, nil, config.ErrInvalidSchema},
		{"schema with quoting", map[string]string{config.EnvSchema: `aya"; drop schema public; --`}, nil, config.ErrInvalidSchema},
		{"schema with upper case", map[string]string{config.EnvSchema: "Aya"}, nil, config.ErrInvalidSchema},
		{"Google credentials present", map[string]string{config.EnvGoogleCreds: "/nonexistent/service-account.json"}, nil, config.ErrRealCredentials},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			env := baseEnv()
			for k, v := range c.set {
				env[k] = v
			}
			for _, k := range c.unset {
				delete(env, k)
			}
			_, err := config.Load(lookupIn(env))
			if !errors.Is(err, c.want) {
				t.Fatalf("Load error = %v, want %v", err, c.want)
			}
			if strings.Contains(err.Error(), fakePassword) {
				t.Fatalf("error message leaks the database password")
			}
		})
	}
}
