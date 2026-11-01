package generalingress

import (
	"errors"
	"net"
	"net/mail"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
)

var uuid = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
var learnerRoute = regexp.MustCompile(`^/v1/learners/([0-9a-f-]{36})/(events|consent)$`)
var otpCode = regexp.MustCompile(`^[0-9]{6}$`)

type parsed struct {
	path, grant, learner, access, operation string
	auth                                    AuthRequest
}

func ascii(s string) bool {
	for _, c := range s {
		if c < 32 || c > 126 {
			return false
		}
	}
	return true
}
func email(s string) (string, bool) {
	a, err := mail.ParseAddress(s)
	return strings.ToLower(s), err == nil && a.Address == s && len(s) <= 254 && ascii(s) && !strings.ContainsAny(s, " <>\t\r\n") && strings.Contains(strings.SplitN(s, "@", 2)[len(strings.SplitN(s, "@", 2))-1], ".")
}
func password(s string) bool {
	return len(s) >= 12 && len(s) <= 256 && !strings.ContainsAny(s, "\r\n\x00")
}

func requestBodyLimit(method, target string) int {
	maxBody := 16384 // GoTrue auth JSON remains tightly bounded.
	if m := learnerRoute.FindStringSubmatch(target); method == "POST" && len(m) > 0 && uuid.MatchString(m[1]) && m[2] == "events" {
		maxBody = 1 << 20 // existing HttpBackend/API batch contract; still <=100 parsed events
	}
	return maxBody
}
func parse(r Request, host string, p Policy) (parsed, error) {
	bad := errors.New("invalid_request")
	out := parsed{}
	if !r.TLS || net.ParseIP(r.Peer) == nil || len(r.Body) > requestBodyLimit(r.Method, r.Target) || len(r.Headers) > 20 || len(r.Target) > 2048 || !ascii(r.Target) || !strings.HasPrefix(r.Target, "/") || strings.ContainsAny(r.Target, "%#\\") || strings.Contains(r.Target, "//") || strings.Contains(r.Target, "..") {
		return out, bad
	}
	headers := map[string]string{}
	for _, h := range r.Headers {
		key := strings.ToLower(h[0])
		if !ascii(h[0]) || !ascii(h[1]) || len(h[1]) > 16384 || h[0] != strings.TrimSpace(h[0]) {
			return out, bad
		}
		if _, ok := headers[key]; ok {
			return out, bad
		}
		switch key {
		case "host", "content-type", "content-length", "authorization", "x-request-id", "accept", "user-agent":
		default:
			return out, bad
		}
		headers[key] = h[1]
	}
	if headers["host"] != host {
		return out, bad
	}
	if length, ok := headers["content-length"]; ok {
		n, err := strconv.Atoi(length)
		if err != nil || strconv.Itoa(n) != length || n != len(r.Body) {
			return out, bad
		}
	}
	if len(r.Body) > 0 && headers["content-type"] != "application/json" {
		return out, bad
	}
	if r.Method == "GET" && len(r.Body) != 0 {
		return out, bad
	}
	if raw, ok := headers["authorization"]; ok {
		if !strings.HasPrefix(raw, "Bearer ") || strings.Count(raw, " ") != 1 || len(raw) <= 7 {
			return out, bad
		}
		out.access = raw[7:]
	}
	u, err := url.ParseRequestURI(r.Target)
	if err != nil || u.Host != "" || u.Scheme != "" {
		return out, bad
	}
	out.path = u.Path
	q, err := url.ParseQuery(u.RawQuery)
	if err != nil {
		return out, bad
	}
	for _, values := range q {
		if len(values) != 1 {
			return out, bad
		}
	}
	if out.path == "/token" && r.Method == "POST" && len(q) == 1 && u.RawQuery == "grant_type="+q.Get("grant_type") && (q.Get("grant_type") == "password" || q.Get("grant_type") == "refresh_token") {
		out.grant = q.Get("grant_type")
	} else if out.path == "/logout" && r.Method == "POST" && u.RawQuery == "scope=local" {
	} else if m := learnerRoute.FindStringSubmatch(out.path); len(m) > 0 && m[2] == "events" && r.Method == "GET" {
		for k, v := range q {
			n, e := strconv.ParseInt(v[0], 10, 64)
			if e != nil || n < 0 || (k != "after" && k != "limit") || (k == "limit" && (n < 1 || n > 100)) {
				return out, bad
			}
		}
	} else if len(q) > 0 || u.RawQuery != "" {
		return out, bad
	}
	if out.path == "/healthz" && r.Method == "GET" {
		return out, nil
	}
	if r.Method == "POST" && (out.path == "/signup" || out.path == "/recover" || out.path == "/resend" || out.path == "/verify" || out.grant != "") {
		var in struct {
			Email    string `json:"email"`
			Password string `json:"password"`
			Token    string `json:"token"`
			Type     string `json:"type"`
			Refresh  string `json:"refresh_token"`
		}
		// Per-route structs forbid otherwise-known fields crossing between operations.
		var raw any
		switch {
		case out.path == "/signup" || out.grant == "password":
			raw = &struct {
				Email    string `json:"email"`
				Password string `json:"password"`
			}{}
		case out.path == "/recover":
			raw = &struct {
				Email string `json:"email"`
			}{}
		case out.path == "/resend":
			raw = &struct {
				Email string `json:"email"`
				Type  string `json:"type"`
			}{}
		case out.path == "/verify":
			raw = &struct {
				Email string `json:"email"`
				Token string `json:"token"`
				Type  string `json:"type"`
			}{}
		case out.grant == "refresh_token":
			raw = &struct {
				Refresh string `json:"refresh_token"`
			}{}
		}
		if native.Decode(r.Body, raw) != nil || native.Decode(r.Body, &in) != nil {
			return out, bad
		}
		if out.grant == "refresh_token" {
			if len(in.Refresh) < 1 || len(in.Refresh) > 4096 || !ascii(in.Refresh) || strings.Contains(in.Refresh, " ") {
				return out, bad
			}
			out.auth = AuthRequest{Grant: out.grant, RefreshToken: in.Refresh}
			return out, nil
		}
		canonical, ok := email(in.Email)
		if !ok {
			return out, bad
		}
		if (out.path == "/signup" || out.grant == "password") && !password(in.Password) {
			return out, bad
		}
		if out.path == "/verify" && (!otpCode.MatchString(in.Token) || (in.Type != "signup" && in.Type != "recovery")) {
			return out, bad
		}
		if out.path == "/resend" && in.Type != "signup" {
			return out, bad
		}
		out.auth = AuthRequest{Grant: out.grant, Email: canonical, Password: in.Password, Code: in.Token, Type: in.Type}
		if out.path == "/verify" {
			out.auth.Grant = "otp"
		}
		if out.path == "/signup" || out.path == "/recover" || out.path == "/resend" {
			out.operation = headers["x-request-id"]
			if !native.ID(out.operation) {
				return out, bad
			}
		}
		return out, nil
	}
	if out.path == "/user" && r.Method == "GET" || out.path == "/logout" && r.Method == "POST" && len(r.Body) == 0 {
		return out, nil
	}
	if out.path == "/user" && r.Method == "PUT" {
		var in struct {
			Password string `json:"password"`
		}
		if native.Decode(r.Body, &in) != nil || !password(in.Password) {
			return out, bad
		}
		out.auth.Password = in.Password
		return out, nil
	}
	if (out.path == "/v1/account" || out.path == "/v1/learners") && (r.Method == "GET" || r.Method == "POST") || out.path == "/v1/packs" && r.Method == "GET" {
		if r.Method == "POST" {
			if out.path == "/v1/account" {
				var in struct {
					Version   string `json:"declaration_version"`
					Adult     bool   `json:"adult_confirmed"`
					Synthetic bool   `json:"synthetic"`
				}
				if native.Decode(r.Body, &in) != nil || !in.Adult || in.Synthetic || p.DeclarationVersion == "" || in.Version != p.DeclarationVersion {
					return out, bad
				}
			} else {
				var in store.ProfileInput
				if native.Decode(r.Body, &in) != nil || !native.ID(in.ClientLearnerID) || in.Kind != "ADULT" || in.Synthetic || in.CreatedBy != "" || (in.Lang != "id" && in.Lang != "en") {
					return out, bad
				}
			}
		}
		return out, nil
	}
	if m := learnerRoute.FindStringSubmatch(out.path); len(m) > 0 && uuid.MatchString(m[1]) {
		out.learner = m[1]
		if m[2] == "events" {
			if r.Method == "GET" {
				return out, nil
			}
			if r.Method == "POST" {
				var in struct {
					Schema    int      `json:"schema_version"`
					Synthetic bool     `json:"synthetic"`
					Events    []string `json:"events"`
				}
				if native.Decode(r.Body, &in) != nil || in.Schema != 1 || in.Synthetic || len(in.Events) < 1 || len(in.Events) > 100 {
					return out, bad
				}
				return out, nil
			}
		} else if r.Method == "POST" {
			var in struct {
				Version   string `json:"version"`
				Granted   *bool  `json:"granted"`
				Synthetic bool   `json:"synthetic"`
			}
			if native.Decode(r.Body, &in) != nil || in.Granted == nil || in.Synthetic || p.ConsentVersion == "" || in.Version != p.ConsentVersion {
				return out, bad
			}
			return out, nil
		}
	}
	return out, bad
}
