package generalingress

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type failingJournal struct {
	journal
	after bool
}

func (f failingJournal) commit(raw []byte) error {
	if f.after {
		if err := f.journal.commit(raw); err != nil {
			return err
		}
	}
	return ErrStorage
}

func TestDurableCommitFailureNeverForwardsAndDoesNotRefund(t *testing.T) {
	for _, after := range []bool{false, true} {
		t.Run(strconv.FormatBool(after), func(t *testing.T) {
			p, _, rt, _, _ := adapterFixture(t)
			healthy := p.budget
			fault, err := NewBudget(budgetPolicy(), failingJournal{healthy.disk, after})
			if err != nil {
				t.Fatal(err)
			}
			p.budget = fault
			in := MailRequest{Action: "recover", Email: "first@example.invalid", RequestID: "fault-op", Peer: "192.0.2.1"}
			if err = p.Mail(context.Background(), in); err == nil || rt.calls != 0 {
				t.Fatal("storage failure forwarded mail")
			}
			p.budget = healthy
			err = p.Mail(context.Background(), in)
			if after {
				if !errors.Is(err, ErrReplay) || rt.calls != 0 {
					t.Fatal("possibly committed reservation refunded")
				}
			} else if err != nil || rt.calls != 1 {
				t.Fatal("known-uncommitted recovery failed")
			}
		})
	}
}

func TestDurableUnknownProviderOutcomeAndNoPIIInJournal(t *testing.T) {
	p, _, rt, _, _ := adapterFixture(t)
	rt.call = func(*http.Request) (*http.Response, error) { return nil, errors.New("lost provider response") }
	in := MailRequest{Action: "signup", Email: "first@example.invalid", Password: "synthetic-password-123", RequestID: "unknown-op", Peer: "192.0.2.1"}
	if err := p.Mail(context.Background(), in); err == nil {
		t.Fatal("unknown send falsely successful")
	}
	if err := p.Mail(context.Background(), in); !errors.Is(err, ErrReplay) || rt.calls != 1 {
		t.Fatal("unknown send repeated")
	}
	raw, err := p.budget.disk.read()
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{in.Email, in.Password, in.Peer, in.RequestID} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatal("PII/credential/raw operation leaked to ledger")
		}
	}
}

func TestDurableConcurrentReservationsShareOneCeiling(t *testing.T) {
	d, b := newBudget(t)
	var wg sync.WaitGroup
	results := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			other, _ := NewBudget(budgetPolicy(), d)
			results <- other.Reserve(context.Background(), "op-"+strconv.Itoa(n), "recipient-"+strconv.Itoa(n), "ip-"+strconv.Itoa(n), time.Unix(1800000000, 0))
		}(i)
	}
	wg.Wait()
	close(results)
	ok := 0
	for err := range results {
		if err == nil {
			ok++
		} else if !errors.Is(err, ErrBudget) {
			t.Fatal(err)
		}
	}
	if ok != 2 {
		t.Fatal("non-atomic global budget", ok)
	}
	if err := b.Reserve(context.Background(), "extra-op", "extra-recipient", "extra-ip", time.Unix(1800000000, 0)); !errors.Is(err, ErrBudget) {
		t.Fatal("ceiling lost")
	}
}

func TestBudgetSubprocessHelper(t *testing.T) {
	if os.Getenv("AYAILMU_JOURNAL_HELPER") != "1" {
		t.Skip("owned subprocess helper")
	}
	d, err := NewFileJournal(os.Getenv("AYAILMU_JOURNAL_DIR"))
	if err != nil {
		os.Exit(11)
	}
	b, err := NewBudget(budgetPolicy(), d)
	if err != nil {
		os.Exit(11)
	}
	id := os.Getenv("AYAILMU_JOURNAL_ID")
	err = b.Reserve(context.Background(), "child-"+id, "recipient-"+id, "ip-"+id, time.Unix(1800000000, 0))
	if errors.Is(err, ErrBudget) {
		os.Exit(10)
	}
	if err != nil {
		os.Exit(11)
	}
	if os.Getenv("AYAILMU_JOURNAL_CRASH") == "1" {
		os.Exit(73)
	}
	os.Exit(0)
}
func child(t *testing.T, dir, id string, crash bool) *exec.Cmd {
	t.Helper()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, exe, "-test.run=^TestBudgetSubprocessHelper$")
	cmd.Env = []string{"AYAILMU_JOURNAL_HELPER=1", "AYAILMU_JOURNAL_DIR=" + dir, "AYAILMU_JOURNAL_ID=" + id}
	if crash {
		cmd.Env = append(cmd.Env, "AYAILMU_JOURNAL_CRASH=1")
	}
	return cmd
}
func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var e *exec.ExitError
	if errors.As(err, &e) {
		return e.ExitCode()
	}
	return -1
}

func TestDurableCrossProcessLockAndProcessLoss(t *testing.T) {
	d, b := newBudget(t)
	commands := []*exec.Cmd{}
	for i := 0; i < 4; i++ {
		cmd := child(t, d.dir, strconv.Itoa(i), false)
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		commands = append(commands, cmd)
	}
	ok, limited := 0, 0
	for _, cmd := range commands {
		switch code := exitCode(cmd.Wait()); code {
		case 0:
			ok++
		case 10:
			limited++
		default:
			t.Fatal("owned child failure", code)
		}
	}
	if ok != 2 || limited != 2 {
		t.Fatal("cross-process ceiling failed", ok, limited)
	}
	d, b = newBudget(t)
	if code := exitCode(child(t, d.dir, "crash", true).Run()); code != 73 {
		t.Fatal("crash fixture failed", code)
	}
	if err := b.Reserve(context.Background(), "child-crash", "recipient-crash", "ip-crash", time.Unix(1800000000, 0)); !errors.Is(err, ErrReplay) {
		t.Fatal("process loss refunded reservation")
	}
	if err := b.Reserve(context.Background(), "after-crash", "recipient-b", "ip-b", time.Unix(1800000000, 0)); err != nil {
		t.Fatal("kernel did not release owned child lock", err)
	}
}

func TestJournalPermissionsSymlinksAndPartialInitializationFailClosed(t *testing.T) {
	for _, mode := range []string{"symlink-state", "symlink-lock", "permissions", "partial-init"} {
		t.Run(mode, func(t *testing.T) {
			d, b := newBudget(t)
			path := filepath.Join(d.dir, "state.json")
			switch mode {
			case "symlink-state":
				os.Rename(path, path+".old")
				if err := os.Symlink(path+".old", path); err != nil {
					t.Fatal(err)
				}
			case "symlink-lock":
				os.Remove(filepath.Join(d.dir, ".lock"))
				if err := os.Symlink(path, filepath.Join(d.dir, ".lock")); err != nil {
					t.Fatal(err)
				}
			case "permissions":
				os.Chmod(path, 0644)
			case "partial-init":
				os.Remove(path)
			}
			if err := b.Reserve(context.Background(), "bad-op", "recipient-a", "ip-a", time.Unix(1800000000, 0)); err == nil {
				t.Fatal("unsafe journal used")
			}
			if mode == "partial-init" && b.Initialize(context.Background(), time.Unix(1800000000, 0)) == nil {
				t.Fatal("partial init automatically reset")
			}
		})
	}
}

func TestStructurallyInvalidButChecksummedLedgerIsRejected(t *testing.T) {
	for _, mode := range []string{"zero-clock", "invalid-operation", "duplicate-envelope"} {
		t.Run(mode, func(t *testing.T) {
			d, b := newBudget(t)
			s := budgetState{Version: 1, Policy: b.fingerprint, LastWall: 1800000000000000000, Reservations: []reservation{}}
			if mode == "zero-clock" {
				s.LastWall = 0
			}
			if mode == "invalid-operation" {
				s.Reservations = append(s.Reservations, reservation{Operation: "not-a-hash", Recipient: "recipient-a", IP: "ip-a", At: 1800000000000000000})
			}
			raw, _ := encodeBudget(s)
			if mode == "duplicate-envelope" {
				raw = append([]byte(`{"SHA256":"ignored",`), raw[1:]...)
			}
			if err := os.WriteFile(filepath.Join(d.dir, "state.json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			if err := b.Reserve(context.Background(), "new-op", "recipient-b", "ip-b", time.Unix(1800000000, 0)); !errors.Is(err, ErrStorage) {
				t.Fatal("structural corruption was accepted")
			}
		})
	}
}
