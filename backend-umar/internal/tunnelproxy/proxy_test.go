package tunnelproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

const learner = "12345678-1234-1234-1234-123456789abc"

func TestAllowedRequestsReachOnlyTheirFixedUpstream(t *testing.T) {
	for _, tc := range []struct{ method, path, body, target string }{
		{"GET", "/healthz", "", "api"},
		{"GET", "/v1/account", "", "api"},
		{"POST", "/v1/account", `{"synthetic":true}`, "api"},
		{"GET", "/v1/learners", "", "api"},
		{"POST", "/v1/learners", `{"synthetic":true}`, "api"},
		{"GET", "/v1/packs", "", "api"},
		{"POST", "/v1/learners/" + learner + "/consent", `{"granted":false}`, "api"},
		{"POST", "/v1/learners/" + learner + "/events", `{"events":["exact bytes"]}`, "api"},
		{"GET", "/v1/learners/" + learner + "/events?after=2&limit=3", "", "api"},
		{"POST", "/token?grant_type=password", `{"email":"syn-a@example.invalid"}`, "auth"},
		{"POST", "/token?grant_type=refresh_token", `{"refresh_token":"synthetic-fixture"}`, "auth"},
		{"POST", "/verify", `{"type":"signup"}`, "auth"},
		{"POST", "/recover", `{"email":"syn-a@example.invalid"}`, "auth"},
		{"POST", "/resend", `{"type":"signup"}`, "auth"},
		{"POST", "/logout?scope=local", "", "auth"},
		{"GET", "/user", "", "auth"},
		{"PUT", "/user", `{"password":"synthetic-fixture"}`, "auth"},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			var calls atomic.Int32
			upstream := func(target string) http.HandlerFunc {
				return func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					body, _ := io.ReadAll(r.Body)
					if target != tc.target || r.Method != tc.method || r.URL.RequestURI() != tc.path || string(body) != tc.body || r.Header.Get("Authorization") != "Bearer synthetic-fixture" {
						t.Errorf("request was rerouted or mutated: %s %s %s %q", target, r.Method, r.URL.RequestURI(), body)
					}
					if r.Header.Get("Forwarded") != "" || r.Header.Get("X-Forwarded-Host") != "" || r.Header.Get("X-Forwarded-For") != "" {
						t.Error("caller-controlled forwarding headers survived")
					}
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"target":"` + target + `"}`))
				}
			}
			api := httptest.NewServer(upstream("api"))
			defer api.Close()
			auth := httptest.NewServer(upstream("auth"))
			defer auth.Close()
			h, err := New(api.URL, auth.URL)
			if err != nil {
				t.Fatal(err)
			}
			r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			r.Header.Set("Authorization", "Bearer synthetic-fixture")
			r.Header.Set("Forwarded", "for=attacker.invalid")
			r.Header.Set("X-Forwarded-Host", "attacker.invalid")
			r.Header.Set("X-Forwarded-For", "203.0.113.10")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 200 || calls.Load() != 1 || w.Body.String() != `{"target":"`+tc.target+`"}` {
				t.Fatalf("status=%d calls=%d body=%s", w.Code, calls.Load(), w.Body.String())
			}
		})
	}
}

func TestUnknownAdminSignupAndAmbiguousRoutesNeverReachUpstreams(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer upstream.Close()
	h, err := New(upstream.URL, upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ method, path string }{
		{"GET", "/admin/users"}, {"GET", "/settings"}, {"GET", "/metrics"}, {"GET", "/readyz"},
		{"POST", "/signup"}, {"GET", "/authorize?provider=google"}, {"GET", "/.well-known/jwks.json"},
		{"GET", "//admin"}, {"GET", "/%61dmin"}, {"GET", "/v1/learners/../admin"},
		{"DELETE", "/v1/account"}, {"GET", "/v1/learners/" + learner + "/consent"},
		{"GET", "/v1/learners/" + learner + "/events/extra"},
		{"POST", "/token?grant_type=pkce"}, {"POST", "/token"},
		{"POST", "/token?grant_type=password&grant_type=refresh_token"},
		{"POST", "/token?grant_type=password&redirect_to=https://foreign.invalid"},
		{"POST", "/logout?scope=global"}, {"GET", "/user?apikey=x"},
		{"GET", "/v1/packs?redirect_to=https://foreign.invalid"},
	} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != 404 {
			t.Errorf("%s %s status=%d", tc.method, tc.path, w.Code)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("%d forbidden requests reached an upstream", calls.Load())
	}
}

func TestNonLoopbackOrDecoratedUpstreamsRejected(t *testing.T) {
	for _, value := range []string{"https://external.invalid", "http://external.invalid:8187", "http://127.0.0.1:8187/admin", "http://user:secret@127.0.0.1:8187", "http://127.0.0.1:8187?x=y", "http://127.0.0.1:8187#fragment", "http://127.0.0.1:0"} {
		if _, err := New(value, "http://127.0.0.1:8287"); err == nil {
			t.Errorf("unsafe API upstream accepted: %s", value)
		}
		if _, err := New("http://127.0.0.1:8187", value); err == nil {
			t.Errorf("unsafe auth upstream accepted: %s", value)
		}
	}
}

func TestOversizedBodiesRejectedBeforeUpstream(t *testing.T) {
	var calls atomic.Int32
	u := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer u.Close()
	h, err := New(u.URL, u.URL)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		path string
		size int
	}{{"/token?grant_type=password", 16*1024 + 1}, {"/v1/account", 1024*1024 + 1}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", tc.path, strings.NewReader(strings.Repeat("x", tc.size))))
		if w.Code != http.StatusRequestEntityTooLarge {
			t.Errorf("%s status=%d", tc.path, w.Code)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("oversized request reached upstream")
	}
}

func TestUpstreamFailureDoesNotExposeDetails(t *testing.T) {
	u := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	h, err := New(u.URL, u.URL)
	if err != nil {
		t.Fatal(err)
	}
	u.Close()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/v1/account", nil))
	if w.Code != 502 || strings.Contains(w.Body.String(), "127.0.0.1") || strings.Contains(w.Body.String(), "dial") {
		t.Fatalf("unredacted failure: %d %s", w.Code, w.Body.String())
	}
}
