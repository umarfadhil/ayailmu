package generalingress

import (
	"context"
	"encoding/json"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/store"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

const deletionBody = `{"request_id":"d1fe486e-4437-4edb-8236-6a14fbf1df27","confirmed":true,"synthetic":false}`

func TestLearnerErasureIngressRequiresExactConfirmedNormalRequest(t *testing.T) {
	target := "/v1/learners/" + learnerA + "/deletion"
	for _, tc := range []struct {
		method, target, body string
		ok                   bool
	}{
		{"POST", target, deletionBody, true},
		{"GET", target, "", false},
		{"POST", target + "?after=0", deletionBody, false},
		{"POST", target, strings.Replace(deletionBody, `"confirmed":true`, `"confirmed":false`, 1), false},
		{"POST", target, strings.Replace(deletionBody, `"synthetic":false`, `"synthetic":true`, 1), false},
		{"POST", target, `{"confirmed":true}`, false},
		{"POST", target, strings.Replace(deletionBody, "d1fe486e-4437-4edb-8236-6a14fbf1df27", "invalid", 1), false},
		{"POST", target, strings.TrimSuffix(deletionBody, "}") + `,"owner_id":"` + userB + `"}`, false},
	} {
		if _, err := parse(authed(tc.method, tc.target, tc.body, "a-access"), "general-beta.example.invalid", Policy{}); (err == nil) != tc.ok {
			t.Errorf("%s %s %s: %v", tc.method, tc.target, tc.body, err)
		}
	}
}

type deletedBackend struct {
	backendDouble
	owns, calls int
}

func (b *deletedBackend) Owns(context.Context, Claims, string, string) (bool, error) {
	b.owns++
	return false, nil
}
func (b *deletedBackend) Call(context.Context, Claims, string, string, []byte, string) (any, error) {
	b.calls++
	return map[string]string{"scope": "learner"}, nil
}

func TestLearnerErasureRetryReachesAuthoritativeBackendAfterProfileRemoved(t *testing.T) {
	f := setup(t, nil)
	b := &deletedBackend{}
	f.e.backend = b
	s := login(t, f, "first@example.invalid")
	target := "/v1/learners/" + learnerA + "/deletion"
	for i := 0; i < 2; i++ {
		if r := handle(f, authed("POST", target, deletionBody, s.AccessToken)); r.Status != 200 {
			t.Fatalf("retry %d: %#v", i, r)
		}
	}
	if b.owns != 0 || b.calls != 2 {
		t.Fatalf("nonexistent-profile precheck blocks authoritative receipt: %#v", b)
	}
	if r := handle(f, authed("GET", "/v1/learners/"+learnerA+"/events", "", s.AccessToken)); r.Status != 404 {
		t.Fatal("other ownership checks bypassed", r)
	}
	f.c.advance(6 * time.Minute)
	if r := handle(f, authed("POST", target, deletionBody, s.AccessToken)); r.Status != 403 || r.Code != "fresh_auth_required" {
		t.Fatal("stale deletion", r)
	}
	if b.calls != 2 {
		t.Fatal("stale deletion reached backend")
	}
}

func TestHTTPLearnerErasureAdapterDoesNotRequireDeletedProfileInList(t *testing.T) {
	p, b, rt, _, _ := adapterFixture(t)
	original := rt.call
	lists, deletes := 0, 0
	rt.call = func(r *http.Request) (*http.Response, error) {
		response, err := original(r)
		if err != nil {
			return response, err
		}
		switch r.URL.Path {
		case "/v1/learners":
			lists++
			response.Body = io.NopCloser(strings.NewReader(`[]`))
		case "/v1/learners/" + learnerA + "/deletion":
			deletes++
			response.Body = io.NopCloser(strings.NewReader(`{"scope":"learner"}`))
		}
		return response, nil
	}
	claims, err := p.Verify(context.Background(), "a-access")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = b.Call(context.Background(), claims, "POST", "/v1/learners/"+learnerA+"/deletion", []byte(deletionBody), "a-access"); err != nil {
		t.Fatal(err)
	}
	if lists != 0 || deletes != 1 {
		t.Fatalf("lists %d deletes %d", lists, deletes)
	}
}

const accountEraseBody = `{"account_id":"40000000-0000-0000-0000-000000000001","request_id":"f3fe486e-4437-4edb-8236-6a14fbf1df27","recovery_token":"8ef03b5802220e3509ea9cc6a5b9811b902ddcaee6040cb3e9b5346f9fbb7d43","confirmed":true}`
const accountStatusBody = `{"request_id":"f3fe486e-4437-4edb-8236-6a14fbf1df27","recovery_token":"8ef03b5802220e3509ea9cc6a5b9811b902ddcaee6040cb3e9b5346f9fbb7d43"}`
const accountReceiptFixture = `{"deletion_id":"50000000-0000-0000-0000-000000000001","scope":"account","request_id":"f3fe486e-4437-4edb-8236-6a14fbf1df27","status":"identity_deletion_pending","app_data_erased_at":"2026-11-11T01:02:03Z"}`

func TestAccountErasureIngressExactBeginAndProofOnlyStatus(t *testing.T) {
	for _, tc := range []struct {
		method, path, body string
		ok                 bool
	}{
		{"POST", "/v1/account/deletion", accountEraseBody, true},
		{"POST", "/v1/account/deletion/status", accountStatusBody, true},
		{"GET", "/v1/account/deletion/status", "", false},
		{"POST", "/v1/account/deletion/status?", accountStatusBody, false},
		{"POST", "/v1/account/deletion?", accountEraseBody, false},
		{"POST", "/v1/account/deletion/status?proof=secret", accountStatusBody, false},
		{"POST", "/v1/account/deletion/status", accountEraseBody, false},
		{"POST", "/v1/account/deletion", strings.Replace(accountEraseBody, `"confirmed":true`, `"confirmed":false`, 1), false},
		{"POST", "/v1/account/deletion", strings.TrimSuffix(accountEraseBody, "}") + `,"synthetic":true}`, false},
		{"POST", "/v1/account/deletion/status", strings.Replace(accountStatusBody, "8ef03", "8Ef03", 1), false},
	} {
		if _, err := parse(req(tc.method, tc.path, tc.body), "general-beta.example.invalid", Policy{}); (err == nil) != tc.ok {
			t.Errorf("%s %s: %v", tc.method, tc.path, err)
		}
	}
}

type accountErasureBackend struct {
	backendDouble
	reads, writes int
}

func (b *accountErasureBackend) AccountDeletionStatus(context.Context, []byte) (store.AccountDeletionStatus, error) {
	b.reads++
	var receipt store.AccountDeletionStatus
	_ = json.Unmarshal([]byte(accountReceiptFixture), &receipt)
	return receipt, nil
}
func (b *accountErasureBackend) Call(context.Context, Claims, string, string, []byte, string) (any, error) {
	b.writes++
	return b.AccountDeletionStatus(context.Background(), nil)
}
func TestAccountErasureStatusDoesNotAuthenticateOrMutateAndIsRateBounded(t *testing.T) {
	f := setup(t, nil)
	b := &accountErasureBackend{}
	f.e.backend = b
	// No session or account exists in the ingress. Only the explicit status method may run.
	if got := handle(f, req("POST", "/v1/account/deletion/status", accountStatusBody)); got.Status != 200 || b.reads != 1 || b.writes != 0 {
		t.Fatal("proof-only status", got, b)
	}
	if got := handle(f, req("POST", "/v1/account/deletion", accountEraseBody)); got.Status != 401 || b.writes != 0 {
		t.Fatal("anonymous begin", got)
	}
	for i := 0; i < f.e.p.AuthIPMinute; i++ {
		_ = handle(f, req("POST", "/v1/account/deletion/status", accountStatusBody))
	}
	if got := handle(f, req("POST", "/v1/account/deletion/status", accountStatusBody)); got.Status != 429 {
		t.Fatal("unbounded status", got)
	}
	session := login(t, f, "first@example.invalid")
	if got := handle(f, authed("POST", "/v1/account/deletion", accountEraseBody, session.AccessToken)); got.Status != 202 || b.writes != 1 {
		t.Fatal("pending status lost", got, b)
	}
}
func TestHTTPAccountStatusAdapterDropsAuthAndValidatesExactReceipt(t *testing.T) {
	_, b, rt, _, _ := adapterFixture(t)
	original := rt.call
	calls := 0
	rt.call = func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Path != "/v1/account/deletion/status" || r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Fatal("status performed identity operation")
		}
		res, err := original(r)
		if res != nil {
			res.Body = io.NopCloser(strings.NewReader(accountReceiptFixture))
		}
		return res, err
	}
	got, err := b.AccountDeletionStatus(context.Background(), []byte(accountStatusBody))
	if err != nil || calls != 1 || got.Status != "identity_deletion_pending" {
		t.Fatal("status adapter", got, err, calls)
	}
	for _, bad := range []string{strings.Replace(accountReceiptFixture, "f3fe486e", "f4fe486e", 1), strings.TrimSuffix(accountReceiptFixture, "}") + `,"email":"must-not-leak"}`, strings.Replace(accountReceiptFixture, "identity_deletion_pending", "completed", 1)} {
		rt.call = func(r *http.Request) (*http.Response, error) {
			res, err := original(r)
			if res != nil {
				res.Body = io.NopCloser(strings.NewReader(bad))
			}
			return res, err
		}
		if _, err = b.AccountDeletionStatus(context.Background(), []byte(accountStatusBody)); err == nil {
			t.Fatal("unbound receipt forwarded")
		}
	}
}
