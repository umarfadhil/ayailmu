package authn

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	jose "github.com/go-jose/go-jose/v4"
)

const (
	// keySetTTL bounds how long a fetched key set is trusted, as long as Auth lets its answer be cached.
	keySetTTL = 10 * time.Minute
	// keyRefreshCooldown is the least time between the starts of two fetches that tokens trigger.
	keyRefreshCooldown = 30 * time.Second
	// keyFetchTimeout bounds one fetch of the key set.
	keyFetchTimeout = 10 * time.Second
)

// ErrKeySetUnavailable wraps every failure to fetch a usable key set from Auth. The wrapping adds a
// fixed reason, never Auth's answer.
var ErrKeySetUnavailable = errors.New("authn: no usable Auth key set")

// keySet is a set of trusted public keys, never changed once built: the configured JWKS, which never
// expires, or one fetch's answer.
type keySet struct {
	keys    []jose.JSONWebKey
	expires time.Time // zero for the configured JWKS
}

// keyCache is a verifier's trusted key set and, in FetchJWKS mode, its refreshes. Whatever tokens
// arrive, it holds one set, when the last fetch started and the fetch in flight.
type keyCache struct {
	mu       sync.Mutex
	set      *keySet   // nil until a fetch succeeds
	attempt  time.Time // when the last fetch started; zero before the first
	inflight *keyFetch // the fetch in progress, which every caller shares
}

// keyFetch is one fetch of the key set. Its fixed failure reason, if any, is set before done closes.
type keyFetch struct {
	done   chan struct{}
	failed string
}

// RefreshKeys fetches the key set now under ctx, whatever its age or the cooldown of token-triggered
// refreshes; while a fetch is in flight it waits for that one instead. Startup calls it to establish
// the set. With a configured JWKS it does nothing. Failures wrap ErrKeySetUnavailable with a fixed
// reason, never Auth's answer, and keep a set that has not expired.
func (v *SupabaseVerifier) RefreshKeys(ctx context.Context) error {
	switch {
	case v == nil || v.client == nil || v.keys == nil:
		return keysUnavailable("verifier is not initialised")
	case v.keysURL == "":
		return nil
	}
	at, c := v.clock(), v.keys
	c.mu.Lock()
	if f := c.inflight; f != nil {
		c.mu.Unlock()
		select {
		case <-f.done:
			return f.result()
		case <-ctx.Done():
			return keysUnavailable("Auth did not answer in time")
		}
	}
	f := &keyFetch{done: make(chan struct{})}
	c.inflight, c.attempt = f, at
	c.mu.Unlock()
	fetchCtx, cancel := context.WithTimeout(ctx, keyFetchTimeout)
	defer cancel()
	set, failed := v.fetchKeys(fetchCtx, at)
	c.finish(f, set, failed)
	return f.result()
}

// trustedPayload returns jws's payload as verified by a trusted key of its kid and algorithm. A token
// met without a usable fetched set, or naming a kid and algorithm that no trusted key has, first waits
// on a refresh (awaitRefresh) and is then tried once more. A token that a trusted key of its kid and
// algorithm fails to verify refreshes nothing, nor does one without a kid, as every trusted key has
// one. A failure is a fixed reason.
func (v *SupabaseVerifier) trustedPayload(ctx context.Context, jws *jose.JSONWebSignature, now time.Time) ([]byte, string) {
	if set := v.keys.usable(now); set != nil {
		payload, known := set.verify(jws)
		switch {
		case payload != nil:
			return payload, ""
		case known || v.keysURL == "":
			return nil, "token is not signed by a trusted key"
		}
	}
	if v.keysURL == "" || jws.Signatures[0].Protected.KeyID == "" {
		return nil, "token is not signed by a trusted key"
	}
	v.awaitRefresh(ctx, now)
	set := v.keys.usable(now)
	if set == nil {
		return nil, "no usable key set"
	}
	if payload, _ := set.verify(jws); payload != nil {
		return payload, ""
	}
	return nil, "token is not signed by a trusted key"
}

// awaitRefresh refreshes a fetched key set for a token: it shares the fetch in flight, or starts one
// unless the cooldown since the last has not passed, and waits until that fetch ends or ctx does. The
// fetch is bounded by keyFetchTimeout alone, so a waiter that gives up leaves it to the others.
func (v *SupabaseVerifier) awaitRefresh(ctx context.Context, now time.Time) {
	c := v.keys
	c.mu.Lock()
	f := c.inflight
	if f == nil {
		if !c.attempt.IsZero() && now.Before(c.attempt.Add(keyRefreshCooldown)) {
			c.mu.Unlock()
			return
		}
		fetch := &keyFetch{done: make(chan struct{})}
		c.inflight, c.attempt, f = fetch, now, fetch
		go func() {
			fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), keyFetchTimeout)
			defer cancel()
			set, failed := v.fetchKeys(fetchCtx, now)
			c.finish(fetch, set, failed)
		}()
	}
	c.mu.Unlock()
	select {
	case <-f.done:
	case <-ctx.Done():
	}
}

// fetchKeys asks Auth's GET /.well-known/jwks.json, with no credential, for its key set, which must pass
// the checks of a configured JWKS; the set expires keySetTTL after at. A failure is a fixed reason.
func (v *SupabaseVerifier) fetchKeys(ctx context.Context, at time.Time) (*keySet, string) {
	status, data, failed := v.send(ctx, http.MethodGet, v.keysURL, "", "", maxJWKSBytes)
	switch {
	case failed != "":
		return nil, failed
	case status >= 300 && status < 400:
		return nil, "Auth redirected, and redirects are never followed"
	case status != http.StatusOK:
		return nil, "Auth did not serve its key set"
	}
	keys, ok := supabaseKeys(data)
	if !ok {
		return nil, "Auth's key set is not a small set of asymmetric public signing keys, each with a key ID and an algorithm that fits it"
	}
	return &keySet{keys: keys, expires: at.Add(keySetTTL)}, ""
}

// usable is the trusted key set, if there is one that has not expired at now.
func (c *keyCache) usable(now time.Time) *keySet {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.set == nil || (!c.set.expires.IsZero() && !now.Before(c.set.expires)) {
		return nil
	}
	return c.set
}

// finish records a fetch's outcome and releases its waiters. A fetched set replaces the trusted one; a
// failure keeps it, so an unexpired set stays usable and an expired one stays expired.
func (c *keyCache) finish(f *keyFetch, set *keySet, failed string) {
	c.mu.Lock()
	if set != nil {
		c.set = set
	}
	c.inflight, f.failed = nil, failed
	c.mu.Unlock()
	close(f.done)
}

// result is the fetch's outcome, once done is closed.
func (f *keyFetch) result() error {
	if f.failed != "" {
		return keysUnavailable(f.failed)
	}
	return nil
}

// verify has go-jose verify jws with each trusted key of its protected kid and algorithm, as overlapping
// keys may share a kid, and returns the payload of the first that does. It also reports whether any
// trusted key has the token's kid and algorithm at all.
func (s *keySet) verify(jws *jose.JSONWebSignature) ([]byte, bool) {
	h, known := jws.Signatures[0].Protected, false
	for _, k := range s.keys {
		if k.KeyID != h.KeyID || k.Algorithm != h.Algorithm {
			continue
		}
		known = true
		if payload, err := jws.Verify(k.Key); err == nil {
			return payload, true
		}
	}
	return nil, known
}

func keysUnavailable(reason string) error {
	return fmt.Errorf("%w: %s", ErrKeySetUnavailable, reason)
}
