package server_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/server"
	"ayailmu.local/backend/internal/store"
)

func TestStartupFailsClosed(t *testing.T) {
	dbURL, emu := infra(t)
	ctx := context.Background()
	probe := fixturePool(t, dbURL, "aya_t_probe")
	t.Cleanup(probe.Close)

	t.Run("unsafe configurations are refused before the database is touched", func(t *testing.T) {
		cases := []struct {
			name string
			edit func(map[string]string)
			want error
		}{
			{"production mode", func(m map[string]string) { m[config.EnvMode] = config.ModeProduction }, config.ErrProductionRefused},
			{"non-demo Firebase project", func(m map[string]string) { m[config.EnvProjectID] = "ayailmu-prod" }, config.ErrNotDemoProject},
			{"listen on every interface", func(m map[string]string) { m[config.EnvListen] = "0.0.0.0:8091" }, config.ErrNotLoopback},
			{"real Google credentials present", func(m map[string]string) { m[config.EnvGoogleCreds] = "/nonexistent/service-account.json" }, config.ErrRealCredentials},
			{"remote database host", func(m map[string]string) {
				m[config.EnvDatabaseURL] = "postgres://aya_example@192.0.2.10:5432/aya_example"
			}, config.ErrDatabaseNotLocal},
			{"emulator differs from the process environment", func(m map[string]string) { m[config.EnvEmulatorHost] = "127.0.0.1:1" }, authn.ErrUnsafeConfig},
		}
		for _, c := range cases {
			t.Run(c.name, func(t *testing.T) {
				schema := newSchemaName(t)
				m := serviceEnv(dbURL, emu, schema, "127.0.0.1:8091")
				c.edit(m)
				svc, err := server.New(ctx, lookupIn(m), server.Options{})
				if svc != nil {
					svc.Close()
				}
				if schemaExists(t, probe, schema) {
					dropSchema(t, probe, schema)
					t.Error("a refused configuration created its schema")
				}
				if !errors.Is(err, c.want) {
					t.Fatalf("server.New error = %v, want %v", err, c.want)
				}
			})
		}
	})

	t.Run("hosts pgx actually parsed are guarded before any connection", func(t *testing.T) {
		dir := t.TempDir()
		// pgx reads PG* variables and service files while parsing; keep it on test-owned files.
		t.Setenv("PGPASSFILE", filepath.Join(dir, "absent-passfile"))
		service := filepath.Join(dir, "pg_service.conf")
		if err := os.WriteFile(service, []byte("[aya_remote]\nhost=192.0.2.10\nport=5432\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		t.Setenv("PGSERVICEFILE", service)
		t.Setenv("PGSERVICE", "")
		t.Setenv("PGHOST", "")
		// sslmode=disable keeps pgx from reading TLS files while it parses.
		refused := []struct{ name, dsn, pghost string }{
			{"a remote fallback after a loopback primary", "postgres://aya_example@127.0.0.1:5432,192.0.2.10:5432/aya_example?connect_timeout=1&sslmode=disable", ""},
			{"a hostname, even localhost", "postgres://aya_example@localhost:5432/aya_example?connect_timeout=1&sslmode=disable", ""},
			{"a host query parameter overriding the authority", "postgres://aya_example@127.0.0.1:5432/aya_example?host=192.0.2.10&connect_timeout=1&sslmode=disable", ""},
			{"PGHOST when the string names no host", "dbname=aya_example user=aya_example connect_timeout=1 sslmode=disable", "192.0.2.10"},
			{"a service file host", "service=aya_remote dbname=aya_example user=aya_example connect_timeout=1 sslmode=disable", ""},
		}
		for _, c := range refused {
			t.Run(c.name, func(t *testing.T) {
				if c.pghost != "" {
					t.Setenv("PGHOST", c.pghost)
				}
				if _, err := store.ParseConfig(c.dsn, "aya_t_guard"); !errors.Is(err, store.ErrDatabaseNotLocal) {
					t.Fatalf("store.ParseConfig = %v, want ErrDatabaseNotLocal", err)
				}
			})
		}
		for i, dsn := range []string{"host=/tmp dbname=aya_example user=aya_example", dbURL} {
			if _, err := store.ParseConfig(dsn, "aya_t_guard"); err != nil {
				t.Fatalf("accepted case %d: store.ParseConfig refused a Unix-socket or loopback database: %v", i, err)
			}
		}
	})

	t.Run("a valid local configuration serves health on its loopback address", func(t *testing.T) {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		listen := ln.Addr().String()
		ln.Close()
		schema := newSchemaName(t)
		t.Cleanup(func() { dropSchema(t, probe, schema) })
		svc, err := server.New(ctx, lookupIn(serviceEnv(dbURL, emu, schema, listen)), server.Options{})
		if err != nil {
			t.Fatalf("server.New: %v", err)
		}
		defer svc.Close()
		run, stop := context.WithCancel(ctx)
		done := make(chan error, 1)
		go func() { done <- svc.ListenAndServe(run) }()
		defer func() {
			stop()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Error("ListenAndServe did not stop")
			}
		}()
		var r reply
		for deadline := time.Now().Add(5 * time.Second); ; time.Sleep(50 * time.Millisecond) {
			resp, err := httpClient.Get("http://" + listen + "/v1/healthz")
			if err == nil {
				b, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				r = reply{status: resp.StatusCode, header: resp.Header, body: b}
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("the service never answered on its loopback address: %v", err)
			}
		}
		wantStatus(t, r, http.StatusOK)
		var h struct{ Status, Mode string }
		decodeJSON(t, r.body, &h)
		if h.Status != "ok" || h.Mode != config.ModeEmulator {
			t.Fatalf("health = %+v, want ok/emulator", h)
		}
	})
}

func TestHTTPGuards(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-g-1", LocalProfileID: "lrn-g-1"}
	pid := s.seedProfile(t, u, src)
	profile, events := "/v1/profiles/"+pid, "/v1/profiles/"+pid+"/events"
	port := s.host[strings.LastIndexByte(s.host, ':')+1:]

	t.Run("health answers without a token on both allowed Host names", func(t *testing.T) {
		for _, host := range []string{s.host, "localhost:" + port} {
			r := s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", host)
			wantStatus(t, r, http.StatusOK)
			var h struct{ Status, Mode string }
			decodeJSON(t, r.body, &h)
			if h.Status != "ok" || h.Mode != config.ModeEmulator {
				t.Fatalf("health = %+v, want ok/emulator", h)
			}
		}
	})

	t.Run("a Host outside the allow-list is refused before authentication", func(t *testing.T) {
		for _, host := range []string{"evil.example", "evil.example:" + port, "127.0.0.1:1", "localhost:1", "[::1]:" + port} {
			wantProblem(t, s.call(t, http.MethodGet, "/v1/me", u.token, nil, "Host", host), http.StatusMisdirectedRequest, "host_not_allowed")
			wantProblem(t, s.call(t, http.MethodGet, "/v1/healthz", "", nil, "Host", host), http.StatusMisdirectedRequest, "host_not_allowed")
		}
	})

	t.Run("every authentication failure is the same 401", func(t *testing.T) {
		anon := anonymousToken(t, s.emu)
		var first []byte
		for i, auth := range []string{"", "Basic Zm9vOmJhcg==", "Bearer", "Bearer ", "Bearer not-a-jwt", "Bearer abc.def.ghi", "Bearer " + anon} {
			var hdr []string
			if auth != "" {
				hdr = []string{"Authorization", auth}
			}
			r := s.call(t, http.MethodGet, "/v1/me", "", nil, hdr...)
			wantProblem(t, r, http.StatusUnauthorized, "unauthenticated")
			if !strings.HasPrefix(r.header.Get("WWW-Authenticate"), "Bearer") {
				t.Fatalf("case %d: WWW-Authenticate = %q, want Bearer", i, r.header.Get("WWW-Authenticate"))
			}
			if first == nil {
				first = r.body
			} else if !bytes.Equal(r.body, first) {
				t.Fatalf("case %d: the 401 body differs by cause", i)
			}
		}
	})

	t.Run("unknown routes, deferred features and snapshots do not exist", func(t *testing.T) {
		for _, path := range []string{"/v1/nope", "/v1/support/products", "/v1/mock-store/purchases", profile + "/snapshot", profile + "/session", "/v2/me"} {
			wantProblem(t, s.call(t, http.MethodGet, path, u.token, nil), http.StatusNotFound, "not_found")
		}
	})

	t.Run("a wrong method is 405 with Allow", func(t *testing.T) {
		for _, c := range []struct{ method, path, allow string }{
			{http.MethodDelete, "/v1/me", "GET"},
			{http.MethodPost, "/v1/curricula", "GET"},
			{http.MethodGet, "/v1/imports", "POST"},
			{http.MethodPut, profile, "GET, PATCH"},
			{http.MethodDelete, events, "GET, POST"},
			{http.MethodPost, profile + "/progress", "GET"},
		} {
			r := s.call(t, c.method, c.path, u.token, nil)
			wantProblem(t, r, http.StatusMethodNotAllowed, "method_not_allowed")
			if got := r.header.Get("Allow"); got != c.allow {
				t.Fatalf("%s %s: Allow = %q, want %q", c.method, c.path, got, c.allow)
			}
		}
	})

	t.Run("request bodies are typed, bounded and well formed", func(t *testing.T) {
		one := answer{id: "ans-g-1", learner: src.LocalProfileID, install: src.InstallID}.envelope()
		for _, ct := range []string{"text/plain", "application/x-www-form-urlencoded", ""} {
			wantProblem(t, s.call(t, http.MethodPost, events, u.token, batch(one), "Content-Type", ct), http.StatusUnsupportedMediaType, "unsupported_media_type")
		}
		wantProblem(t, s.call(t, http.MethodPatch, profile, u.token, []byte(`{"settings":{"session_minutes":15}}`), "If-Match", `"r1"`),
			http.StatusUnsupportedMediaType, "unsupported_media_type")
		huge := append([]byte(`{"events":[`), bytes.Repeat([]byte(" "), 4<<20)...)
		wantProblem(t, s.call(t, http.MethodPost, events, u.token, append(huge, "]}"...)), http.StatusRequestEntityTooLarge, "body_too_large")
		wantProblem(t, s.call(t, http.MethodPost, events, u.token, []byte(`{"events":[`)), http.StatusBadRequest, "invalid_json")
		for _, body := range []string{`[]`, `{"events":{}}`, `{"evts":[]}`, `{"events":[]}`, `{"events":[],"note":1}`} {
			wantProblem(t, s.call(t, http.MethodPost, events, u.token, []byte(body)), http.StatusBadRequest, "invalid_request")
		}
		many := make([][]byte, 501)
		for i := range many {
			many[i] = answer{id: fmt.Sprintf("ans-g-%03d", i), learner: src.LocalProfileID, install: src.InstallID}.envelope()
		}
		wantProblem(t, s.call(t, http.MethodPost, events, u.token, batch(many...)), http.StatusRequestEntityTooLarge, "batch_too_large")
		if n := s.count(t, "SELECT count(*) FROM events"); n != 0 {
			t.Fatalf("refused requests stored %d events", n)
		}
	})
}

func TestCurriculumMetadataExposesNoAnswerKeysOrMastery(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	wantProblem(t, s.call(t, http.MethodGet, "/v1/curricula", "", nil), http.StatusUnauthorized, "unauthenticated")

	r := s.call(t, http.MethodGet, "/v1/curricula", u.token, nil)
	wantStatus(t, r, http.StatusOK)
	var got struct {
		Families []curriculum.Family `json:"families"`
		Packs    []curriculum.Pack   `json:"packs"`
	}
	decodeJSON(t, r.body, &got)
	reg := curriculum.Default()
	if !reflect.DeepEqual(got.Families, reg.Families()) {
		t.Fatalf("families = %+v, want the registry's %+v", got.Families, reg.Families())
	}
	if !reflect.DeepEqual(got.Packs, reg.Packs()) {
		t.Fatalf("packs = %+v, want the registry's exact pins", got.Packs)
	}
	for _, p := range got.Packs {
		if !p.Synthetic || p.ReviewedProductionContent {
			t.Fatalf("pack %s/%s/%s is not labelled synthetic and unreviewed", p.Family, p.Track, p.ContentVersion)
		}
	}
	for _, k := range keysIn(t, r.body) {
		switch strings.ToLower(k) {
		case "items", "lesson_screens", "screens", "prompts", "options", "presented_options", "answer", "answers", "answer_key",
			"key", "keys", "correct", "accept", "mastery", "mastered", "learned", "readiness", "skill_state":
			t.Fatalf("curriculum metadata exposes %q", k)
		}
	}
}
