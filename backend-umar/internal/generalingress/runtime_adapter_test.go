package generalingress

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/pem"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func runtimeAdapterFixture(t *testing.T) (RuntimeConfig, *HTTPProvider, *HTTPBackend, *roundTripDouble, *testClock) {
	t.Helper()
	c, _, _, clock := runtimeFixture(t)
	_, _, rt, reader, _ := adapterFixture(t)
	reader.value.Principal.AuthTime = clock.Now().Unix()
	reader.value.ExpiresAt = clock.Now().Add(time.Hour)
	original := rt.call
	rt.call = func(r *http.Request) (*http.Response, error) {
		response, err := original(r)
		if response != nil && response.TLS != nil {
			response.TLS.ServerName = "localhost"
		}
		return response, err
	}
	pin := sha256.Sum256([]byte("existing-synthetic-public-root-model-no-key"))
	c.CAHash = hex.EncodeToString(pin[:])
	p, b, err := runtimeAdapters(c, clock, rt, reader, nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	return c, p, b, rt, clock
}
func TestRuntimeAdaptersUsePortlessTLSNameAndPrivateExactOrigin(t *testing.T) {
	_, p, _, rt, _ := runtimeAdapterFixture(t)
	original := rt.call
	rt.call = func(r *http.Request) (*http.Response, error) {
		if r.URL.Host != "localhost:58443" || r.Host != "localhost:58443" || r.URL.Scheme != "https" {
			t.Fatal("private origin drift")
		}
		return original(r)
	}
	s, err := p.Authenticate(context.Background(), AuthRequest{Grant: "password", Email: "first@example.invalid", Password: "synthetic-password-123"})
	if err != nil || s.AccessToken != "a-access" || p.OfflineOnly() {
		t.Fatal("runtime provider composition failed", err)
	}
	if p.cfg.Simulation {
		t.Fatal("runtime masqueraded as simulation")
	}
}
func TestRuntimeAdapterNoImplicitAuthorityNetworkMailOrRedirect(t *testing.T) {
	c, p, _, rt, clock := runtimeAdapterFixture(t)
	before := rt.calls
	if p.Mail(context.Background(), MailRequest{Action: "signup"}) == nil || rt.calls != before {
		t.Fatal("unconfigured mail forwarded")
	}
	c.Revocation = RequireSessionStatus
	if _, _, err := runtimeAdapters(c, clock, rt, p.reader, nil, nil, nil); err == nil {
		t.Fatal("invented authoritative session status")
	}
	c.Revocation = AllowBoundedJWT
	c.Policy.MailEnabled = true
	if _, _, err := runtimeAdapters(c, clock, rt, p.reader, nil, nil, keyerDouble{}); err == nil {
		t.Fatal("partial explicit accounting silently fell back")
	}
	original := rt.call
	rt.call = func(r *http.Request) (*http.Response, error) {
		response, err := original(r)
		response.StatusCode = 302
		response.Header.Set("Location", "https://other.example.invalid")
		return response, err
	}
	if _, err := p.Inspect(context.Background(), "a-access"); err == nil {
		t.Fatal("upstream redirect accepted")
	}
}
func TestRuntimeDedicatedAccountingReusesAtomicStoreWithoutReset(t *testing.T) {
	_, _, _, clock := runtimeFixture(t)
	keyer, err := NewRuntimeKeyer(true, "public-fixture", "runtime-fixture", bytes.Repeat([]byte{0xaa}, 131))
	if err != nil {
		t.Fatal(err)
	}
	disk, err := NewFileJournal(filepath.Join(t.TempDir(), "ledger"))
	if err != nil {
		t.Fatal(err)
	}
	policy := BudgetPolicy{Scope: "runtime-fixture", Global: 2, RecipientHour: 2, IPHour: 2, Cooldown: time.Minute, IdentityBinding: keyer.PolicyBinding()}
	b, err := NewRuntimeBudget(true, policy, disk)
	if err != nil {
		t.Fatal(err)
	}
	if b.Check(context.Background(), clock.Now()) == nil {
		t.Fatal("missing ledger silently initialized")
	}
	if b.Initialize(context.Background(), clock.Now()) != nil {
		t.Fatal("explicit disposable initialization failed")
	}
	recipient, _ := keyer.Key("recipient", "first@example.invalid")
	ip, _ := keyer.Key("ip", "192.0.2.1")
	if b.Reserve(context.Background(), "op1", recipient, ip, clock.Now()) != nil {
		t.Fatal("reservation failed")
	}
	restored, _ := NewRuntimeBudget(true, policy, disk)
	if restored.Check(context.Background(), clock.Now()) != nil || restored.Reserve(context.Background(), "op1", recipient, ip, clock.Now()) != ErrReplay {
		t.Fatal("restart lost accounting")
	}
	if restored.Initialize(context.Background(), clock.Now()) == nil {
		t.Fatal("existing ledger reset")
	}
	if _, err := NewRuntimeKeyer(false, "unset", "fixture", nil); err == nil {
		t.Fatal("default keyer open")
	}
}
func TestRuntimeTransportRejectsDisabledMissingOrWrongCAWithoutDial(t *testing.T) {
	c, _, _, clock := runtimeFixture(t)
	if _, err := NewRuntimeTransport(c, nil, clock.Now()); err == nil {
		t.Fatal("missing CA accepted")
	}
	c.Enabled = false
	if _, err := NewRuntimeTransport(c, []byte("not a certificate"), clock.Now()); err == nil {
		t.Fatal("disabled transport constructed")
	}
}

func TestRuntimePinnedTLSConstructionAndOIDCCompositionMakeNoConnection(t *testing.T) {
	c, _, _, clock := runtimeFixture(t)
	publicCA, err := os.ReadFile("testdata/runtime-public-ca.crt")
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(publicCA)
	if block == nil {
		t.Fatal("public test CA fixture absent")
	}
	pin := sha256.Sum256(block.Bytes)
	c.CAHash = hex.EncodeToString(pin[:])
	roundTripper, err := NewRuntimeTransport(c, publicCA, clock.Now())
	if err != nil {
		t.Fatal(err)
	}
	guard := roundTripper.(*guardedTransport)
	transport := guard.base.(*http.Transport)
	defer guard.CloseIdleConnections()
	if transport.Proxy != nil || transport.TLSClientConfig.InsecureSkipVerify || transport.TLSClientConfig.RootCAs == nil || transport.TLSClientConfig.MinVersion < tls.VersionTLS12 || transport.TLSClientConfig.ServerName != "localhost" || !transport.DisableCompression {
		t.Fatal("runtime TLS policy missing")
	}
	if _, err = transport.DialContext(context.Background(), "tcp", "external.example.invalid:443"); err == nil {
		t.Fatal("unlisted dial target accepted")
	}
	p, b, err := NewRuntimeHTTPAdapters(c, clock, publicCA, nil, nil, nil)
	if err != nil || !p.ready() || b == nil {
		t.Fatal("real OIDC composition failed", err)
	}
	defer p.CloseIdleConnections()
	if _, ok := p.reader.(*runtimeSessionReader); !ok {
		t.Fatal("production signature oracle replaced by fixture")
	}
	c.CAHash = hex.EncodeToString(make([]byte, 32))
	if _, err = NewRuntimeTransport(c, publicCA, clock.Now()); err == nil {
		t.Fatal("wrong CA pin accepted")
	}
}

func TestOrdinaryAdapterPreservesIssuerAcrossPublicURLAndRejectsAudienceDrift(t *testing.T) {
	c, _, _, rt, clock := runtimeAdapterFixture(t)
	_, _, _, reader, _ := adapterFixture(t)
	c.Policy.Issuer = "https://identity.example.invalid"
	reader.value.Principal.Issuer = c.Policy.Issuer
	reader.value.Principal.AuthTime = clock.Now().Unix()
	reader.value.ExpiresAt = clock.Now().Add(time.Hour)
	for _, public := range []string{origin, "https://changed-public.example.invalid"} {
		c.Policy.Origin = public
		p, b, err := runtimeAdapters(c, clock, rt, reader, nil, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		claims, err := p.Verify(context.Background(), "a-access")
		if err != nil || claims.Issuer != c.Policy.Issuer || claims.Subject != userA {
			t.Fatal("public URL rotated provider identity")
		}
		if own, err := b.Owns(context.Background(), claims, learnerA, "a-access"); err != nil || !own {
			t.Fatal("stable issuer lost account scope", err)
		}
		before := rt.calls
		reader.value.Audience = "other-app"
		if _, err := p.Inspect(context.Background(), "a-access"); err == nil || rt.calls != before {
			t.Fatal("wrong audience forwarded")
		}
		reader.value.Audience = "authenticated"
		reader.value.Principal.Issuer = "https://untrusted.example.invalid"
		if _, err := p.Verify(context.Background(), "a-access"); err == nil {
			t.Fatal("unconfigured issuer accepted")
		}
		reader.value.Principal.Issuer = c.Policy.Issuer
	}
}
