package store_test

// Remote database transport. In the deploy modes and the migration and ledger jobs (OpenAllowing, ParseConfigAllowing) every
// target pgx would dial, the primary and each fallback, after pgx applied the connection string, the PG* environment and
// the service file, must be a literal loopback IP, a Unix socket, or reached over verified TLS: sslmode=verify-full, the
// host name checked against the server certificate, no plaintext fallback and no opportunistic mode. A private-network
// plaintext exception exists only when the caller asks for it explicitly, and then only for sslmode=disable to a
// single-label host name or a private-range IP address, never to a public DNS name or address. A refusal is one of two
// fixed errors that quote neither the password nor a host.
//
// The parsing tests need nothing but pgx. The handshake tests dial a throwaway TLS-speaking listener on 127.0.0.1 (a
// protocol stub that answers pgx's SSLRequest, never a real database) and prove what the client actually did on the wire:
// it verified the certificate, it never sent a startup packet in plaintext after a refusal, and it dialed nothing when the
// configuration was refused first.

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"math/big"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"ayailmu.local/backend/internal/store"
)

const sslRequestCode = 80877103

// transportDSN is a URL for hosts (comma-separated, with ports) whose query is exactly query.
func transportDSN(hosts, query string) string {
	if query != "" {
		query = "?" + query
	}
	return "postgres://aya_runtime:" + storePassword + "@" + hosts + "/ayailmu" + query
}

func TestRemoteTargetsRequireVerifiedTLS(t *testing.T) {
	allowed := []string{"db.example.test", "db2.example.test", "203.0.113.7", "127.0.0.1", "::1", "/var/run/postgresql", "aya-db"}
	ca := writeCA(t, newCA(t))
	rootcert := "&sslrootcert=" + ca
	serviceFile := filepath.Join(t.TempDir(), "pg_service.conf")
	if err := os.WriteFile(serviceFile, []byte("[plain]\nhost=db.example.test\nsslmode=disable\n[secure]\nhost=db.example.test\nsslmode=verify-full\nsslrootcert="+ca+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name string
		dsn  string
		env  map[string]string
		want error
	}{
		// What is accepted.
		{"verify-full with the pinned root", transportDSN("db.example.test:5432", "sslmode=verify-full"+rootcert), nil, nil},
		{"verify-full with the system roots", transportDSN("db.example.test:5432", "sslmode=verify-full"), nil, nil},
		{"verify-full to an IP literal", transportDSN("203.0.113.7:5432", "sslmode=verify-full"+rootcert), nil, nil},
		{"verify-full on the primary and every fallback", transportDSN("db.example.test:5432,db2.example.test:5432", "sslmode=verify-full"+rootcert), nil, nil},
		{"verify-full from the environment", transportDSN("db.example.test:5432", ""), map[string]string{"PGSSLMODE": "verify-full"}, nil},
		{"the connection string beats a weaker environment", transportDSN("db.example.test:5432", "sslmode=verify-full"+rootcert), map[string]string{"PGSSLMODE": "disable"}, nil},
		{"verify-full from the service file", "service=secure user=aya_runtime dbname=ayailmu", map[string]string{"PGSERVICEFILE": serviceFile}, nil},
		{"literal IPv4 loopback in plaintext", transportDSN("127.0.0.1:5432", "sslmode=disable"), nil, nil},
		{"literal IPv6 loopback in plaintext", transportDSN("[::1]:5432", "sslmode=disable"), nil, nil},
		{"a Unix socket directory", "host=/var/run/postgresql user=aya_runtime dbname=ayailmu sslmode=disable", nil, nil},

		// No plaintext, opportunistic or unverified mode reaches a remote name, in the string or by default.
		{"no sslmode, which pgx would read as prefer and may downgrade", transportDSN("db.example.test:5432", ""), nil, store.ErrDatabaseTransportInsecure},
		{"sslmode=disable", transportDSN("db.example.test:5432", "sslmode=disable"), nil, store.ErrDatabaseTransportInsecure},
		{"sslmode=allow", transportDSN("db.example.test:5432", "sslmode=allow"), nil, store.ErrDatabaseTransportInsecure},
		{"sslmode=prefer", transportDSN("db.example.test:5432", "sslmode=prefer"), nil, store.ErrDatabaseTransportInsecure},
		{"sslmode=require, which encrypts without authenticating the server", transportDSN("db.example.test:5432", "sslmode=require"+rootcert), nil, store.ErrDatabaseTransportInsecure},
		{"sslmode=verify-ca, which skips the host name check", transportDSN("db.example.test:5432", "sslmode=verify-ca"+rootcert), nil, store.ErrDatabaseTransportInsecure},
		{"sslmode=disable to an IP literal", transportDSN("203.0.113.7:5432", "sslmode=disable"), nil, store.ErrDatabaseTransportInsecure},
		{"plaintext from the environment", transportDSN("db.example.test:5432", ""), map[string]string{"PGSSLMODE": "disable"}, store.ErrDatabaseTransportInsecure},
		{"opportunistic from the environment", transportDSN("db.example.test:5432", ""), map[string]string{"PGSSLMODE": "prefer"}, store.ErrDatabaseTransportInsecure},
		{"plaintext from the service file", "service=plain user=aya_runtime dbname=ayailmu", map[string]string{"PGSERVICEFILE": serviceFile}, store.ErrDatabaseTransportInsecure},
		{"a plaintext fallback behind a verified primary (keyword form)", "host=db.example.test,db2.example.test user=aya_runtime dbname=ayailmu sslmode=prefer sslrootcert=" + ca, nil, store.ErrDatabaseTransportInsecure},
		{"a remote fallback behind a loopback primary", transportDSN("127.0.0.1:5432,db.example.test:5432", "sslmode=disable"), nil, store.ErrDatabaseTransportInsecure},
		{"a remote primary before a loopback fallback", transportDSN("db.example.test:5432,127.0.0.1:5432", "sslmode=disable"), nil, store.ErrDatabaseTransportInsecure},
		{"PGHOST naming a remote host without TLS", transportDSN("", "sslmode=disable"), map[string]string{"PGHOST": "db.example.test"}, store.ErrDatabaseTransportInsecure},
		{"a private single-label name without the explicit exception", transportDSN("aya-db:5432", "sslmode=disable"), nil, store.ErrDatabaseTransportInsecure},
	} {
		t.Run(c.name, func(t *testing.T) {
			for k, v := range c.env {
				t.Setenv(k, v)
			}
			cfg, err := store.ParseConfigAllowing(c.dsn, "ayailmu", allowed)
			if c.want == nil {
				if err != nil {
					t.Fatalf("refused an acceptable transport: %s", withheld(err))
				}
				for _, target := range targets(cfg.ConnConfig.Host, cfg.ConnConfig.TLSConfig, cfg.ConnConfig.Fallbacks) {
					if isLocalTarget(target.host) {
						continue
					}
					if target.tls == nil || target.tls.InsecureSkipVerify || target.tls.ServerName != target.host {
						t.Fatalf("accepted target %q without certificate and host name verification", target.host)
					}
				}
				return
			}
			if !errors.Is(err, c.want) {
				t.Fatalf("error = %s, want %v", withheld(err), c.want)
			}
			assertGenericTransportError(t, err)
		})
	}
}

func TestPrivateNetworkPlaintextIsExplicitAndConstrained(t *testing.T) {
	allowed := []string{"aya-db", "aya-db.internal", "db.example.test", "203.0.113.7", "10.1.2.3", "172.16.4.9", "192.168.5.6",
		"fd00::7", "100.64.0.1", "169.254.1.1", "localhost", "127.0.0.1"}
	ca := writeCA(t, newCA(t))
	private := store.PrivateNetwork(true)
	for _, c := range []struct {
		name string
		dsn  string
		want error
	}{
		{"a single-label service name, explicit sslmode=disable", transportDSN("aya-db:5432", "sslmode=disable"), nil},
		{"an RFC 1918 10/8 address", transportDSN("10.1.2.3:5432", "sslmode=disable"), nil},
		{"an RFC 1918 172.16/12 address", transportDSN("172.16.4.9:5432", "sslmode=disable"), nil},
		{"an RFC 1918 192.168/16 address", transportDSN("192.168.5.6:5432", "sslmode=disable"), nil},
		{"a unique local IPv6 address", transportDSN("[fd00::7]:5432", "sslmode=disable"), nil},
		{"verified TLS to a public name is still fine", transportDSN("db.example.test:5432", "sslmode=verify-full&sslrootcert="+ca), nil},
		{"loopback keeps working", transportDSN("127.0.0.1:5432", "sslmode=disable"), nil},

		{"no sslmode: pgx's default would silently downgrade", transportDSN("aya-db:5432", ""), store.ErrDatabaseTransportInsecure},
		{"sslmode=prefer", transportDSN("aya-db:5432", "sslmode=prefer"), store.ErrDatabaseTransportInsecure},
		{"sslmode=allow", transportDSN("aya-db:5432", "sslmode=allow"), store.ErrDatabaseTransportInsecure},
		{"sslmode=require", transportDSN("aya-db:5432", "sslmode=require"), store.ErrDatabaseTransportInsecure},
		{"sslmode=verify-ca", transportDSN("aya-db:5432", "sslmode=verify-ca&sslrootcert="+ca), store.ErrDatabaseTransportInsecure},

		{"plaintext to a public DNS name", transportDSN("db.example.test:5432", "sslmode=disable"), store.ErrDatabasePlaintextNotPrivate},
		{"plaintext to a dotted internal-looking name", transportDSN("aya-db.internal:5432", "sslmode=disable"), store.ErrDatabasePlaintextNotPrivate},
		{"plaintext to a public IP address", transportDSN("203.0.113.7:5432", "sslmode=disable"), store.ErrDatabasePlaintextNotPrivate},
		{"plaintext to carrier-grade NAT space", transportDSN("100.64.0.1:5432", "sslmode=disable"), store.ErrDatabasePlaintextNotPrivate},
		{"plaintext to a link-local address", transportDSN("169.254.1.1:5432", "sslmode=disable"), store.ErrDatabasePlaintextNotPrivate},
		{"a public plaintext fallback behind a private plaintext primary", transportDSN("aya-db:5432,db.example.test:5432", "sslmode=disable"), store.ErrDatabasePlaintextNotPrivate},
	} {
		t.Run(c.name, func(t *testing.T) {
			_, err := store.ParseConfigAllowing(c.dsn, "ayailmu", allowed, private)
			if c.want == nil {
				if err != nil {
					t.Fatalf("refused: %s", withheld(err))
				}
				return
			}
			if !errors.Is(err, c.want) {
				t.Fatalf("error = %s, want %v", withheld(err), c.want)
			}
			assertGenericTransportError(t, err)
		})
	}

	t.Run("PrivateNetwork(false) is the default", func(t *testing.T) {
		if _, err := store.ParseConfigAllowing(transportDSN("aya-db:5432", "sslmode=disable"), "ayailmu", allowed, store.PrivateNetwork(false)); !errors.Is(err, store.ErrDatabaseTransportInsecure) {
			t.Fatalf("error = %s, want ErrDatabaseTransportInsecure", withheld(err))
		}
	})
}

// A single-label name is accepted as a container network's service name only if nothing but DNS can resolve it. The C
// resolver's inet_aton also reads one number as a whole IPv4 address (decimal, octal with a leading 0, or hexadecimal with 0x),
// so "134744072", "01001004010" and "0x08080808" all dial 8.8.8.8 although they contain no dot. They must be refused before
// any dial, whatever the platform's resolver would have made of them; ordinary service names stay accepted.
func TestPrivateNetworkRefusesNumericAddressSpellingsOfASingleLabel(t *testing.T) {
	long63, long64 := strings.Repeat("a", 63), strings.Repeat("a", 64)
	numeric := []string{
		"134744072", "01001004010", "0x08080808", "0X08080808", "0x8080808", "0x7f000001", "2130706433", "017700000001",
		"0", "00", "010", "4294967295", "0x", "0xdb", "0XDB",
	}
	malformed := []string{long64, "-db", "db-", "db\u00e9", "db name", "db\x00", "db/x", "db:1", "db%eth0", "[db]", "db@x", "_"}
	accepted := []string{"aya-db", "postgres", "db1", "pg_primary", "2fa-db", "a", long63, "0xg", "1e3", "08x", "AYA-DB"}
	allowed := append(append(append([]string{}, numeric...), malformed...), accepted...)
	private := store.PrivateNetwork(true)
	for _, h := range numeric {
		t.Run("numeric "+h, func(t *testing.T) {
			_, err := store.ParseConfigAllowing(transportDSN(h+":5432", "sslmode=disable"), "ayailmu", allowed, private)
			if !errors.Is(err, store.ErrDatabasePlaintextNotPrivate) {
				t.Fatalf("error = %s, want ErrDatabasePlaintextNotPrivate", withheld(err))
			}
			assertGenericTransportError(t, err)
		})
	}
	for _, h := range malformed {
		t.Run("malformed "+h, func(t *testing.T) {
			// pgx may already reject the spelling while parsing; either way the private-network exception must not apply.
			if _, err := store.ParseConfigAllowing(transportDSN(h+":5432", "sslmode=disable"), "ayailmu", allowed, private); err == nil {
				t.Fatalf("accepted %q for plaintext", h)
			}
		})
	}
	for _, h := range accepted {
		t.Run("accepted "+h, func(t *testing.T) {
			if _, err := store.ParseConfigAllowing(transportDSN(h+":5432", "sslmode=disable"), "ayailmu", allowed, private); err != nil {
				t.Fatalf("refused the service name %q: %s", h, withheld(err))
			}
		})
	}
	t.Run("a numeric label is also refused as a plaintext fallback", func(t *testing.T) {
		_, err := store.ParseConfigAllowing(transportDSN("aya-db:5432,134744072:5432", "sslmode=disable"), "ayailmu", allowed, private)
		if !errors.Is(err, store.ErrDatabasePlaintextNotPrivate) {
			t.Fatalf("error = %s, want ErrDatabasePlaintextNotPrivate", withheld(err))
		}
	})
	t.Run("no TLS means no exception: a numeric label never reaches the plaintext path either way", func(t *testing.T) {
		if _, err := store.ParseConfigAllowing(transportDSN("0x08080808:5432", "sslmode=disable"), "ayailmu", allowed); !errors.Is(err, store.ErrDatabaseTransportInsecure) {
			t.Fatalf("error = %s, want ErrDatabaseTransportInsecure", withheld(err))
		}
	})
}

// On the wire: the number 2130706433 is 127.0.0.1 to the C resolver, so a listener on loopback is exactly what an unguarded
// plaintext dial to that spelling would reach. With the private-network exception on, nothing may be dialed at all.
func TestOpenAllowingDialsNothingForANumericSpellingOfAnAddress(t *testing.T) {
	srv := startStub(t, stubOptions{})
	for _, h := range []string{"2130706433", "0x7f000001", "017700000001"} {
		t.Run(h, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			st, err := store.OpenAllowing(ctx, transportDSN(h+":"+srv.port, "sslmode=disable&connect_timeout=3"), "ayailmu", []string{h}, store.PrivateNetwork(true))
			if st != nil {
				st.Close()
			}
			if !errors.Is(err, store.ErrDatabasePlaintextNotPrivate) {
				t.Fatalf("error = %s, want ErrDatabasePlaintextNotPrivate", withheld(err))
			}
			assertGenericTransportError(t, err)
		})
	}
	if n, p := srv.accepted.Load(), srv.plaintextStartups.Load(); n != 0 || p != 0 {
		t.Fatalf("the listener accepted %d connections and %d plaintext startup packets although every spelling was refused", n, p)
	}
}

// The transport rule is applied after the host allow-list, so a host outside it is still reported as such.
func TestTransportRuleDoesNotMaskTheHostAllowList(t *testing.T) {
	if _, err := store.ParseConfigAllowing(transportDSN("elsewhere.example.test:5432", "sslmode=disable"), "ayailmu", []string{"db.example.test"}); !errors.Is(err, store.ErrDatabaseHostNotAllowed) {
		t.Fatalf("error = %s, want ErrDatabaseHostNotAllowed", withheld(err))
	}
}

// OpenAllowing is the core path of the API, the migration job and the ledger tool: it must apply the rule itself, before it
// dials anything.
func TestOpenAllowingDialsNothingWhenTheTransportIsRefused(t *testing.T) {
	srv := startStub(t, stubOptions{tls: newLeaf(t, newCA(t), "localhost")})
	for _, q := range []string{"sslmode=disable", "sslmode=prefer", "sslmode=require", ""} {
		t.Run("sslmode "+q, func(t *testing.T) {
			_, err := store.OpenAllowing(context.Background(), transportDSN("localhost:"+srv.port, q), "ayailmu", []string{"localhost"})
			if !errors.Is(err, store.ErrDatabaseTransportInsecure) {
				t.Fatalf("error = %s, want ErrDatabaseTransportInsecure", withheld(err))
			}
			assertGenericTransportError(t, err)
		})
	}
	if n := srv.accepted.Load(); n != 0 {
		t.Fatalf("the listener accepted %d connections although every configuration was refused", n)
	}
}

func TestOpenAllowingVerifiesTheServerCertificateOnTheWire(t *testing.T) {
	trusted := newCA(t)
	rogue := newCA(t)
	caFile := writeCA(t, trusted)
	dsn := func(port string, root string) string {
		return transportDSN("localhost:"+port, "sslmode=verify-full&sslrootcert="+root+"&connect_timeout=3")
	}
	open := func(t *testing.T, dsn string, opts ...store.Option) error {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		st, err := store.OpenAllowing(ctx, dsn, "ayailmu", []string{"localhost"}, opts...)
		if st != nil {
			st.Close()
		}
		return err
	}

	t.Run("a certificate for this host from the pinned root completes the handshake and reaches the startup packet", func(t *testing.T) {
		srv := startStub(t, stubOptions{tls: newLeaf(t, trusted, "localhost")})
		err := open(t, dsn(srv.port, caFile))
		if srv.handshakes.Load() != 1 || srv.startupOverTLS.Load() != 1 {
			t.Fatalf("handshakes = %d, startup packets over TLS = %d, want 1 and 1 (open error: %s)", srv.handshakes.Load(), srv.startupOverTLS.Load(), withheld(err))
		}
		if srv.plaintextStartups.Load() != 0 {
			t.Fatal("a startup packet was sent in plaintext")
		}
		assertGenericTransportError(t, err) // the stub is not a database, so the open fails after TLS; it must still be generic
	})
	t.Run("a certificate for another host name is refused and no startup packet is sent", func(t *testing.T) {
		srv := startStub(t, stubOptions{tls: newLeaf(t, trusted, "other.example.test")})
		err := open(t, dsn(srv.port, caFile))
		if err == nil {
			t.Fatal("opened over a certificate for another host")
		}
		if srv.startupOverTLS.Load() != 0 || srv.plaintextStartups.Load() != 0 {
			t.Fatal("the client sent a startup packet to a server whose certificate did not match the host")
		}
		assertGenericTransportError(t, err)
	})
	t.Run("a certificate from an unpinned root is refused and no startup packet is sent", func(t *testing.T) {
		srv := startStub(t, stubOptions{tls: newLeaf(t, rogue, "localhost")})
		err := open(t, dsn(srv.port, caFile))
		if err == nil {
			t.Fatal("opened over a certificate from a root that was not pinned")
		}
		if srv.startupOverTLS.Load() != 0 || srv.plaintextStartups.Load() != 0 {
			t.Fatal("the client sent a startup packet to a server whose certificate chain was not trusted")
		}
		assertGenericTransportError(t, err)
	})
	t.Run("a server that refuses TLS is not answered in plaintext", func(t *testing.T) {
		srv := startStub(t, stubOptions{})
		err := open(t, dsn(srv.port, caFile))
		if err == nil {
			t.Fatal("opened without TLS")
		}
		if srv.sslRequests.Load() == 0 {
			t.Fatal("the client never asked for TLS")
		}
		if srv.plaintextStartups.Load() != 0 {
			t.Fatal("the client downgraded to a plaintext startup packet after TLS was refused")
		}
		assertGenericTransportError(t, err)
	})
	t.Run("only the explicit private-network exception speaks plaintext", func(t *testing.T) {
		srv := startStub(t, stubOptions{})
		err := open(t, transportDSN("localhost:"+srv.port, "sslmode=disable&connect_timeout=3"), store.PrivateNetwork(true))
		if err == nil {
			t.Fatal("the stub is not a database; the open should fail after the startup packet")
		}
		if srv.plaintextStartups.Load() != 1 || srv.sslRequests.Load() != 0 {
			t.Fatalf("plaintext startups = %d, ssl requests = %d, want 1 and 0", srv.plaintextStartups.Load(), srv.sslRequests.Load())
		}
	})
}

// --- helpers ------------------------------------------------------------------------------------------------------------

type target struct {
	host string
	tls  *tls.Config
}

func targets(host string, cfg *tls.Config, fallbacks []*pgconn.FallbackConfig) []target {
	out := []target{{host, cfg}}
	for _, fb := range fallbacks {
		out = append(out, target{fb.Host, fb.TLSConfig})
	}
	return out
}

func isLocalTarget(host string) bool {
	if strings.HasPrefix(host, "/") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// assertGenericTransportError checks that a refusal or connection error names neither the synthetic password, the role nor a
// file path, and that a transport refusal, whose text is fixed, names no host either. A TLS verification error of the
// standard library may name the certificate's and the dialed host; the commands print only an error's class.
func assertGenericTransportError(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		return
	}
	leaks := []string{storePassword, "aya_runtime", ".pem"}
	if errors.Is(err, store.ErrDatabaseTransportInsecure) || errors.Is(err, store.ErrDatabasePlaintextNotPrivate) {
		leaks = append(leaks, "example.test", "203.0.113.7", "localhost", "aya-db", "10.1.2.3")
	}
	for _, leak := range leaks {
		if strings.Contains(err.Error(), leak) {
			t.Fatalf("the error quotes %q: %s", leak, withheld(err))
		}
	}
}

type testCA struct {
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
	pem  []byte
}

func newCA(t *testing.T) testCA {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()), Subject: pkix.Name{CommonName: "store transport test CA"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return testCA{cert: cert, key: key, pem: pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})}
}

func writeCA(t *testing.T, ca testCA) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "root.pem")
	if err := os.WriteFile(p, ca.pem, 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

// newLeaf issues a server certificate for dnsName (and no IP) from ca.
func newLeaf(t *testing.T, ca testCA, dnsName string) *tls.Config {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano() + 1), Subject: pkix.Name{CommonName: dnsName},
		DNSNames: []string{dnsName}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, ca.cert, &key.PublicKey, ca.key)
	if err != nil {
		t.Fatal(err)
	}
	return &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}}, MinVersion: tls.VersionTLS12}
}

type stubOptions struct {
	tls *tls.Config // nil: the stub answers the SSLRequest with 'N'
}

// stub is a protocol stub, not a database: it answers pgx's SSLRequest, counts what the client did, and hangs up.
type stub struct {
	port                                                                 string
	accepted, sslRequests, handshakes, startupOverTLS, plaintextStartups atomic.Int64
}

func startStub(t *testing.T, o stubOptions) *stub {
	t.Helper()
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	s := &stub{port: strconv.Itoa(ln.Addr().(*net.TCPAddr).Port)}
	done := make(chan struct{})
	t.Cleanup(func() { ln.Close(); <-done })
	go func() {
		defer close(done)
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			s.accepted.Add(1)
			go s.serve(conn, o)
		}
	}()
	return s
}

func (s *stub) serve(conn net.Conn, o stubOptions) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	head := make([]byte, 8)
	n, _ := readFull(conn, head)
	if n < 8 {
		return
	}
	if binary.BigEndian.Uint32(head[4:]) != sslRequestCode {
		// A startup message without an SSLRequest: the client went straight to plaintext.
		s.plaintextStartups.Add(1)
		return
	}
	s.sslRequests.Add(1)
	if o.tls == nil {
		_, _ = conn.Write([]byte{'N'})
		// A client that downgrades now sends its startup packet in plaintext.
		buf := make([]byte, 1)
		if k, _ := conn.Read(buf); k > 0 {
			s.plaintextStartups.Add(1)
		}
		return
	}
	_, _ = conn.Write([]byte{'S'})
	tc := tls.Server(conn, o.tls)
	if err := tc.Handshake(); err != nil {
		return
	}
	s.handshakes.Add(1)
	buf := make([]byte, 1)
	if k, _ := tc.Read(buf); k > 0 {
		s.startupOverTLS.Add(1)
	}
}

func readFull(c net.Conn, b []byte) (int, error) {
	n := 0
	for n < len(b) {
		k, err := c.Read(b[n:])
		n += k
		if err != nil {
			return n, err
		}
	}
	return n, nil
}
