package generalingress

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
)

var ErrBudget = errors.New("mail budget unavailable")
var ErrReplay = errors.New("mail request already reserved")
var ErrStorage = errors.New("durable mail accounting unavailable")
var opaqueKey = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,79}$`)

type BudgetPolicy struct {
	Simulation                    bool
	Scope                         string
	Deadline                      time.Time
	Global, RecipientHour, IPHour int
	Cooldown                      time.Duration
	IdentityBinding               string
}
type journal interface {
	locked(context.Context, func() error) error
	initialize([]byte) error
	read() ([]byte, error)
	commit([]byte) error
}
type Budget struct {
	runtime     bool
	policy      BudgetPolicy
	disk        journal
	fingerprint string
}
type reservation struct {
	Operation, Recipient, IP string
	At                       int64
}
type budgetState struct {
	Version      int
	Policy       string
	LastWall     int64
	Reservations []reservation
}
type budgetEnvelope struct {
	SHA256 string
	Data   json.RawMessage
}

func NewBudget(p BudgetPolicy, d journal) (*Budget, error) {
	if d == nil {
		return nil, ErrStorage
	}
	raw, _ := json.Marshal(p)
	sum := sha256.Sum256(raw)
	return &Budget{policy: p, disk: d, fingerprint: hex.EncodeToString(sum[:])}, nil
}
func (b *Budget) valid(now time.Time) bool {
	lifetimeOK := !b.runtime && now.Before(b.policy.Deadline) || b.runtime && b.policy.Deadline.IsZero()
	return (b.policy.Simulation || b.runtime) && lifetimeOK && opaqueKey.MatchString(b.policy.Scope) && opaqueKey.MatchString(b.policy.IdentityBinding) && now.UnixNano() > 0 && b.policy.Global > 0 && b.policy.Global <= 10000 && b.policy.RecipientHour > 0 && b.policy.IPHour > 0 && b.policy.Cooldown >= time.Second
}
func (b *Budget) retention() time.Duration {
	d := 48 * time.Hour
	if b.policy.Cooldown > d {
		d = b.policy.Cooldown
	}
	return d
}
func (b *Budget) maxStoredReservations() int {
	if !b.runtime {
		return b.policy.Global
	}
	return (int(b.retention()/(24*time.Hour)) + 2) * b.policy.Global
}
func encodeBudget(s budgetState) ([]byte, error) {
	raw, err := json.Marshal(s)
	if err != nil {
		return nil, ErrStorage
	}
	sum := sha256.Sum256(raw)
	return json.Marshal(budgetEnvelope{hex.EncodeToString(sum[:]), raw})
}
func decodeBudget(raw []byte) (budgetState, error) {
	var envelope budgetEnvelope
	var state budgetState
	if native.ValidateDocument(raw) != nil || json.Unmarshal(raw, &envelope) != nil {
		return state, ErrStorage
	}
	sum := sha256.Sum256(envelope.Data)
	if envelope.SHA256 != hex.EncodeToString(sum[:]) || json.Unmarshal(envelope.Data, &state) != nil || state.Version != 1 || state.Reservations == nil || state.LastWall <= 0 {
		return state, ErrStorage
	}
	return state, nil
}
func (b *Budget) Initialize(ctx context.Context, now time.Time) error {
	if !b.valid(now) || !b.runtime && b.policy.Deadline.Sub(now) > 24*time.Hour {
		return ErrStorage
	}
	return b.disk.locked(ctx, func() error {
		raw, err := encodeBudget(budgetState{Version: 1, Policy: b.fingerprint, LastWall: now.UnixNano(), Reservations: []reservation{}})
		if err != nil {
			return err
		}
		return b.disk.initialize(raw)
	})
}

// Reserve commits before any provider callback. Simulation keeps its fixed
// allocation. Ordinary operation has a rolling 24h cost cap and >=48h replay
// retention; unknown sends are charged, never automatically retried/refunded.
func (b *Budget) Reserve(ctx context.Context, operation, recipient, ip string, now time.Time) error {
	if !b.valid(now) || !opaqueKey.MatchString(operation) || !opaqueKey.MatchString(recipient) || !opaqueKey.MatchString(ip) {
		return ErrStorage
	}
	return b.disk.locked(ctx, func() error {
		raw, err := b.disk.read()
		if err != nil {
			return ErrStorage
		}
		s, err := decodeBudget(raw)
		if err != nil || s.Policy != b.fingerprint || now.UnixNano() < s.LastWall || len(s.Reservations) > b.maxStoredReservations() {
			return ErrStorage
		}
		operationHash := sha256.Sum256([]byte(operation))
		op := hex.EncodeToString(operationHash[:])
		nr, ni, global := 0, 0, 0
		kept := make([]reservation, 0, len(s.Reservations)+1)
		for _, r := range s.Reservations {
			decoded, err := hex.DecodeString(r.Operation)
			if err != nil || len(decoded) != 32 || r.At <= 0 || r.At > s.LastWall {
				return ErrStorage
			}
			at := time.Unix(0, r.At)
			if at.After(now) || !opaqueKey.MatchString(r.Recipient) || !opaqueKey.MatchString(r.IP) {
				return ErrStorage
			}
			if b.runtime && now.Sub(at) >= b.retention() {
				continue
			}
			kept = append(kept, r)
			if r.Operation == op {
				return ErrReplay
			}
			if !b.runtime || now.Sub(at) < 24*time.Hour {
				global++
			}
			if r.Recipient == recipient {
				if now.Sub(at) < b.policy.Cooldown {
					return ErrBudget
				}
				if now.Sub(at) < time.Hour {
					nr++
				}
			}
			if r.IP == ip && now.Sub(at) < time.Hour {
				ni++
			}
		}
		if global >= b.policy.Global || nr >= b.policy.RecipientHour || ni >= b.policy.IPHour {
			return ErrBudget
		}
		s.LastWall = now.UnixNano()
		s.Reservations = append(kept, reservation{op, recipient, ip, now.UnixNano()})
		updated, err := encodeBudget(s)
		if err != nil {
			return ErrStorage
		}
		if b.disk.commit(updated) != nil {
			return ErrStorage
		}
		return nil
	})
}
