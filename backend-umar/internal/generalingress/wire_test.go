package generalingress

import (
	"encoding/json"
	"testing"
)

func TestWireCodecUsesActualGoTrueSessionAndSafeErrorSchema(t *testing.T) {
	r := Response{Status: 200, Code: "ok", Session: &Session{AccessToken: "noncredential-access", RefreshToken: "noncredential-refresh"}, User: &User{ID: userA, SessionID: sidA, Email: "one@example.invalid", Confirmed: true, ConfirmedAt: "2026-01-01T00:00:00Z"}, ExpiresIn: 3600}
	status, body := EncodeResponse(r)
	var m map[string]any
	if json.Unmarshal(body, &m) != nil {
		t.Fatal("not JSON")
	}
	if status != 200 || m["access_token"] != "noncredential-access" || m["expires_in"] != float64(3600) || m["token_type"] != "bearer" {
		t.Fatal("native GoTrue session fields absent")
	}
	u, ok := m["user"].(map[string]any)
	if !ok || u["id"] != userA || u["email_confirmed_at"] != "2026-01-01T00:00:00Z" {
		t.Fatal("native confirmed user missing")
	}
	status, body = EncodeResponse(Response{Status: 409, Code: "request_already_attempted"})
	json.Unmarshal(body, &m)
	if status != 409 || m["error"] != "request_already_attempted" || m["error_code"] != "request_already_attempted" {
		t.Fatal("safe ingress error not consumable by native")
	}
	if status, _ := EncodeResponse(Response{Status: 200, Session: r.Session}); status != 503 {
		t.Fatal("incomplete session fabricated")
	}
}
