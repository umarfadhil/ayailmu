package config_test

// Production mode for a staging deployment, Phase 18 RED. AYA_MODE=production stays refused unless the deployment opts in
// explicitly and exactly: the supported provider (AYA_AUTH_PROVIDER=standalone-gotrue, the self-hosted Supabase Auth this
// backend already verifies) and the deployment (AYA_DEPLOYMENT_ENV=staging). With both it takes only exact, complete
// settings, as the deploy modes do, and stricter ones: public Host values and https web origins that are public DNS names
// (never IP literals, loopback, local or test names); the Auth server's https origin by its own public name, at its root
// (no path, so never a guessed hosted /auth/v1 prefix; an explicit port for a private listener is allowed), never plain
// http or a stack-internal name; the trusted immediate proxies as exact IP literals (no CIDR, wildcard, unspecified or
// loopback address, no host name or port); the database URL and the admin credential from private files; and no emulator,
// Google credential, Firebase or local-stack setting, even empty. The other modes refuse the new staging settings instead
// of ignoring them. Every refusal names the variable and quotes nothing it was given. The host names are documented
// placeholders (example.com), never resolved or contacted.

import (
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/config"
)

// The staging settings, by name: they are new, so the tests spell them out.
const (
	stagingEnvAuthProvider   = "AYA_AUTH_PROVIDER"
	stagingEnvDeployment     = "AYA_DEPLOYMENT_ENV"
	stagingEnvTrustedProxies = "AYA_TRUSTED_PROXIES"
)

const (
	// stagingAPIHost and stagingAppOrigin are the public front's documented placeholders.
	stagingAPIHost   = "api-staging.example.com"
	stagingAppOrigin = "https://app-staging.example.com"
	// stagingAuthPrivate is Auth by its own public name on the proxy's private TLS listener (an explicit port), the origin
	// the verifier and admin calls use; stagingIssuer is the exact issuer of its tokens.
	stagingAuthPrivate = "https://auth-staging.example.com:9443"
	stagingIssuer      = "https://auth-staging.example.com"
	// stagingProxy is the TLS-terminating proxy's fixed address on the private network.
	stagingProxy = "10.30.0.2"
)

// stagingEnv is a complete, valid, explicitly opted-in staging configuration: the runtime role's database URL and the
// admin credential in private files.
func stagingEnv(t *testing.T) map[string]string {
	t.Helper()
	return map[string]string{
		config.EnvMode:                 config.ModeProduction,
		stagingEnvAuthProvider:         "standalone-gotrue",
		stagingEnvDeployment:           "staging",
		config.EnvListen:               "0.0.0.0:8080",
		config.EnvAllowedHosts:         stagingAPIHost,
		config.EnvCORSOrigins:          stagingAppOrigin,
		stagingEnvTrustedProxies:       stagingProxy,
		config.EnvDBHosts:              "db",
		config.EnvDatabaseURLFile:      databaseURLFile(t, deployDSN+"\n", 0o600),
		config.EnvSupabaseURL:          stagingAuthPrivate,
		config.EnvSupabaseIssuer:       stagingIssuer,
		config.EnvSupabaseAudience:     "authenticated",
		config.EnvSupabaseAdminKeyFile: adminKeyFile(t, fakeAdminKey+"\n", 0o600),
	}
}

// quotesNothing fails the test when err quotes a password, the admin credential, a marker, the database URL or a private
// file's path.
func quotesNothing(t *testing.T, err error, env map[string]string) {
	t.Helper()
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
}

// With its explicit opt-in and complete settings, production loads and keeps exactly what it was given: the public Host
// plus only the container's loopback health probe, the https origin, the database host and the private file's one URL,
// and Auth's private https origin, issuer, audience and the file's one credential, with no stack-internal Auth host.
// Formatting the configuration prints no password or credential.
func TestLoadProductionStagingTakesOnlyItsExactCompleteSettings(t *testing.T) {
	cfg, err := config.Load(lookupIn(stagingEnv(t)))
	if err != nil {
		t.Fatalf("Load(a complete, explicitly opted-in staging setup) = %v; want it loaded", err)
	}
	switch {
	case cfg.Mode != config.ModeProduction:
		t.Fatalf("Mode = %q, want %q", cfg.Mode, config.ModeProduction)
	case cfg.Listen != "0.0.0.0:8080":
		t.Fatalf("Listen = %q, want the configured 0.0.0.0:8080", cfg.Listen)
	case strings.Join(cfg.AllowedHosts, ",") != stagingAPIHost+",127.0.0.1:8080":
		t.Fatalf("AllowedHosts = %q, want the public Host and only the loopback health probe's 127.0.0.1:8080", cfg.AllowedHosts)
	case strings.Join(cfg.CORSOrigins, ",") != stagingAppOrigin:
		t.Fatalf("CORSOrigins = %q, want exactly the configured origin", cfg.CORSOrigins)
	case strings.Join(cfg.DBHosts, ",") != "db":
		t.Fatalf("DBHosts = %q, want exactly the configured database host", cfg.DBHosts)
	case cfg.DatabaseURL.Reveal() != deployDSN:
		t.Fatal("DatabaseURL.Reveal() is not the private file's one URL without its final newline")
	case cfg.Schema != config.DefaultSchema || cfg.ExportMaxBytes != config.MaxExportBytes:
		t.Fatalf("Schema/ExportMaxBytes = %q/%d, want the defaults", cfg.Schema, cfg.ExportMaxBytes)
	}
	s := cfg.Supabase
	if s.URL != stagingAuthPrivate || s.Issuer != stagingIssuer || s.Audience != "authenticated" || s.AdminKey.Reveal() != fakeAdminKey ||
		len(s.AuthHosts) != 0 {
		t.Fatalf("Supabase = %q/%q/%q/%q, want Auth's private https origin, issuer and audience, the file's one credential and no internal host",
			s.URL, s.Issuer, s.Audience, s.AuthHosts)
	}
	for _, f := range []string{fmt.Sprintf("%v", cfg), fmt.Sprintf("%+v", cfg), fmt.Sprintf("%#v", cfg)} {
		if strings.Contains(f, fakePassword) || strings.Contains(f, fakeAdminKey) {
			t.Fatal("formatting the configuration prints the database password or the admin credential")
		}
	}

	for _, c := range []struct {
		name string
		edit func(*testing.T, map[string]string)
		kept func(config.Config) bool
	}{
		{"Auth at its public root, without a port", set(config.EnvSupabaseURL, "https://auth-staging.example.com"), func(got config.Config) bool {
			return got.Supabase.URL == "https://auth-staging.example.com"
		}},
		{"two public Host values and two origins", func(_ *testing.T, env map[string]string) {
			env[config.EnvAllowedHosts] = stagingAPIHost + ",api-staging-2.example.com"
			env[config.EnvCORSOrigins] = stagingAppOrigin + ",https://app-staging-2.example.com"
		}, func(got config.Config) bool {
			return strings.Join(got.AllowedHosts, ",") == stagingAPIHost+",api-staging-2.example.com,127.0.0.1:8080" &&
				strings.Join(got.CORSOrigins, ",") == stagingAppOrigin+",https://app-staging-2.example.com"
		}},
		{"two trusted proxies, one of them IPv6", set(stagingEnvTrustedProxies, stagingProxy+",fd00:30::2"), func(got config.Config) bool {
			return got.Mode == config.ModeProduction
		}},
		{"listen on IPv4 loopback", set(config.EnvListen, "127.0.0.1:8080"), func(got config.Config) bool {
			return strings.Join(got.AllowedHosts, ",") == stagingAPIHost+",127.0.0.1:8080"
		}},
	} {
		t.Run(c.name, func(t *testing.T) {
			env := stagingEnv(t)
			c.edit(t, env)
			got, err := config.Load(lookupIn(env))
			if err != nil {
				t.Fatalf("Load = %v; want this exact form loaded", err)
			}
			if !c.kept(got) {
				t.Fatalf("Load kept AllowedHosts %q, CORSOrigins %q and Auth URL %q, not exactly the configured values",
					got.AllowedHosts, got.CORSOrigins, got.Supabase.URL)
			}
		})
	}
}

// Production without both explicit opt-ins, exactly spelled, stays refused wholesale, however complete the rest; and no
// generic AYA_MODE=staging exists. These already hold and must keep holding.
func TestLoadProductionStaysRefusedWithoutItsExplicitOptIn(t *testing.T) {
	for _, c := range []struct {
		name string
		env  func(*testing.T) map[string]string
		want error
	}{
		{"bare production", func(*testing.T) map[string]string { return map[string]string{config.EnvMode: config.ModeProduction} }, config.ErrProductionRefused},
		{"no provider opt-in", without(stagingEnvAuthProvider), config.ErrProductionRefused},
		{"no deployment opt-in", without(stagingEnvDeployment), config.ErrProductionRefused},
		{"the local synthetic provider", with(stagingEnvAuthProvider, "local-supabase"), config.ErrProductionRefused},
		{"a hosted provider", with(stagingEnvAuthProvider, "supabase"), config.ErrProductionRefused},
		{"the provider in another case", with(stagingEnvAuthProvider, "Standalone-GoTrue"), config.ErrProductionRefused},
		{"the provider with a trailing space", with(stagingEnvAuthProvider, "standalone-gotrue "), config.ErrProductionRefused},
		{"the provider empty", with(stagingEnvAuthProvider, ""), config.ErrProductionRefused},
		{"a production deployment", with(stagingEnvDeployment, "production"), config.ErrProductionRefused},
		{"the deployment in another case", with(stagingEnvDeployment, "Staging"), config.ErrProductionRefused},
		{"the deployment empty", with(stagingEnvDeployment, ""), config.ErrProductionRefused},
		{"a generic staging mode", with(config.EnvMode, "staging"), config.ErrInvalidMode},
	} {
		t.Run(c.name, func(t *testing.T) {
			env := c.env(t)
			_, err := config.Load(lookupIn(env))
			if !errors.Is(err, c.want) {
				t.Fatalf("Load error = %v, want %v", err, c.want)
			}
			quotesNothing(t, err, env)
		})
	}
}

// without is stagingEnv with name unset; with is stagingEnv with name set to value.
func without(name string) func(*testing.T) map[string]string {
	return func(t *testing.T) map[string]string {
		env := stagingEnv(t)
		delete(env, name)
		return env
	}
}

func with(name, value string) func(*testing.T) map[string]string {
	return func(t *testing.T) map[string]string {
		env := stagingEnv(t)
		env[name] = value
		return env
	}
}

// With both opt-ins, production refuses, before anything is opened, every unsafe, incomplete or foreign setting, for that
// setting's own reason rather than wholesale. want is the documented error where one fits; nil means a refusal of the
// named variable that is not ErrProductionRefused.
func TestLoadProductionStagingRefusesUnsafeOrForeignSettings(t *testing.T) {
	type refusal struct {
		name  string
		edit  func(*testing.T, map[string]string)
		want  error
		names string
	}
	cases := []refusal{
		{"the emulator host, even empty", set(config.EnvEmulatorHost, ""), config.ErrEmulatorEnvironment, config.EnvEmulatorHost},
		{"Google credentials, even empty", set(config.EnvGoogleCreds, ""), config.ErrRealCredentials, config.EnvGoogleCreds},
		{"a Firebase project", set(config.EnvProjectID, "demo-ayailmu"), config.ErrSettingNotUsed, config.EnvProjectID},
		{"the local stack's internal Auth hosts", set(config.EnvAuthHosts, "aya-auth:9999"), config.ErrSettingNotUsed, config.EnvAuthHosts},
		{"the database URL in the environment, even empty", set(config.EnvDatabaseURL, ""), config.ErrSecretInEnvironment, config.EnvDatabaseURL},
		{"the database URL in the environment", set(config.EnvDatabaseURL, "postgres://aya_runtime:"+unsafeMarker+"@db:5432/ayailmu"), config.ErrSecretInEnvironment, config.EnvDatabaseURL},
		{"database URL file missing", unset(config.EnvDatabaseURLFile), config.ErrMissing, config.EnvDatabaseURLFile},
		{"database URL file readable by its group", urlFile(deployDSN, 0o640), config.ErrUnsafeSecretFile, config.EnvDatabaseURLFile},
		{"a database host outside AYA_DB_HOSTS", urlFile("postgres://aya_runtime:"+fakePassword+"@db.example.com:5432/ayailmu", 0o600), config.ErrDatabaseHostNotAllowed, config.EnvDatabaseURLFile},
		{"database hosts missing", unset(config.EnvDBHosts), config.ErrMissing, config.EnvDBHosts},
		{"admin credential file missing", unset(config.EnvSupabaseAdminKeyFile), config.ErrMissing, config.EnvSupabaseAdminKeyFile},
		{"admin credential file readable by its group", keyFile(fakeAdminKey, 0o640), config.ErrUnsafeSecretFile, config.EnvSupabaseAdminKeyFile},
		{"issuer missing", unset(config.EnvSupabaseIssuer), config.ErrMissing, config.EnvSupabaseIssuer},
		{"audience missing", unset(config.EnvSupabaseAudience), config.ErrMissing, config.EnvSupabaseAudience},
		{"an issuer with a space", set(config.EnvSupabaseIssuer, stagingIssuer+" x"), config.ErrInvalidAuthSetting, config.EnvSupabaseIssuer},
		{"listen missing", unset(config.EnvListen), config.ErrMissing, config.EnvListen},
		{"listen on every IPv6 interface", set(config.EnvListen, "[::]:8080"), config.ErrNotDeployListen, config.EnvListen},
		{"public Host values missing", unset(config.EnvAllowedHosts), config.ErrMissing, config.EnvAllowedHosts},
		{"web origins missing: production names them explicitly", unset(config.EnvCORSOrigins), config.ErrMissing, config.EnvCORSOrigins},
		{"web origins empty", set(config.EnvCORSOrigins, ""), config.ErrMissing, config.EnvCORSOrigins},
		{"trusted proxies missing", unset(stagingEnvTrustedProxies), config.ErrMissing, stagingEnvTrustedProxies},
		{"trusted proxies empty", set(stagingEnvTrustedProxies, ""), config.ErrMissing, stagingEnvTrustedProxies},
	}
	for _, v := range []string{"10.30.0.0/24", "0.0.0.0/0", "::/0", "0.0.0.0", "::", "*", "127.0.0.1", "::1", "proxy", "edge.example.com",
		stagingProxy + ":443", stagingProxy + "," + stagingProxy, stagingProxy + ", 10.30.0.3", "fd00:30:0::2", "[fd00:30::2]"} {
		cases = append(cases, refusal{"a trusted proxy written " + v, set(stagingEnvTrustedProxies, v), config.ErrInvalidHostList, stagingEnvTrustedProxies})
	}
	for _, v := range []string{"api.ayailmu-local.test", "localhost", "api.localhost", "api.local", "api.internal", "api", "192.0.2.10",
		"10.30.0.5", "[2001:db8::1]", "*.example.com"} {
		cases = append(cases, refusal{"a public Host written " + v, set(config.EnvAllowedHosts, v), config.ErrInvalidHostList, config.EnvAllowedHosts})
	}
	for _, v := range []string{"https://app.ayailmu-local.test", "https://localhost:8443", "https://192.0.2.10", "http://app-staging.example.com",
		"https://app-staging.example.com:443", "*", "null"} {
		cases = append(cases, refusal{"a web origin written " + v, set(config.EnvCORSOrigins, v), config.ErrInvalidOrigins, config.EnvCORSOrigins})
	}
	for _, c := range []struct{ name, url string }{
		{"plain http", "http://auth-staging.example.com:9443"},
		{"the hosted /auth/v1 prefix", "https://auth-staging.example.com/auth/v1"},
		{"a trailing slash", "https://auth-staging.example.com/"},
		{"userinfo", "https://svc:" + unsafeMarker + "@auth-staging.example.com"},
		{"a query", "https://auth-staging.example.com?apikey=" + unsafeMarker},
		{"a fragment", "https://auth-staging.example.com#" + unsafeMarker},
		{"a loopback address", "https://127.0.0.1:9443"},
		{"a private address", "https://10.30.0.3:9443"},
		{"an IPv6 address", "https://[fd00:30::3]:9443"},
		{"the local stack's internal name", "https://aya-auth:9999"},
		{"a test domain", "https://auth.ayailmu-local.test"},
		{"localhost", "https://localhost:9443"},
		{"upper case", "https://AUTH-staging.example.com"},
		{"a trailing dot", "https://auth-staging.example.com."},
		{"a wildcard", "https://*.example.com"},
		{"port zero", "https://auth-staging.example.com:0"},
		{"a port with a leading zero", "https://auth-staging.example.com:09443"},
		{"a port out of range", "https://auth-staging.example.com:65536"},
		{"an encoded authority", "https://auth-staging.example.com%2F@evil.example.com"},
		{"a backslash", `https://auth-staging.example.com\@evil.example.com`},
		{"a trailing space", "https://auth-staging.example.com "},
		{"a control character", "https://auth-staging.example.com\t"},
		{"another scheme", "wss://auth-staging.example.com"},
	} {
		cases = append(cases, refusal{"an Auth URL with " + c.name, set(config.EnvSupabaseURL, c.url), nil, config.EnvSupabaseURL})
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			env := stagingEnv(t)
			c.edit(t, env)
			_, err := config.Load(lookupIn(env))
			switch {
			case err == nil:
				t.Fatal("Load accepted the setup; want a refusal before anything is opened")
			case errors.Is(err, config.ErrProductionRefused):
				t.Fatalf("Load refused production wholesale (%v); with both opt-ins it must refuse %s for its own reason", err, c.names)
			case c.want != nil && !errors.Is(err, c.want):
				t.Fatalf("Load error = %v, want %v", err, c.want)
			case !strings.Contains(err.Error(), c.names):
				t.Fatalf("the refusal %q does not name %s", err.Error(), c.names)
			}
			quotesNothing(t, err, env)
		})
	}
}

// The other modes refuse the staging settings instead of ignoring them: no deploy or loopback mode is silently turned
// toward real remote resources or a proxy's say-so.
func TestLoadOtherModesRefuseTheStagingSettings(t *testing.T) {
	for _, c := range []struct {
		mode string
		env  func(*testing.T) map[string]string
		name string
	}{
		{config.ModeDeploySmoke, func(t *testing.T) map[string]string { return deployEnv(t, config.ModeDeploySmoke) }, stagingEnvAuthProvider},
		{config.ModeDeploySmoke, func(t *testing.T) map[string]string { return deployEnv(t, config.ModeDeploySmoke) }, stagingEnvTrustedProxies},
		{config.ModeLocalCompose, func(t *testing.T) map[string]string { return deployEnv(t, config.ModeLocalCompose) }, stagingEnvDeployment},
		{config.ModeLocalCompose, func(t *testing.T) map[string]string { return deployEnv(t, config.ModeLocalCompose) }, stagingEnvTrustedProxies},
		{config.ModeLocalSupabase, localSupabaseEnv, stagingEnvDeployment},
		{config.ModeLocalSupabase, localSupabaseEnv, stagingEnvAuthProvider},
	} {
		t.Run(c.mode+" with "+c.name, func(t *testing.T) {
			env := c.env(t)
			env[c.name] = map[string]string{stagingEnvAuthProvider: "standalone-gotrue", stagingEnvDeployment: "staging", stagingEnvTrustedProxies: stagingProxy}[c.name]
			_, err := config.Load(lookupIn(env))
			if !errors.Is(err, config.ErrSettingNotUsed) {
				t.Fatalf("Load error = %v, want ErrSettingNotUsed: %s is a staging setting", err, c.name)
			}
			if !strings.Contains(err.Error(), c.name) {
				t.Fatalf("the refusal %q does not name %s", err.Error(), c.name)
			}
			quotesNothing(t, err, env)
		})
	}
}
