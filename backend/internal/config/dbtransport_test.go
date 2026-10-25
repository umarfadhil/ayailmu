package config_test

// The database transport setting. In the deploy modes, in production, in the migration job and in the ledger tool the
// database is reached over verified TLS unless AYA_DB_TRANSPORT=private-network asks, explicitly, for plaintext on a private
// network (the local Compose stack's own data network). Unset and "verified-tls" are the same strict default; any other value
// is refused naming the variable only; production refuses private-network outright; the loopback modes take no such setting.
// Whether a target may really be plaintext is decided by the store from what pgx parsed (internal/store/transport.go).

import (
	"errors"
	"testing"

	"ayailmu.local/backend/internal/config"
)

func TestDBTransportDefaultsToVerifiedTLSAndPrivateNetworkIsExplicit(t *testing.T) {
	type loaded struct {
		name string
		load func(t *testing.T, transport *string) (private bool, err error)
	}
	set := func(env map[string]string, transport *string) map[string]string {
		if transport != nil {
			env[config.EnvDBTransport] = *transport
		}
		return env
	}
	loaders := []loaded{
		{"deploy-smoke", func(t *testing.T, tr *string) (bool, error) {
			c, err := config.Load(lookupIn(set(deployEnv(t, config.ModeDeploySmoke), tr)))
			return c.DBPrivateNetwork, err
		}},
		{"local-compose", func(t *testing.T, tr *string) (bool, error) {
			c, err := config.Load(lookupIn(set(deployEnv(t, config.ModeLocalCompose), tr)))
			return c.DBPrivateNetwork, err
		}},
		{"production staging", func(t *testing.T, tr *string) (bool, error) {
			c, err := config.Load(lookupIn(set(stagingEnv(t), tr)))
			return c.DBPrivateNetwork, err
		}},
		{"migration job", func(t *testing.T, tr *string) (bool, error) {
			m, err := config.LoadMigration(lookupIn(set(migrationEnv(t), tr)))
			return m.DBPrivateNetwork, err
		}},
		{"ledger export", func(t *testing.T, tr *string) (bool, error) {
			o, err := config.LoadLedgerExport(lookupIn(set(ledgerExportEnv(t), tr)))
			return o.DBPrivateNetwork, err
		}},
		{"ledger replay", func(t *testing.T, tr *string) (bool, error) {
			o, err := config.LoadLedgerReplay(lookupIn(set(ledgerReplayEnv(t), tr)))
			return o.DBPrivateNetwork, err
		}},
	}
	str := func(s string) *string { return &s }
	for _, l := range loaders {
		production := l.name == "production staging"
		t.Run(l.name, func(t *testing.T) {
			if private, err := l.load(t, nil); err != nil || private {
				t.Fatalf("unset: private = %v, err = %v; want the strict default, loaded", private, err)
			}
			if private, err := l.load(t, str("verified-tls")); err != nil || private {
				t.Fatalf("verified-tls: private = %v, err = %v; want strict, loaded", private, err)
			}
			private, err := l.load(t, str("private-network"))
			if production {
				if !errors.Is(err, config.ErrInvalidDBTransport) {
					t.Fatalf("production with private-network: err = %v, want ErrInvalidDBTransport", err)
				}
			} else if err != nil || !private {
				t.Fatalf("private-network: private = %v, err = %v; want the explicit exception, loaded", private, err)
			}
			for _, bad := range []string{"", "Private-Network", "private_network", "plaintext", "disable", "verified-tls,private-network", " verified-tls"} {
				_, err := l.load(t, str(bad))
				if !errors.Is(err, config.ErrInvalidDBTransport) {
					t.Fatalf("value %q: err = %v, want ErrInvalidDBTransport", bad, err)
				}
				// The refusal is the fixed text and the variable's name: nothing of the rejected value.
				if got, want := err.Error(), config.ErrInvalidDBTransport.Error()+": "+config.EnvDBTransport; got != want {
					t.Fatalf("value %q: refusal = %q, want exactly %q", bad, got, want)
				}
			}
		})
	}
}

func TestLoopbackModesTakeNoDatabaseTransportSetting(t *testing.T) {
	env := map[string]string{
		config.EnvMode:             config.ModeLocalSupabase,
		config.EnvDatabaseURL:      "postgres://u:" + fakePassword + "@127.0.0.1:5432/db",
		config.EnvDBTransport:      "verified-tls",
		config.EnvSupabaseURL:      "http://127.0.0.1:9999",
		config.EnvSupabaseIssuer:   "http://127.0.0.1:9999/auth/v1",
		config.EnvSupabaseAudience: "authenticated",
	}
	if _, err := config.Load(lookupIn(env)); !errors.Is(err, config.ErrSettingNotUsed) {
		t.Fatalf("local-supabase with %s: err = %v, want ErrSettingNotUsed", config.EnvDBTransport, err)
	}
}

// migrationEnv is a complete migration job configuration: the owner's URL on the database host "db" in a private file.
func migrationEnv(t *testing.T) map[string]string {
	t.Helper()
	return map[string]string{
		config.EnvDatabaseURLFile: databaseURLFile(t, ownerDSN+"\n", 0o600),
		config.EnvDBHosts:         "db",
	}
}
