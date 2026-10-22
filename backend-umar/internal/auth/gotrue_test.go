package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"
)

func TestGoTrueClaimsAndRefreshDoesNotRenewAuthentication(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "synthetic-gotrue", Algorithm: "ES256", Use: "sig"}}})
	}))
	defer server.Close()
	now := time.Now().Unix()
	token := func(overrides map[string]any) string {
		claims := map[string]any{"iss": server.URL, "aud": "authenticated", "sub": "a749d859-937d-408b-a183-7931c8ab58c1", "session_id": "b217d680-ab81-43a6-ab26-401304958455", "role": "authenticated", "iat": now, "exp": now + 300, "is_anonymous": false, "amr": []map[string]any{{"method": "password", "timestamp": now}}}
		for k, v := range overrides {
			claims[k] = v
		}
		b, _ := json.Marshal(claims)
		signer, e := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "synthetic-gotrue").WithType("JWT"))
		if e != nil {
			t.Fatal(e)
		}
		signed, e := signer.Sign(b)
		if e != nil {
			t.Fatal(e)
		}
		raw, e := signed.CompactSerialize()
		if e != nil {
			t.Fatal(e)
		}
		return raw
	}
	v, err := New(context.Background(), Config{Provider: "gotrue", Issuer: server.URL, JWKSURL: server.URL, Audience: "authenticated", AllowLoopbackHTTP: true})
	if err != nil {
		t.Fatal(err)
	}
	p, err := v.Verify(context.Background(), token(nil))
	if err != nil || !p.Fresh(time.Now()) {
		t.Fatal(p, err)
	}
	for name, c := range map[string]map[string]any{
		"issuer": {"iss": "https://foreign.invalid"}, "audience": {"aud": "umar-api"}, "service_role": {"role": "service_role"}, "anon_role": {"role": "anon"}, "anonymous_user": {"is_anonymous": true}, "missing_session": {"session_id": nil}, "invalid_subject": {"sub": "not-a-uuid"}, "future_iat": {"iat": now + 30}, "expired": {"exp": now - 10}, "future_nbf": {"nbf": now + 30}, "future_authentication": {"amr": []map[string]any{{"method": "password", "timestamp": now + 60}}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, e := v.Verify(context.Background(), token(c)); e == nil {
				t.Fatal("unsafe token accepted")
			}
		})
	}
	for name, c := range map[string]map[string]any{
		"refreshed_old_login":     {"iat": now, "amr": []map[string]any{{"method": "password", "timestamp": now - 600}}},
		"missing_amr":             {"amr": nil},
		"untrusted_user_metadata": {"amr": nil, "user_metadata": map[string]any{"auth_time": now, "role": "authenticated"}},
	} {
		t.Run(name, func(t *testing.T) {
			p, e := v.Verify(context.Background(), token(c))
			if e != nil || p.Fresh(time.Now()) {
				t.Fatal("refresh/metadata incorrectly counted as fresh", e)
			}
		})
	}
}
