// dev-auth-keys creates private credentials for the isolated synthetic GoTrue lab.
// Never use this development bootstrap for a deployed identity service.
package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	jose "github.com/go-jose/go-jose/v4"
)

func run() error {
	dir := flag.String("dir", "", "private synthetic lab directory")
	flag.Parse()
	if *dir == "" {
		return fmt.Errorf("a private output directory is required")
	}
	if err := os.MkdirAll(*dir, 0700); err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(*dir, "signing-keys.json")); err == nil {
		return nil
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return err
	}
	kid := "umar-synthetic-" + rand.Text()
	jwk := jose.JSONWebKey{Key: key, KeyID: kid, Algorithm: "ES256", Use: "sig"}
	encoded, err := json.Marshal(jwk)
	if err != nil {
		return err
	}
	var document map[string]any
	if err = json.Unmarshal(encoded, &document); err != nil {
		return err
	}
	// GoTrue selects its signing JWK by key_ops ("use:sig" alone is insufficient).
	document["key_ops"] = []string{"sign", "verify"}
	keys, err := json.Marshal([]map[string]any{document})
	if err != nil {
		return err
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.ES256, Key: key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", kid))
	if err != nil {
		return err
	}
	now := time.Now().Unix()
	claims, err := json.Marshal(map[string]any{"iss": "http://127.0.0.1:8287", "aud": "authenticated", "sub": "00000000-0000-0000-0000-000000000000", "role": "service_role", "iat": now, "exp": now + 365*86400})
	if err != nil {
		return err
	}
	signed, err := signer.Sign(claims)
	if err != nil {
		return err
	}
	admin, err := signed.CompactSerialize()
	if err != nil {
		return err
	}
	for name, value := range map[string][]byte{"signing-keys.json": keys, "service-role.jwt": []byte(admin)} {
		f, e := os.OpenFile(filepath.Join(*dir, name), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e != nil {
			return e
		}
		_, e = f.Write(value)
		f.Close()
		if e != nil {
			return e
		}
	}
	return nil
}
func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Synthetic auth credential initialization failed")
		os.Exit(1)
	}
}
