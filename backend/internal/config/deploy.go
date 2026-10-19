package config

import (
	"errors"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
)

// The deploy modes (Phase 8). Neither is production: ModeProduction stays refused.
const (
	// ModeDeploySmoke is the deny-all verifier of a deployment's containers, TLS, readiness and database isolation. It takes
	// only the exact deploy settings below, serves health and readiness, and accepts no token at all, so no data can be read
	// or written. It is never production authentication.
	ModeDeploySmoke = "deploy-smoke"
	// ModeLocalCompose is the local synthetic Compose stack: the API, its PostgreSQL and its own standalone Supabase Auth
	// (GoTrue) on the stack's internal networks. It takes the exact deploy settings below and the local-supabase Auth
	// settings, whose Auth URL must name exactly one of AYA_AUTH_HOSTS. Its accounts record the local-supabase provider
	// kind. For synthetic local fixtures only.
	ModeLocalCompose = "local-compose"
)

// Deploy settings. A list is comma-separated, without spaces, and names each entry once.
const (
	// EnvAllowedHosts lists the exact Host header values the service answers: lowercase host names or IP literals, each
	// with an optional port. The container's own loopback health probe (127.0.0.1:<listen port>) is added; nothing else is.
	EnvAllowedHosts = "AYA_ALLOWED_HOSTS"
	// EnvCORSOrigins lists the exact https web origins the CORS gate grants. Unset or empty means native clients only.
	EnvCORSOrigins = "AYA_CORS_ORIGINS"
	// EnvDBHosts lists the exact database hosts (host names, IP literals or socket directories, without ports): every host
	// the database URL names, and every host pgx parses from it, must be one of them.
	EnvDBHosts = "AYA_DB_HOSTS"
	// EnvDatabaseURLFile is the absolute path of the private file that holds the database URL, one postgres:// URL on one
	// line. In the deploy modes AYA_DATABASE_URL must be unset.
	EnvDatabaseURLFile = "AYA_DATABASE_URL_FILE"
	// EnvAuthHosts lists, in ModeLocalCompose, the exact host:port values the Supabase Auth URL may name on the stack's
	// internal network.
	EnvAuthHosts = "AYA_AUTH_HOSTS"
)

// maxSocketDirBytes bounds a socket directory of AYA_DB_HOSTS.
const maxSocketDirBytes = 1 << 10

// Deploy guard failures. Like the others, Load wraps exactly one of them with the variable's name and never its value.
var (
	// ErrInvalidHostList reports a malformed AYA_ALLOWED_HOSTS, AYA_DB_HOSTS or AYA_AUTH_HOSTS.
	ErrInvalidHostList = errors.New("config: a host list must name exact lowercase host names or IP literals (with a port where the setting takes one), comma-separated without spaces, each once")
	// ErrInvalidOrigins reports a malformed AYA_CORS_ORIGINS.
	ErrInvalidOrigins = errors.New("config: the web origins must be exact https origins (a lowercase host and an optional non-default port, no path), comma-separated without spaces, each once")
	// ErrDatabaseHostNotAllowed reports a database URL that names a host outside AYA_DB_HOSTS, or no host at all.
	ErrDatabaseHostNotAllowed = errors.New("config: every database host the database URL names must be one of AYA_DB_HOSTS")
	// ErrAuthHostNotAllowed reports, in ModeLocalCompose, a Supabase Auth URL whose host and port are not exactly one of
	// AYA_AUTH_HOSTS.
	ErrAuthHostNotAllowed = errors.New("config: the Supabase Auth URL must be http or https to exactly one of AYA_AUTH_HOSTS, port included, without userinfo, query or fragment")
	// ErrEmulatorEnvironment reports FIREBASE_AUTH_EMULATOR_HOST set, even empty, in a deploy mode or the migration job.
	ErrEmulatorEnvironment = errors.New("config: FIREBASE_AUTH_EMULATOR_HOST must be unset, even empty, outside emulator mode")
	// ErrSecretInEnvironment reports AYA_DATABASE_URL set, even empty, where the database URL must come from its file.
	ErrSecretInEnvironment = errors.New("config: the database URL must come from its private file (AYA_DATABASE_URL_FILE); AYA_DATABASE_URL must be unset, even empty")
	// ErrNotDeployListen reports a deploy listen address that is not 0.0.0.0 or a literal IPv4 loopback address with an
	// explicit non-zero port.
	ErrNotDeployListen = errors.New("config: the deploy listen address must be 0.0.0.0 or a literal IPv4 loopback address with an explicit non-zero port")
	// ErrSettingNotUsed reports a setting of another mode, which a deploy mode refuses rather than ignores.
	ErrSettingNotUsed = errors.New("config: a setting of another mode is set; a deploy mode takes only its own settings")
)

// Migration is the configuration of the migration job (cmd/ayailmu-migrate), which applies the embedded migrations as
// the schema's owner and exits: the owner's database URL from its private file (AYA_DATABASE_URL_FILE), the schema, and
// the exact database hosts pgx may dial (AYA_DB_HOSTS).
type Migration struct {
	DatabaseURL Secret
	Schema      string
	DBHosts     []string
}

// IsDeployMode reports whether mode is one of the deploy modes, whose service verifies its schema instead of migrating it.
func IsDeployMode(mode string) bool {
	return mode == ModeDeploySmoke || mode == ModeLocalCompose
}

// LoadMigration reads the migration job's settings through lookup, under the deploy guards that apply to it: the
// database URL from its private file only, every database host in AYA_DB_HOSTS, and no emulator or Google variable,
// even empty.
func LoadMigration(lookup func(string) (string, bool)) (Migration, error) {
	if err := refuseLocalVariables(lookup); err != nil {
		return Migration{}, err
	}
	dsn, hosts, err := loadDeployDatabase(lookup)
	if err != nil {
		return Migration{}, err
	}
	schema, err := loadSchema(getter(lookup))
	if err != nil {
		return Migration{}, err
	}
	return Migration{DatabaseURL: dsn, Schema: schema, DBHosts: hosts}, nil
}

// loadDeploy reads a deploy mode's settings, which are all explicit: no listen address, Host or database default, and
// no fallback to the loopback modes' local web preview. A setting of another mode is refused, not ignored.
func loadDeploy(mode string, lookup func(string) (string, bool)) (Config, error) {
	get := getter(lookup)
	if err := refuseLocalVariables(lookup); err != nil {
		return Config{}, err
	}
	foreign := []string{EnvProjectID}
	if mode == ModeDeploySmoke {
		foreign = append(foreign, EnvSupabaseURL, EnvAuthHosts, EnvSupabaseIssuer, EnvSupabaseAudience, EnvSupabaseAdminKeyFile)
	}
	for _, name := range foreign {
		if _, set := lookup(name); set {
			return Config{}, refuse(ErrSettingNotUsed, name)
		}
	}
	dsn, dbHosts, err := loadDeployDatabase(lookup)
	if err != nil {
		return Config{}, err
	}

	listen := get(EnvListen)
	if listen == "" {
		return Config{}, refuse(ErrMissing, EnvListen)
	}
	probe, ok := deployListen(listen)
	if !ok {
		return Config{}, refuse(ErrNotDeployListen, EnvListen)
	}
	hosts, err := loadList(get, EnvAllowedHosts, isAllowedHost)
	if err != nil {
		return Config{}, err
	}
	if !slices.Contains(hosts, probe) {
		hosts = append(hosts, probe)
	}
	var origins []string
	if v := get(EnvCORSOrigins); v != "" {
		if origins, ok = splitList(v, isWebOrigin); !ok {
			return Config{}, refuse(ErrInvalidOrigins, EnvCORSOrigins)
		}
	}

	schema, err := loadSchema(get)
	if err != nil {
		return Config{}, err
	}
	exportMax, err := loadExportLimit(get)
	if err != nil {
		return Config{}, err
	}
	var supabase Supabase
	if mode == ModeLocalCompose {
		if supabase, err = loadComposeAuth(get); err != nil {
			return Config{}, err
		}
	}
	return Config{
		Mode:           mode,
		Listen:         listen,
		AllowedHosts:   hosts,
		CORSOrigins:    origins,
		DatabaseURL:    dsn,
		DBHosts:        dbHosts,
		Schema:         schema,
		ExportMaxBytes: exportMax,
		Supabase:       supabase,
	}, nil
}

// loadComposeAuth reads local-compose's Auth: the exact host:port list of AYA_AUTH_HOSTS, an Auth URL naming exactly one
// of them, and the issuer, audience and admin credential as in ModeLocalSupabase.
func loadComposeAuth(get func(string) string) (Supabase, error) {
	s := Supabase{URL: get(EnvSupabaseURL)}
	if s.URL == "" {
		return Supabase{}, refuse(ErrMissing, EnvSupabaseURL)
	}
	hosts, err := loadList(get, EnvAuthHosts, isAuthHostEntry)
	if err != nil {
		return Supabase{}, err
	}
	if !isComposeAuthURL(s.URL, hosts) {
		return Supabase{}, refuse(ErrAuthHostNotAllowed, EnvSupabaseURL)
	}
	s.AuthHosts = hosts
	return loadAuthTrust(get, s)
}

// loadDeployDatabase reads the database settings that the deploy modes and the migration job share: no database URL in
// the environment, even empty; the exact database hosts; and the one postgres:// URL of the private file, every host of
// which they must list. pgx's own view of the URL, after the PG* environment, is checked again when the store opens.
func loadDeployDatabase(lookup func(string) (string, bool)) (Secret, []string, error) {
	if _, set := lookup(EnvDatabaseURL); set {
		return "", nil, refuse(ErrSecretInEnvironment, EnvDatabaseURL)
	}
	get := getter(lookup)
	hosts, err := loadList(get, EnvDBHosts, isDatabaseHost)
	if err != nil {
		return "", nil, err
	}
	path := get(EnvDatabaseURLFile)
	if path == "" {
		return "", nil, refuse(ErrMissing, EnvDatabaseURLFile)
	}
	dsn, ok := readSecretFile(path)
	if !ok || (!strings.HasPrefix(dsn, "postgres://") && !strings.HasPrefix(dsn, "postgresql://")) {
		return "", nil, refuse(ErrUnsafeSecretFile, EnvDatabaseURLFile)
	}
	named, ok := urlHosts(dsn)
	if !ok || len(named) == 0 {
		return "", nil, refuse(ErrDatabaseHostNotAllowed, EnvDatabaseURLFile)
	}
	for _, h := range named {
		if !slices.Contains(hosts, h) {
			return "", nil, refuse(ErrDatabaseHostNotAllowed, EnvDatabaseURLFile)
		}
	}
	return Secret(dsn), hosts, nil
}

// refuseLocalVariables refuses the variables only the loopback emulator mode may see: the emulator host, which the
// Firebase SDK obeys on its own, and Google credentials, which Google client libraries load on their own. Both are
// refused even when empty.
func refuseLocalVariables(lookup func(string) (string, bool)) error {
	if _, set := lookup(EnvEmulatorHost); set {
		return refuse(ErrEmulatorEnvironment, EnvEmulatorHost)
	}
	if _, set := lookup(EnvGoogleCreds); set {
		return ErrRealCredentials
	}
	return nil
}

// getter reads a variable through lookup, unset reading as empty.
func getter(lookup func(string) (string, bool)) func(string) string {
	return func(name string) string {
		v, _ := lookup(name)
		return v
	}
}

// loadList reads the required list name, whose every entry valid accepts.
func loadList(get func(string) string, name string, valid func(string) bool) ([]string, error) {
	v := get(name)
	if v == "" {
		return nil, refuse(ErrMissing, name)
	}
	list, ok := splitList(v, valid)
	if !ok {
		return nil, refuse(ErrInvalidHostList, name)
	}
	return list, nil
}

// splitList splits a comma-separated list without spaces whose every entry valid accepts and none repeats.
func splitList(v string, valid func(string) bool) ([]string, bool) {
	entries := strings.Split(v, ",")
	for i, e := range entries {
		if !valid(e) || slices.Contains(entries[:i], e) {
			return nil, false
		}
	}
	return entries, true
}

// deployListen accepts 0.0.0.0 or a literal IPv4 loopback address, with an explicit non-zero port, written canonically.
// It returns the Host value of the container's own loopback health probe: 127.0.0.1:<port> for 0.0.0.0, or the loopback
// address itself.
func deployListen(listen string) (string, bool) {
	ap, err := netip.ParseAddrPort(listen)
	if err != nil || ap.Port() == 0 || ap.String() != listen {
		return "", false
	}
	switch a := ap.Addr(); {
	case a == netip.IPv4Unspecified():
		return "127.0.0.1:" + strconv.Itoa(int(ap.Port())), true
	case a.Is4() && a.IsLoopback():
		return listen, true
	default:
		return "", false
	}
}

// isAllowedHost accepts an exact Host header value: a lowercase host name or an IP literal (IPv6 in brackets), with an
// optional port.
func isAllowedHost(s string) bool {
	_, _, ok := splitHost(s)
	return ok
}

// isAuthHostEntry accepts a host:port of the stack's internal network: a lowercase host name and an explicit port.
func isAuthHostEntry(s string) bool {
	name, port, ok := strings.Cut(s, ":")
	return ok && isHostName(name) && isPort(port)
}

// isDatabaseHost accepts a database host as pgx parses it, without a port: a lowercase host name, an IP literal (IPv6
// without brackets) or a socket directory.
func isDatabaseHost(s string) bool {
	if strings.HasPrefix(s, "/") {
		return isVisibleASCII(s, maxSocketDirBytes)
	}
	return isIPLiteral(s) || isHostName(s)
}

// isWebOrigin accepts an exact https origin: "https://" and a lowercase host name or IP literal, with an optional port
// other than the default 443, and nothing more: no path, query or fragment.
func isWebOrigin(s string) bool {
	rest, ok := strings.CutPrefix(s, "https://")
	if !ok {
		return false
	}
	_, port, ok := splitHost(rest)
	return ok && port != "443"
}

// isComposeAuthURL accepts an http or https URL whose host and port are exactly one of hosts, without userinfo, query or
// fragment. The Supabase verifier then applies its own URL guards as well.
func isComposeAuthURL(raw string, hosts []string) bool {
	if len(raw) > maxAuthURLBytes || strings.ContainsAny(raw, "?#") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Opaque != "" || u.User != nil {
		return false
	}
	return slices.Contains(hosts, u.Host)
}

// splitHost splits a Host-style entry into its host and port, without resolving or normalising anything: "name",
// "name:port", "192.0.2.10:8443", "[2001:db8::1]" or "[2001:db8::1]:8443". A bracketed host must be an IPv6 literal and
// an unbracketed one a lowercase host name or an IPv4 literal, written canonically. The port is empty when absent.
func splitHost(s string) (host, port string, ok bool) {
	if rest, bracketed := strings.CutPrefix(s, "["); bracketed {
		addr, tail, closed := strings.Cut(rest, "]")
		if a, err := netip.ParseAddr(addr); !closed || err != nil || !a.Is6() || !isIPLiteral(addr) {
			return "", "", false
		}
		if tail == "" {
			return addr, "", true
		}
		port, ok = strings.CutPrefix(tail, ":")
		return addr, port, ok && isPort(port)
	}
	host, port, hasPort := strings.Cut(s, ":")
	if hasPort && !isPort(port) {
		return "", "", false
	}
	if a, err := netip.ParseAddr(host); err == nil {
		return host, port, a.Is4() && isIPLiteral(host)
	}
	return host, port, isHostName(host)
}

// isHostName accepts a lowercase DNS name: dot-separated labels of 1 to 63 letters, digits and hyphens, none starting or
// ending with a hyphen, 253 bytes at most.
func isHostName(s string) bool {
	if s == "" || len(s) > 253 {
		return false
	}
	for _, label := range strings.Split(s, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			if c := label[i]; (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	return true
}

// isIPLiteral accepts an IP address written canonically, without a zone or IPv4 mapping.
func isIPLiteral(s string) bool {
	a, err := netip.ParseAddr(s)
	return err == nil && a.Zone() == "" && !a.Is4In6() && a.String() == s
}

// isPort accepts a decimal port from 1 to 65535, without a sign or leading zero.
func isPort(s string) bool {
	if s == "" || len(s) > 5 || s[0] == '0' {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	n, err := strconv.Atoi(s)
	return err == nil && n <= 65535
}
