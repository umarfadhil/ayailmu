package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/testoidc"
)

// Only the repository's explicitly supplied disposable database is used.
func TestHTTPLearnerErasureRequiresOwnerConfirmationAndFreshAuth(t *testing.T) {
	database := os.Getenv("UMAR_TEST_DATABASE_URL")
	if database == "" {
		t.Skip("disposable Postgres fixture not configured")
	}
	registry, err := catalog.Load()
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
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
	policy, _ := ParseReleasePolicy("true", "adult-owner-v1", "owner-sync-fixture-1")
	server := httptest.NewServer(NewWithRelease(s, verifier, registry, policy))
	defer server.Close()
	endpoint := server.URL
	token := issuer.Token(t, map[string]any{"sub": t.Name()})
	foreign := issuer.Token(t, map[string]any{"sub": t.Name() + "-foreign"})
	stale := issuer.Token(t, map[string]any{"sub": t.Name(), "auth_time": time.Now().Add(-10 * time.Minute).Unix()})
	call := func(path, body, bearer string, want int) []byte {
		t.Helper()
		req, _ := http.NewRequest("POST", endpoint+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+bearer)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("POST %s: got %d want %d: %s", path, res.StatusCode, want, data)
		}
		return data
	}
	activation := `{"declaration_version":"adult-owner-v1","adult_confirmed":true,"synthetic":false}`
	call("/v1/account", activation, token, 200)
	call("/v1/account", activation, foreign, 200)
	input := `{"client_learner_id":"erasure-adult","kind":"ADULT","lang":"id","synthetic":false}`
	var learner store.Profile
	if err = json.Unmarshal(call("/v1/learners", input, token, 200), &learner); err != nil {
		t.Fatal(err)
	}
	path := "/v1/learners/" + learner.ID + "/deletion"
	body := `{"request_id":"55fe486e-4437-4edb-8236-6a14fbf1df27","confirmed":true,"synthetic":false}`
	call(path, strings.Replace(body, `"confirmed":true`, `"confirmed":false`, 1), token, 400)
	call(path, body, stale, 403)
	call(path, body, foreign, 404)
	first := call(path, body, token, 200)
	var receipt map[string]string
	if err = json.Unmarshal(first, &receipt); err != nil {
		t.Fatal(err)
	}
	if receipt["scope"] != "learner" || receipt["learner_id"] != learner.ID || receipt["request_id"] != "55fe486e-4437-4edb-8236-6a14fbf1df27" || receipt["deletion_id"] == "" || receipt["completed_at"] == "" {
		t.Fatalf("wrong receipt: %s", first)
	}
	if got := call(path, body, token, 200); string(got) != string(first) {
		t.Fatalf("retry changed receipt: %s / %s", first, got)
	}
	call("/v1/learners", input, token, 410)
	otherInput := `{"client_learner_id":"erasure-second-adult","kind":"ADULT","lang":"en","synthetic":false}`
	var second store.Profile
	json.Unmarshal(call("/v1/learners", otherInput, token, 200), &second)
	call("/v1/learners/"+second.ID+"/deletion", body, token, 409)

	// Turning off learning readiness cannot remove the existing owner's erasure path.
	off := httptest.NewServer(NewWithRelease(s, verifier, registry, ReleasePolicy{}, DeploymentNormalOnly))
	defer off.Close()
	endpoint = off.URL
	body2 := strings.Replace(body, "55fe486e-4437-4edb-8236-6a14fbf1df27", "66fe486e-4437-4edb-8236-6a14fbf1df27", 1)
	call("/v1/learners/"+second.ID+"/deletion", body2, token, 200)
}
