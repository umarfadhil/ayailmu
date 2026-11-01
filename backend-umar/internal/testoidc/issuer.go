// Package testoidc is a synthetic local JWKS fixture; never an authentication mode.
package testoidc

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	jose "github.com/go-jose/go-jose/v4"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type Issuer struct {
	URL    string
	key    *rsa.PrivateKey
	server *httptest.Server
}

func New(t *testing.T) *Issuer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	i := &Issuer{key: key}
	i.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/jwks" {
			json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "synthetic", Algorithm: "RS256", Use: "sig"}}})
			return
		}
		http.NotFound(w, r)
	}))
	i.URL = i.server.URL
	t.Cleanup(i.server.Close)
	return i
}
func (i *Issuer) Token(t *testing.T, overrides map[string]any) string {
	t.Helper()
	now := time.Now().Unix()
	claims := map[string]any{"iss": i.URL, "sub": "synthetic-owner", "aud": "umar-api", "azp": "umar-native", "typ": "Bearer", "scope": "openid umar.sync", "iat": now, "exp": now + 300, "auth_time": now}
	for k, v := range overrides {
		claims[k] = v
	}
	b, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: i.key}, (&jose.SignerOptions{}).WithHeader("kid", "synthetic").WithType("JWT"))
	if err != nil {
		t.Fatal(err)
	}
	obj, err := signer.Sign(b)
	if err != nil {
		t.Fatal(err)
	}
	token, err := obj.CompactSerialize()
	if err != nil {
		t.Fatal(err)
	}
	return token
}
