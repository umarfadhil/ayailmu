package tunnelproxy

import (
	"bytes"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var learnerRoute = regexp.MustCompile(`^/v1/learners/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/(consent|events)$`)

func loopbackUpstream(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("invalid loopback upstream")
	}
	ip := net.ParseIP(u.Hostname())
	port, err := strconv.Atoi(u.Port())
	if err != nil || port < 1 || port > 65535 || ip == nil || !ip.IsLoopback() || u.Scheme != "http" || u.User != nil || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return nil, errors.New("upstream must be a plain HTTP loopback origin with a port")
	}
	return u, nil
}

func allowed(r *http.Request) (auth bool, ok bool) {
	if strings.Contains(r.URL.EscapedPath(), "%") || path.Clean(r.URL.Path) != r.URL.Path || strings.HasPrefix(r.URL.Path, "//") {
		return false, false
	}
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return false, false
	}
	for _, values := range q {
		if len(values) != 1 {
			return false, false
		}
	}
	method, p := r.Method, r.URL.Path
	noQuery := len(q) == 0
	getOrPost := method == http.MethodGet || method == http.MethodPost
	switch p {
	case "/healthz", "/v1/packs":
		return false, noQuery && method == http.MethodGet
	case "/v1/account", "/v1/learners":
		return false, noQuery && getOrPost
	case "/token":
		return true, method == http.MethodPost && len(q) == 1 && (q.Get("grant_type") == "password" || q.Get("grant_type") == "refresh_token")
	case "/verify", "/recover", "/resend":
		return true, noQuery && method == http.MethodPost
	case "/logout":
		return true, method == http.MethodPost && len(q) == 1 && q.Get("scope") == "local"
	case "/user":
		return true, noQuery && (method == http.MethodGet || method == http.MethodPut)
	}
	if !learnerRoute.MatchString(p) {
		return false, false
	}
	if strings.HasSuffix(p, "/consent") {
		return false, noQuery && method == http.MethodPost
	}
	if method == http.MethodPost {
		return false, noQuery
	}
	if method != http.MethodGet {
		return false, false
	}
	for key := range q {
		if key != "after" && key != "limit" {
			return false, false
		}
	}
	return false, true
}

// New routes only the synthetic client contract to two fixed loopback services.
// It does not open a public endpoint or replace the API/provider's authentication.
func New(apiURL, authURL string) (http.Handler, error) {
	api, err := loopbackUpstream(apiURL)
	if err != nil {
		return nil, err
	}
	auth, err := loopbackUpstream(authURL)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}).DialContext, MaxIdleConns: 8, MaxIdleConnsPerHost: 4, IdleConnTimeout: 30 * time.Second, ResponseHeaderTimeout: 5 * time.Second, MaxResponseHeaderBytes: 32768, DisableCompression: true}
	proxy := func(target *url.URL) *httputil.ReverseProxy {
		return &httputil.ReverseProxy{
			Rewrite: func(r *httputil.ProxyRequest) {
				r.SetURL(target)
				// Rewrite removes Forwarded/X-Forwarded-*; never trust caller-supplied identities.
				r.Out.Host = target.Host
			},
			Transport: transport,
			ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
				http.Error(w, "upstream unavailable", http.StatusBadGateway)
			},
		}
	}
	apiProxy, authProxy := proxy(api), proxy(auth)
	slots := make(chan struct{}, 16)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		isAuth, ok := allowed(r)
		if !ok {
			http.NotFound(w, r)
			return
		}
		select {
		case slots <- struct{}{}:
			defer func() { <-slots }()
		default:
			http.Error(w, "busy", http.StatusServiceUnavailable)
			return
		}
		limit := int64(1 << 20)
		if isAuth {
			limit = 16 << 10
		}
		if r.Body != nil {
			body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
			_ = r.Body.Close()
			if err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			if int64(len(body)) > limit {
				http.Error(w, "request too large", http.StatusRequestEntityTooLarge)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			r.ContentLength = int64(len(body))
		}
		if isAuth {
			authProxy.ServeHTTP(w, r)
		} else {
			apiProxy.ServeHTTP(w, r)
		}
	}), nil
}
