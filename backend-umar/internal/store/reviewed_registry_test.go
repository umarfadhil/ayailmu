package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
)

func inactiveRegistry(t *testing.T) *catalog.Registry {
	t.Helper()
	b, err := os.ReadFile("../../candidates/reviewed-math/finalized-registry.json")
	if err != nil {
		t.Fatal(err)
	}
	var r catalog.Registry
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	if r.SourceCommit != "b6e0d6123cb359436f83ce3ae0685198ee13a815" || len(r.Packs) != 1 {
		t.Fatal("reviewed registry source binding changed")
	}
	return &r
}

func inactiveProfile() Profile {
	return Profile{ID: "20000000-0000-0000-0000-000000000001", ClientLearnerID: "same-native-id", Kind: "ADULT", Audience: "adults", Lang: "id", Synthetic: false}
}

func inactiveEvents(t *testing.T) []native.Event {
	t.Helper()
	b, err := os.ReadFile("../../../android/content/src/reviewed/assets/packs/matematika/mat-a-local/v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var client struct {
		Items []struct {
			ID      string   `json:"item_id"`
			Type    string   `json:"type"`
			Unit    string   `json:"unit"`
			Pool    string   `json:"pool"`
			Skills  []string `json:"skills"`
			Gem     bool     `json:"gem"`
			Numeric struct {
				Value float64 `json:"value"`
			} `json:"numeric"`
			Options []struct {
				ID      string `json:"id"`
				Correct bool   `json:"correct"`
			} `json:"options"`
			Solution []string          `json:"solution"`
			Pairs    map[string]string `json:"solution_pairs"`
		} `json:"items"`
	}
	if err = json.Unmarshal(b, &client); err != nil {
		t.Fatal(err)
	}
	out := make([]native.Event, 0, len(client.Items))
	for _, item := range client.Items {
		response := map[string]any{}
		switch item.Type {
		case "number_input", "estimate_slider":
			value := item.Numeric.Value
			if item.ID == "MAT-A-P-01-002" {
				value = 85000
			} // reachable slider value, checked by Android tests
			response = map[string]any{"kind": "number", "value": value}
		case "choose", "true_false":
			for _, option := range item.Options {
				if option.Correct {
					response = map[string]any{"kind": "choice", "option_id": option.ID}
				}
			}
		case "tiles", "fill_blank":
			response = map[string]any{"kind": "sequence", "sequence": item.Solution}
		case "match_pairs":
			pairs := []native.Pair{}
			for left, right := range item.Pairs {
				pairs = append(pairs, native.Pair{Left: left, Right: right})
			}
			response = map[string]any{"kind": "pairs", "pairs": pairs}
		case "info_card":
			response = map[string]any{"kind": "choice", "option_id": "seen"}
		default:
			t.Fatalf("unexpected reviewed type %s", item.Type)
		}
		raw, _ := json.Marshal(response)
		first, fresh, outcome := true, !item.Gem, "correct"
		if item.Gem {
			outcome = "not_assessed"
		}
		e := native.Event{AnswerID: "answer-" + item.ID, LearnerID: "same-native-id", ItemID: item.ID, Track: "mat-a-local", ContentVersion: "mat-a-local-pemula-0.3", RulesVersion: "casual-local-0.1", AppVersion: "offline-contract-test", Timestamp: "2026-10-30T00:00:00Z", LocalDate: "2026-10-30", SessionID: "session-local", Lang: "id", Pool: item.Pool, Unit: item.Unit, Skills: item.Skills, RawResponse: string(raw), AutoScore: map[string]string{}, Outcome: outcome, FirstAttempt: &first, FreshEvidence: &fresh, ReviewStatus: "approved", Synthetic: false, ItemType: item.Type, Gem: item.Gem}
		e.ErrorTags = []string{}
		e.HelpLinesShown = []string{}
		data, _ := json.Marshal(e)
		parsed, err := native.ParseForMode(data, false, false)
		if err != nil {
			t.Fatalf("native contract %s: %v", item.ID, err)
		}
		out = append(out, parsed)
	}
	return out
}

func TestInactiveRegistryAcceptsOnlyMatchingReviewedEvents(t *testing.T) {
	s := &Store{registry: inactiveRegistry(t)}
	p := inactiveProfile()
	events := inactiveEvents(t)
	if len(events) != 14 {
		t.Fatal("client event fixture drift")
	}
	for _, e := range events {
		t.Run(e.ItemID, func(t *testing.T) {
			if status, err := s.registration(e, p); err != nil || status != "registered" {
				t.Fatal(status, err)
			}
		})
	}
	for name, mutate := range map[string]func(*native.Event){
		"foreign-native-learner": func(e *native.Event) { e.LearnerID = "another-native-id" },
		"unknown-item":           func(e *native.Event) { e.ItemID = "not-reviewed" },
		"wrong-content-version":  func(e *native.Event) { e.ContentVersion = "another-version" },
		"wrong-rules":            func(e *native.Event) { e.RulesVersion = "another-rules" },
		"wrong-type":             func(e *native.Event) { e.ItemType = "story" },
		"wrong-unit":             func(e *native.Event) { e.Unit = "02" },
		"wrong-pool":             func(e *native.Event) { e.Pool = "SPARE" },
		"draft":                  func(e *native.Event) { e.ReviewStatus = "draft" },
	} {
		t.Run(name, func(t *testing.T) {
			e := events[0]
			mutate(&e)
			if _, err := s.registration(e, p); !errors.Is(err, ErrInvalid) {
				t.Fatalf("accepted mismatched reference: %v", err)
			}
		})
	}
	child := p
	child.Audience = "kids"
	if _, err := s.registration(events[0], child); !errors.Is(err, ErrInvalid) {
		t.Fatal("adult pack accepted for child")
	}
}

type ownershipMockTx struct {
	pgx.Tx
	rows map[string]ownedFixture
}
type ownedFixture struct {
	owner   string
	profile Profile
}
type ownershipMockRow struct {
	fixture ownedFixture
	err     error
}

func (r ownershipMockRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	p := r.fixture.profile
	*(dest[0].(*string)) = p.ID
	*(dest[1].(*string)) = p.ClientLearnerID
	*(dest[2].(*string)) = p.Kind
	*(dest[3].(*string)) = p.Audience
	*(dest[4].(*string)) = p.Lang
	*(dest[5].(*string)) = p.CreatedBy
	*(dest[6].(*bool)) = p.Synthetic
	*(dest[7].(*int64)) = 0
	return nil
}
func (m ownershipMockTx) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	if len(args) != 2 || !strings.Contains(strings.Join(strings.Fields(sql), " "), "WHERE id=$1 AND owner_id=$2 FOR UPDATE") {
		return ownershipMockRow{err: errors.New("ownership predicate/parameter contract changed")}
	}
	id, owner := args[0].(string), args[1].(string)
	f, ok := m.rows[id]
	if !ok || f.owner != owner {
		return ownershipMockRow{err: pgx.ErrNoRows}
	}
	return ownershipMockRow{fixture: f}
}

func TestInactiveRegistryOwnerUUIDIsolationWithMockRows(t *testing.T) {
	a, b := "10000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000002"
	pa, pb := inactiveProfile(), inactiveProfile()
	pb.ID = "20000000-0000-0000-0000-000000000002"
	tx := ownershipMockTx{rows: map[string]ownedFixture{pa.ID: {a, pa}, pb.ID: {b, pb}}}
	for _, tc := range []struct {
		owner, id string
		allowed   bool
	}{{a, pa.ID, true}, {b, pb.ID, true}, {a, pb.ID, false}, {b, pa.ID, false}, {"10000000-0000-0000-0000-000000000003", pa.ID, false}, {a, "bad-id", false}} {
		got, _, err := owned(context.Background(), tx, tc.owner, tc.id)
		if tc.allowed {
			if err != nil || got.ID != tc.id || got.ClientLearnerID != "same-native-id" {
				t.Fatal(got, err)
			}
		} else if !errors.Is(err, ErrNotFound) {
			t.Fatalf("cross-account reference accepted: %v", err)
		}
	}
}
