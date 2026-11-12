package identityerase

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const subject = "10000000-0000-0000-0000-000000000001"
const issuer = "https://accounts.example.invalid"
const fixtureToken = "isolated-provider-admin-fixture"

func TestGoTrueHardDeletionAcceptsOnlyVersionedConfirmation(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		ok     bool
	}{
		{"deleted", 200, `{}`, true},
		{"already absent", 404, `{"code":404,"error_code":"user_not_found","msg":"not found"}`, true},
		{"generic not found", 404, `{"error":"not_found"}`, false},
		{"missing status", 404, `{"error_code":"user_not_found"}`, false},
		{"wrong body status", 404, `{"code":500,"error_code":"user_not_found"}`, false},
		{"case alias", 404, `{"Code":404,"error_code":"user_not_found"}`, false},
		{"trailing value", 200, `{} {}`, false},
		{"truncated", 200, `{`, false},
		{"mismatched status", 500, `{"error_code":"user_not_found"}`, false},
		{"no body", 204, ``, false},
		{"wrong success body", 200, `{"id":"` + subject + `"}`, false},
		{"null", 200, `null`, false},
		{"duplicate error", 404, `{"error_code":"user_not_found","error_code":"user_not_found"}`, false},
		{"oversized", 200, strings.Repeat(" ", 4097) + `{}`, false},
		{"credentials refused", 403, `{"msg":"secret provider detail"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				body, _ := io.ReadAll(r.Body)
				if r.Method != "DELETE" || r.URL.Path != "/admin/users/"+subject || r.URL.RawQuery != "" || r.Header.Get("Authorization") != "Bearer "+fixtureToken || r.Header.Get("Cookie") != "" || string(body) != `{"should_soft_delete":false}` {
					t.Error("unsafe provider request")
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = io.WriteString(w, tc.body)
			}))
			defer server.Close()
			client := server.Client()
			client.Jar, _ = cookiejar.New(nil)
			origin, _ := url.Parse(server.URL)
			client.Jar.SetCookies(origin, []*http.Cookie{{Name: "unrelated", Value: "must-not-send"}})
			provider, err := newWithClient(Config{Issuer: issuer, AdminOrigin: server.URL, AdminToken: fixtureToken}, client)
			if err != nil {
				t.Fatal(err)
			}
			err = provider.DeleteIdentity(context.Background(), issuer, subject)
			if (err == nil) != tc.ok || calls.Load() != 1 {
				t.Fatalf("ok %v calls %d error %v", tc.ok, calls.Load(), err)
			}
			if err != nil && (!errors.Is(err, ErrIdentityNotDeleted) || strings.Contains(err.Error(), "secret")) {
				t.Fatal("provider detail leaked", err)
			}
		})
	}
}
func TestGoTrueDeletionRejectsForeignIssuerAndMalformedIDWithoutIO(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer server.Close()
	p, err := newWithClient(Config{Issuer: issuer, AdminOrigin: server.URL, AdminToken: fixtureToken}, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"", "00000000-0000-0000-0000-000000000000", "../users", subject + "?all=true", strings.ToUpper(subject[:1]) + "F" + subject[2:]} {
		if p.DeleteIdentity(context.Background(), issuer, id) == nil {
			t.Fatal("invalid identity accepted")
		}
	}
	if p.DeleteIdentity(context.Background(), "https://other.example.invalid", subject) == nil || calls.Load() != 0 {
		t.Fatal("foreign request escaped", calls.Load())
	}
	for _, value := range []any{p, *p, Config{Issuer: issuer, AdminOrigin: server.URL, AdminToken: fixtureToken}} {
		if strings.Contains(fmt.Sprintf("%v %#v", value, value), fixtureToken) {
			t.Fatal("printable credential")
		}
	}
}
func TestGoTrueDeletionNeverFollowsRedirectAndBoundsCancellation(t *testing.T) {
	var leaked atomic.Int32
	trap := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { leaked.Add(1) }))
	defer trap.Close()
	var redirectCode atomic.Int32
	source := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", trap.URL)
		w.WriteHeader(int(redirectCode.Load()))
	}))
	defer source.Close()
	client := source.Client()
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return nil }
	p, err := newWithClient(Config{Issuer: issuer, AdminOrigin: source.URL, AdminToken: fixtureToken}, client)
	if err != nil {
		t.Fatal(err)
	}
	for _, code := range []int32{301, 302, 303, 307, 308} {
		redirectCode.Store(code)
		if p.DeleteIdentity(context.Background(), issuer, subject) == nil || leaked.Load() != 0 {
			t.Fatal("redirect escaped", code)
		}
	}
	// Drain the fixture request before waiting; an unread request body can prevent
	// an HTTP/1 server from observing peer cancellation and hang fixture cleanup.
	release := make(chan struct{})
	blocked := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer blocked.Close()
	defer close(release)
	p, err = newWithClient(Config{Issuer: issuer, AdminOrigin: blocked.URL, AdminToken: fixtureToken}, blocked.Client())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	started := time.Now()
	if p.DeleteIdentity(ctx, issuer, subject) == nil {
		t.Fatal("cancelled deletion claimed completion")
	}
	if time.Since(started) > time.Second {
		t.Fatal("caller deadline not respected")
	}

}
func TestGoTrueDeletionConfigurationFailsClosed(t *testing.T) {
	for _, cfg := range []Config{
		{}, {Issuer: issuer, AdminOrigin: "http://localhost:9999", AdminToken: fixtureToken},
		{Issuer: issuer, AdminOrigin: "https://host.example.invalid/admin", AdminToken: fixtureToken},
		{Issuer: issuer, AdminOrigin: "https://user:password@host.example.invalid", AdminToken: fixtureToken},
		{Issuer: issuer, AdminOrigin: "https://host.example.invalid", AdminToken: ""},
		{Issuer: issuer, AdminOrigin: "https://host.example.invalid", AdminToken: "token\r\nInjected"},
	} {
		if _, err := New(cfg); !errors.Is(err, ErrConfiguration) {
			t.Fatal("unsafe configuration accepted", err)
		}
	}
}
