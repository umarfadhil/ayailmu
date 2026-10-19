package authn_test

// A synthetic local stack's internal network, Phase 8 RED. In synthetic mode the Supabase verifier may reach its Auth over
// plain http at an internal name only when that exact host:port is one of InternalHosts: an unlisted name, another port,
// no port, the name in another case, userinfo, a query, and the same listed name outside synthetic mode stay refused, as
// before. By such a name ("localhost" stands in for a container's name here: a name the resolver answers, not a literal
// loopback address) the verifier fetches the key set and confirms a session exactly as at a loopback address, through the
// owned plain-HTTP stand-in that supabase_keys_test.go defines, which faults any cookie or misplaced credential and counts
// every request.

import (
	"context"
	"errors"
	"net/url"
	"testing"

	"ayailmu.local/backend/internal/authn"
	"ayailmu.local/backend/internal/config"
)

func TestSupabaseVerifierUsesPlainHTTPOnlyForAnExactInternalHost(t *testing.T) {
	settings := func(base string, synthetic bool, hosts ...string) authn.SupabaseConfig {
		return authn.SupabaseConfig{BaseURL: base, Issuer: "https://auth.ayailmu-local.test/auth/v1", Audience: supabaseAudience,
			AdminKey: config.Secret("adm-internal-not-real-6021"), FetchJWKS: true, LocalSynthetic: synthetic, InternalHosts: hosts}
	}

	t.Run("an exact internal host is accepted", func(t *testing.T) {
		for _, base := range []string{"http://aya-auth:9999", "http://aya-auth:9999/", "http://aya-auth:9999/auth/v1"} {
			if _, err := authn.NewSupabaseVerifier(settings(base, true, "aya-auth:9999")); err != nil {
				t.Fatalf("NewSupabaseVerifier(%s, its host and port listed) = %v, want a verifier", base, err)
			}
		}
	})

	t.Run("anything else stays refused", func(t *testing.T) {
		listed := []string{"aya-auth:9999"}
		for _, c := range []struct {
			name      string
			base      string
			synthetic bool
			hosts     []string
		}{
			{"an internal name not listed", "http://aya-auth:9999", true, nil},
			{"another internal name", "http://other-auth:9999", true, listed},
			{"another port", "http://aya-auth:9998", true, listed},
			{"no port", "http://aya-auth", true, listed},
			{"the name in another case", "http://Aya-Auth:9999", true, listed},
			{"userinfo", "http://svc:not-a-secret@aya-auth:9999", true, listed},
			{"a query", "http://aya-auth:9999/?apikey=not-a-secret", true, listed},
			{"a listed name outside synthetic mode", "http://aya-auth:9999", false, listed},
		} {
			t.Run(c.name, func(t *testing.T) {
				if _, err := authn.NewSupabaseVerifier(settings(c.base, c.synthetic, c.hosts...)); !errors.Is(err, authn.ErrUnsafeConfig) {
					t.Fatalf("NewSupabaseVerifier error = %v, want ErrUnsafeConfig", err)
				}
			})
		}
	})

	t.Run("by its internal name the verifier fetches the key set and confirms a session as on loopback", func(t *testing.T) {
		k := newKeyedAuth(t, true)
		u, err := url.Parse(k.srv.URL)
		if err != nil {
			t.Fatal(err)
		}
		host := "localhost:" + u.Port()
		v, err := authn.NewSupabaseVerifier(authn.SupabaseConfig{BaseURL: "http://" + host + supabaseBase, Issuer: k.issuer, Audience: supabaseAudience,
			AdminKey: config.Secret(k.adminKey), FetchJWKS: true, LocalSynthetic: true, InternalHosts: []string{host}})
		if err != nil {
			t.Fatalf("NewSupabaseVerifier(Auth by its internal name): %s", k.describe(err))
		}
		if err := v.RefreshKeys(context.Background()); err != nil {
			t.Fatalf("RefreshKeys by the internal name: %s", k.describe(err))
		}
		token := k.issue(t, k.initial)
		s, err := v.VerifySession(context.Background(), token)
		if err != nil || s.Issuer != k.issuer || s.Subject != k.uid {
			t.Fatalf("VerifySession by the internal name: %s; want the stand-in's user", k.describe(err, token))
		}
		if keys, users := k.counts(t); keys != 1 || users != 1 {
			t.Fatalf("Auth served its key set %d times and GET /user %d times, want once each", keys, users)
		}
	})
}
