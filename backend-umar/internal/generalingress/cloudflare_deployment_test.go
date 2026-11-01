package generalingress

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestObservedCloudflareMetadataIsDiscardedWithoutWideningHeaders(t *testing.T) {
	cases := []struct {
		name   string
		edit   func(*http.Request)
		status int
	}{
		{"observed metadata", func(r *http.Request) {
			r.Header.Set("Cf-Ew-Via", "15")
			r.Header.Set("Cf-Warp-Tag-Id", "fixture-edge")
			r.Header.Set("Cf-Worker", "fixture.workers.dev")
		}, 200},
		{"nonascii metadata", func(r *http.Request) { r.Header.Set("Cf-Ew-Via", "π") }, 400},
		{"oversized metadata", func(r *http.Request) { r.Header.Set("Cf-Warp-Tag-Id", strings.Repeat("x", 4097)) }, 400},
		{"duplicate metadata", func(r *http.Request) { r.Header["Cf-Warp-Tag-Id"] = []string{"one", "two"} }, 400},
		{"unknown header remains denied", func(r *http.Request) { r.Header.Set("Cf-Unreviewed-Header", "fixture") }, 400},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, e, f, _ := runtimeFixture(t)
			h, _ := NewRuntimeHandler(c, e)
			r := httptest.NewRequest("GET", "/healthz", nil)
			r.Host = "general-beta.example.invalid"
			r.RemoteAddr = "192.0.2.1:1234"
			r.TLS = &tls.ConnectionState{HandshakeComplete: true}
			tc.edit(r)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.status {
				t.Fatalf("status %d expected %d", w.Code, tc.status)
			}
			if f.p.authCalls != 0 || len(f.p.mail) != 0 || f.b.calls != 0 {
				t.Fatal("metadata-only request reached dependencies")
			}
		})
	}
}

func TestCloudflareMetadataCannotRotateRateIdentity(t *testing.T) {
	c, _, f, clock := runtimeFixture(t)
	c.Policy.AuthIPMinute = 1
	e, err := NewRuntime(c, clock, f.v, f.p, f.b)
	if err != nil {
		t.Fatal(err)
	}
	h, _ := NewRuntimeHandler(c, e)
	for i, value := range []string{"first-fixture", "second-fixture"} {
		r := httptest.NewRequest("POST", "/token?grant_type=password", strings.NewReader(`{"email":"first@example.invalid","password":"synthetic-password-123"}`))
		r.Host = "general-beta.example.invalid"
		r.RemoteAddr = "192.0.2.1:1234"
		r.TLS = &tls.ConnectionState{HandshakeComplete: true}
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Cf-Ew-Via", "15")
		r.Header.Set("Cf-Warp-Tag-Id", value)
		r.Header.Set("Cf-Worker", value+".workers.dev")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		want := 200
		if i == 1 {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("status %d expected %d", w.Code, want)
		}
	}
}
