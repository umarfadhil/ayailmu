package store

import (
	"context"
	"strings"
	"testing"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
)

func transportRegistry(t *testing.T) *catalog.Registry {
	t.Helper()
	registry, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	return registry
}

func TestOpenRemoteSSLModes(t *testing.T) {
	registry := transportRegistry(t)
	for _, test := range []struct {
		name    string
		query   string
		wantErr bool
	}{
		{name: "default", wantErr: true},
		{name: "disable", query: "sslmode=disable", wantErr: true},
		{name: "prefer", query: "sslmode=prefer", wantErr: true},
		{name: "allow", query: "sslmode=allow", wantErr: true},
		{name: "require", query: "sslmode=require", wantErr: true},
		{name: "verify-ca", query: "sslmode=verify-ca", wantErr: true},
		{name: "verify-full", query: "sslmode=verify-full"},
	} {
		t.Run(test.name, func(t *testing.T) {
			url := "postgres://synthetic:synthetic@db.example.invalid/synthetic"
			if test.query != "" {
				url += "?" + test.query
			}
			s, err := Open(context.Background(), url, registry)
			if test.wantErr {
				if err == nil {
					s.Close()
					t.Fatal("remote connection without hostname-verifying TLS was accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			s.Close()
		})
	}
}

func TestOpenVerifiedRemoteAddresses(t *testing.T) {
	registry := transportRegistry(t)
	for _, host := range []string{"db.example.invalid", "203.0.113.10", "[2001:db8::10]"} {
		t.Run(host, func(t *testing.T) {
			s, err := Open(context.Background(), "postgres://synthetic:synthetic@"+host+"/synthetic?sslmode=verify-full", registry)
			if err != nil {
				t.Fatal(err)
			}
			s.Close()
		})
	}
}

func TestOpenLocalTransportDefaultsRemainCompatible(t *testing.T) {
	registry := transportRegistry(t)
	for _, test := range []struct {
		name string
		url  string
	}{
		{name: "loopback IPv4 default", url: "postgres://synthetic:synthetic@127.0.0.1/synthetic"},
		{name: "loopback IPv4 disable", url: "postgres://synthetic:synthetic@127.8.9.10/synthetic?sslmode=disable"},
		{name: "loopback IPv6 default", url: "postgres://synthetic:synthetic@[::1]/synthetic"},
		{name: "Unix socket default", url: "postgres://synthetic:synthetic@/synthetic?host=%2Ftmp"},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, err := Open(context.Background(), test.url, registry)
			if err != nil {
				t.Fatal(err)
			}
			s.Close()
		})
	}
}

func TestOpenRejectsDeceptiveRemoteHostnames(t *testing.T) {
	registry := transportRegistry(t)
	for _, host := range []string{"127.0.0.1.evil.invalid", "localhost.evil.invalid"} {
		t.Run(host, func(t *testing.T) {
			s, err := Open(context.Background(), "postgres://synthetic:synthetic@"+host+"/synthetic?sslmode=disable", registry)
			if err == nil {
				s.Close()
				t.Fatal("hostname resembling a loopback address was treated as local")
			}
		})
	}
}

func TestOpenMixedMainAndFallbackTransports(t *testing.T) {
	registry := transportRegistry(t)
	for _, test := range []struct {
		name    string
		url     string
		wantErr bool
	}{
		{
			name: "verified remote main and fallback",
			url:  "postgres://synthetic:synthetic@db-one.example.invalid,db-two.example.invalid/synthetic?sslmode=verify-full",
		},
		{
			name: "verified remote with local main",
			url:  "postgres://synthetic:synthetic@127.0.0.1,db.example.invalid/synthetic?sslmode=verify-full",
		},
		{
			name:    "remote main with plaintext remote fallback",
			url:     "postgres://synthetic:synthetic@db-one.example.invalid,db-two.example.invalid/synthetic?sslmode=prefer",
			wantErr: true,
		},
		{
			name:    "plaintext remote main with local fallback",
			url:     "postgres://synthetic:synthetic@db.example.invalid,127.0.0.1/synthetic?sslmode=disable",
			wantErr: true,
		},
		{
			name:    "local main with plaintext remote fallback",
			url:     "postgres://synthetic:synthetic@127.0.0.1,db.example.invalid/synthetic?sslmode=disable",
			wantErr: true,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, err := Open(context.Background(), test.url, registry)
			if test.wantErr {
				if err == nil {
					s.Close()
					t.Fatal("mixed targets permit an unauthenticated or plaintext connection")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			s.Close()
		})
	}
}

func TestOpenTransportErrorIsGenericAndRedacted(t *testing.T) {
	const (
		host     = "transport-secret.example.invalid"
		password = "synthetic-do-not-disclose"
	)
	url := "postgres://synthetic:" + password + "@" + host + "/synthetic?sslmode=disable"
	s, err := Open(context.Background(), url, transportRegistry(t))
	if err == nil {
		s.Close()
		t.Fatal("insecure remote transport was accepted")
	}
	if err.Error() != "remote database transport validation failed" {
		t.Fatalf("unexpected transport error: %v", err)
	}
	for _, secret := range []string{url, host, password} {
		if strings.Contains(err.Error(), secret) {
			t.Fatal("transport error disclosed connection details")
		}
	}
}

func TestOpenLocalPoolSettingsRemainCompatible(t *testing.T) {
	s, err := Open(context.Background(), "postgres://synthetic:synthetic@127.0.0.1/synthetic?sslmode=disable&pool_max_conns=3&search_path=pg_temp", transportRegistry(t))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	cfg := s.pool.Config()
	if cfg.MaxConns != 8 {
		t.Fatalf("MaxConns changed: %d", cfg.MaxConns)
	}
	if got := cfg.ConnConfig.RuntimeParams["search_path"]; got != "public, pg_temp" {
		t.Fatalf("search_path changed: %q", got)
	}
}
