package config_test

// Local synthetic Supabase mode (AYA_MODE=local-supabase), Phase 4 RED. The mode keeps the API and its database on
// literal loopback as emulator mode does, and trusts one explicitly configured local Supabase Auth: a loopback base
// URL, the exact issuer and audience of its tokens, and a server-only admin credential read from a private file. Every
// refusal names the setting and quotes no value: no URL, path, credential or password.

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/config"
)

const (
	// fakeAdminKey is a synthetic marker, not a credential: tests prove it never appears in output.
	fakeAdminKey = "fake-admin-key-not-real-5519"
	// unsafeMarker is a synthetic marker placed where a value must never be quoted from.
	unsafeMarker = "unsafe-marker-not-real-4417"
)

// adminKeyFile writes content to a new file of exactly mode in a test-owned directory and returns its absolute path.
func adminKeyFile(t *testing.T, content string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "admin-key")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
	return path
}

// localSupabaseEnv is a complete, valid local-supabase configuration whose admin credential is fakeAdminKey, with a
// final newline, in a private file.
func localSupabaseEnv(t *testing.T) map[string]string {
	t.Helper()
	return map[string]string{
		config.EnvMode:                 config.ModeLocalSupabase,
		config.EnvDatabaseURL:          "postgres://aya_example:" + fakePassword + "@127.0.0.1:6543/aya_example",
		config.EnvSupabaseURL:          "http://127.0.0.1:54321",
		config.EnvSupabaseIssuer:       "https://auth.ayailmu-local.test/auth/v1",
		config.EnvSupabaseAudience:     "authenticated",
		config.EnvSupabaseAdminKeyFile: adminKeyFile(t, fakeAdminKey+"\n", 0o600),
	}
}

func set(name, value string) func(*testing.T, map[string]string) {
	return func(_ *testing.T, env map[string]string) { env[name] = value }
}

func unset(name string) func(*testing.T, map[string]string) {
	return func(_ *testing.T, env map[string]string) { delete(env, name) }
}

func keyFile(content string, mode os.FileMode) func(*testing.T, map[string]string) {
	return func(t *testing.T, env map[string]string) { env[config.EnvSupabaseAdminKeyFile] = adminKeyFile(t, content, mode) }
}

// ModeLocalSupabase loads only with every Auth setting explicit: a loopback Auth URL (plain http is acceptable there
// for synthetic fixtures), the issuer, the audience and a private admin credential file, whose one credential it reads
// without the final newline and never prints. The listener, database and Google-credential guards of emulator mode
// apply unchanged. Anything missing or unsafe is refused with the variable's name and none of its value.
func TestLoadLocalSupabaseModeTrustsOnlyItsExplicitLoopbackAuth(t *testing.T) {
	t.Run("a complete loopback configuration", func(t *testing.T) {
		env := localSupabaseEnv(t)
		cfg, err := config.Load(lookupIn(env))
		if err != nil {
			t.Fatalf("Load(local-supabase setup): %v", err)
		}
		switch {
		case cfg.Mode != config.ModeLocalSupabase:
			t.Fatalf("Mode = %q, want %q", cfg.Mode, config.ModeLocalSupabase)
		case cfg.Listen != config.DefaultListen || strings.Join(cfg.AllowedHosts, ",") != "127.0.0.1:8091,localhost:8091":
			t.Fatalf("Listen/AllowedHosts = %q/%q, want the strict loopback default", cfg.Listen, cfg.AllowedHosts)
		case cfg.DatabaseURL.Reveal() != env[config.EnvDatabaseURL] || cfg.Schema != config.DefaultSchema:
			t.Fatal("the database settings are not the configured ones")
		case cfg.Supabase.URL != "http://127.0.0.1:54321" || cfg.Supabase.Issuer != "https://auth.ayailmu-local.test/auth/v1" ||
			cfg.Supabase.Audience != "authenticated":
			t.Fatalf("Supabase = %q/%q/%q, want the configured URL, issuer and audience", cfg.Supabase.URL, cfg.Supabase.Issuer, cfg.Supabase.Audience)
		case cfg.Supabase.AdminKey.Reveal() != fakeAdminKey:
			t.Fatal("AdminKey.Reveal() is not the file's one credential without its final newline")
		}
		for _, s := range []string{fmt.Sprintf("%v", cfg), fmt.Sprintf("%+v", cfg), fmt.Sprintf("%#v", cfg), fmt.Sprintf("%v", cfg.Supabase)} {
			if strings.Contains(s, fakeAdminKey) || strings.Contains(s, fakePassword) {
				t.Fatal("formatting the configuration prints the admin credential or the database password")
			}
		}
	})

	t.Run("other loopback forms", func(t *testing.T) {
		for _, c := range []struct {
			name string
			edit func(*testing.T, map[string]string)
		}{
			{"IPv6 loopback Auth", set(config.EnvSupabaseURL, "http://[::1]:54321")},
			{"Auth under a path", set(config.EnvSupabaseURL, "http://127.0.0.1:54321/auth/v1")},
			{"Auth over https on loopback", set(config.EnvSupabaseURL, "https://127.0.0.1:54321")},
			{"a read-only admin credential file without a final newline", keyFile(fakeAdminKey, 0o400)},
		} {
			t.Run(c.name, func(t *testing.T) {
				env := localSupabaseEnv(t)
				c.edit(t, env)
				cfg, err := config.Load(lookupIn(env))
				switch {
				case err != nil:
					t.Fatalf("Load: %v", err)
				case cfg.Mode != config.ModeLocalSupabase || cfg.Supabase.URL != env[config.EnvSupabaseURL]:
					t.Fatalf("Mode/URL = %q/%q, want local-supabase and the configured URL", cfg.Mode, cfg.Supabase.URL)
				case cfg.Supabase.AdminKey.Reveal() != fakeAdminKey:
					t.Fatal("AdminKey.Reveal() is not the file's one credential")
				}
			})
		}
	})

	t.Run("missing or unsafe settings are refused, quoting nothing", func(t *testing.T) {
		for _, c := range []struct {
			name string
			edit func(*testing.T, map[string]string)
			want error
		}{
			{"Auth URL missing", unset(config.EnvSupabaseURL), config.ErrMissing},
			{"issuer missing", unset(config.EnvSupabaseIssuer), config.ErrMissing},
			{"audience missing", unset(config.EnvSupabaseAudience), config.ErrMissing},
			{"admin credential file missing", unset(config.EnvSupabaseAdminKeyFile), config.ErrMissing},
			{"Auth on a remote https host", set(config.EnvSupabaseURL, "https://auth.example.com"), config.ErrNotLocalAuth},
			{"Auth on a LAN address", set(config.EnvSupabaseURL, "http://192.0.2.10:54321"), config.ErrNotLocalAuth},
			{"Auth by hostname, even localhost", set(config.EnvSupabaseURL, "http://localhost:54321"), config.ErrNotLocalAuth},
			{"Auth without a port", set(config.EnvSupabaseURL, "http://127.0.0.1"), config.ErrNotLocalAuth},
			{"Auth on an IPv4-mapped address", set(config.EnvSupabaseURL, "http://[::ffff:127.0.0.1]:54321"), config.ErrNotLocalAuth},
			{"Auth URL with userinfo", set(config.EnvSupabaseURL, "http://svc:"+unsafeMarker+"@127.0.0.1:54321"), config.ErrNotLocalAuth},
			{"Auth URL with a query", set(config.EnvSupabaseURL, "http://127.0.0.1:54321/auth/v1?apikey="+unsafeMarker), config.ErrNotLocalAuth},
			{"Auth URL with a fragment", set(config.EnvSupabaseURL, "http://127.0.0.1:54321/auth/v1#"+unsafeMarker), config.ErrNotLocalAuth},
			{"Auth URL of another scheme", set(config.EnvSupabaseURL, "ftp://127.0.0.1:54321/"+unsafeMarker), config.ErrNotLocalAuth},
			{"issuer with a control character", set(config.EnvSupabaseIssuer, "https://auth.ayailmu-local.test/\n"+unsafeMarker), config.ErrInvalidAuthSetting},
			{"audience longer than any", set(config.EnvSupabaseAudience, strings.Repeat("a", 300)), config.ErrInvalidAuthSetting},
			{"admin credential file by relative path", set(config.EnvSupabaseAdminKeyFile, "admin-credential"), config.ErrUnsafeSecretFile},
			{"admin credential file readable by its group", keyFile(fakeAdminKey, 0o640), config.ErrUnsafeSecretFile},
			{"admin credential file readable by everyone", keyFile(fakeAdminKey, 0o604), config.ErrUnsafeSecretFile},
			{"admin credential file writable by its group", keyFile(fakeAdminKey, 0o620), config.ErrUnsafeSecretFile},
			{"admin credential path is a directory", func(t *testing.T, env map[string]string) {
				env[config.EnvSupabaseAdminKeyFile] = t.TempDir()
			}, config.ErrUnsafeSecretFile},
			{"admin credential path is a symlink to a private file", func(t *testing.T, env map[string]string) {
				link := filepath.Join(t.TempDir(), "admin-link")
				if err := os.Symlink(adminKeyFile(t, fakeAdminKey, 0o600), link); err != nil {
					t.Fatal(err)
				}
				env[config.EnvSupabaseAdminKeyFile] = link
			}, config.ErrUnsafeSecretFile},
			{"admin credential file does not exist", func(t *testing.T, env map[string]string) {
				env[config.EnvSupabaseAdminKeyFile] = filepath.Join(t.TempDir(), "absent-admin-key")
			}, config.ErrUnsafeSecretFile},
			{"admin credential file is empty", keyFile("", 0o600), config.ErrUnsafeSecretFile},
			{"admin credential file holds two credentials", keyFile(fakeAdminKey+"\n"+fakeAdminKey+"\n", 0o600), config.ErrUnsafeSecretFile},
			{"admin credential with a space", keyFile("Bearer "+fakeAdminKey, 0o600), config.ErrUnsafeSecretFile},
			{"admin credential file larger than any credential", keyFile(strings.Repeat("k", 8<<10+1), 0o600), config.ErrUnsafeSecretFile},
			{"listen on every interface", set(config.EnvListen, "0.0.0.0:8091"), config.ErrNotLoopback},
			{"database on a remote host", set(config.EnvDatabaseURL, "postgres://aya_example:"+fakePassword+"@db.example.com:5432/aya_example"), config.ErrDatabaseNotLocal},
			{"Google credentials present", set(config.EnvGoogleCreds, "/nonexistent/service-account.json"), config.ErrRealCredentials},
		} {
			t.Run(c.name, func(t *testing.T) {
				env := localSupabaseEnv(t)
				c.edit(t, env)
				_, err := config.Load(lookupIn(env))
				if !errors.Is(err, c.want) {
					t.Fatalf("Load error = %v, want %v", err, c.want)
				}
				quoted := []string{fakeAdminKey, fakePassword, unsafeMarker}
				if path := env[config.EnvSupabaseAdminKeyFile]; filepath.IsAbs(path) {
					quoted = append(quoted, path)
				}
				for _, s := range quoted {
					if strings.Contains(err.Error(), s) {
						t.Fatal("the refusal quotes a credential, a password, a path or a configured value")
					}
				}
			})
		}
	})
}
