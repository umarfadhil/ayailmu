package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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

func TestHTTPAccountOwnershipAndSync(t *testing.T) {
	url := os.Getenv("UMAR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("run scripts/integration.sh")
	}
	ctx := context.Background()
	r, _ := catalog.Load()
	s, e := store.Open(ctx, url, r)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if e = s.Migrate(ctx); e != nil {
		t.Fatal(e)
	}
	issuer := testoidc.New(t)
	v, e := auth.New(ctx, auth.Config{Issuer: issuer.URL, JWKSURL: issuer.URL + "/jwks", Audience: "umar-api", ClientID: "umar-native", AllowLoopbackHTTP: true})
	if e != nil {
		t.Fatal(e)
	}
	server := httptest.NewServer(New(s, v, r))
	defer server.Close()
	token := issuer.Token(t, map[string]any{"sub": t.Name()})
	foreign := issuer.Token(t, map[string]any{"sub": "foreign-http-owner"})
	call := func(method, path, body, tok string, want int) []byte {
		t.Helper()
		req, _ := http.NewRequest(method, server.URL+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		if res.StatusCode != want {
			t.Fatalf("%s %s got %d want %d: %s", method, path, res.StatusCode, want, b)
		}
		return b
	}
	call("GET", "/healthz", "", "", 200)
	call("GET", "/readyz", "", "", 200)
	call("GET", "/v1/learners", "", "", 401)
	call("GET", "/v1/learners", "", token, 403)
	declaration := `{"declaration_version":"adult-owner-v1","adult_confirmed":true,"synthetic":true}`
	call("POST", "/v1/account", declaration, issuer.Token(t, map[string]any{"auth_time": time.Now().Unix() - 600}), 403)
	call("POST", "/v1/account", strings.Replace(declaration, `"synthetic":true`, `"synthetic":false`, 1), token, 400)
	call("POST", "/v1/account", declaration, token, 200)
	call("GET", "/v1/account", "", issuer.Token(t, map[string]any{"sub": t.Name(), "auth_time": time.Now().Unix() - 600}), 200)
	call("GET", "/v1/account", "", issuer.Token(t, map[string]any{"sub": "unknown-readonly-account"}), 403)
	call("POST", "/v1/account", declaration, foreign, 200)
	input := `{"client_learner_id":"http-native","kind":"ADULT","lang":"id","synthetic":true}`
	call("POST", "/v1/learners", strings.Replace(input, `"kind":`, `"label":"private","kind":`, 1), token, 400)
	call("POST", "/v1/learners", strings.Replace(input, `"kind":`, `"kind":"ADULT","kind":`, 1), token, 400)
	var p store.Profile
	json.Unmarshal(call("POST", "/v1/learners", input, token, 200), &p)
	if p.ID == "" {
		t.Fatal("missing profile")
	}
	call("POST", "/v1/learners", input, token, 200)
	consent := `{"version":"synthetic-sync-v1","granted":true,"synthetic":true}`
	path := "/v1/learners/" + p.ID
	call("POST", path+"/consent", consent, foreign, 404)
	call("POST", path+"/consent", consent, issuer.Token(t, map[string]any{"sub": t.Name(), "auth_time": time.Now().Unix() - 600}), 403)
	call("POST", path+"/consent", consent, token, 200)
	payload := `{"answer_id":"http-answer-1","learner_id":"http-native","item_id":"SYNTHETIC-UNKNOWN","track":"test-track","content_version":"v1","rules_version":"v1","app_version":"test","timestamp":"2026-10-18T10:00:00Z","local_date":"2026-10-18","session_id":"ses1","lang":"id","pool":"PRACT","unit":"A","skills":[],"raw_response":"{\"kind\":\"choice\",\"option_id\":\"a\"}","auto_score":{},"outcome":"correct","first_attempt":true,"fresh_evidence":false,"review_status":"draft","synthetic":true,"item_type":"choose"}`
	envelope := func(p string) string {
		b, _ := json.Marshal(map[string]any{"schema_version": 1, "synthetic": true, "events": []string{p}})
		return string(b)
	}
	call("POST", path+"/events", envelope(payload), foreign, 404)
	call("POST", path+"/events", envelope(strings.Replace(payload, "http-native", "foreign-native", 1)), token, 400)
	call("POST", path+"/events", strings.Replace(envelope(payload), `"synthetic":true`, `"synthetic":false,"SYNTHETIC":true`, 1), token, 400)
	call("POST", path+"/events", envelope(payload), token, 200)
	var receipts []store.Receipt
	json.Unmarshal(call("POST", path+"/events", envelope(payload), token, 200), &receipts)
	if len(receipts) != 1 || !receipts[0].Duplicate {
		t.Fatal("missing duplicate receipt")
	}
	call("POST", path+"/events", envelope(strings.Replace(payload, `"outcome":"correct"`, `"outcome":"wrong"`, 1)), token, 409)
	var page store.Page
	json.Unmarshal(call("GET", path+"/events?after=0&limit=1", "", token, 200), &page)
	if len(page.Events) != 1 || page.Events[0].Payload != payload {
		t.Fatal("round trip changed payload")
	}
	call("GET", path+"/events?after=-1", "", token, 400)
	call("GET", path+"/events?after=1&after=2", "", token, 400)
	call("GET", path+"/events?limit=101", "", token, 400)
	call("GET", path+"/events", "", foreign, 404)
	b := call("GET", "/v1/learners", "", foreign, 200)
	if bytes.Contains(b, []byte(p.ID)) {
		t.Fatal("profile leak")
	}
	call("POST", path+"/consent", strings.Replace(consent, `"granted":true`, `"granted":false`, 1), token, 200)
	call("POST", path+"/events", envelope(payload), token, 403)
	call("POST", path+"/events", strings.Repeat(" ", 1048577), token, 413)
	b = call("GET", "/v1/packs", "", token, 200)
	if !bytes.Contains(b, []byte("815e30f")) {
		t.Fatal("missing source provenance")
	}
	_ = fmt.Sprintf("%s", p.ID)
}
