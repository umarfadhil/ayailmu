package main

// Container healthcheck probe, Phase 8 RED. `ayailmu-api probe <url>` is the runtime image's only health tool (it has no
// shell or curl): one bounded GET of a literal-loopback http URL. It exits 0 only for a 200 answer, and 1 for any other
// answer, a redirect (never followed), a refused connection or no answer in time. A URL it refuses (a name, even
// localhost, another address, another scheme, userinfo, a query or a fragment, no port) and a malformed command line exit
// 2 without connecting anywhere. It never prints a URL's userinfo.

import (
	"bytes"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// probeMarker is a synthetic value placed where the probe must never print from.
const probeMarker = "probe-marker-not-real-3307"

// counted is an owned loopback server that answers with h and counts the requests that reach it.
type counted struct {
	*httptest.Server
	hits atomic.Int32
}

func newCounted(t *testing.T, h http.HandlerFunc) *counted {
	t.Helper()
	c := &counted{}
	c.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c.hits.Add(1)
		h(w, r)
	}))
	t.Cleanup(c.Close)
	return c
}

func answerStatus(code int) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(code) }
}

// runProbe runs the probe with args and returns its exit status, what it printed and how long it took.
func runProbe(args ...string) (int, string, time.Duration) {
	var stderr bytes.Buffer
	start := time.Now()
	code := probe(args, &stderr)
	return code, stderr.String(), time.Since(start)
}

func TestProbeGetsOnlyALoopbackURLAndExitsByItsAnswer(t *testing.T) {
	ready := newCounted(t, answerStatus(http.StatusOK))

	t.Run("a 200 answer exits 0", func(t *testing.T) {
		if code, _, _ := runProbe(ready.URL + "/v1/readyz"); code != 0 {
			t.Fatalf("probe of a 200 answer exited %d, want 0", code)
		}
		if ready.hits.Load() == 0 {
			t.Fatal("the probe exited without asking the service")
		}
	})

	t.Run("any other answer exits 1", func(t *testing.T) {
		for _, status := range []int{http.StatusServiceUnavailable, http.StatusNotFound, http.StatusNoContent} {
			srv := newCounted(t, answerStatus(status))
			if code, _, _ := runProbe(srv.URL + "/v1/readyz"); code != 1 {
				t.Fatalf("probe of a %d answer exited %d, want 1", status, code)
			}
		}
	})

	t.Run("a redirect is not followed", func(t *testing.T) {
		before := ready.hits.Load()
		moved := newCounted(t, func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, ready.URL+"/v1/readyz", http.StatusFound)
		})
		if code, _, _ := runProbe(moved.URL + "/v1/readyz"); code != 1 {
			t.Fatalf("probe of a redirect exited %d, want 1", code)
		}
		if ready.hits.Load() != before {
			t.Fatal("the probe followed a redirect")
		}
	})

	t.Run("a refused connection exits 1", func(t *testing.T) {
		ln, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		closed := "http://" + ln.Addr().String() + "/v1/readyz"
		ln.Close()
		if code, _, _ := runProbe(closed); code != 1 {
			t.Fatalf("probe of a closed port exited %d, want 1", code)
		}
	})

	t.Run("no answer in time exits 1 within a bound", func(t *testing.T) {
		stop := make(chan struct{})
		silent := newCounted(t, func(_ http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-stop:
			}
		})
		t.Cleanup(func() { close(stop) }) // runs first, so no handler still waits when the server closes
		code, _, took := runProbe(silent.URL + "/v1/readyz")
		if code != 1 || took > 10*time.Second {
			t.Fatalf("probe of a silent service exited %d after %v, want 1 within 10 s", code, took)
		}
	})

	t.Run("a URL it refuses exits 2 without connecting", func(t *testing.T) {
		watched := newCounted(t, answerStatus(http.StatusOK))
		_, port, err := net.SplitHostPort(strings.TrimPrefix(watched.URL, "http://"))
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range []struct{ name, url string }{
			{"a name, even localhost", "http://localhost:" + port + "/v1/readyz"},
			{"https", "https://127.0.0.1:" + port + "/v1/readyz"},
			{"userinfo", "http://probe:" + probeMarker + "@127.0.0.1:" + port + "/v1/readyz"},
			{"a query", "http://127.0.0.1:" + port + "/v1/readyz?verbose=1"},
			{"a fragment", "http://127.0.0.1:" + port + "/v1/readyz#top"},
			{"an IPv4-mapped loopback address", "http://[::ffff:127.0.0.1]:" + port + "/v1/readyz"},
			{"no port", "http://127.0.0.1/v1/readyz"},
			{"no scheme", "127.0.0.1:" + port + "/v1/readyz"},
			{"another address", "http://192.0.2.10:8080/v1/readyz"},
			{"an empty URL", ""},
		} {
			code, printed, took := runProbe(c.url)
			switch {
			case code != 2:
				t.Fatalf("probe of %s exited %d, want 2", c.name, code)
			case took > 2*time.Second:
				t.Fatalf("probe of %s took %v: it must refuse without connecting", c.name, took)
			case strings.Contains(printed, probeMarker):
				t.Fatalf("probe of %s printed the URL's userinfo", c.name)
			}
		}
		if n := watched.hits.Load(); n != 0 {
			t.Fatalf("a refused URL reached the service %d times", n)
		}
	})

	t.Run("a malformed command line exits 2", func(t *testing.T) {
		for _, args := range [][]string{nil, {ready.URL + "/v1/readyz", ready.URL + "/v1/healthz"}} {
			if code, _, _ := runProbe(args...); code != 2 {
				t.Fatalf("probe with %d arguments exited %d, want 2", len(args), code)
			}
		}
	})
}
