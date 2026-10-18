// Package config loads and guards the local backend configuration.
//
// Every guard runs before the binary opens a socket. The slice listens only on a literal loopback
// address, trusts only a demo Firebase project through the loopback Auth emulator, connects only to a
// loopback or Unix-socket PostgreSQL, and refuses production mode outright: production token
// verification does not exist yet.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

// Modes. Only ModeEmulator starts in this slice; ModeProduction is always refused.
const (
	ModeEmulator   = "emulator"
	ModeProduction = "production"
)

// Defaults applied when a variable is unset or empty.
const (
	DefaultListen = "127.0.0.1:8091"
	DefaultSchema = "ayailmu"
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
)

// Guard failures. Load wraps exactly one of these, so callers can use errors.Is. The wrapping names
// the variable and never quotes its value.
var (
	ErrMissing           = errors.New("config: required setting is missing")
	ErrInvalidMode       = errors.New("config: unknown mode")
	ErrProductionRefused = errors.New("config: production mode is refused (production token verification is not implemented)")
	ErrNotLoopback       = errors.New("config: address must be a literal loopback IP with an explicit non-zero port")
	ErrNotDemoProject    = errors.New(`config: Firebase project ID must start with "demo-"`)
	ErrDatabaseNotLocal  = errors.New("config: every database host must be a literal loopback IP or a Unix socket directory")
	ErrInvalidSchema     = errors.New("config: database schema name is not allowed")
	ErrRealCredentials   = errors.New("config: GOOGLE_APPLICATION_CREDENTIALS must be unset")
)

// Secret is a string that never prints, logs or marshals its value.
type Secret string

const redacted = "[redacted]"

// Reveal returns the value for the one place that needs it (opening the database pool).
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
	// Listen is a literal loopback host:port (default 127.0.0.1:8091).
	Listen string
	// AllowedHosts are the exact Host header values the server accepts: Listen itself and
	// "localhost:<port>" (DNS-rebinding guard).
	AllowedHosts []string
	DatabaseURL  Secret
	// Schema is the PostgreSQL schema that holds every table (default "ayailmu").
	Schema    string
	ProjectID string
	// EmulatorHost is the literal loopback host:port of the Firebase Auth emulator.
	EmulatorHost string
}

// Load reads every setting through lookup (os.LookupEnv in the binary, a map in tests), applies the
// defaults and guards, and returns the first guard failure wrapped around one of the Err values.
func Load(lookup func(string) (string, bool)) (Config, error) {
	get := func(name string) string {
		v, _ := lookup(name)
		return v
	}

	switch get(EnvMode) {
	case ModeEmulator:
	case "":
		return Config{}, refuse(ErrMissing, EnvMode)
	case ModeProduction:
		return Config{}, ErrProductionRefused
	default:
		return Config{}, refuse(ErrInvalidMode, EnvMode)
	}
	// Google client libraries load this file on their own, so it is refused even when empty.
	if _, set := lookup(EnvGoogleCreds); set {
		return Config{}, ErrRealCredentials
	}

	listen := get(EnvListen)
	if listen == "" {
		listen = DefaultListen
	}
	port, ok := loopbackPort(listen)
	if !ok {
		return Config{}, refuse(ErrNotLoopback, EnvListen)
	}

	projectID := get(EnvProjectID)
	if projectID == "" {
		return Config{}, refuse(ErrMissing, EnvProjectID)
	}
	if !isDemoProject(projectID) {
		return Config{}, refuse(ErrNotDemoProject, EnvProjectID)
	}

	emulatorHost := get(EnvEmulatorHost)
	if emulatorHost == "" {
		return Config{}, refuse(ErrMissing, EnvEmulatorHost)
	}
	if _, ok := loopbackPort(emulatorHost); !ok {
		return Config{}, refuse(ErrNotLoopback, EnvEmulatorHost)
	}

	dbURL := get(EnvDatabaseURL)
	if dbURL == "" {
		return Config{}, refuse(ErrMissing, EnvDatabaseURL)
	}
	if !databaseIsLocal(dbURL) {
		return Config{}, refuse(ErrDatabaseNotLocal, EnvDatabaseURL)
	}

	schema := get(EnvSchema)
	if schema == "" {
		schema = DefaultSchema
	}
	if !validSchema(schema) {
		return Config{}, refuse(ErrInvalidSchema, EnvSchema)
	}

	return Config{
		Mode:         ModeEmulator,
		Listen:       listen,
		AllowedHosts: []string{listen, "localhost:" + strconv.Itoa(int(port))},
		DatabaseURL:  Secret(dbURL),
		Schema:       schema,
		ProjectID:    projectID,
		EmulatorHost: emulatorHost,
	}, nil
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
