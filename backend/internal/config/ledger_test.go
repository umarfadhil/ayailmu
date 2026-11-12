package config_test

// Deletion-ledger operator settings, Phase 9 RED. The operator tool (cmd/ayailmu-ledger) takes the operator's database
// URL only from its private file and dials only AYA_DB_HOSTS, under the migration job's guards, and the trusted issuer
// explicitly. An export takes nothing of Auth but that issuer, and refuses the admin credential and the rest of Auth's
// settings. A replay also takes the stack's own Auth exactly as local-compose does, by its name on the internal network,
// with its private admin credential, to delete each entry's exact identity. Every refusal names the variable and quotes
// no value: no URL, path, password or credential.

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/config"
)

// ledgerExportEnv is a complete export configuration: the owner's URL on the database host "db" in a private file, and
// the stack's issuer.
func ledgerExportEnv(t *testing.T) map[string]string {
	t.Helper()
	return map[string]string{
		config.EnvDatabaseURLFile: databaseURLFile(t, ownerDSN+"\n", 0o600),
		config.EnvDBHosts:         "db",
		config.EnvSupabaseIssuer:  composeIssuer,
	}
}

// ledgerReplayEnv is a complete replay configuration: the export's, and the stack's own Auth by its internal name with
// its audience and private admin credential.
func ledgerReplayEnv(t *testing.T) map[string]string {
	t.Helper()
	env := ledgerExportEnv(t)
	env[config.EnvSupabaseURL] = "http://" + composeAuth
	env[config.EnvAuthHosts] = composeAuth
	env[config.EnvSupabaseAudience] = "authenticated"
	env[config.EnvSupabaseAdminKeyFile] = adminKeyFile(t, fakeAdminKey+"\n", 0o600)
	return env
}

// noSecretFormatted fails the test if formatting op prints the database password or the admin credential.
func noSecretFormatted(t *testing.T, op config.LedgerOperator) {
	t.Helper()
	for _, f := range []string{fmt.Sprintf("%v", op), fmt.Sprintf("%+v", op), fmt.Sprintf("%#v", op)} {
		if strings.Contains(f, fakePassword) || strings.Contains(f, fakeAdminKey) {
			t.Fatal("formatting the ledger settings prints the database password or the admin credential")
		}
	}
}

// An export keeps exactly the private file's one URL without its final newline, the database host, the schema and the
// trusted issuer, and configures no Auth. A replay also keeps the stack's Auth: its URL, host list, issuer, audience
// and the file's one admin credential. Neither prints a secret when formatted.
func TestLoadLedgerSettingsTakeOnlyTheOperatorsExplicitSettings(t *testing.T) {
	t.Run("an export", func(t *testing.T) {
		op, err := config.LoadLedgerExport(lookupIn(ledgerExportEnv(t)))
		switch {
		case err != nil:
			t.Fatalf("LoadLedgerExport: %v", err)
		case op.DatabaseURL.Reveal() != ownerDSN:
			t.Fatal("DatabaseURL.Reveal() is not the private file's one URL without its final newline")
		case op.Schema != config.DefaultSchema || strings.Join(op.DBHosts, ",") != "db":
			t.Fatalf("Schema/DBHosts = %q/%q, want the default schema and exactly the configured host", op.Schema, op.DBHosts)
		case op.Issuer != composeIssuer:
			t.Fatalf("Issuer = %q, want exactly the configured issuer", op.Issuer)
		case op.Supabase.URL != "" || len(op.Supabase.AuthHosts) != 0 || op.Supabase.AdminKey.Reveal() != "":
			t.Fatal("an export configured an Auth: it deletes no identity")
		}
		noSecretFormatted(t, op)
	})
	t.Run("a replay", func(t *testing.T) {
		op, err := config.LoadLedgerReplay(lookupIn(ledgerReplayEnv(t)))
		if err != nil {
			t.Fatalf("LoadLedgerReplay: %v", err)
		}
		s := op.Supabase
		switch {
		case op.DatabaseURL.Reveal() != ownerDSN || strings.Join(op.DBHosts, ",") != "db" || op.Schema != config.DefaultSchema:
			t.Fatal("the replay's database settings are not exactly the configured ones")
		case op.Issuer != composeIssuer || s.Issuer != composeIssuer:
			t.Fatalf("Issuer = %q/%q, want exactly the configured issuer", op.Issuer, s.Issuer)
		case s.URL != "http://"+composeAuth || strings.Join(s.AuthHosts, ",") != composeAuth || s.Audience != "authenticated":
			t.Fatalf("Auth = %q/%q/%q, want the stack's Auth by its internal name", s.URL, s.AuthHosts, s.Audience)
		case s.AdminKey.Reveal() != fakeAdminKey:
			t.Fatal("AdminKey.Reveal() is not the private file's one credential without its final newline")
		}
		noSecretFormatted(t, op)
	})
	t.Run("a test schema", func(t *testing.T) {
		for name, load := range map[string]func(func(string) (string, bool)) (config.LedgerOperator, error){
			"export": config.LoadLedgerExport, "replay": config.LoadLedgerReplay,
		} {
			env := ledgerReplayEnv(t)
			if name == "export" {
				env = ledgerExportEnv(t)
			}
			env[config.EnvSchema] = "aya_t_0a1b2c3d4e5f"
			if op, err := load(lookupIn(env)); err != nil || op.Schema != "aya_t_0a1b2c3d4e5f" {
				t.Fatalf("%s: Schema = %q, %v; want the configured test schema", name, op.Schema, err)
			}
		}
	})
}

// Missing, unsafe or foreign settings are refused before anything is opened: the database URL in the environment, even
// empty; a URL file that is not private; a database host outside the list; emulator or Google variables, even empty; an
// unsafe schema; a missing or malformed issuer; for an export, any Auth setting but the issuer, even empty; for a
// replay, a missing or unlisted Auth URL, missing Auth hosts or audience, and a missing or unsafe admin credential file.
// Every refusal wraps the documented error, names the variable and quotes nothing it was given.
func TestLoadLedgerSettingsRefuseUnsafeOrForeignSettings(t *testing.T) {
	both, exportOnly, replayOnly := []string{"export", "replay"}, []string{"export"}, []string{"replay"}
	for _, c := range []struct {
		name  string
		loads []string
		edit  func(*testing.T, map[string]string)
		want  error
		names string
	}{
		{"the database URL in the environment", both, set(config.EnvDatabaseURL, ownerDSN), config.ErrSecretInEnvironment, config.EnvDatabaseURL},
		{"the database URL in the environment, empty", both, set(config.EnvDatabaseURL, ""), config.ErrSecretInEnvironment, config.EnvDatabaseURL},
		{"database URL file missing", both, unset(config.EnvDatabaseURLFile), config.ErrMissing, config.EnvDatabaseURLFile},
		{"database URL file readable by its group", both, urlFile(ownerDSN, 0o640), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"a database host outside AYA_DB_HOSTS", both, urlFile("postgres://aya_owner:"+fakePassword+"@db.example.com:5432/ayailmu", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
		{"database hosts missing", both, unset(config.EnvDBHosts), config.ErrMissing, config.EnvDBHosts},
		{"emulator host set but empty", both, set(config.EnvEmulatorHost, ""), config.ErrEmulatorEnvironment, config.EnvEmulatorHost},
		{"Google credentials set but empty", both, set(config.EnvGoogleCreds, ""), config.ErrRealCredentials, config.EnvGoogleCreds},
		{"schema public", both, set(config.EnvSchema, "public"), config.ErrInvalidSchema, config.EnvSchema},
		{"issuer missing", both, unset(config.EnvSupabaseIssuer), config.ErrMissing, config.EnvSupabaseIssuer},
		{"an issuer with a space", both, set(config.EnvSupabaseIssuer, "https://auth.ayailmu-local.test/auth "+unsafeMarker), config.ErrInvalidAuthSetting, config.EnvSupabaseIssuer},
		{"an export given the admin credential file", exportOnly, keyFile(fakeAdminKey, 0o600), config.ErrSettingNotUsed, config.EnvSupabaseAdminKeyFile},
		{"an export given the admin credential file, empty", exportOnly, set(config.EnvSupabaseAdminKeyFile, ""), config.ErrSettingNotUsed, config.EnvSupabaseAdminKeyFile},
		{"an export given the Auth URL", exportOnly, set(config.EnvSupabaseURL, "http://"+composeAuth), config.ErrSettingNotUsed, config.EnvSupabaseURL},
		{"an export given the Auth hosts", exportOnly, set(config.EnvAuthHosts, composeAuth), config.ErrSettingNotUsed, config.EnvAuthHosts},
		{"an export given the audience", exportOnly, set(config.EnvSupabaseAudience, "authenticated"), config.ErrSettingNotUsed, config.EnvSupabaseAudience},
		{"Auth URL missing", replayOnly, unset(config.EnvSupabaseURL), config.ErrMissing, config.EnvSupabaseURL},
		{"an Auth URL outside AYA_AUTH_HOSTS", replayOnly, set(config.EnvSupabaseURL, "http://other-auth:9999"), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"an Auth URL with userinfo", replayOnly, set(config.EnvSupabaseURL, "http://svc:"+unsafeMarker+"@"+composeAuth), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"Auth hosts missing", replayOnly, unset(config.EnvAuthHosts), config.ErrMissing, config.EnvAuthHosts},
		{"audience missing", replayOnly, unset(config.EnvSupabaseAudience), config.ErrMissing, config.EnvSupabaseAudience},
		{"admin credential file missing", replayOnly, unset(config.EnvSupabaseAdminKeyFile), config.ErrMissing, config.EnvSupabaseAdminKeyFile},
		{"admin credential file readable by everyone", replayOnly, keyFile(fakeAdminKey, 0o644), config.ErrUnsafeSecretFile, config.EnvSupabaseAdminKeyFile},
	} {
		for _, load := range c.loads {
			t.Run(load+": "+c.name, func(t *testing.T) {
				env, loader := ledgerExportEnv(t), config.LoadLedgerExport
				if load == "replay" {
					env, loader = ledgerReplayEnv(t), config.LoadLedgerReplay
				}
				c.edit(t, env)
				_, err := loader(lookupIn(env))
				if !errors.Is(err, c.want) {
					t.Fatalf("%s error = %v, want %v", load, err, c.want)
				}
				if !strings.Contains(err.Error(), c.names) {
					t.Fatalf("the refusal %q does not name %s", err.Error(), c.names)
				}
				quoted := []string{fakePassword, fakeAdminKey, unsafeMarker, ownerDSN}
				for _, name := range []string{config.EnvDatabaseURLFile, config.EnvSupabaseAdminKeyFile} {
					if path := env[name]; filepath.IsAbs(path) {
						quoted = append(quoted, path)
					}
				}
				for _, s := range quoted {
					if strings.Contains(err.Error(), s) {
						t.Fatal("the refusal quotes a password, a credential, a path or a configured value")
					}
				}
			})
		}
	}
}
