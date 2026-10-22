package labconfig

import (
	"errors"
	"net/url"
	"strconv"
	"strings"
)

// PublicOrigin accepts the same exact, credential-free HTTPS origin as the lab APK.
// It deliberately does not normalize issuer strings: JWT issuer agreement is exact.
func PublicOrigin(value string) (string, error) {
	invalid := errors.New("public origin must be canonical HTTPS without credentials, path, query or fragment")
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawPath != "" || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Hostname() != strings.ToLower(u.Hostname()) || strings.HasSuffix(u.Host, ":") || u.String() != value {
		return "", invalid
	}
	for _, c := range u.Hostname() {
		if c > 127 {
			return "", invalid
		}
	}
	if u.Port() != "" {
		port, err := strconv.Atoi(u.Port())
		if err != nil || port < 1 || port > 65535 || strconv.Itoa(port) != u.Port() {
			return "", invalid
		}
	}
	return value, nil
}

func Issuer(provider, origin, explicit, fallback string) (string, error) {
	if origin != "" {
		if provider != "gotrue" {
			return "", errors.New("public synthetic origin requires GoTrue")
		}
		if _, err := PublicOrigin(origin); err != nil {
			return "", err
		}
		if explicit != "" && explicit != origin {
			return "", errors.New("public origin and explicit OIDC issuer disagree")
		}
		return origin, nil
	}
	if explicit != "" {
		return explicit, nil
	}
	return fallback, nil
}
