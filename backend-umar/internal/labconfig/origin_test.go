package labconfig

import "testing"

func TestPublicOrigin(t *testing.T) {
	for _, value := range []string{"https://umar-test.example.invalid", "https://umar-test.example.invalid:8443"} {
		if got, err := PublicOrigin(value); err != nil || got != value {
			t.Fatalf("valid origin: got %q, %v", got, err)
		}
	}
	for _, value := range []string{"", "http://umar-test.example.invalid", "http://127.0.0.1:8287", " https://umar-test.example.invalid", "https://user:password@umar-test.example.invalid", "https://umar-test.example.invalid/", "https://umar-test.example.invalid/auth", "https://umar-test.example.invalid?token=x", "https://umar-test.example.invalid#fragment", "https://UMAR-test.example.invalid", "https://umar-test.example.invalid:0", "https://umar-test.example.invalid:65536", "https:///missing-host"} {
		if _, err := PublicOrigin(value); err == nil {
			t.Errorf("unsafe/noncanonical origin accepted: %q", value)
		}
	}
}

func TestIssuerKeepsLocalDefaultAndRequiresExactPublicAgreement(t *testing.T) {
	const local = "http://127.0.0.1:8287"
	const public = "https://umar-test.example.invalid"
	for _, tc := range []struct{ provider, origin, explicit, want string }{
		{"gotrue", "", "", local},
		{"gotrue", "", "https://existing.example.invalid", "https://existing.example.invalid"},
		{"gotrue", public, "", public},
		{"gotrue", public, public, public},
	} {
		if got, err := Issuer(tc.provider, tc.origin, tc.explicit, local); err != nil || got != tc.want {
			t.Fatalf("issuer: got %q, %v; want %q", got, err, tc.want)
		}
	}
	for _, tc := range []struct{ provider, origin, explicit string }{
		{"gotrue", public, local},
		{"gotrue", public, public + "/"},
		{"gotrue", "http://unsafe.invalid", ""},
		{"keycloak", public, ""},
	} {
		if _, err := Issuer(tc.provider, tc.origin, tc.explicit, local); err == nil {
			t.Errorf("mismatched public issuer accepted: %+v", tc)
		}
	}
}
