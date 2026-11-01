package generalingress

import (
	"encoding/json"
	"regexp"
	"time"
)

var safeWireCode = regexp.MustCompile(`^[a-z_]{1,80}$`)

// EncodeResponse is a pure codec, not an HTTP listener. Internal structs must
// never accidentally become a different public protocol through Go field names.
func EncodeResponse(r Response) (int, []byte) {
	unavailable := []byte(`{"error":"unavailable","error_code":"unavailable"}`)
	if r.Status == 204 {
		return 204, nil
	}
	if r.Status < 200 || r.Status >= 300 {
		if r.Status < 400 || r.Status > 599 || !safeWireCode.MatchString(r.Code) {
			return 503, unavailable
		}
		b, _ := json.Marshal(map[string]string{"error": r.Code, "error_code": r.Code})
		return r.Status, b
	}
	user := func(u *User) (map[string]any, bool) {
		if u == nil || !uuid.MatchString(u.ID) || !u.Confirmed || u.Anonymous || u.Revoked {
			return nil, false
		}
		if _, e := time.Parse(time.RFC3339, u.ConfirmedAt); e != nil {
			return nil, false
		}
		return map[string]any{"id": u.ID, "email": u.Email, "email_confirmed_at": u.ConfirmedAt, "is_anonymous": false, "role": "authenticated"}, true
	}
	var body any
	if r.Session != nil {
		u, ok := user(r.User)
		if !ok || r.ExpiresIn < 1 || r.ExpiresIn > 86400 || !bearer(r.Session.AccessToken) || !bearer(r.Session.RefreshToken) {
			return 503, unavailable
		}
		body = map[string]any{"access_token": r.Session.AccessToken, "refresh_token": r.Session.RefreshToken, "token_type": "bearer", "expires_in": r.ExpiresIn, "user": u}
	} else if r.User != nil {
		u, ok := user(r.User)
		if !ok {
			return 503, unavailable
		}
		body = u
	} else if r.Data != nil {
		body = r.Data
	} else {
		body = map[string]string{"status": r.Code}
	}
	b, err := json.Marshal(body)
	if err != nil {
		return 503, unavailable
	}
	return r.Status, b
}
