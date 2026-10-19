package config_test

// Deploy modes, Phase 8 RED. deploy-smoke (the deny-all verifier of a deployment's containers, TLS, readiness and
// database isolation) and local-compose (the local synthetic Compose stack, which trusts its own standalone GoTrue by its
// name on the stack's internal network) take only exact, explicit settings: the Host header values the service answers,
// the https web origins it grants (none means native clients only), the database hosts pgx may dial, and the database URL
// from a private file, never from the environment. Emulator and Google variables are refused even when empty, and so is a
// setting of another mode. Production stays refused with every deploy setting present. The migration job takes the
// owner's database URL the same way. Every refusal names the variable and quotes no value: no URL, path, password or
// credential.

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
	// deployHost and deployOrigin are synthetic names of the stack's HTTPS front, in a .test domain that resolves nowhere.
	deployHost   = "api.ayailmu-local.test"
	deployOrigin = "https://app.ayailmu-local.test"
	// composeAuth is the stack's own GoTrue by its name and port on the internal network.
	composeAuth = "aya-auth:9999"
	// composeIssuer is the fixed synthetic issuer the stack's GoTrue signs with.
	composeIssuer = "https://auth.ayailmu-local.test/auth/v1"
)

var (
	// deployDSN is the runtime role's database URL on the stack's database host "db", and ownerDSN the schema owner's.
	deployDSN = "postgres://aya_runtime:" + fakePassword + "@db:5432/ayailmu?sslmode=disable"
	ownerDSN  = "postgres://aya_owner:" + fakePassword + "@db:5432/ayailmu?sslmode=disable"
)

// databaseURLFile writes content to a new file of exactly mode in a test-owned directory and returns its absolute path.
func databaseURLFile(t *testing.T, content string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "database-url")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
	return path
}

// urlFile makes the database URL file a new file of mode holding content.
func urlFile(content string, mode os.FileMode) func(*testing.T, map[string]string) {
	return func(t *testing.T, env map[string]string) {
		env[config.EnvDatabaseURLFile] = databaseURLFile(t, content, mode)
	}
}

// deployEnv is a complete, valid configuration of a deploy mode: the API on every interface of its container at 8080,
// answering its HTTPS front with and without the front's port, granting one https origin, on the database host "db" with
// the runtime role's URL in a private file. local-compose also names its own GoTrue on the internal network, with its
// issuer, audience and private admin credential.
func deployEnv(t *testing.T, mode string) map[string]string {
	t.Helper()
	env := map[string]string{
		config.EnvMode:            mode,
		config.EnvListen:          "0.0.0.0:8080",
		config.EnvAllowedHosts:    deployHost + "," + deployHost + ":58443",
		config.EnvCORSOrigins:     deployOrigin,
		config.EnvDBHosts:         "db",
		config.EnvDatabaseURLFile: databaseURLFile(t, deployDSN+"\n", 0o600),
	}
	if mode == config.ModeLocalCompose {
		env[config.EnvSupabaseURL] = "http://" + composeAuth
		env[config.EnvAuthHosts] = composeAuth
		env[config.EnvSupabaseIssuer] = composeIssuer
		env[config.EnvSupabaseAudience] = "authenticated"
		env[config.EnvSupabaseAdminKeyFile] = adminKeyFile(t, fakeAdminKey+"\n", 0o600)
	}
	return env
}

// A deploy mode loads only with its settings explicit and keeps exactly what it was given: the Host values plus the
// container's own loopback health probe (never localhost:<port>), the https origins and nothing of the local web preview,
// the database hosts, and the one database URL of the private file without its final newline. local-compose also keeps
// its Auth's URL, host list, issuer, audience and admin credential; deploy-smoke configures no Auth at all. Formatting
// the configuration prints no password or credential.
func TestLoadDeployModesTakeOnlyTheirExactSettings(t *testing.T) {
	for _, mode := range []string{config.ModeDeploySmoke, config.ModeLocalCompose} {
		t.Run(mode+": a complete configuration", func(t *testing.T) {
			cfg, err := config.Load(lookupIn(deployEnv(t, mode)))
			if err != nil {
				t.Fatalf("Load(%s setup): %v", mode, err)
			}
			switch {
			case cfg.Mode != mode:
				t.Fatalf("Mode = %q, want %q", cfg.Mode, mode)
			case cfg.Listen != "0.0.0.0:8080":
				t.Fatalf("Listen = %q, want the configured 0.0.0.0:8080", cfg.Listen)
			case strings.Join(cfg.AllowedHosts, ",") != deployHost+","+deployHost+":58443,127.0.0.1:8080":
				t.Fatalf("AllowedHosts = %q, want the configured hosts and only the loopback health probe's 127.0.0.1:8080", cfg.AllowedHosts)
			case strings.Join(cfg.CORSOrigins, ",") != deployOrigin:
				t.Fatalf("CORSOrigins = %q, want exactly the configured origin", cfg.CORSOrigins)
			case strings.Join(cfg.DBHosts, ",") != "db":
				t.Fatalf("DBHosts = %q, want exactly the configured database host", cfg.DBHosts)
			case cfg.DatabaseURL.Reveal() != deployDSN:
				t.Fatal("DatabaseURL.Reveal() is not the private file's one URL without its final newline")
			case cfg.Schema != config.DefaultSchema || cfg.ExportMaxBytes != config.MaxExportBytes:
				t.Fatalf("Schema/ExportMaxBytes = %q/%d, want the defaults", cfg.Schema, cfg.ExportMaxBytes)
			}
			s := cfg.Supabase
			if mode == config.ModeLocalCompose {
				if s.URL != "http://"+composeAuth || strings.Join(s.AuthHosts, ",") != composeAuth || s.Issuer != composeIssuer ||
					s.Audience != "authenticated" || s.AdminKey.Reveal() != fakeAdminKey {
					t.Fatalf("Supabase = %q/%q/%q/%q, want the configured Auth by its internal name and the file's one credential",
						s.URL, s.AuthHosts, s.Issuer, s.Audience)
				}
			} else if s.URL != "" || len(s.AuthHosts) != 0 || s.AdminKey.Reveal() != "" {
				t.Fatal("deploy-smoke configured an Auth: it trusts no identity provider")
			}
			for _, f := range []string{fmt.Sprintf("%v", cfg), fmt.Sprintf("%+v", cfg), fmt.Sprintf("%#v", cfg)} {
				if strings.Contains(f, fakePassword) || strings.Contains(f, fakeAdminKey) {
					t.Fatal("formatting the configuration prints the database password or the admin credential")
				}
			}
		})
	}

	t.Run("no web origin means native clients only", func(t *testing.T) {
		for _, edit := range []func(*testing.T, map[string]string){unset(config.EnvCORSOrigins), set(config.EnvCORSOrigins, "")} {
			env := deployEnv(t, config.ModeDeploySmoke)
			edit(t, env)
			cfg, err := config.Load(lookupIn(env))
			if err != nil {
				t.Fatalf("Load: %v", err)
			}
			if len(cfg.CORSOrigins) != 0 {
				t.Fatalf("CORSOrigins = %q, want none: a deploy mode never falls back to the local web preview", cfg.CORSOrigins)
			}
		}
	})

	t.Run("other exact forms", func(t *testing.T) {
		for _, c := range []struct {
			name string
			mode string
			edit func(*testing.T, map[string]string)
			kept func(config.Config) bool
		}{
			{"listen on IPv4 loopback", config.ModeDeploySmoke, set(config.EnvListen, "127.0.0.1:8080"), func(got config.Config) bool {
				return strings.Join(got.AllowedHosts, ",") == deployHost+","+deployHost+":58443,127.0.0.1:8080"
			}},
			{"an IP literal Host and a second origin with its port", config.ModeDeploySmoke, func(_ *testing.T, env map[string]string) {
				env[config.EnvAllowedHosts] = deployHost + ",192.0.2.10:8443"
				env[config.EnvCORSOrigins] = deployOrigin + ",https://localhost:58443"
			}, func(got config.Config) bool {
				return strings.Join(got.AllowedHosts, ",") == deployHost+",192.0.2.10:8443,127.0.0.1:8080" &&
					strings.Join(got.CORSOrigins, ",") == deployOrigin+",https://localhost:58443"
			}},
			{"allowed primary and fallback database hosts", config.ModeDeploySmoke, func(t *testing.T, env map[string]string) {
				env[config.EnvDBHosts] = "db,db-replica"
				env[config.EnvDatabaseURLFile] = databaseURLFile(t, "postgres://aya_runtime:"+fakePassword+"@db:5432,db-replica:5432/ayailmu", 0o600)
			}, func(got config.Config) bool { return strings.Join(got.DBHosts, ",") == "db,db-replica" }},
			{"an allowed host parameter", config.ModeDeploySmoke, func(t *testing.T, env map[string]string) {
				env[config.EnvDBHosts] = "db,db-replica"
				env[config.EnvDatabaseURLFile] = databaseURLFile(t, "postgres://aya_runtime:"+fakePassword+"@db:5432/ayailmu?host=db-replica", 0o600)
			}, func(got config.Config) bool { return strings.Join(got.DBHosts, ",") == "db,db-replica" }},
			{"an IPv6 database host, listed as pgx parses it", config.ModeDeploySmoke, func(t *testing.T, env map[string]string) {
				env[config.EnvDBHosts] = "fd00::5"
				env[config.EnvDatabaseURLFile] = databaseURLFile(t, "postgres://aya_runtime:"+fakePassword+"@[fd00::5]:5432/ayailmu", 0o600)
			}, func(got config.Config) bool { return strings.Join(got.DBHosts, ",") == "fd00::5" }},
			{"a read-only database URL file without a final newline", config.ModeDeploySmoke, urlFile(deployDSN, 0o400), func(got config.Config) bool {
				return got.DatabaseURL.Reveal() == deployDSN
			}},
			{"a test schema", config.ModeDeploySmoke, set(config.EnvSchema, "aya_t_0a1b2c3d4e5f"), func(got config.Config) bool {
				return got.Schema == "aya_t_0a1b2c3d4e5f"
			}},
			{"Auth over https at its internal name", config.ModeLocalCompose, set(config.EnvSupabaseURL, "https://"+composeAuth), func(got config.Config) bool {
				return got.Supabase.URL == "https://"+composeAuth
			}},
			{"Auth under a path at its internal name", config.ModeLocalCompose, set(config.EnvSupabaseURL, "http://"+composeAuth+"/auth/v1"), func(got config.Config) bool {
				return got.Supabase.URL == "http://"+composeAuth+"/auth/v1"
			}},
		} {
			t.Run(c.mode+": "+c.name, func(t *testing.T) {
				env := deployEnv(t, c.mode)
				c.edit(t, env)
				cfg, err := config.Load(lookupIn(env))
				if err != nil {
					t.Fatalf("Load: %v", err)
				}
				if !c.kept(cfg) {
					t.Fatalf("Load kept AllowedHosts %q, CORSOrigins %q, DBHosts %q and Auth URL %q, not exactly the configured values",
						cfg.AllowedHosts, cfg.CORSOrigins, cfg.DBHosts, cfg.Supabase.URL)
				}
			})
		}
	})
}

// A deploy mode refuses, before anything is opened: production, however complete; emulator and Google variables, even
// empty; a setting of another mode; the database URL in the environment, even empty; a database URL file that is not
// private or holds more or less than one URL; a database host, fallback or host parameter outside AYA_DB_HOSTS, loopback
// included, or no host at all; malformed host lists and origins (wildcards, schemes, paths, spaces, upper case, repeats,
// the default port, plain http, null); and a listen address other than 0.0.0.0 or IPv4 loopback with an explicit port.
// local-compose also refuses an Auth URL that is not exactly one of AYA_AUTH_HOSTS, and missing or unsafe Auth settings.
// Every refusal wraps the documented error, names the variable, and quotes nothing it was given.
func TestLoadDeployModesRefuseUnsafeOrForeignSettings(t *testing.T) {
	both := []string{config.ModeDeploySmoke, config.ModeLocalCompose}
	smoke := []string{config.ModeDeploySmoke}
	compose := []string{config.ModeLocalCompose}
	for _, c := range []struct {
		name  string
		modes []string
		edit  func(*testing.T, map[string]string)
		want  error
		names string
	}{
		{"production with every deploy setting", both, set(config.EnvMode, config.ModeProduction), config.ErrProductionRefused, ""},
		{"emulator host set", both, set(config.EnvEmulatorHost, "127.0.0.1:9099"), config.ErrEmulatorEnvironment, config.EnvEmulatorHost},
		{"emulator host set but empty", both, set(config.EnvEmulatorHost, ""), config.ErrEmulatorEnvironment, config.EnvEmulatorHost},
		{"Google credentials set", both, set(config.EnvGoogleCreds, "/nonexistent/"+unsafeMarker+".json"), config.ErrRealCredentials, config.EnvGoogleCreds},
		{"Google credentials set but empty", both, set(config.EnvGoogleCreds, ""), config.ErrRealCredentials, config.EnvGoogleCreds},
		{"a Firebase project set", both, set(config.EnvProjectID, "demo-ayailmu"), config.ErrSettingNotUsed, config.EnvProjectID},
		{"the database URL in the environment", both, set(config.EnvDatabaseURL, "postgres://aya_runtime:"+unsafeMarker+"@db:5432/ayailmu"), config.ErrSecretInEnvironment, config.EnvDatabaseURL},
		{"the database URL in the environment, empty", both, set(config.EnvDatabaseURL, ""), config.ErrSecretInEnvironment, config.EnvDatabaseURL},
		{"database URL file missing", both, unset(config.EnvDatabaseURLFile), config.ErrMissing, config.EnvDatabaseURLFile},
		{"database URL file by relative path", both, set(config.EnvDatabaseURLFile, "database-url"), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"database URL file readable by its group", both, urlFile(deployDSN, 0o640), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"database URL file readable by everyone", both, urlFile(deployDSN, 0o644), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"database URL path is a directory", both, func(t *testing.T, env map[string]string) {
			env[config.EnvDatabaseURLFile] = t.TempDir()
		}, config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"database URL path is a symlink to a private file", both, func(t *testing.T, env map[string]string) {
			link := filepath.Join(t.TempDir(), "database-url-link")
			if err := os.Symlink(databaseURLFile(t, deployDSN, 0o600), link); err != nil {
				t.Fatal(err)
			}
			env[config.EnvDatabaseURLFile] = link
		}, config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"database URL file does not exist", both, func(t *testing.T, env map[string]string) {
			env[config.EnvDatabaseURLFile] = filepath.Join(t.TempDir(), "absent-database-url")
		}, config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"database URL file is empty", both, urlFile("", 0o600), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"database URL file holds two URLs", both, urlFile(deployDSN+"\n"+deployDSN+"\n", 0o600), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"database URL file holds a keyword string with spaces", both, urlFile("host=db user=aya_runtime password="+fakePassword+" dbname=ayailmu", 0o600), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"a database host outside AYA_DB_HOSTS", both, urlFile("postgres://aya_runtime:"+fakePassword+"@db.example.com:5432/ayailmu", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
		{"a fallback database host outside AYA_DB_HOSTS", both, urlFile("postgres://aya_runtime:"+fakePassword+"@db:5432,db.example.com:5432/ayailmu", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
		{"a host parameter outside AYA_DB_HOSTS", both, urlFile("postgres://aya_runtime:"+fakePassword+"@db:5432/ayailmu?host=db.example.com", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
		{"a loopback database host AYA_DB_HOSTS does not name", both, urlFile("postgres://aya_runtime:"+fakePassword+"@127.0.0.1:5432/ayailmu", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
		{"a database URL that names no host", both, urlFile("postgres://aya_runtime:"+fakePassword+"@/ayailmu", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
		{"a database URL whose hosts cannot be split", both, urlFile("postgres://aya_runtime:"+fakePassword+"@db:5432:5433/ayailmu", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
		{"database hosts missing", both, unset(config.EnvDBHosts), config.ErrMissing, config.EnvDBHosts},
		{"database hosts empty", both, set(config.EnvDBHosts, ""), config.ErrMissing, config.EnvDBHosts},
		{"database hosts with a wildcard", both, set(config.EnvDBHosts, "*"), config.ErrInvalidHostList, config.EnvDBHosts},
		{"database hosts with a space", both, set(config.EnvDBHosts, "db, db-replica"), config.ErrInvalidHostList, config.EnvDBHosts},
		{"database hosts with an empty entry", both, set(config.EnvDBHosts, "db,,db-replica"), config.ErrInvalidHostList, config.EnvDBHosts},
		{"database hosts in upper case", both, set(config.EnvDBHosts, "DB"), config.ErrInvalidHostList, config.EnvDBHosts},
		{"a database host with a port", both, set(config.EnvDBHosts, "db:5432"), config.ErrInvalidHostList, config.EnvDBHosts},
		{"allowed hosts missing", both, unset(config.EnvAllowedHosts), config.ErrMissing, config.EnvAllowedHosts},
		{"allowed hosts empty", both, set(config.EnvAllowedHosts, ""), config.ErrMissing, config.EnvAllowedHosts},
		{"an allowed host with a wildcard", both, set(config.EnvAllowedHosts, "*.ayailmu-local.test"), config.ErrInvalidHostList, config.EnvAllowedHosts},
		{"an allowed host with a scheme", both, set(config.EnvAllowedHosts, "https://"+deployHost), config.ErrInvalidHostList, config.EnvAllowedHosts},
		{"an allowed host with a path", both, set(config.EnvAllowedHosts, deployHost+"/v1"), config.ErrInvalidHostList, config.EnvAllowedHosts},
		{"an allowed host with userinfo", both, set(config.EnvAllowedHosts, unsafeMarker+"@"+deployHost), config.ErrInvalidHostList, config.EnvAllowedHosts},
		{"an allowed host in upper case", both, set(config.EnvAllowedHosts, "API.ayailmu-local.test"), config.ErrInvalidHostList, config.EnvAllowedHosts},
		{"an allowed host twice", both, set(config.EnvAllowedHosts, deployHost+","+deployHost), config.ErrInvalidHostList, config.EnvAllowedHosts},
		{"an allowed host on port zero", both, set(config.EnvAllowedHosts, deployHost+":0"), config.ErrInvalidHostList, config.EnvAllowedHosts},
		{"allowed hosts with a space", both, set(config.EnvAllowedHosts, deployHost+", localhost"), config.ErrInvalidHostList, config.EnvAllowedHosts},
		{"a web origin over plain http", both, set(config.EnvCORSOrigins, "http://app.ayailmu-local.test"), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"the local web preview as an origin", both, set(config.EnvCORSOrigins, "http://localhost:8087"), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"a wildcard origin", both, set(config.EnvCORSOrigins, "*"), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"the null origin", both, set(config.EnvCORSOrigins, "null"), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"an origin with a path", both, set(config.EnvCORSOrigins, deployOrigin+"/"), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"an origin with the default port", both, set(config.EnvCORSOrigins, deployOrigin+":443"), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"an origin in upper case", both, set(config.EnvCORSOrigins, "https://APP.ayailmu-local.test"), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"an origin with a query", both, set(config.EnvCORSOrigins, deployOrigin+"/?"+unsafeMarker), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"origins with a space", both, set(config.EnvCORSOrigins, deployOrigin+", https://localhost:58443"), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"an origin twice", both, set(config.EnvCORSOrigins, deployOrigin+","+deployOrigin), config.ErrInvalidOrigins, config.EnvCORSOrigins},
		{"listen missing", both, unset(config.EnvListen), config.ErrMissing, config.EnvListen},
		{"listen by hostname", both, set(config.EnvListen, "api:8080"), config.ErrNotDeployListen, config.EnvListen},
		{"listen on a LAN address", both, set(config.EnvListen, "192.0.2.10:8080"), config.ErrNotDeployListen, config.EnvListen},
		{"listen on every IPv6 interface", both, set(config.EnvListen, "[::]:8080"), config.ErrNotDeployListen, config.EnvListen},
		{"listen on port zero", both, set(config.EnvListen, "0.0.0.0:0"), config.ErrNotDeployListen, config.EnvListen},
		{"listen without port", both, set(config.EnvListen, "0.0.0.0"), config.ErrNotDeployListen, config.EnvListen},
		{"schema public", both, set(config.EnvSchema, "public"), config.ErrInvalidSchema, config.EnvSchema},
		{"an export limit with a unit", both, set(config.EnvExportMaxBytes, "16MiB"), config.ErrInvalidExportLimit, config.EnvExportMaxBytes},
		{"a Supabase Auth URL", smoke, set(config.EnvSupabaseURL, "http://"+composeAuth), config.ErrSettingNotUsed, config.EnvSupabaseURL},
		{"an Auth host list", smoke, set(config.EnvAuthHosts, composeAuth), config.ErrSettingNotUsed, config.EnvAuthHosts},
		{"an admin credential file", smoke, keyFile(fakeAdminKey, 0o600), config.ErrSettingNotUsed, config.EnvSupabaseAdminKeyFile},
		{"Auth URL missing", compose, unset(config.EnvSupabaseURL), config.ErrMissing, config.EnvSupabaseURL},
		{"Auth hosts missing", compose, unset(config.EnvAuthHosts), config.ErrMissing, config.EnvAuthHosts},
		{"an Auth URL host outside AYA_AUTH_HOSTS", compose, set(config.EnvSupabaseURL, "http://other-auth:9999"), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"an Auth URL on another port", compose, set(config.EnvSupabaseURL, "http://aya-auth:9998"), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"an Auth URL without its port", compose, set(config.EnvSupabaseURL, "http://aya-auth"), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"an Auth URL on loopback AYA_AUTH_HOSTS does not name", compose, set(config.EnvSupabaseURL, "http://127.0.0.1:54321"), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"an Auth URL with userinfo", compose, set(config.EnvSupabaseURL, "http://svc:"+unsafeMarker+"@"+composeAuth), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"an Auth URL with a query", compose, set(config.EnvSupabaseURL, "http://"+composeAuth+"/?apikey="+unsafeMarker), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"an Auth URL with a fragment", compose, set(config.EnvSupabaseURL, "http://"+composeAuth+"/#"+unsafeMarker), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"an Auth URL of another scheme", compose, set(config.EnvSupabaseURL, "ftp://"+composeAuth), config.ErrAuthHostNotAllowed, config.EnvSupabaseURL},
		{"Auth hosts without a port", compose, set(config.EnvAuthHosts, "aya-auth"), config.ErrInvalidHostList, config.EnvAuthHosts},
		{"Auth hosts with a wildcard", compose, set(config.EnvAuthHosts, "*:9999"), config.ErrInvalidHostList, config.EnvAuthHosts},
		{"issuer missing", compose, unset(config.EnvSupabaseIssuer), config.ErrMissing, config.EnvSupabaseIssuer},
		{"audience missing", compose, unset(config.EnvSupabaseAudience), config.ErrMissing, config.EnvSupabaseAudience},
		{"admin credential file missing", compose, unset(config.EnvSupabaseAdminKeyFile), config.ErrMissing, config.EnvSupabaseAdminKeyFile},
		{"admin credential file readable by its group", compose, keyFile(fakeAdminKey, 0o640), config.ErrUnsafeSecretFile, config.EnvSupabaseAdminKeyFile},
	} {
		for _, mode := range c.modes {
			t.Run(mode+": "+c.name, func(t *testing.T) {
				env := deployEnv(t, mode)
				c.edit(t, env)
				_, err := config.Load(lookupIn(env))
				if !errors.Is(err, c.want) {
					t.Fatalf("Load error = %v, want %v", err, c.want)
				}
				if c.names != "" && !strings.Contains(err.Error(), c.names) {
					t.Fatalf("the refusal %q does not name %s", err.Error(), c.names)
				}
				quoted := []string{fakePassword, fakeAdminKey, unsafeMarker, deployDSN}
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

// The migration job takes the owner's database URL only from its private file and dials only AYA_DB_HOSTS, under the
// deploy modes' guards: the URL in the environment (even empty), a file that is not private, a host outside the list,
// a malformed list, emulator or Google variables (even empty) and an unsafe schema are refused, naming the variable and
// quoting nothing.
func TestLoadMigrationTakesTheOwnerURLOnlyFromItsPrivateFile(t *testing.T) {
	migrationEnv := func(t *testing.T) map[string]string {
		return map[string]string{
			config.EnvDatabaseURLFile: databaseURLFile(t, ownerDSN+"\n", 0o600),
			config.EnvDBHosts:         "db",
		}
	}

	t.Run("a complete configuration", func(t *testing.T) {
		m, err := config.LoadMigration(lookupIn(migrationEnv(t)))
		switch {
		case err != nil:
			t.Fatalf("LoadMigration: %v", err)
		case m.DatabaseURL.Reveal() != ownerDSN:
			t.Fatal("DatabaseURL.Reveal() is not the private file's one URL without its final newline")
		case m.Schema != config.DefaultSchema || strings.Join(m.DBHosts, ",") != "db":
			t.Fatalf("Schema/DBHosts = %q/%q, want the default schema and exactly the configured host", m.Schema, m.DBHosts)
		}
		for _, f := range []string{fmt.Sprintf("%v", m), fmt.Sprintf("%+v", m), fmt.Sprintf("%#v", m)} {
			if strings.Contains(f, fakePassword) {
				t.Fatal("formatting the migration settings prints the database password")
			}
		}
	})

	t.Run("a test schema", func(t *testing.T) {
		env := migrationEnv(t)
		env[config.EnvSchema] = "aya_t_0a1b2c3d4e5f"
		m, err := config.LoadMigration(lookupIn(env))
		if err != nil || m.Schema != "aya_t_0a1b2c3d4e5f" {
			t.Fatalf("LoadMigration = %q, %v; want the configured test schema", m.Schema, err)
		}
	})

	t.Run("missing or unsafe settings are refused, quoting nothing", func(t *testing.T) {
		for _, c := range []struct {
			name  string
			edit  func(*testing.T, map[string]string)
			want  error
			names string
		}{
			{"the database URL in the environment", set(config.EnvDatabaseURL, ownerDSN), config.ErrSecretInEnvironment, config.EnvDatabaseURL},
			{"the database URL in the environment, empty", set(config.EnvDatabaseURL, ""), config.ErrSecretInEnvironment, config.EnvDatabaseURL},
			{"database URL file missing", unset(config.EnvDatabaseURLFile), config.ErrMissing, config.EnvDatabaseURLFile},
			{"database URL file readable by its group", urlFile(ownerDSN, 0o640), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
			{"a database host outside AYA_DB_HOSTS", urlFile("postgres://aya_owner:"+fakePassword+"@db.example.com:5432/ayailmu", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
			{"database hosts missing", unset(config.EnvDBHosts), config.ErrMissing, config.EnvDBHosts},
			{"database hosts with a wildcard", set(config.EnvDBHosts, "*"), config.ErrInvalidHostList, config.EnvDBHosts},
			{"emulator host set but empty", set(config.EnvEmulatorHost, ""), config.ErrEmulatorEnvironment, config.EnvEmulatorHost},
			{"Google credentials set but empty", set(config.EnvGoogleCreds, ""), config.ErrRealCredentials, config.EnvGoogleCreds},
			{"schema public", set(config.EnvSchema, "public"), config.ErrInvalidSchema, config.EnvSchema},
		} {
			t.Run(c.name, func(t *testing.T) {
				env := migrationEnv(t)
				c.edit(t, env)
				_, err := config.LoadMigration(lookupIn(env))
				if !errors.Is(err, c.want) {
					t.Fatalf("LoadMigration error = %v, want %v", err, c.want)
				}
				if !strings.Contains(err.Error(), c.names) {
					t.Fatalf("the refusal %q does not name %s", err.Error(), c.names)
				}
				quoted := []string{fakePassword, ownerDSN}
				if path := env[config.EnvDatabaseURLFile]; filepath.IsAbs(path) {
					quoted = append(quoted, path)
				}
				for _, s := range quoted {
					if strings.Contains(err.Error(), s) {
						t.Fatal("the refusal quotes a password, a path or a configured value")
					}
				}
			})
		}
	})
}
