package main

// The migration job reaches its database over verified TLS unless AYA_DB_TRANSPORT=private-network explicitly allows
// plaintext to a private target. A named host (here "localhost", a single-label name that resolves to the isolated test
// PostgreSQL) with sslmode=disable is the case that used to migrate silently: now it is refused, before anything is dialed
// or created, with the fixed reason and no URL, host or password in the output. With the explicit exception it runs.

import (
	"bytes"
	"context"
	"net/url"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/store"
)

func TestMigrateRefusesPlaintextToANamedHostUnlessPrivateNetworkIsExplicit(t *testing.T) {
	ctx := context.Background()
	dbURL := testDatabaseURL(t)
	u, err := url.Parse(dbURL)
	if err != nil || u.Port() == "" {
		t.Fatal("AYA_TEST_DATABASE_URL must be a postgres:// URL with a host and a port")
	}
	password, _ := u.User.Password()
	u.Host = "localhost:" + u.Port()
	q := u.Query()
	q.Set("sslmode", "disable")
	u.RawQuery = q.Encode()
	named := u.String()
	envFor := func(t *testing.T, schema string) map[string]string {
		return map[string]string{
			config.EnvDatabaseURLFile: urlFile(t, named+"\n", 0o600),
			config.EnvDBHosts:         "localhost",
			config.EnvSchema:          schema,
		}
	}
	quotes := func(s string) bool {
		return strings.Contains(s, named) || (password != "" && strings.Contains(s, password)) || strings.Contains(s, "localhost")
	}

	t.Run("plaintext to the allow-listed name is refused and creates nothing", func(t *testing.T) {
		schema := ownedSchema(t)
		pool := fixturePool(t, dbURL, schema)
		var out, errOut bytes.Buffer
		if code := run(ctx, lookupIn(envFor(t, schema)), &out, &errOut); code != 1 {
			t.Fatalf("exit %d, want 1 (stdout %q)", code, out.String())
		}
		if !strings.Contains(errOut.String(), store.ErrDatabaseTransportInsecure.Error()) {
			t.Fatalf("stderr = %q, want the fixed transport refusal", errOut.String())
		}
		if out.Len() != 0 || quotes(out.String()+errOut.String()) {
			t.Fatal("the refusal printed on stdout or quoted the URL, host or password")
		}
		if schemaExists(t, pool, schema) {
			t.Fatal("a refused job created the schema")
		}
	})

	t.Run("an explicit private-network setting runs the same configuration", func(t *testing.T) {
		schema := ownedSchema(t)
		pool := fixturePool(t, dbURL, schema)
		env := envFor(t, schema)
		env[config.EnvDBTransport] = "private-network"
		var out, errOut bytes.Buffer
		if code := run(ctx, lookupIn(env), &out, &errOut); code != 0 {
			t.Fatalf("exit %d, want 0 (stderr %q)", code, errOut.String())
		}
		if !schemaExists(t, pool, schema) || strings.TrimSpace(out.String()) == "" {
			t.Fatal("the job did not migrate")
		}
		if quotes(out.String() + errOut.String()) {
			t.Fatal("the job printed the URL, host or password")
		}
	})

	t.Run("verified-tls spelled out keeps the strict default", func(t *testing.T) {
		schema := ownedSchema(t)
		pool := fixturePool(t, dbURL, schema)
		env := envFor(t, schema)
		env[config.EnvDBTransport] = "verified-tls"
		var out, errOut bytes.Buffer
		if code := run(ctx, lookupIn(env), &out, &errOut); code != 1 || schemaExists(t, pool, schema) {
			t.Fatalf("exit %d, schema created = %v; want a refusal that creates nothing", code, schemaExists(t, pool, schema))
		}
	})
}
