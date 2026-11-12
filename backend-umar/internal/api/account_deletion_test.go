package api

import (
	"context"
	"encoding/json"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/accounterase"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/testoidc"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

type isolatedAccountProvider struct {
	issuer string
	calls  int
}

func (p *isolatedAccountProvider) Issuer() string { return p.issuer }
func (p *isolatedAccountProvider) DeleteIdentity(context.Context, string, string) error {
	p.calls++
	return nil
}
func TestHTTPAccountErasureRequiresFreshOwnerAndProofOnlyStatusSurvivesAuthRemoval(t *testing.T) {
	database := os.Getenv("UMAR_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("disposable Postgres required")
	}
	ctx := context.Background()
	registry, _ := catalog.Load()
	s, err := store.Open(ctx, database, registry)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	issuer := testoidc.New(t)
	verifier, err := auth.New(ctx, auth.Config{Issuer: issuer.URL, JWKSURL: issuer.URL + "/jwks", Audience: "umar-api", ClientID: "umar-native", AllowLoopbackHTTP: true})
	if err != nil {
		t.Fatal(err)
	}
	subject := "30000000-0000-0000-0000-000000000001"
	owner, err := s.Activate(ctx, issuer.URL, subject, true)
	if err != nil {
		t.Fatal(err)
	}
	provider := &isolatedAccountProvider{issuer: issuer.URL}
	coordinator, err := accounterase.New(s, provider)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewWithAccountErasure(s, verifier, registry, ReleasePolicy{}, coordinator, DeploymentNormalOnly))
	defer server.Close()
	endpoint := server.URL
	token := issuer.Token(t, map[string]any{"sub": subject})
	foreign := issuer.Token(t, map[string]any{"sub": "30000000-0000-0000-0000-000000000002"})
	stale := issuer.Token(t, map[string]any{"sub": subject, "auth_time": time.Now().Add(-10 * time.Minute).Unix()})
	call := func(method, path, body, bearer string, want int) []byte {
		t.Helper()
		r, _ := http.NewRequest(method, endpoint+path, strings.NewReader(body))
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		raw, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s: got%d want%d %s", method, path, res.StatusCode, want, raw)
		}
		if res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("cacheable erasure response")
		}
		return raw
	}
	proof := strings.Repeat("ab", 32)
	request := "f2fe486e-4437-4edb-8236-6a14fbf1df27"
	input := `{"account_id":"` + owner + `","request_id":"` + request + `","recovery_token":"` + proof + `","confirmed":true}`
	path := "/v1/account/deletion"
	call("POST", path, input, "", 401)
	call("POST", path, input, stale, 403)
	call("POST", path, input, foreign, 404)
	call("POST", path, strings.Replace(input, `"confirmed":true`, `"confirmed":false`, 1), token, 400)
	first := call("POST", path, input, token, 202)
	if provider.calls != 0 {
		t.Fatal("provider ran inside request")
	}
	if again := call("POST", path, input, token, 202); string(again) != string(first) {
		t.Fatal("retry receipt changed")
	}
	call("GET", "/v1/account", "", token, 410)
	if worked, err := coordinator.ProcessNext(ctx); err != nil || !worked || provider.calls != 1 {
		t.Fatal("worker", worked, err)
	}
	statusBody := `{"request_id":"` + request + `","recovery_token":"` + proof + `"}`
	raw := call("POST", path+"/status", statusBody, "", 200)
	var receipt map[string]any
	if json.Unmarshal(raw, &receipt) != nil || receipt["status"] != "completed" || receipt["identity_deleted_at"] == nil {
		t.Fatal("status", string(raw))
	}
	for _, secret := range []string{proof, subject, owner, issuer.URL} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("status reveals private metadata")
		}
	}
	call("POST", path+"/status", strings.Replace(statusBody, proof, strings.Repeat("cd", 32), 1), "", 404)
	call("POST", path+"/status?recovery_token="+proof, statusBody, "", 400)
	call("POST", path+"/status", strings.TrimSuffix(statusBody, "}")+`,"account_id":"`+owner+`"}`, "", 400)
	// Receipt recovery stays available even if the provider is unavailable or creation is disabled.
	off := httptest.NewServer(NewWithRelease(s, verifier, registry, ReleasePolicy{}, DeploymentNormalOnly))
	defer off.Close()
	endpoint = off.URL
	call("POST", path, input, token, 503)
	call("POST", path+"/status", statusBody, "", 200)
}
