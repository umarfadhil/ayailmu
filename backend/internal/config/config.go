// Package config loads and guards the local backend configuration.
//
// Every guard runs before the binary opens a socket. The slice listens only on a literal loopback
// address and connects only to a loopback or Unix-socket PostgreSQL. Emulator mode trusts only a demo
// Firebase project through the loopback Auth emulator. The local synthetic Supabase mode trusts only one
// explicitly configured Supabase Auth on literal loopback, whose server-only admin credential it reads
// from a private file. The deploy modes (deploy.go) take only exact, explicit settings instead: the Host
// values, web origins and database hosts they allow, and the database URL from a private file. Production
// mode is refused unless it opts in exactly to its one supported deployment, staging with its own
// standalone GoTrue (production_staging.go), whose stricter settings extend the deploy modes'.
package config

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

// Modes. ModeEmulator and ModeLocalSupabase start, as do the deploy modes of deploy.go; ModeProduction is
// refused without its exact staging opt-in (production_staging.go).
const (
	ModeEmulator = "emulator"
	// ModeLocalSupabase is the local synthetic Supabase mode: it trusts one explicitly configured local
	// Supabase Auth (GoTrue) on literal loopback, for synthetic local fixtures only, through its base URL,
	// the exact issuer and audience of its tokens, and a server-only admin credential read from a private
	// file. The API and its database stay on literal loopback as in emulator mode; the Firebase settings
	// are not used.
	ModeLocalSupabase = "local-supabase"
	ModeProduction    = "production"
)

// Bounds of the local Supabase settings. An issuer or audience fits the 256 bytes an account's issuer
// may hold; the admin credential file holds one bearer credential, its final newline included.
const (
	maxAuthSettingBytes = 256
	maxAuthURLBytes     = 2 << 10
	maxSecretFileBytes  = 8 << 10
)

// Defaults applied when a variable is unset or empty.
const (
	DefaultListen = "127.0.0.1:8091"
	DefaultSchema = "ayailmu"
)

// Bounds of the account export's encoded size. MaxExportBytes (16 MiB) is both the default and the
// most AYA_EXPORT_MAX_BYTES may set: the setting can only lower the limit.
const (
	MinExportBytes = 1 << 10
	MaxExportBytes = 16 << 20
)

// Variable names. Values come from the runtime environment and are never committed.
const (
	EnvMode         = "AYA_MODE"
	EnvListen       = "AYA_LISTEN"
	EnvDatabaseURL  = "AYA_DATABASE_URL"
	EnvSchema       = "AYA_DB_SCHEMA"
	EnvProjectID    = "AYA_FIREBASE_PROJECT_ID"
	EnvEmulatorHost = "FIREBASE_AUTH_EMULATOR_HOST"
	EnvGoogleCreds  = "GOOGLE_APPLICATION_CREDENTIALS"
	// EnvExportMaxBytes optionally lowers the account export limit.
	EnvExportMaxBytes = "AYA_EXPORT_MAX_BYTES"
	// The local Supabase Auth of ModeLocalSupabase: its loopback base URL, the exact issuer and audience of
	// its access tokens, and the absolute path of the private file that holds its server-only admin
	// credential.
	EnvSupabaseURL          = "AYA_SUPABASE_URL"
	EnvSupabaseIssuer       = "AYA_SUPABASE_ISSUER"
	EnvSupabaseAudience     = "AYA_SUPABASE_AUDIENCE"
	EnvSupabaseAdminKeyFile = "AYA_SUPABASE_ADMIN_KEY_FILE"
)

// Guard failures. Load wraps exactly one of these, so callers can use errors.Is. The wrapping names
// the variable and never quotes its value.
var (
	ErrMissing           = errors.New("config: required setting is missing")
	ErrInvalidMode       = errors.New("config: unknown mode")
	ErrProductionRefused = errors.New("config: production mode is refused without its exact opt-in: AYA_AUTH_PROVIDER and AYA_DEPLOYMENT_ENV must name its one supported staging deployment")
	ErrNotLoopback       = errors.New("config: address must be a literal loopback IP with an explicit non-zero port")
	ErrNotDemoProject    = errors.New(`config: Firebase project ID must start with "demo-"`)
	ErrDatabaseNotLocal  = errors.New("config: every database host must be a literal loopback IP or a Unix socket directory")
	ErrInvalidSchema     = errors.New("config: database schema name is not allowed")
	ErrRealCredentials   = errors.New("config: GOOGLE_APPLICATION_CREDENTIALS must be unset")
	// ErrInvalidExportLimit reports an export limit that is not a plain decimal number of bytes within
	// the bounds: the setting can only lower the 16 MiB default.
	ErrInvalidExportLimit = errors.New("config: the export limit must be a decimal number of bytes from 1024 to 16777216")
	// ErrNotLocalAuth reports a Supabase Auth URL that is not http or https on a literal loopback IP with an
	// explicit non-zero port, or that carries userinfo, a query or a fragment.
	ErrNotLocalAuth = errors.New("config: the Supabase Auth URL must be http or https on a literal loopback IP with an explicit non-zero port, without userinfo, query or fragment")
	// ErrInvalidAuthSetting reports a Supabase issuer or audience that is not 1 to 256 bytes of visible
	// ASCII.
	ErrInvalidAuthSetting = errors.New("config: the Supabase issuer and audience must each be 1 to 256 bytes of visible ASCII")
	// ErrUnsafeSecretFile reports a secret file, the admin credential's or the database URL's, that is not
	// private: it must be an absolute path to this user's own regular file (not a link), closed to group
	// and others, holding one value of at most 8 KiB (a bearer credential, or one postgres:// URL).
	ErrUnsafeSecretFile = errors.New("config: a secret file (the admin credential or the database URL) must be an absolute path to this user's own regular file, closed to group and others, holding one value of at most 8 KiB")
)

// Secret is a string that never prints, logs or marshals its value.
type Secret string

const redacted = "[redacted]"

// Reveal returns the value for the places that need it: opening the database pool, and the Supabase
// verifier's server-only admin request.
func (s Secret) Reveal() string {
	return string(s)
}

func (Secret) String() string {
	return redacted
}

func (Secret) GoString() string {
	return redacted
}

// Format covers every fmt verb, including %v, %+v, %#v, %s, %q and %x.
func (Secret) Format(f fmt.State, _ rune) {
	_, _ = f.Write([]byte(redacted))
}

func (Secret) MarshalText() ([]byte, error) {
	return []byte(redacted), nil
}

func (Secret) LogValue() slog.Value {
	return slog.StringValue(redacted)
}

// Config is a configuration that passed every guard.
type Config struct {
	Mode string
	// Listen is a literal loopback host:port (default 127.0.0.1:8091); in the deploy modes and production,
	// 0.0.0.0 or IPv4 loopback with an explicit port.
	Listen string
	// AllowedHosts are the exact Host header values the server accepts: Listen itself and
	// "localhost:<port>" (DNS-rebinding guard); in the deploy modes and production, AYA_ALLOWED_HOSTS (public
	// DNS names in production) and the container's own loopback health probe.
	AllowedHosts []string
	// TrustedProxies are, in ModeProduction, the exact addresses of the TLS-terminating proxies in front of the service
	// (AYA_TRUSTED_PROXIES): canonical unicast IP literals, never unspecified or loopback, so a peer's parsed address
	// matches one exactly. Nil in every other mode.
	TrustedProxies []string
	// CORSOrigins are, in the deploy modes and production, the exact web origins the CORS gate grants (AYA_CORS_ORIGINS;
	// none means native clients only, which production refuses). Nil in the loopback modes, whose gate grants only the
	// local Expo web preview.
	CORSOrigins []string
	DatabaseURL Secret
	// DBHosts are, in the deploy modes and production, the exact database hosts pgx may dial (AYA_DB_HOSTS). Nil in the
	// loopback modes, whose database must be on literal loopback or a Unix socket.
	DBHosts []string
	// DBPrivateNetwork is true only in a deploy mode, never in production, when AYA_DB_TRANSPORT=private-network explicitly
	// allows plaintext (sslmode=disable) to a private database target. False is the strict default: every remote target over
	// verified TLS. It only states the request; the store applies it to what pgx parsed.
	DBPrivateNetwork bool
	// Schema is the PostgreSQL schema that holds every table (default "ayailmu").
	Schema    string
	ProjectID string
	// EmulatorHost is the literal loopback host:port of the Firebase Auth emulator.
	EmulatorHost string
	// ExportMaxBytes is the largest account export served, in encoded bytes (default and maximum
	// MaxExportBytes).
	ExportMaxBytes int
	// Supabase is the local Supabase Auth in ModeLocalSupabase and ModeLocalCompose, and the deployment's own
	// standalone GoTrue in ModeProduction; zero in emulator and deploy-smoke modes.
	Supabase Supabase
}

// Supabase is the local Supabase Auth of ModeLocalSupabase or ModeLocalCompose, or the standalone GoTrue of
// ModeProduction.
type Supabase struct {
	// URL is Auth's base URL: http or https on a literal loopback IP and port, or in ModeLocalCompose to
	// exactly one of AuthHosts, or in ModeProduction exactly https:// and Auth's own public DNS name,
	// optionally with the private port 9443.
	URL string
	// Issuer and Audience are the exact iss and aud claims of its access tokens.
	Issuer   string
	Audience string
	// AdminKey is the server-only admin credential, read from the private file.
	AdminKey Secret
	// AuthHosts are, in ModeLocalCompose, the exact host:port values URL may name on the stack's internal network
	// (AYA_AUTH_HOSTS). Nil in ModeLocalSupabase and ModeProduction.
	AuthHosts []string
}

// Load reads every setting through lookup (os.LookupEnv in the binary, a map in tests), applies the
// defaults and guards, and returns the first guard failure wrapped around one of the Err values.
func Load(lookup func(string) (string, bool)) (Config, error) {
	get := func(name string) string {
		v, _ := lookup(name)
		return v
	}

	mode := get(EnvMode)
	switch mode {
	case ModeEmulator, ModeLocalSupabase:
	case ModeDeploySmoke, ModeLocalCompose:
		return loadDeploy(mode, lookup)
	case "":
		return Config{}, refuse(ErrMissing, EnvMode)
	case ModeProduction:
		// However complete the rest, production stays refused without its exact opt-in.
		if !stagingOptedIn(get) {
			return Config{}, ErrProductionRefused
		}
		return loadDeploy(mode, lookup)
	default:
		return Config{}, refuse(ErrInvalidMode, EnvMode)
	}
	// Google client libraries load this file on their own, so it is refused even when empty.
	if _, set := lookup(EnvGoogleCreds); set {
		return Config{}, ErrRealCredentials
	}
	// Production's own settings, and the deploy modes' database transport, are refused, even empty, rather than ignored.
	if err := refuseSettings(lookup, append([]string{EnvDBTransport}, stagingSettings...)...); err != nil {
		return Config{}, err
	}

	listen := get(EnvListen)
	if listen == "" {
		listen = DefaultListen
	}
	port, ok := loopbackPort(listen)
	if !ok {
		return Config{}, refuse(ErrNotLoopback, EnvListen)
	}

	// Each mode's own Auth: the demo Firebase project and emulator, or the local Supabase Auth.
	var projectID, emulatorHost string
	var supabase Supabase
	switch mode {
	case ModeEmulator:
		projectID = get(EnvProjectID)
		if projectID == "" {
			return Config{}, refuse(ErrMissing, EnvProjectID)
		}
		if !isDemoProject(projectID) {
			return Config{}, refuse(ErrNotDemoProject, EnvProjectID)
		}
		emulatorHost = get(EnvEmulatorHost)
		if emulatorHost == "" {
			return Config{}, refuse(ErrMissing, EnvEmulatorHost)
		}
		if _, ok := loopbackPort(emulatorHost); !ok {
			return Config{}, refuse(ErrNotLoopback, EnvEmulatorHost)
		}
	case ModeLocalSupabase:
		var err error
		if supabase, err = loadSupabase(get); err != nil {
			return Config{}, err
		}
	}

	dbURL := get(EnvDatabaseURL)
	if dbURL == "" {
		return Config{}, refuse(ErrMissing, EnvDatabaseURL)
	}
	if !databaseIsLocal(dbURL) {
		return Config{}, refuse(ErrDatabaseNotLocal, EnvDatabaseURL)
	}

	schema, err := loadSchema(get)
	if err != nil {
		return Config{}, err
	}
	exportMax, err := loadExportLimit(get)
	if err != nil {
		return Config{}, err
	}

	return Config{
		Mode:           mode,
		Listen:         listen,
		AllowedHosts:   []string{listen, "localhost:" + strconv.Itoa(int(port))},
		DatabaseURL:    Secret(dbURL),
		Schema:         schema,
		ProjectID:      projectID,
		EmulatorHost:   emulatorHost,
		ExportMaxBytes: exportMax,
		Supabase:       supabase,
	}, nil
}

// loadSchema reads the schema, by default DefaultSchema.
func loadSchema(get func(string) string) (string, error) {
	schema := get(EnvSchema)
	if schema == "" {
		schema = DefaultSchema
	}
	if !validSchema(schema) {
		return "", refuse(ErrInvalidSchema, EnvSchema)
	}
	return schema, nil
}

// loadExportLimit reads the export limit, by default MaxExportBytes.
func loadExportLimit(get func(string) string) (int, error) {
	v := get(EnvExportMaxBytes)
	if v == "" {
		return MaxExportBytes, nil
	}
	n, ok := exportLimit(v)
	if !ok {
		return 0, refuse(ErrInvalidExportLimit, EnvExportMaxBytes)
	}
	return n, nil
}

// loadSupabase reads the local Supabase Auth of ModeLocalSupabase: a literal-loopback Auth URL, the
// exact issuer and audience, and the admin credential from its private file. Each refusal names its
// variable only.
func loadSupabase(get func(string) string) (Supabase, error) {
	s := Supabase{URL: get(EnvSupabaseURL)}
	switch {
	case s.URL == "":
		return Supabase{}, refuse(ErrMissing, EnvSupabaseURL)
	case !isLocalAuthURL(s.URL):
		return Supabase{}, refuse(ErrNotLocalAuth, EnvSupabaseURL)
	}
	return loadAuthTrust(get, s)
}

// loadAuthTrust completes s, whose Auth URL was checked, with the exact issuer and audience of Auth's
// tokens and the admin credential from its private file. Each refusal names its variable only.
func loadAuthTrust(get func(string) string, s Supabase) (Supabase, error) {
	s.Issuer, s.Audience = get(EnvSupabaseIssuer), get(EnvSupabaseAudience)
	switch {
	case s.Issuer == "":
		return Supabase{}, refuse(ErrMissing, EnvSupabaseIssuer)
	case !isVisibleASCII(s.Issuer, maxAuthSettingBytes):
		return Supabase{}, refuse(ErrInvalidAuthSetting, EnvSupabaseIssuer)
	case s.Audience == "":
		return Supabase{}, refuse(ErrMissing, EnvSupabaseAudience)
	case !isVisibleASCII(s.Audience, maxAuthSettingBytes):
		return Supabase{}, refuse(ErrInvalidAuthSetting, EnvSupabaseAudience)
	}
	path := get(EnvSupabaseAdminKeyFile)
	if path == "" {
		return Supabase{}, refuse(ErrMissing, EnvSupabaseAdminKeyFile)
	}
	key, ok := readSecretFile(path)
	if !ok {
		return Supabase{}, refuse(ErrUnsafeSecretFile, EnvSupabaseAdminKeyFile)
	}
	s.AdminKey = Secret(key)
	return s, nil
}

// isLocalAuthURL accepts an http or https URL whose host is a literal loopback IP with an explicit
// non-zero port (loopbackPort), without userinfo, query or fragment. The Supabase verifier then applies
// its own URL guards as well.
func isLocalAuthURL(raw string) bool {
	if len(raw) > maxAuthURLBytes || strings.ContainsAny(raw, "?#") {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Opaque != "" || u.User != nil {
		return false
	}
	_, ok := loopbackPort(u.Host)
	return ok
}

// isVisibleASCII accepts 1 to maxBytes bytes of visible ASCII: no space, control or non-ASCII byte.
func isVisibleASCII(s string, maxBytes int) bool {
	if s == "" || len(s) > maxBytes {
		return false
	}
	for i := 0; i < len(s); i++ {
		if c := s[i]; c <= ' ' || c > '~' {
			return false
		}
	}
	return true
}

// readSecretFile reads one server-only credential from a private file: an absolute path whose final
// component is a private file (privateFile) rather than a symlink, holding one credential of visible
// ASCII, optionally followed by a single newline. The file read must be the file checked. Nothing about
// the file or its contents reaches an error.
func readSecretFile(path string) (string, bool) {
	if !filepath.IsAbs(path) {
		return "", false
	}
	checked, err := os.Lstat(path)
	if err != nil || !privateFile(checked) {
		return "", false
	}
	f, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil || !os.SameFile(checked, opened) || !privateFile(opened) {
		return "", false
	}
	data, err := io.ReadAll(io.LimitReader(f, maxSecretFileBytes+1))
	if err != nil || len(data) > maxSecretFileBytes {
		return "", false
	}
	secret := strings.TrimSuffix(string(data), "\n")
	if !isVisibleASCII(secret, maxSecretFileBytes) {
		return "", false
	}
	return secret, true
}

// privateFile reports whether info is a regular file of at most maxSecretFileBytes that this process's
// user owns and that its group and others can neither read, write nor execute.
func privateFile(info os.FileInfo) bool {
	st, ok := info.Sys().(*syscall.Stat_t)
	return ok && info.Mode().IsRegular() && info.Mode().Perm()&0o077 == 0 && int64(st.Uid) == int64(os.Getuid()) &&
		info.Size() <= maxSecretFileBytes
}

// exportLimit reads an export limit: plain decimal digits without a sign or leading zero, from
// MinExportBytes to MaxExportBytes. Units, words and anything else are refused.
func exportLimit(v string) (int, bool) {
	if v == "" || len(v) > len(strconv.Itoa(MaxExportBytes)) || v[0] == '0' {
		return 0, false
	}
	for i := 0; i < len(v); i++ {
		if v[i] < '0' || v[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(v)
	return n, err == nil && n >= MinExportBytes && n <= MaxExportBytes
}

// refuse wraps one guard failure with the variable name only: a connection string pasted into the
// wrong variable must not leak through that variable's error.
func refuse(err error, name string) error {
	return fmt.Errorf("%w: %s", err, name)
}

// loopbackPort accepts a literal loopback IP with an explicit non-zero port ("127.0.0.1:8091",
// "[::1]:8091"), written canonically and without a zone, so the Host allow-list derived from it is
// exact. Hostnames, "localhost" included, are refused: they resolve through DNS and hosts files.
func loopbackPort(hostport string) (uint16, bool) {
	ap, err := netip.ParseAddrPort(hostport)
	if err != nil {
		return 0, false
	}
	a := ap.Addr()
	if !a.IsLoopback() || a.Zone() != "" || a.Is4In6() || ap.Port() == 0 || ap.String() != hostport {
		return 0, false
	}
	return ap.Port(), true
}

// isDemoProject accepts "demo-" followed by lowercase letters, digits and hyphens. Firebase demo
// projects cannot reach real resources.
func isDemoProject(id string) bool {
	rest, ok := strings.CutPrefix(id, "demo-")
	if !ok || rest == "" {
		return false
	}
	for i := 0; i < len(rest); i++ {
		if c := rest[i]; (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
			return false
		}
	}
	return true
}

// validSchema accepts a lowercase identifier (a letter, then letters, digits or underscores, at most
// 63 bytes) that is not public, information_schema or a pg_ system schema.
func validSchema(s string) bool {
	if s == "" || len(s) > 63 || s == "public" || s == "information_schema" || strings.HasPrefix(s, "pg_") {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		letter := c >= 'a' && c <= 'z'
		tail := i > 0 && (c == '_' || (c >= '0' && c <= '9'))
		if !letter && !tail {
			return false
		}
	}
	return true
}

// databaseIsLocal reports whether every host the connection string can make pgx dial is a literal
// loopback IP or a Unix socket directory (a path starting with "/"). It splits both pgx formats the
// way pgconn does but reads only the string, never the environment or files. The string must name
// its hosts itself: hosts in the string override PGHOST, service files and the pgx default, so none
// of those can add a remote host. Every host occurrence is checked, including ones pgx would ignore.
func databaseIsLocal(conn string) bool {
	var hosts []string
	var ok bool
	if strings.HasPrefix(conn, "postgres://") || strings.HasPrefix(conn, "postgresql://") {
		hosts, ok = urlHosts(conn)
	} else {
		hosts, ok = keywordValueHosts(conn)
	}
	if !ok || len(hosts) == 0 {
		return false
	}
	for _, h := range hosts {
		if !strings.HasPrefix(h, "/") && !isLoopbackIP(h) {
			return false
		}
	}
	return true
}

func isLoopbackIP(s string) bool {
	a, err := netip.ParseAddr(s)
	return err == nil && a.IsLoopback() && a.Zone() == "" && !a.Is4In6()
}

// urlHosts returns the URL's authority hosts, split like pgconn (comma-separated host[:port], IPv6 in
// brackets, empty hosts skipped), plus every value of every "host" query parameter, which pgconn lets
// override them. A parse error is reported without its text: url errors quote the whole string,
// password included.
func urlHosts(conn string) ([]string, bool) {
	u, err := url.Parse(conn)
	if err != nil {
		return nil, false
	}
	var hosts []string
	for _, h := range strings.Split(u.Host, ",") {
		if h == "" {
			continue
		}
		if net.ParseIP(strings.Trim(h, "[]")) != nil || !strings.Contains(h, ":") {
			hosts = append(hosts, strings.Trim(h, "[]"))
			continue
		}
		host, _, err := net.SplitHostPort(h)
		if err != nil {
			return nil, false
		}
		if host != "" {
			hosts = append(hosts, host)
		}
	}
	for _, v := range u.Query()["host"] {
		hosts = append(hosts, strings.Split(v, ",")...)
	}
	return hosts, true
}

const connSpace = " \t\n\r\v\f"

// keywordValueHosts tokenises a keyword/value string exactly like pgconn (a value may be
// single-quoted; a backslash escapes the next byte) and returns every comma-separated value of every
// "host" keyword.
func keywordValueHosts(s string) ([]string, bool) {
	var hosts []string
	for len(s) > 0 {
		eq := strings.IndexByte(s, '=')
		if eq < 0 {
			return nil, false
		}
		key := strings.Trim(s[:eq], connSpace)
		s = strings.TrimLeft(s[eq+1:], connSpace)
		var val string
		switch {
		case s == "":
		case s[0] == '\'':
			s = s[1:]
			end := 0
			for ; end < len(s) && s[end] != '\''; end++ {
				if s[end] == '\\' {
					end++
				}
			}
			if end >= len(s) {
				return nil, false // unterminated quote
			}
			val, s = unescapeConnValue(s[:end]), s[end+1:]
		default:
			end := 0
			for ; end < len(s) && !strings.ContainsRune(connSpace, rune(s[end])); end++ {
				if s[end] == '\\' {
					end++
					if end == len(s) {
						return nil, false // dangling backslash
					}
				}
			}
			val, s = unescapeConnValue(s[:end]), s[min(end+1, len(s)):]
		}
		if key == "" {
			return nil, false
		}
		if key == "host" {
			hosts = append(hosts, strings.Split(val, ",")...)
		}
	}
	return hosts, true
}

// unescapeConnValue undoes the two escapes pgconn recognises in keyword/value strings.
func unescapeConnValue(v string) string {
	return strings.ReplaceAll(strings.ReplaceAll(v, `\\`, `\`), `\'`, `'`)
}
