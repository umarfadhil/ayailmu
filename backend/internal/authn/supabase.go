package authn

import (
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	jose "github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"

	"ayailmu.local/backend/internal/config"
)

const (
	// supabaseRole is the role claim of a signed-in user's access token; Auth's API keys carry the
	// roles "anon" and "service_role".
	supabaseRole = "authenticated"
	// passwordMethod is the amr method of a password sign-in.
	passwordMethod = "password"
	// userNotFoundCode is the error_code of Auth's 404 for a user it does not have.
	userNotFoundCode = "user_not_found"
	// hardDeleteBody asks Auth's admin API to delete the user rather than soft-delete them.
	hardDeleteBody = `{"should_soft_delete":false}`
	// nilUUID is neither a user ID nor a session ID.
	nilUUID = "00000000-0000-0000-0000-000000000000"
	// clockSkew is the leeway for a token's times. Auth runs beside this backend, so it is short.
	clockSkew = 30 * time.Second
	// maxSettingBytes bounds the base URL, the issuer and the audience.
	maxSettingBytes = 2 << 10
	// maxJWKSBytes and maxJWKSKeys bound a key set, configured or fetched; Auth publishes a few keys at
	// most.
	maxJWKSBytes = 64 << 10
	maxJWKSKeys  = 16
	// minRSABits and maxRSABits bound an RSA key's modulus. maxRSABits is go-jose's default
	// MaxRSAModulusBits, which this package never raises.
	minRSABits = 2048
	maxRSABits = 4096
	// maxProviderBytes bounds the sign-in provider's name.
	maxProviderBytes = 64
	// maxUserBytes bounds GET /user's answer and maxAdminBytes the admin delete's; maxHeaderBytes
	// bounds the response headers the default client reads.
	maxUserBytes   = 64 << 10
	maxAdminBytes  = 4 << 10
	maxHeaderBytes = 64 << 10
)

// rsaAlgorithms are the signature algorithms a trusted RSA key may name.
var rsaAlgorithms = []jose.SignatureAlgorithm{jose.RS256, jose.RS384, jose.RS512, jose.PS256, jose.PS384, jose.PS512}

// tokenAlgorithms is the fixed allowlist of signature algorithms a token may name: those a trusted key
// may have, all asymmetric. Neither a token nor a fetched key set extends it.
var tokenAlgorithms = []jose.SignatureAlgorithm{jose.ES256, jose.ES384, jose.ES512, jose.RS256, jose.RS384,
	jose.RS512, jose.PS256, jose.PS384, jose.PS512, jose.EdDSA}

// SupabaseConfig configures a SupabaseVerifier for one standalone Supabase Auth (GoTrue v2.197.0)
// server of this backend's own deployment.
type SupabaseConfig struct {
	// BaseURL is the Auth server's base URL, under which it serves /user and /admin/users/{id}: https,
	// or plain http on a canonical literal loopback address or exactly one of InternalHosts in
	// LocalSynthetic mode only. No userinfo, query, fragment or dot segments.
	BaseURL string
	// Issuer and Audience are the exact iss and aud claims of the server's access tokens.
	Issuer   string
	Audience string
	// JWKS is the server's public JSON Web Key Set, as served at /.well-known/jwks.json: at most 16
	// asymmetric public signing keys, each with a key ID and an algorithm that fits it. Keys may
	// overlap during a rotation. Without FetchJWKS it is configured, never fetched.
	JWKS []byte
	// FetchJWKS makes the verifier fetch the key set from BaseURL's /.well-known/jwks.json instead, and
	// JWKS must then be empty. A fetch is one GET, with no credential or cookie, that follows no
	// redirect; its answer is bounded and checked like JWKS. A fetched set is used for at most 10
	// minutes. A token of a key the set does not hold, or one met without a usable set, triggers a
	// refresh, at most one every 30 seconds, which concurrent tokens share. RefreshKeys establishes the
	// set at startup. Whenever no fetched set is usable, every token is refused.
	FetchJWKS bool
	// AdminKey is the server-only credential of the admin API. It never leaves the backend.
	AdminKey config.Secret
	// LocalSynthetic marks a synthetic local fixture: only then may BaseURL use plain http, and only on
	// loopback.
	LocalSynthetic bool
	// InternalHosts are, with LocalSynthetic, the exact host:port values of a synthetic local stack's
	// internal network (its container DNS names) to which BaseURL may also use plain http: a lowercase
	// host name and an explicit port, matched exactly, never resolved or normalised here. Outside
	// LocalSynthetic they allow nothing.
	InternalHosts []string
	// HTTPClient sends every request to Auth; nil means a dedicated client that dials Auth directly,
	// never through a proxy of the environment. A client that skips TLS verification is refused.
	// Redirects are never followed and cookies never kept.
	HTTPClient *http.Client
	// Now is the verifier's clock, for token times, a ban's end and the fetched key set's age; nil means
	// time.Now.
	Now func() time.Time
}

// SupabaseVerifier verifies Supabase Auth access tokens (SessionVerifier) and deletes a verified
// user's Auth account (IdentityDeleter). Its key set is configured, or fetched from the configured
// server (FetchJWKS), cached and refreshed on demand, never in the background; no token header directs
// a request: it only ever asks the configured server's GET /.well-known/jwks.json, GET /user and
// DELETE /admin/users/{id}.
type SupabaseVerifier struct {
	userURL  string // GET: the caller's own user
	usersURL string // DELETE usersURL + ID: a user, through the admin API
	keysURL  string // GET: Auth's key set in FetchJWKS mode; empty for a configured one
	issuer   string
	audience string
	// adminKey and keys sit behind pointers, which fmt prints as addresses: formatting the verifier
	// never prints the credential or a key ID.
	adminKey *config.Secret
	keys     *keyCache
	client   *http.Client
	clock    func() time.Time
}

var (
	_ SessionVerifier = (*SupabaseVerifier)(nil)
	_ IdentityDeleter = (*SupabaseVerifier)(nil)
)

// supabaseClaims are the claims of an Auth access token that the verifier reads.
type supabaseClaims struct {
	jwt.Claims
	Role        string              `json:"role"`
	SessionID   string              `json:"session_id"`
	IsAnonymous *bool               `json:"is_anonymous"`
	AMR         []supabaseAMR       `json:"amr"`
	AppMetadata supabaseAppMetadata `json:"app_metadata"`
}

// supabaseAMR is one entry of the amr claim: a way the session's user authenticated, and when.
type supabaseAMR struct {
	Method    string `json:"method"`
	Timestamp int64  `json:"timestamp"`
}

// supabaseAppMetadata is what the verifier reads of the app_metadata claim.
type supabaseAppMetadata struct {
	Provider string `json:"provider"`
}

// NewSupabaseVerifier checks cfg and builds the verifier; it contacts nothing, not even in FetchJWKS
// mode. Every refusal wraps ErrUnsafeConfig with a fixed reason that quotes no setting.
func NewSupabaseVerifier(cfg SupabaseConfig) (*SupabaseVerifier, error) {
	base, ok := supabaseBaseURL(cfg.BaseURL, cfg.LocalSynthetic, cfg.InternalHosts)
	if !ok {
		return nil, unsafeConfig("the base URL must be https, or plain http to a literal loopback address and port or to a listed internal host and port in synthetic mode, with no userinfo, query, fragment or dot segment")
	}
	keys, ok := supabaseKeys(cfg.JWKS)
	switch {
	case cfg.Issuer == "" || len(cfg.Issuer) > maxSettingBytes:
		return nil, unsafeConfig("the issuer is missing or too long")
	case cfg.Audience == "" || len(cfg.Audience) > maxSettingBytes:
		return nil, unsafeConfig("the audience is missing or too long")
	case !isBearerCredential(cfg.AdminKey.Reveal()):
		return nil, unsafeConfig("the admin credential is missing or not a bearer credential")
	case cfg.FetchJWKS && len(cfg.JWKS) != 0:
		return nil, unsafeConfig("a fetched key set excludes a configured one")
	case !cfg.FetchJWKS && !ok:
		return nil, unsafeConfig("the key set is not a small set of asymmetric public signing keys, each with a key ID and an algorithm that fits it")
	}
	client, ok := supabaseClient(cfg.HTTPClient)
	if !ok {
		return nil, unsafeConfig("the HTTP client must verify TLS certificates")
	}
	clock := cfg.Now
	if clock == nil {
		clock = time.Now
	}
	adminKey := cfg.AdminKey
	v := &SupabaseVerifier{userURL: base + "/user", usersURL: base + "/admin/users/", issuer: cfg.Issuer,
		audience: cfg.Audience, adminKey: &adminKey, keys: &keyCache{}, client: client, clock: clock}
	if cfg.FetchJWKS {
		v.keysURL = base + "/.well-known/jwks.json"
	} else {
		v.keys.set = &keySet{keys: keys}
	}
	return v, nil
}

// Verify returns the identity of a verified access token: VerifySession without the sign-in time.
func (v *SupabaseVerifier) Verify(ctx context.Context, accessToken string) (Identity, error) {
	s, err := v.VerifySession(ctx, accessToken)
	return s.Identity, err
}

// VerifySession returns the identity and verified sign-in time of an access token.
//
// The token is first proven locally, so one that fails never reaches GET /user: a compact JWS of an
// allowlisted asymmetric algorithm that go-jose verifies with a trusted key of the token's kid and
// algorithm (configured, or fetched as FetchJWKS describes); the exact issuer and audience; an expiry
// after the issue time, with neither of them nor a not-before time out of range; the authenticated
// role; a non-anonymous user with a canonical UUID subject; a session; and a sign-in provider. Auth's
// GET /user, asked once with the token itself, must then confirm the same active user: Auth refuses a
// revoked session or a banned user, and its answer must be the token's user, neither banned nor
// deleted.
//
// The sign-in time is the verified amr claim's password entry, which token refreshes keep; neither the
// issue time nor a refresh sets it, and it is zero without a password entry. Every failure wraps
// ErrUnauthenticated with a fixed reason, never the token, a claim or Auth's answer.
func (v *SupabaseVerifier) VerifySession(ctx context.Context, accessToken string) (Session, error) {
	if v == nil || v.client == nil || v.keys == nil {
		return Session{}, reject("verifier is not initialised")
	}
	ctx, cancel := context.WithTimeout(ctx, verifyTimeout)
	defer cancel()
	s, err := v.verifyToken(ctx, accessToken, v.clock())
	if err != nil {
		return Session{}, err
	}
	status, data, failed := v.send(ctx, http.MethodGet, v.userURL, accessToken, "", maxUserBytes)
	var u struct {
		ID          string     `json:"id"`
		Audience    string     `json:"aud"`
		Role        string     `json:"role"`
		IsAnonymous *bool      `json:"is_anonymous"`
		BannedUntil *time.Time `json:"banned_until"`
		DeletedAt   *time.Time `json:"deleted_at"`
	}
	switch {
	case failed != "":
		return Session{}, reject(failed)
	case status >= 300 && status < 400:
		return Session{}, reject("Auth redirected, and redirects are never followed")
	case status != http.StatusOK:
		return Session{}, reject("Auth did not confirm the user and session")
	case json.Unmarshal(data, &u) != nil:
		return Session{}, reject("Auth's answer is malformed")
	case u.ID != s.Subject || u.Audience != v.audience || u.Role != supabaseRole || u.IsAnonymous == nil || *u.IsAnonymous:
		return Session{}, reject("Auth's answer is not about the token's signed-in user")
	case u.BannedUntil != nil && v.clock().Before(*u.BannedUntil):
		return Session{}, reject("Auth reports the user banned")
	case u.DeletedAt != nil:
		return Session{}, reject("Auth reports the user deleted")
	}
	return s, nil
}

// DeleteIdentity hard-deletes the identity's Auth user through the admin API's DELETE
// /admin/users/{id}, with the server-only admin credential. Only a canonical UUID subject of this
// verifier's issuer is sent. Auth's success, 200 with exactly the JSON object {}, and its precise 404
// user_not_found count as deleted; any other answer, a redirect included, does not. Failures wrap
// ErrIdentityNotDeleted with a fixed reason, never the credential, the subject or Auth's answer.
func (v *SupabaseVerifier) DeleteIdentity(ctx context.Context, id Identity) error {
	switch {
	case v == nil || v.client == nil:
		return notDeleted("verifier is not initialised")
	case id.Issuer != v.issuer:
		return notDeleted("the identity belongs to another issuer")
	case !isCanonicalUUID(id.Subject):
		return notDeleted("the subject is not a user ID")
	}
	ctx, cancel := context.WithTimeout(ctx, deleteTimeout)
	defer cancel()
	status, data, failed := v.send(ctx, http.MethodDelete, v.usersURL+id.Subject, v.adminKey.Reveal(), hardDeleteBody, maxAdminBytes)
	switch {
	case failed != "":
		return notDeleted(failed)
	case status == http.StatusOK && isEmptyObject(data):
		return nil // Auth deleted the user
	case status == http.StatusNotFound && isUserNotFound(data):
		return nil // Auth no longer has the user
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		return notDeleted("Auth refused the admin credential")
	case status >= 300 && status < 400:
		return notDeleted("Auth redirected, and redirects are never followed")
	default:
		return notDeleted("Auth's answer is neither its deletion success nor its precise user_not_found")
	}
}

// verifyToken makes every local check of VerifySession, before anything reaches GET /user. The only
// request it may wait on is a refresh of a fetched key set.
func (v *SupabaseVerifier) verifyToken(ctx context.Context, token string, now time.Time) (Session, error) {
	switch {
	case token == "":
		return Session{}, reject("empty token")
	case len(token) > maxTokenBytes:
		return Session{}, reject("token too long")
	case !isCompactJWS(token):
		return Session{}, reject("token is not a compact JWS")
	}
	jws, err := jose.ParseSignedCompact(token, tokenAlgorithms)
	if err != nil || len(jws.Signatures) != 1 {
		return Session{}, reject("token is not signed with an accepted algorithm")
	}
	payload, failed := v.trustedPayload(ctx, jws, now)
	if failed != "" {
		return Session{}, reject(failed)
	}
	var c supabaseClaims
	switch {
	case json.Unmarshal(payload, &c) != nil:
		return Session{}, reject("token claims are malformed")
	case c.Issuer != v.issuer || len(c.Audience) != 1 || c.Audience[0] != v.audience:
		return Session{}, reject("issuer or audience is not the configured Auth server's")
	case c.Expiry == nil || c.IssuedAt == nil || !c.Expiry.Time().After(c.IssuedAt.Time()):
		return Session{}, reject("token times are missing or inconsistent")
	case c.ValidateWithLeeway(jwt.Expected{Time: now}, clockSkew) != nil:
		return Session{}, reject("token expired, is not valid yet or was issued in the future")
	case c.Role != supabaseRole:
		return Session{}, reject("token is not a signed-in user's")
	case c.IsAnonymous == nil || *c.IsAnonymous:
		return Session{}, reject("anonymous sign-ins stay on the device")
	case !isCanonicalUUID(c.Subject):
		return Session{}, reject("subject is not a canonical user ID")
	case !isCanonicalUUID(c.SessionID):
		return Session{}, reject("session is missing")
	case !isProviderName(c.AppMetadata.Provider) || c.AppMetadata.Provider == providerAnonymous:
		return Session{}, reject("sign-in provider is missing")
	}
	return Session{
		Identity: Identity{Issuer: c.Issuer, Subject: c.Subject, SignInProvider: c.AppMetadata.Provider},
		AuthTime: c.passwordSignIn(),
	}, nil
}

// passwordSignIn is the latest password entry of the verified amr claim, which token refreshes keep and
// nothing else sets. An entry later than the token's issue time is not believed. It is zero without
// one.
func (c *supabaseClaims) passwordSignIn() time.Time {
	limit := c.IssuedAt.Time().Add(clockSkew).Unix()
	var latest int64
	for _, m := range c.AMR {
		if m.Method == passwordMethod && m.Timestamp > latest && m.Timestamp <= limit {
			latest = m.Timestamp
		}
	}
	if latest == 0 {
		return time.Time{}
	}
	return time.Unix(latest, 0)
}

// send makes one request to Auth, with bearer as its credential unless it is empty, and reads the whole
// answer, of at most limit bytes. A failure is a fixed reason, never the transport's error, which can
// quote the request.
func (v *SupabaseVerifier) send(ctx context.Context, method, target, bearer, body string, limit int) (int, []byte, string) {
	var rd io.Reader
	if body != "" {
		rd = strings.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, rd)
	if err != nil {
		return 0, nil, "the request to Auth could not be built"
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	req.Header.Set("Accept", "application/json")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := v.client.Do(req)
	switch {
	case err != nil && ctx.Err() != nil:
		return 0, nil, "Auth did not answer in time"
	case err != nil:
		return 0, nil, "Auth gave no usable answer"
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, int64(limit)+1))
	switch {
	case err != nil:
		return 0, nil, "Auth's answer was cut short"
	case len(data) > limit:
		return 0, nil, "Auth's answer is larger than any it gives"
	}
	return resp.StatusCode, data, ""
}

// supabaseBaseURL checks the configured base URL and returns it without a trailing slash, with no
// userinfo, query, fragment, unusual escape, or empty or dot path segment.
func supabaseBaseURL(raw string, localSynthetic bool, internalHosts []string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > maxSettingBytes || strings.ContainsAny(raw, "?#") || u.Opaque != "" ||
		u.User != nil || u.RawPath != "" || !isAuthHost(u, localSynthetic, internalHosts) {
		return "", false
	}
	path := strings.TrimSuffix(u.EscapedPath(), "/")
	for _, segment := range strings.Split(path, "/")[1:] {
		if segment == "" || segment == "." || segment == ".." {
			return "", false
		}
	}
	return u.Scheme + "://" + u.Host + path, true
}

// isAuthHost accepts https to a host name or IP address without a zone, with a port from 1 to 65535 if
// any, or plain http to a literal loopback address and port, or to exactly one of internalHosts, in
// synthetic mode only.
func isAuthHost(u *url.URL, localSynthetic bool, internalHosts []string) bool {
	switch u.Scheme {
	case "http":
		return localSynthetic && (isLoopbackHostPort(u.Host) || isListedInternalHost(u.Host, internalHosts))
	case "https":
		if u.Hostname() == "" || strings.Contains(u.Host, "%") || strings.HasSuffix(u.Host, ":") {
			return false
		}
		if p := u.Port(); p != "" {
			n, err := strconv.ParseUint(p, 10, 16)
			return err == nil && n > 0
		}
		return true
	default:
		return false
	}
}

// isListedInternalHost reports whether hostport is exactly one of hosts and is a lowercase host name with
// an explicit port from 1 to 65535, without a leading zero: a synthetic stack's container name on its
// internal network. Nothing is resolved or normalised, so another case, port or spelling is not listed.
func isListedInternalHost(hostport string, hosts []string) bool {
	name, port, ok := strings.Cut(hostport, ":")
	if !ok || !slices.Contains(hosts, hostport) || !isInternalName(name) || port == "" || port[0] == '0' {
		return false
	}
	n, err := strconv.ParseUint(port, 10, 16)
	return err == nil && n > 0
}

// isInternalName accepts a lowercase host name: dot-separated labels of letters, digits and hyphens,
// none empty or starting or ending with a hyphen.
func isInternalName(s string) bool {
	if s == "" || len(s) > 253 {
		return false
	}
	for _, label := range strings.Split(s, ".") {
		if label == "" || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for i := 0; i < len(label); i++ {
			if c := label[i]; (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' {
				return false
			}
		}
	}
	return true
}

// supabaseKeys parses a key set, configured or fetched: 1 to maxJWKSKeys public keys in at most
// maxJWKSBytes, each with a key ID, no use but "sig" and an asymmetric algorithm that fits its type and
// size (keyFits).
func supabaseKeys(jwks []byte) ([]jose.JSONWebKey, bool) {
	var set jose.JSONWebKeySet
	if len(jwks) > maxJWKSBytes || json.Unmarshal(jwks, &set) != nil || len(set.Keys) == 0 || len(set.Keys) > maxJWKSKeys {
		return nil, false
	}
	for i := range set.Keys {
		if k := &set.Keys[i]; !k.IsPublic() || !k.Valid() || k.KeyID == "" || (k.Use != "" && k.Use != "sig") || !keyFits(k) {
			return nil, false
		}
	}
	return set.Keys, true
}

// keyFits reports whether a public key's "alg" is the ECDSA algorithm of its curve, an RSA algorithm for
// a modulus of minRSABits to maxRSABits, or EdDSA for an Ed25519 key.
func keyFits(k *jose.JSONWebKey) bool {
	alg := jose.SignatureAlgorithm(k.Algorithm)
	switch key := k.Key.(type) {
	case *ecdsa.PublicKey:
		return alg == jose.ES256 && key.Curve == elliptic.P256() || alg == jose.ES384 && key.Curve == elliptic.P384() ||
			alg == jose.ES512 && key.Curve == elliptic.P521()
	case *rsa.PublicKey:
		bits := key.N.BitLen()
		return bits >= minRSABits && bits <= maxRSABits && slices.Contains(rsaAlgorithms, alg)
	case ed25519.PublicKey:
		return alg == jose.EdDSA
	default:
		return false
	}
}

// supabaseClient returns the client for Auth: a copy of the configured client, which must not skip TLS
// verification, or a dedicated one that dials Auth directly, never through a proxy of the environment.
// Neither keeps cookies or follows a redirect.
func supabaseClient(configured *http.Client) (*http.Client, bool) {
	var hc http.Client
	if configured == nil {
		hc.Transport = &http.Transport{ForceAttemptHTTP2: true, TLSHandshakeTimeout: verifyTimeout,
			IdleConnTimeout: time.Minute, MaxResponseHeaderBytes: maxHeaderBytes}
	} else {
		if t, ok := configured.Transport.(*http.Transport); ok && t.TLSClientConfig != nil && t.TLSClientConfig.InsecureSkipVerify {
			return nil, false
		}
		hc = *configured
	}
	hc.Jar = nil
	hc.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &hc, true
}

// isCompactJWS reports whether s has the shape of a compact JWS: three non-empty base64url segments.
func isCompactJWS(s string) bool {
	segments := strings.Split(s, ".")
	if len(segments) != 3 {
		return false
	}
	for _, segment := range segments {
		if segment == "" {
			return false
		}
		for i := 0; i < len(segment); i++ {
			if c := segment[i]; (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' && c != '_' {
				return false
			}
		}
	}
	return true
}

// isCanonicalUUID accepts a UUID written canonically, lowercase hex digits in 8-4-4-4-12 groups, other
// than the nil UUID.
func isCanonicalUUID(s string) bool {
	if len(s) != len(nilUUID) || s == nilUUID {
		return false
	}
	for i := 0; i < len(s); i++ {
		switch c := s[i]; i {
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

// isProviderName accepts an Auth provider name such as "email" or "google": at most maxProviderBytes of
// lowercase letters, digits, '-', '_', '.' and ':'.
func isProviderName(s string) bool {
	if s == "" || len(s) > maxProviderBytes {
		return false
	}
	for i := 0; i < len(s); i++ {
		if c := s[i]; (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '-' && c != '_' && c != '.' && c != ':' {
			return false
		}
	}
	return true
}

// isBearerCredential accepts a credential that an Authorization header carries as is: at most
// maxTokenBytes of visible ASCII.
func isBearerCredential(s string) bool {
	if s == "" || len(s) > maxTokenBytes {
		return false
	}
	for i := 0; i < len(s); i++ {
		if c := s[i]; c <= ' ' || c > '~' {
			return false
		}
	}
	return true
}

// isEmptyObject reports whether data is the JSON object {}, Auth's answer to a deleted user.
func isEmptyObject(data []byte) bool {
	var obj map[string]json.RawMessage
	return json.Unmarshal(data, &obj) == nil && obj != nil && len(obj) == 0
}

// isUserNotFound reports whether data is Auth's error document for a user it does not have.
func isUserNotFound(data []byte) bool {
	var p struct {
		Code      int    `json:"code"`
		ErrorCode string `json:"error_code"`
	}
	return json.Unmarshal(data, &p) == nil && p.Code == http.StatusNotFound && p.ErrorCode == userNotFoundCode
}

func unsafeConfig(reason string) error {
	return fmt.Errorf("%w: %s", ErrUnsafeConfig, reason)
}
