package generalingress

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func budgetPolicy() BudgetPolicy {
	return BudgetPolicy{Simulation: true, Scope: "fixture-only", Deadline: time.Unix(1800003600, 0), Global: 2, RecipientHour: 2, IPHour: 2, Cooldown: time.Minute, IdentityBinding: "fixture-binding"}
}
func newBudget(t *testing.T) (*FileJournal, *Budget) {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "mail-journal")
	disk, err := NewFileJournal(dir)
	if err != nil {
		t.Fatal(err)
	}
	b, err := NewBudget(budgetPolicy(), disk)
	if err != nil {
		t.Fatal(err)
	}
	if err = b.Initialize(context.Background(), time.Unix(1800000000, 0)); err != nil {
		t.Fatal(err)
	}
	return disk, b
}

func TestDurableReservationSurvivesRestartAndAmbiguousSend(t *testing.T) {
	d, b := newBudget(t)
	ctx := context.Background()
	now := time.Unix(1800000000, 0)
	if err := b.Reserve(ctx, "operation-a", "recipient-a", "ip-a", now); err != nil {
		t.Fatal(err)
	}
	restarted, err := NewBudget(budgetPolicy(), d)
	if err != nil {
		t.Fatal(err)
	}
	if err = restarted.Reserve(ctx, "operation-a", "recipient-a", "ip-a", now.Add(time.Minute)); !errors.Is(err, ErrReplay) {
		t.Fatal("restart re-sent uncertain request")
	}
	if err = restarted.Reserve(ctx, "operation-b", "recipient-b", "ip-b", now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if err = restarted.Reserve(ctx, "operation-c", "recipient-c", "ip-c", now.Add(2*time.Minute)); !errors.Is(err, ErrBudget) {
		t.Fatal("restart lost global accounting")
	}
	if err = restarted.Initialize(ctx, now); err == nil {
		t.Fatal("existing ledger reset")
	}
}

func TestMissingCorruptOrPolicyChangedLedgerFailsClosed(t *testing.T) {
	for _, mode := range []string{"missing", "corrupt", "policy", "clock", "expiry"} {
		t.Run(mode, func(t *testing.T) {
			d, b := newBudget(t)
			ctx := context.Background()
			now := time.Unix(1800000000, 0)
			if err := b.Reserve(ctx, "operation-a", "recipient-a", "ip-a", now); err != nil {
				t.Fatal(err)
			}
			p := budgetPolicy()
			switch mode {
			case "missing":
				if err := os.Remove(filepath.Join(d.dir, "state.json")); err != nil {
					t.Fatal(err)
				}
			case "corrupt":
				if err := os.WriteFile(filepath.Join(d.dir, "state.json"), []byte("partial"), 0600); err != nil {
					t.Fatal(err)
				}
			case "policy":
				p.Global = 100
			case "clock":
				now = now.Add(-time.Second)
			case "expiry":
				now = p.Deadline
			}
			other, err := NewBudget(p, d)
			if err != nil {
				t.Fatal(err)
			}
			if err = other.Reserve(ctx, "operation-b", "recipient-b", "ip-b", now); err == nil {
				t.Fatal("unsafe storage/policy accepted")
			}
		})
	}
}
