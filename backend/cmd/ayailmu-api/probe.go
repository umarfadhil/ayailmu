package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

// Exit statuses of the probe.
const (
	probeOK      = 0 // the service answered 200
	probeFailed  = 1 // any other answer, a redirect, a refused connection or no answer in time
	probeRefused = 2 // a URL the probe refuses, or a malformed command line; nothing was contacted
)

const (
	// probeTimeout bounds the probe's one request, connecting included.
	probeTimeout = 5 * time.Second
	// probeMaxBody bounds what the probe reads of an answer before it closes the connection.
	probeMaxBody = 64 << 10
)

// probe is the container healthcheck subcommand, `ayailmu-api probe <url>`: one bounded GET of a literal-loopback http
// URL, for a runtime image that has no shell or curl. It follows no redirect, uses no proxy of the environment, keeps
// no cookie or connection, and exits 0 only for a 200 answer. It never prints the URL, so no userinfo can reach a log.
func probe(args []string, stderr io.Writer) int {
	if len(args) != 1 {
		fmt.Fprintln(stderr, "usage: ayailmu-api probe http://<loopback IP>:<port>/<path>")
		return probeRefused
	}
	target, ok := probeURL(args[0])
	if !ok {
		fmt.Fprintln(stderr, "ayailmu-api probe: refused: the URL must be plain http to a literal loopback IP with an explicit port, without userinfo, query or fragment")
		return probeRefused
	}
	ctx, cancel := context.WithTimeout(context.Background(), probeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		fmt.Fprintln(stderr, "ayailmu-api probe: refused: the request cannot be built")
		return probeRefused
	}
	client := &http.Client{
		Transport:     &http.Transport{DisableKeepAlives: true, ResponseHeaderTimeout: probeTimeout, MaxResponseHeaderBytes: probeMaxBody},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		Timeout:       probeTimeout,
	}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Fprintln(stderr, "ayailmu-api probe: no answer")
		return probeFailed
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, probeMaxBody))
	if resp.StatusCode != http.StatusOK {
		fmt.Fprintf(stderr, "ayailmu-api probe: answered %d\n", resp.StatusCode)
		return probeFailed
	}
	return probeOK
}

// probeURL accepts plain http to a literal loopback IP with an explicit non-zero port, written canonically, without a
// zone, IPv4 mapping, userinfo, query or fragment. Names, localhost included, are refused: nothing is resolved.
func probeURL(raw string) (string, bool) {
	if raw == "" || strings.ContainsAny(raw, "?#") {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" || u.Opaque != "" || u.User != nil {
		return "", false
	}
	ap, err := netip.ParseAddrPort(u.Host)
	if err != nil {
		return "", false
	}
	a := ap.Addr()
	if !a.IsLoopback() || a.Zone() != "" || a.Is4In6() || ap.Port() == 0 || ap.String() != u.Host {
		return "", false
	}
	return raw, true
}
