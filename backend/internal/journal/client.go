package journal

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

const (
	defaultTimeout   = 30 * time.Second
	maxResponseBytes = 64 << 20
)

// api is a Client checked for one call: requests go to its loopback base URL only, carry the token in
// their Authorization header only, and never follow a redirect.
type api struct {
	base   string
	token  string
	client *http.Client
}

func newAPI(c *Client) (*api, error) {
	if c == nil || c.Token == "" {
		return nil, ErrInvalidClient
	}
	u, err := url.Parse(c.BaseURL)
	if err != nil || u.Scheme != "http" || u.User != nil || u.Opaque != "" || u.RawQuery != "" || u.ForceQuery ||
		u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return nil, ErrInvalidClient
	}
	host, port, err := net.SplitHostPort(u.Host)
	if ip := net.ParseIP(host); err != nil || ip == nil || !ip.IsLoopback() || port == "" {
		return nil, ErrInvalidClient
	}
	hc := http.Client{Timeout: defaultTimeout}
	if c.HTTP != nil {
		hc = *c.HTTP
	}
	hc.Jar = nil
	hc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &api{base: "http://" + u.Host, token: c.Token, client: &hc}, nil
}

// send makes one request and reads the whole response. A transport error means no usable response,
// although the request may have reached the server.
func (a *api) send(ctx context.Context, method, path, contentType, ifMatch string, body []byte) (int, []byte, error) {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, a.base+path, rd)
	if err != nil {
		return 0, nil, fmt.Errorf("journal: build a request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+a.token)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("journal: no usable response: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return 0, nil, fmt.Errorf("journal: the response was cut short: %w", err)
	}
	if len(data) > maxResponseBytes {
		return 0, nil, ErrBadResponse
	}
	return resp.StatusCode, data, nil
}

// refused reports a status other than the expected ones with the server's stable problem code, never its
// text.
func refused(op string, status int, body []byte) error {
	if code := problemCode(body); code != "" {
		return fmt.Errorf("%w: %s answered %d %s", ErrRefused, op, status, code)
	}
	return fmt.Errorf("%w: %s answered %d", ErrRefused, op, status)
}

// problemCode returns a problem document's code when it looks like one of the API's stable codes:
// lowercase letters and underscores.
func problemCode(body []byte) string {
	var p struct {
		Code string `json:"code"`
	}
	if json.Unmarshal(body, &p) != nil || p.Code == "" || len(p.Code) > 64 {
		return ""
	}
	for i := 0; i < len(p.Code); i++ {
		if c := p.Code[i]; (c < 'a' || c > 'z') && c != '_' {
			return ""
		}
	}
	return p.Code
}

// validUUID accepts the hyphenated 8-4-4-4-12 hex form the server writes.
func validUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				return false
			}
		}
	}
	return true
}

func etag(revision int64) string {
	return `"r` + strconv.FormatInt(revision, 10) + `"`
}
