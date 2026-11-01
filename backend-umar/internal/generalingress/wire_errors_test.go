package generalingress

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

func TestWireRefusalsPreserveOnlyDocumentedSafeStatusPairs(t *testing.T) {
	for _, tc := range []struct {
		name    string
		status  int
		body    string
		allowed bool
	}{
		{"consent", 403, `{"error":"sync_consent_required"}`, true},
		{"consent version", 403, `{"error":"sync_consent_update_required"}`, true},
		{"collision", 409, `{"error":"idempotency_conflict"}`, true},
		{"unconfirmed", 400, `{"error_code":"email_not_confirmed"}`, true},
		{"unknown upstream text", 403, `{"error":"private_provider_diagnostic","message":"must not escape"}`, false},
		{"status mismatch", 500, `{"error":"sync_consent_required"}`, false},
		{"duplicate field", 403, `{"error":"sync_consent_required","error":"not_found"}`, false},
		{"malformed", 403, `{`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			p, _, rt, _, _ := adapterFixture(t)
			original := rt.call
			rt.call = func(r *http.Request) (*http.Response, error) {
				response, err := original(r)
				if err != nil {
					return response, err
				}
				response.StatusCode = tc.status
				response.Body = io.NopCloser(strings.NewReader(tc.body))
				return response, nil
			}
			_, err := p.request(context.Background(), "GET", "/v1/packs", nil, "a-access")
			var failure *wireFailure
			if errors.As(err, &failure) != tc.allowed {
				t.Fatal("unsafe or missing action status mapping")
			}
			if tc.allowed && failure.status != tc.status {
				t.Fatal("status changed")
			}
			if err == nil {
				t.Fatal("error became success")
			}
		})
	}
}
