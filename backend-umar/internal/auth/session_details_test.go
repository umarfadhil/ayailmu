package auth

import (
	"testing"
	"time"
)

func TestDetailedGoTrueClaimsPreserveSignedIdentityAndFreshness(t *testing.T) {
	now := time.Unix(1800000000, 0)
	raw := []byte(`{"role":"authenticated","session_id":"30000000-0000-0000-0000-000000000001","is_anonymous":false,"iat":1800000000,"amr":[{"method":"password","timestamp":1799999400}],"user_metadata":{"auth_time":1800000000}}`)
	d, err := parseGoTrueSession(raw, Principal{Issuer: "https://issuer.example.invalid", Subject: "10000000-0000-0000-0000-000000000001"}, now.Add(time.Hour), now)
	if err != nil || d.SessionID != "30000000-0000-0000-0000-000000000001" || d.Method != "password" || d.Principal.AuthTime != 1799999400 || d.Principal.Fresh(now) {
		t.Fatal("signed session identity/freshness changed", err)
	}
	for _, bad := range []string{
		`{"role":"authenticated","role":"service_role"}`,
		`{"Role":"authenticated","session_id":"30000000-0000-0000-0000-000000000001","iat":1800000000}`,
		`{"role":"authenticated","session_id":"not-uuid","iat":1800000000}`,
		`{"role":"authenticated","session_id":"30000000-0000-0000-0000-000000000001","iat":1800000000,"is_anonymous":true}`,
		`{"role":"authenticated","session_id":"30000000-0000-0000-0000-000000000001","iat":1800000030}`,
		`{"role":"authenticated","session_id":"30000000-0000-0000-0000-000000000001","iat":1800000000,"amr":[{"method":"password","timestamp":1800000040}]}`,
	} {
		if _, err := parseGoTrueSession([]byte(bad), d.Principal, now.Add(time.Hour), now); err == nil {
			t.Error("unsafe claims accepted")
		}
	}
}

func TestInjectedOIDCClientHasNoDefaultNetworkFallback(t *testing.T) {
	if _, err := NewWithClient(nil, Config{}, nil); err == nil {
		t.Fatal("missing explicit HTTP client accepted")
	}
}
