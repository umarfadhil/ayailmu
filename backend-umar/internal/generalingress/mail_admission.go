package generalingress

import (
	"crypto/sha256"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// A known rejection is distinct from a transport outcome that might have sent mail.
type rateFailure struct{ seconds int }

type providerRejection struct{ status int }

func (*providerRejection) Error() string { return "provider rejected mail request" }
func (*providerRejection) Unwrap() error { return ErrDenied }

func boundedRetry(d time.Duration) int {
	if d <= 0 {
		return 1
	}
	if d >= time.Hour {
		return 3600
	}
	return int((d + time.Second - 1) / time.Second)
}

func (*rateFailure) Error() string { return "provider rate limited request" }

func retrySeconds(h http.Header) int {
	v := h.Values("Retry-After")
	if len(v) == 1 {
		n, err := strconv.Atoi(v[0])
		if err == nil && n >= 1 && n <= 3600 && strconv.Itoa(n) == v[0] {
			return n
		}
	}
	return 60
}

type mailAttempt struct {
	fingerprint      [32]byte
	expires, retryAt time.Time
	pending          bool
	outcome          error
}

// This bounded cache is deliberately transient. Restart loses replay records;
// the provider still owns confirmation, recipient cooldowns and account quota.
// It holds digests/times only, never a password, OTP, token, email or IP string.
type mailAdmission struct {
	mu                              sync.Mutex
	now                             func() time.Time
	last                            time.Time
	capacity, recipientHour, ipHour int
	cooldown                        time.Duration
	attempts                        map[[32]byte]mailAttempt
	windows                         map[[32]byte][]time.Time
	lastRecipient                   map[[32]byte]time.Time
}

func newMailAdmission(c RuntimeConfig, now func() time.Time) *mailAdmission {
	return &mailAdmission{now: now, capacity: c.Policy.MaxState, recipientHour: c.Policy.MailRecipientHour, ipHour: c.Policy.MailIPHour, cooldown: c.Policy.MailCooldown, attempts: map[[32]byte]mailAttempt{}, windows: map[[32]byte][]time.Time{}, lastRecipient: map[[32]byte]time.Time{}}
}

func (m *mailAdmission) reserve(id string, fingerprint, recipient, peer [32]byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	if now.Before(m.last) {
		return ErrUnavailable
	}
	m.last = now
	for k, a := range m.attempts {
		if !a.pending && !now.Before(a.expires) {
			delete(m.attempts, k)
		}
	}
	for k, w := range m.windows {
		kept := w[:0]
		for _, at := range w {
			if now.Sub(at) < time.Hour {
				kept = append(kept, at)
			}
		}
		if len(kept) == 0 {
			delete(m.windows, k)
		} else {
			m.windows[k] = kept
		}
	}
	for k, at := range m.lastRecipient {
		if now.Sub(at) >= m.cooldown {
			delete(m.lastRecipient, k)
		}
	}
	key := sha256.Sum256([]byte(id))
	prior, exists := m.attempts[key]
	if exists {
		if prior.fingerprint != fingerprint {
			return &wireFailure{409, "idempotency_conflict"}
		}
		if prior.pending {
			return ErrReplay
		}
		var limited *rateFailure
		if !errors.As(prior.outcome, &limited) {
			if prior.outcome != nil && !errors.Is(prior.outcome, ErrUnavailable) {
				return prior.outcome
			}
			return ErrReplay
		}
		if now.Before(prior.retryAt) {
			return &rateFailure{seconds: boundedRetry(prior.retryAt.Sub(now))}
		}
	} else if len(m.attempts) >= m.capacity {
		return ErrUnavailable
	}
	if at, ok := m.lastRecipient[recipient]; ok && now.Sub(at) < m.cooldown {
		return &rateFailure{seconds: boundedRetry(m.cooldown - now.Sub(at))}
	}
	if len(m.windows[recipient]) >= m.recipientHour || len(m.windows[peer]) >= m.ipHour {
		return &rateFailure{seconds: 60}
	}
	m.windows[recipient] = append(m.windows[recipient], now)
	m.windows[peer] = append(m.windows[peer], now)
	m.lastRecipient[recipient] = now
	expires := now.Add(24 * time.Hour)
	if exists {
		expires = prior.expires
	}
	m.attempts[key] = mailAttempt{fingerprint: fingerprint, expires: expires, pending: true}
	return nil
}

func (m *mailAdmission) complete(id string, outcome error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := sha256.Sum256([]byte(id))
	a, ok := m.attempts[key]
	if !ok {
		return
	}
	a.pending = false
	a.outcome = outcome
	var limited *rateFailure
	if errors.As(outcome, &limited) {
		a.retryAt = m.now().Add(time.Duration(limited.seconds) * time.Second)
	}
	m.attempts[key] = a
}
