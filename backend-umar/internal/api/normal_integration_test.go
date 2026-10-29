package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/auth"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/testoidc"
)

// Runs only against the explicitly supplied disposable test database; never a runtime deployment.
func TestHTTPNormalOwnerLearnerConsentAndImmutableSync(t *testing.T) {
	url := os.Getenv("UMAR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("disposable Postgres fixture not configured")
	}
	registry, _ := catalog.Load()
	pack := registry.Packs[0]
	pack.Synthetic = false
	pack.Items = map[string]catalog.Item{}
	for id, item := range registry.Packs[0].Items {
		item.ReviewStatus = "approved"
		pack.Items[id] = item
	}
	registry.Packs[0] = pack
	var itemID string
	var item catalog.Item
	for itemID, item = range pack.Items {
		if item.Type == "choose" {
			break
		}
	}
	draftItem := item
	draftItem.ReviewStatus = "draft"
	pack.Items["fixture-draft"] = draftItem
	ctx := context.Background()
	s, err := store.Open(ctx, url, registry)
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
	foreign := issuer.Token(t, map[string]any{"sub": "foreign-normal-owner"})
	call := func(method, path, body, tok string, want int) []byte {
		t.Helper()
		req, _ := http.NewRequest(method, endpoint+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+tok)
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		data, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s got %d want %d: %s", method, path, res.StatusCode, want, data)
		}
		return data
	}
	call("POST", "/v1/account", `{"declaration_version":"adult-owner-v1","adult_confirmed":false,"synthetic":false}`, token, 400)
	call("POST", "/v1/account", `{"declaration_version":"adult-owner-v1","adult_confirmed":true,"synthetic":false}`, token, 200)
	call("POST", "/v1/account", `{"declaration_version":"adult-owner-v1","adult_confirmed":true,"synthetic":false}`, foreign, 200)
	input := `{"client_learner_id":"normal-native","kind":"ADULT","lang":"id","synthetic":false}`
	var profile store.Profile
	json.Unmarshal(call("POST", "/v1/learners", input, token, 200), &profile)
	path := "/v1/learners/" + profile.ID
	call("POST", path+"/consent", `{"version":"synthetic-sync-v1","granted":true,"synthetic":false}`, token, 400)
	call("POST", path+"/consent", `{"version":"owner-sync-fixture-1","granted":true,"synthetic":false}`, foreign, 404)
	call("POST", path+"/consent", `{"version":"owner-sync-fixture-1","granted":true,"synthetic":false}`, token, 200)
	payload := fmt.Sprintf(`{"answer_id":"normal-answer-1","learner_id":"normal-native","item_id":%q,"track":%q,"content_version":%q,"rules_version":%q,"app_version":"fixture","timestamp":"2026-10-26T00:00:00Z","local_date":"2026-10-26","session_id":"normal-session","lang":%q,"pool":%q,"unit":%q,"skills":[],"raw_response":"{\"kind\":\"choice\",\"option_id\":\"a\"}","auto_score":{},"outcome":"correct","first_attempt":true,"fresh_evidence":false,"review_status":"approved","synthetic":false,"item_type":%q}`,
		itemID, pack.Track, pack.ContentVersion, pack.RulesVersion, pack.InstructionLangs[0], item.Pool, item.Unit, item.Type)
	envelope := func(raw string) string {
		b, _ := json.Marshal(map[string]any{"schema_version": 1, "synthetic": false, "events": []string{raw}})
		return string(b)
	}
	call("POST", path+"/events", envelope(strings.Replace(payload, `"review_status":"approved"`, `"review_status":"draft"`, 1)), token, 400)
	call("POST", path+"/events", envelope(strings.Replace(payload, fmt.Sprintf("\"item_id\":%q", itemID), "\"item_id\":\"unknown-normal-item\"", 1)), token, 400)
	call("POST", path+"/events", envelope(strings.Replace(payload, fmt.Sprintf("\"item_id\":%q", itemID), "\"item_id\":\"fixture-draft\"", 1)), token, 400)
	call("POST", path+"/events", envelope(strings.Replace(payload, fmt.Sprintf("\"rules_version\":%q", pack.RulesVersion), "\"rules_version\":\"forged-rules\"", 1)), token, 400)
	call("POST", path+"/events", envelope(payload), foreign, 404)
	call("POST", path+"/events", envelope(payload), token, 200)
	var receipts []store.Receipt
	json.Unmarshal(call("POST", path+"/events", envelope(payload), token, 200), &receipts)
	if len(receipts) != 1 || !receipts[0].Duplicate || receipts[0].RegistryStatus != "registered" {
		t.Fatalf("bad replay: %#v", receipts)
	}
	var page store.Page
	json.Unmarshal(call("GET", path+"/events?after=0&limit=1", "", token, 200), &page)
	if len(page.Events) != 1 || page.Events[0].Payload != payload {
		t.Fatal("normal payload changed")
	}

	policyV2, _ := ParseReleasePolicy("true", "adult-owner-v1", "owner-sync-fixture-2")
	v2 := httptest.NewServer(NewWithRelease(s, verifier, registry, policyV2))
	defer v2.Close()
	endpoint = v2.URL
	call("POST", path+"/events", envelope(payload), token, 403)
	call("GET", path+"/events?after=0&limit=1", "", token, 403)
	call("POST", path+"/consent", `{"version":"owner-sync-fixture-2","granted":true,"synthetic":false}`, token, 200)
	call("POST", path+"/events", envelope(payload), token, 200)
	call("GET", path+"/events?after=0&limit=1", "", token, 200)

	off := httptest.NewServer(NewWithRelease(s, verifier, registry, ReleasePolicy{}, DeploymentNormalOnly))
	defer off.Close()
	endpoint = off.URL
	mismatched, _ := json.Marshal(map[string]any{"schema_version": 1, "synthetic": true, "events": []string{payload}})
	call("POST", path+"/events", string(mismatched), token, 400)
	call("GET", "/v1/learners", "", token, 403)
	call("GET", path+"/events?after=0&limit=1", "", token, 403)

	// A normal-only deployment never exposes the separate synthetic lane, even while readiness changes.
	lab := httptest.NewServer(New(s, verifier, registry))
	defer lab.Close()
	syntheticToken := issuer.Token(t, map[string]any{"sub": "synthetic-lane-fixture"})
	endpoint = lab.URL
	call("POST", "/v1/account", `{"declaration_version":"adult-owner-v1","adult_confirmed":true,"synthetic":true}`, syntheticToken, 200)
	labInput := `{"client_learner_id":"lab-native","kind":"ADULT","lang":"id","synthetic":true}`
	var labProfile store.Profile
	json.Unmarshal(call("POST", "/v1/learners", labInput, syntheticToken, 200), &labProfile)
	labPath := "/v1/learners/" + labProfile.ID
	call("POST", labPath+"/consent", `{"version":"synthetic-sync-v1","granted":true,"synthetic":true}`, syntheticToken, 200)
	labPayload := `{"answer_id":"lab-answer-1","learner_id":"lab-native","item_id":"LAB-UNKNOWN","track":"lab-track","content_version":"lab-v1","rules_version":"lab-v1","app_version":"fixture","timestamp":"2026-10-26T00:00:00Z","local_date":"2026-10-26","session_id":"lab-session","lang":"id","pool":"PRACT","unit":"A","skills":[],"raw_response":"{\"kind\":\"choice\",\"option_id\":\"a\"}","auto_score":{},"outcome":"correct","first_attempt":true,"fresh_evidence":false,"review_status":"draft","synthetic":true,"item_type":"choose"}`
	labEnvelope, _ := json.Marshal(map[string]any{"schema_version": 1, "synthetic": true, "events": []string{labPayload}})
	call("POST", labPath+"/events", string(labEnvelope), syntheticToken, 200)

	endpoint = server.URL
	call("POST", "/v1/account", `{"declaration_version":"adult-owner-v1","adult_confirmed":true,"synthetic":true}`, syntheticToken, 400)
	call("GET", "/v1/learners", "", syntheticToken, 403)
	call("POST", labPath+"/events", string(labEnvelope), syntheticToken, 403)
	call("GET", labPath+"/events?after=0&limit=1", "", syntheticToken, 403)

	endpoint = off.URL
	call("GET", "/v1/learners", "", syntheticToken, 403)
	catalogBody := call("GET", "/v1/packs", "", token, 200)
	var emptyCatalog catalog.Registry
	json.Unmarshal(catalogBody, &emptyCatalog)
	if len(emptyCatalog.Packs) != 0 {
		t.Fatal("normal OFF catalog served lab/draft content")
	}
	endpoint = lab.URL
	call("GET", "/v1/learners", "", syntheticToken, 200)
}
