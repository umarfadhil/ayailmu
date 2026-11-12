//go:build firebase_emulator

package authn_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"ayailmu.local/backend/internal/authn"
)

const (
	testProject = "demo-ayailmu"
	// The Auth emulator accepts any API key; this one is a label, not a credential.
	emulatorAPIKey = "demo-ayailmu-local-test-key"
)

// Tests in this file talk to the real local Auth emulator. They fail (never skip) without it.
func emulatorHost(t *testing.T) string {
	t.Helper()
	h := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST")
	if h == "" {
		t.Fatal("FIREBASE_AUTH_EMULATOR_HOST is not set: these tests need the local Auth emulator (127.0.0.1:9099, project demo-ayailmu); refusing to skip")
	}
	host, _, err := net.SplitHostPort(h)
	if ip := net.ParseIP(host); err != nil || ip == nil || !ip.IsLoopback() {
		t.Fatal("FIREBASE_AUTH_EMULATOR_HOST must be a literal loopback host:port")
	}
	return h
}

type emuUser struct {
	email    string
	password string
	uid      string
	token    string
}

// emulatorPost calls the emulator's Identity Toolkit REST API. Tokens and passwords are never logged.
func emulatorPost(t *testing.T, host, method string, body, out any) {
	t.Helper()
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	url := "http://" + host + "/identitytoolkit.googleapis.com/v1/" + method + "?key=" + emulatorAPIKey
	resp, err := http.Post(url, "application/json", bytes.NewReader(b))
	if err != nil {
		t.Fatalf("auth emulator %s: %v", method, err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		_ = json.Unmarshal(raw, &e)
		t.Fatalf("auth emulator %s: status %d (%s)", method, resp.StatusCode, e.Error.Message)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("auth emulator %s: decode response: %v", method, err)
	}
}

// signUp creates a synthetic example.test account, then signs in with its password so the token
// under test comes from the password sign-in path.
func signUp(t *testing.T, host string) emuUser {
	t.Helper()
	u := emuUser{email: "aya-" + randomHex(t, 8) + "@example.test", password: "pw-" + randomHex(t, 12)}
	var up struct {
		LocalID string `json:"localId"`
	}
	emulatorPost(t, host, "accounts:signUp", map[string]any{"email": u.email, "password": u.password, "returnSecureToken": true}, &up)
	var in struct {
		IDToken string `json:"idToken"`
		LocalID string `json:"localId"`
	}
	emulatorPost(t, host, "accounts:signInWithPassword", map[string]any{"email": u.email, "password": u.password, "returnSecureToken": true}, &in)
	if up.LocalID == "" || in.IDToken == "" || in.LocalID != up.LocalID {
		t.Fatal("auth emulator sign-up/sign-in returned no consistent uid or no token")
	}
	u.uid, u.token = up.LocalID, in.IDToken
	t.Cleanup(func() { deleteUser(t, host, u.uid) })
	return u
}

func signUpAnonymous(t *testing.T, host string) string {
	t.Helper()
	var out struct {
		IDToken string `json:"idToken"`
		LocalID string `json:"localId"`
	}
	emulatorPost(t, host, "accounts:signUp", map[string]any{"returnSecureToken": true}, &out)
	if out.IDToken == "" {
		t.Fatal("auth emulator anonymous sign-up returned no token")
	}
	t.Cleanup(func() { deleteUser(t, host, out.LocalID) })
	return out.IDToken
}

// deleteUser removes one synthetic emulator account ("Bearer owner" is the emulator's documented
// local admin placeholder, not a credential). Best effort: cleanup never fails a test.
func deleteUser(t *testing.T, host, uid string) {
	b, _ := json.Marshal(map[string]string{"localId": uid})
	req, err := http.NewRequest(http.MethodPost, "http://"+host+"/identitytoolkit.googleapis.com/v1/projects/"+testProject+"/accounts:delete", bytes.NewReader(b))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer owner")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Logf("cleanup: deleting a synthetic emulator user failed: %v", err)
		return
	}
	resp.Body.Close()
}

// mutate re-encodes an emulator-issued token with changed claims. The result is an
// emulator-format UNSIGNED token that the emulator never issued: it exercises claim checks only.
func mutate(t *testing.T, token string, change func(claims map[string]any)) string {
	t.Helper()
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Fatal("emulator token is not a three-part JWT")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		t.Fatalf("decode emulator token claims: %v", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatalf("parse emulator token claims: %v", err)
	}
	change(claims)
	enc, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	return parts[0] + "." + base64.RawURLEncoding.EncodeToString(enc) + "." + parts[2]
}

func newVerifier(t *testing.T, host string) *authn.EmulatorVerifier {
	t.Helper()
	v, err := authn.NewEmulatorVerifier(context.Background(), authn.EmulatorConfig{ProjectID: testProject, EmulatorHost: host})
	if err != nil {
		t.Fatalf("NewEmulatorVerifier: %v", err)
	}
	return v
}

func TestVerifierAcceptsEmulatorIssuedPasswordTokens(t *testing.T) {
	host := emulatorHost(t)
	v := newVerifier(t, host)
	a := signUp(t, host)
	b := signUp(t, host)
	ctx := context.Background()

	idA, err := v.Verify(ctx, a.token)
	if err != nil {
		t.Fatalf("Verify(emulator-issued password token): %v", err)
	}
	want := authn.Identity{Issuer: "https://securetoken.google.com/" + testProject, Subject: a.uid, SignInProvider: "password"}
	if idA != want {
		t.Fatalf("identity = %+v, want %+v", idA, want)
	}
	again, err := v.Verify(ctx, a.token)
	if err != nil || again != idA {
		t.Fatalf("second verification of the same token = %+v, %v; want the same identity", again, err)
	}
	idB, err := v.Verify(ctx, b.token)
	if err != nil {
		t.Fatalf("Verify(second user): %v", err)
	}
	if idB.Subject == idA.Subject || idB.Subject != b.uid {
		t.Fatalf("second user subject = %q, want its own uid distinct from the first", idB.Subject)
	}
}

func TestVerifierRejectsInvalidTokens(t *testing.T) {
	host := emulatorHost(t)
	v := newVerifier(t, host)
	u := signUp(t, host)
	anon := signUpAnonymous(t, host)
	now := float64(time.Now().Unix())
	unknown := "aya-unknown-" + randomHex(t, 6)

	cases := []struct {
		name  string
		token string
	}{
		{"empty", ""},
		{"garbage", "not-a-jwt"},
		{"two segments", "abc.def"},
		{"anonymous, emulator-issued", anon},
		{"expired (mutated unsigned emulator-format)", mutate(t, u.token, func(c map[string]any) {
			c["iat"], c["auth_time"], c["exp"] = now-7200, now-7200, now-3600
		})},
		{"issued in the future (mutated unsigned)", mutate(t, u.token, func(c map[string]any) {
			c["iat"], c["auth_time"], c["exp"] = now+3600, now+3600, now+7200
		})},
		{"wrong audience (mutated unsigned)", mutate(t, u.token, func(c map[string]any) { c["aud"] = "demo-other" })},
		{"wrong issuer (mutated unsigned)", mutate(t, u.token, func(c map[string]any) {
			c["iss"] = "https://securetoken.google.com/demo-other"
		})},
		{"issuer not securetoken (mutated unsigned)", mutate(t, u.token, func(c map[string]any) {
			c["iss"] = "https://evil.example/" + testProject
		})},
		{"other project, consistent aud and iss (mutated unsigned)", mutate(t, u.token, func(c map[string]any) {
			c["aud"], c["iss"] = "demo-other", "https://securetoken.google.com/demo-other"
		})},
		{"empty subject (mutated unsigned)", mutate(t, u.token, func(c map[string]any) { c["sub"], c["user_id"] = "", "" })},
		{"subject unknown to the emulator (mutated unsigned)", mutate(t, u.token, func(c map[string]any) {
			c["sub"], c["user_id"] = unknown, unknown
		})},
		{"anonymous provider claim (mutated unsigned)", mutate(t, u.token, func(c map[string]any) {
			if fb, ok := c["firebase"].(map[string]any); ok {
				fb["sign_in_provider"] = "anonymous"
			} else {
				c["firebase"] = map[string]any{"sign_in_provider": "anonymous"}
			}
		})},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id, err := v.Verify(context.Background(), c.token)
			if !errors.Is(err, authn.ErrUnauthenticated) {
				t.Fatalf("Verify = %+v, %v; want an error wrapping ErrUnauthenticated", id, err)
			}
			if len(c.token) > 16 && strings.Contains(err.Error(), c.token) {
				t.Fatal("verification error contains the token")
			}
		})
	}
}

func TestNewEmulatorVerifierRefusesUnsafeSetups(t *testing.T) {
	host := emulatorHost(t)
	cases := []struct {
		name string
		cfg  authn.EmulatorConfig
		env  string // value for FIREBASE_AUTH_EMULATOR_HOST during the case
	}{
		{"non-demo project", authn.EmulatorConfig{ProjectID: "ayailmu-prod", EmulatorHost: host}, host},
		{"empty project", authn.EmulatorConfig{ProjectID: "", EmulatorHost: host}, host},
		{"emulator on a LAN address", authn.EmulatorConfig{ProjectID: testProject, EmulatorHost: "10.0.0.5:9099"}, "10.0.0.5:9099"},
		{"emulator by hostname", authn.EmulatorConfig{ProjectID: testProject, EmulatorHost: "localhost:9099"}, "localhost:9099"},
		{"process variable differs from the configured emulator", authn.EmulatorConfig{ProjectID: testProject, EmulatorHost: host}, "127.0.0.1:1"},
		{"process variable empty (SDK would contact Google)", authn.EmulatorConfig{ProjectID: testProject, EmulatorHost: host}, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Setenv("FIREBASE_AUTH_EMULATOR_HOST", c.env)
			v, err := authn.NewEmulatorVerifier(context.Background(), c.cfg)
			if !errors.Is(err, authn.ErrUnsafeConfig) {
				t.Fatalf("NewEmulatorVerifier = %v, %v; want ErrUnsafeConfig", v, err)
			}
		})
	}
}

// VerifySession reports the verified sign-in time, the token's auth_time, which token refreshes keep: never the
// token's issue time. Without auth_time the sign-in time is unknown.
func TestVerifySessionReportsTheVerifiedSignInTime(t *testing.T) {
	host := emulatorHost(t)
	v := newVerifier(t, host)
	u := signUp(t, host)
	ctx := context.Background()

	s, err := v.VerifySession(ctx, u.token)
	if err != nil {
		t.Fatalf("VerifySession(emulator-issued password token): %v", err)
	}
	id, err := v.Verify(ctx, u.token)
	if err != nil || s.Identity != id {
		t.Fatalf("session identity = %+v, want Verify's %+v (%v)", s.Identity, id, err)
	}
	if now := time.Now(); s.AuthTime.IsZero() || s.AuthTime.Before(now.Add(-5*time.Minute)) || s.AuthTime.After(now.Add(time.Minute)) {
		t.Fatalf("sign-in time %v of a fresh sign-in is not about now", s.AuthTime)
	}

	signedIn := time.Now().Add(-2 * time.Hour).Unix()
	old, err := v.VerifySession(ctx, mutate(t, u.token, func(c map[string]any) { c["auth_time"] = float64(signedIn) }))
	if err != nil {
		t.Fatalf("VerifySession(sign-in two hours ago, fresh iat; mutated unsigned): %v", err)
	}
	if !old.AuthTime.Equal(time.Unix(signedIn, 0)) || old.Identity != id {
		t.Fatalf("session = %+v, want the token's auth_time %v, not its issue time", old, time.Unix(signedIn, 0))
	}

	// The SDK may refuse a token without auth_time; if it accepts one, the sign-in time stays unknown.
	missing, err := v.VerifySession(ctx, mutate(t, u.token, func(c map[string]any) { delete(c, "auth_time") }))
	switch {
	case err != nil && !errors.Is(err, authn.ErrUnauthenticated):
		t.Fatalf("VerifySession(no auth_time) = %v, want ErrUnauthenticated or success", err)
	case err == nil && !missing.AuthTime.IsZero():
		t.Fatalf("sign-in time %v without an auth_time claim, want zero", missing.AuthTime)
	}
}

// DeleteIdentity removes exactly the identity's emulator account: its tokens stop verifying, a repeat counts as
// deleted, and another account is untouched. An identity of another issuer is refused, deleting nothing.
func TestDeleteIdentityRemovesOnlyThatEmulatorAccount(t *testing.T) {
	host := emulatorHost(t)
	v := newVerifier(t, host)
	u, other := signUp(t, host), signUp(t, host)
	ctx := context.Background()
	id, err := v.Verify(ctx, u.token)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	foreign := id
	foreign.Issuer = "https://securetoken.google.com/demo-other"
	if err := v.DeleteIdentity(ctx, foreign); !errors.Is(err, authn.ErrIdentityNotDeleted) || strings.Contains(err.Error(), u.uid) {
		t.Fatalf("DeleteIdentity(another issuer) = %v, want ErrIdentityNotDeleted without the subject", err)
	}
	if _, err := v.Verify(ctx, u.token); err != nil {
		t.Fatalf("a refused deletion removed the account: %v", err)
	}

	if err := v.DeleteIdentity(ctx, id); err != nil {
		t.Fatalf("DeleteIdentity: %v", err)
	}
	if _, err := v.Verify(ctx, u.token); !errors.Is(err, authn.ErrUnauthenticated) {
		t.Fatalf("Verify after the deletion = %v, want ErrUnauthenticated", err)
	}
	if err := v.DeleteIdentity(ctx, id); err != nil {
		t.Fatalf("repeated DeleteIdentity = %v, want nil: an account that is gone counts as deleted", err)
	}
	if _, err := v.Verify(ctx, other.token); err != nil {
		t.Fatalf("the other account no longer verifies: %v", err)
	}
}
