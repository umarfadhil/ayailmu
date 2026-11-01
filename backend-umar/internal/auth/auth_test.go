package auth

import (
	"context"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/testoidc"
	"testing"
	"time"
)

func TestJWKSClaimsAndFreshness(t *testing.T) {
	issuer := testoidc.New(t)
	v, err := New(context.Background(), Config{Issuer: issuer.URL, JWKSURL: issuer.URL + "/jwks", Audience: "umar-api", ClientID: "umar-native", AllowLoopbackHTTP: true})
	if err != nil {
		t.Fatal(err)
	}
	p, err := v.Verify(context.Background(), issuer.Token(t, nil))
	if err != nil || p.Subject != "synthetic-owner" || !p.Fresh(time.Now()) {
		t.Fatal(p, err)
	}
	cases := map[string]map[string]any{
		"issuer": {"iss": "http://foreign.invalid"}, "audience": {"aud": "account"}, "client": {"azp": "other"}, "expired": {"exp": time.Now().Unix() - 5}, "nbf": {"nbf": time.Now().Unix() + 60}, "scope": {"scope": "openid"}, "type": {"typ": "ID"}, "empty-subject": {"sub": ""}, "future-iat": {"iat": time.Now().Unix() + 100},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			if _, e := v.Verify(context.Background(), issuer.Token(t, c)); e == nil {
				t.Fatal("invalid claims accepted")
			}
		})
	}
	p, err = v.Verify(context.Background(), issuer.Token(t, map[string]any{"auth_time": time.Now().Unix() - 600}))
	if err != nil || p.Fresh(time.Now()) {
		t.Fatal("stale authentication accepted as fresh", err)
	}
	p, err = v.Verify(context.Background(), issuer.Token(t, map[string]any{"auth_time": nil}))
	if err != nil || p.Fresh(time.Now()) {
		t.Fatal("missing auth time accepted as fresh", err)
	}
	foreign := testoidc.New(t)
	if _, err = v.Verify(context.Background(), foreign.Token(t, map[string]any{"iss": issuer.URL})); err == nil {
		t.Fatal("wrong signing key accepted")
	}
	if _, err = v.Verify(context.Background(), "not-a-token"); err == nil {
		t.Fatal("malformed token accepted")
	}
}
func TestConfigurationFailsClosed(t *testing.T) {
	for _, cfg := range []Config{{}, {Issuer: "http://example.com", JWKSURL: "http://example.com/jwks", Audience: "umar-api", ClientID: "umar-native", AllowLoopbackHTTP: true}} {
		if _, err := New(context.Background(), cfg); err == nil {
			t.Fatal("unsafe configuration accepted")
		}
	}
}
