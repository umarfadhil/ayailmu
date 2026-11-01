package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
)

func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("UMAR_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("run scripts/integration.sh for isolated Postgres")
	}
	r, _ := catalog.Load()
	s, e := Open(context.Background(), url, r)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(s.Close)
	if e = s.Migrate(context.Background()); e != nil {
		t.Fatal(e)
	}
	if e = s.Migrate(context.Background()); e != nil {
		t.Fatal("migration rerun", e)
	}
	return s
}
func setup(t *testing.T, s *Store) (string, Profile) {
	t.Helper()
	ctx := context.Background()
	a, e := s.Activate(ctx, "test-issuer", t.Name())
	if e != nil {
		t.Fatal(e)
	}
	p, e := s.CreateProfile(ctx, a, ProfileInput{ClientLearnerID: "lrn-native", Kind: "ADULT", Lang: "id", Synthetic: true})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Consent(ctx, a, p.ID, true, "synthetic-sync-v1"); e != nil {
		t.Fatal(e)
	}
	return a, p
}
func event(n int) string {
	return fmt.Sprintf(`{"answer_id":"ans-%d","learner_id":"lrn-native","item_id":"SYNTHETIC-UNKNOWN","track":"unknown-track","content_version":"test-1","rules_version":"test-1","app_version":"test","timestamp":"2026-10-18T10:00:00Z","local_date":"2026-10-18","session_id":"ses-1","lang":"id","pool":"PRACT","unit":"A","skills":[],"raw_response":"{\"kind\":\"choice\",\"option_id\":\"a\"}","auto_score":{},"outcome":"correct","first_attempt":true,"fresh_evidence":false,"review_status":"draft","synthetic":true,"item_type":"choose"}`, n)
}
func TestPostgresOwnershipConsentAndAtomicReplay(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, p := setup(t, s)
	other, e := s.Activate(ctx, "test-issuer", "other-"+t.Name())
	if e != nil {
		t.Fatal(e)
	}
	p2, e := s.CreateProfile(ctx, other, ProfileInput{ClientLearnerID: "lrn-native", Kind: "ADULT", Lang: "id", Synthetic: true})
	if e != nil {
		t.Fatal("same client id under other owner", e)
	}
	for _, fn := range []func() error{
		func() error { _, e := s.Pull(ctx, other, p.ID, 0, 10); return e }, func() error { _, e := s.Append(ctx, other, p.ID, []string{event(1)}); return e }, func() error { return s.Consent(ctx, other, p.ID, true, "synthetic-sync-v1") },
	} {
		if !errors.Is(fn(), ErrNotFound) {
			t.Fatal("ownership not enforced")
		}
	}
	if _, e = s.CreateProfile(ctx, other, ProfileInput{ClientLearnerID: "child", Kind: "ANAK", Lang: "id", CreatedBy: p.ID, Synthetic: true}); e == nil {
		t.Fatal("foreign guardian accepted")
	}
	child, e := s.CreateProfile(ctx, a, ProfileInput{ClientLearnerID: "child", Kind: "ANAK", Lang: "en", CreatedBy: p.ID, Synthetic: true})
	if e != nil || child.Audience != "kids" {
		t.Fatal(e)
	}
	if _, e = s.CreateProfile(ctx, a, ProfileInput{ClientLearnerID: "grandchild", Kind: "ANAK", Lang: "en", CreatedBy: child.ID, Synthetic: true}); e == nil {
		t.Fatal("child creator accepted")
	}
	if _, e = s.CreateProfile(ctx, a, ProfileInput{ClientLearnerID: "real", Kind: "ADULT", Lang: "id"}); e == nil {
		t.Fatal("real data accepted")
	}
	if _, e = s.CreateProfile(ctx, a, ProfileInput{ClientLearnerID: "lrn-native", Kind: "ADULT", Lang: "id", Synthetic: true}); e != nil {
		t.Fatal("profile replay", e)
	}
	if _, e = s.CreateProfile(ctx, a, ProfileInput{ClientLearnerID: "lrn-native", Kind: "ADULT", Lang: "en", Synthetic: true}); !errors.Is(e, ErrConflict) {
		t.Fatal("changed profile replay", e)
	}
	got, e := s.Append(ctx, a, p.ID, []string{event(1)})
	if e != nil || got[0].Sequence != 1 || got[0].Duplicate || got[0].RegistryStatus != "unregistered" {
		t.Fatal(got, e)
	}
	got, e = s.Append(ctx, a, p.ID, []string{event(1)})
	if e != nil || !got[0].Duplicate {
		t.Fatal(got, e)
	}
	if _, e = s.Append(ctx, a, p.ID, []string{event(2), strings.Replace(event(1), `"outcome":"correct"`, `"outcome":"wrong"`, 1)}); !errors.Is(e, ErrConflict) {
		t.Fatal("conflict not detected", e)
	}
	page, e := s.Pull(ctx, a, p.ID, 0, 100)
	if e != nil || len(page.Events) != 1 || page.Events[0].Payload != event(1) {
		t.Fatal("batch atomicity/byte preservation", page, e)
	}
	if _, e = s.Append(ctx, other, p2.ID, []string{event(1)}); !errors.Is(e, ErrConsent) {
		t.Fatal("opt-in required", e)
	}
	if e = s.Consent(ctx, a, p.ID, false, "synthetic-sync-v1"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Append(ctx, a, p.ID, []string{event(2)}); !errors.Is(e, ErrConsent) {
		t.Fatal("revocation upload", e)
	}
	if _, e = s.Pull(ctx, a, p.ID, 0, 10); !errors.Is(e, ErrConsent) {
		t.Fatal("revocation pull", e)
	}
	if e = s.Consent(ctx, a, p.ID, true, "arab-trial-1"); !errors.Is(e, ErrInvalid) {
		t.Fatal("trial consent reused", e)
	}
	if e = s.Consent(ctx, a, p.ID, true, "synthetic-sync-v1"); e != nil {
		t.Fatal(e)
	}
	// Database enforcement: immutability is not just an HTTP convention.
	if _, e = s.pool.Exec(ctx, "UPDATE answer_events SET payload=payload WHERE learner_id=$1", p.ID); e == nil {
		t.Fatal("SQL event mutation allowed")
	}
	if _, e = s.pool.Exec(ctx, "DELETE FROM answer_events WHERE learner_id=$1", p.ID); e == nil {
		t.Fatal("SQL event deletion allowed")
	}
	if _, e = s.pool.Exec(ctx, "UPDATE sync_consents SET granted=false WHERE learner_id=$1", p.ID); e == nil {
		t.Fatal("consent history mutable")
	}
}
func TestPostgresConcurrentCursorAndDuplicate(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, p := setup(t, s)
	var wg sync.WaitGroup
	errs := make(chan error, 40)
	for n := 0; n < 30; n++ {
		wg.Add(1)
		go func(n int) { defer wg.Done(); _, e := s.Append(ctx, a, p.ID, []string{event(n)}); errs <- e }(n)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	page, e := s.Pull(ctx, a, p.ID, 0, 7)
	if e != nil || !page.HasMore || page.NextCursor != 7 {
		t.Fatal(page, e)
	}
	all := page.Events
	for page.HasMore {
		page, e = s.Pull(ctx, a, p.ID, page.NextCursor, 7)
		if e != nil {
			t.Fatal(e)
		}
		all = append(all, page.Events...)
	}
	if len(all) != 30 {
		t.Fatal(len(all))
	}
	for i, e := range all {
		if e.Sequence != int64(i+1) {
			t.Fatal("cursor gap", e)
		}
	}
	var valid map[string]any
	if e = json.Unmarshal([]byte(all[0].Payload), &valid); e != nil {
		t.Fatal(e)
	}
}

func TestRejectImplicitDatabaseTarget(t *testing.T) {
	r, _ := catalog.Load()
	s, err := Open(context.Background(), "", r)
	if err == nil {
		s.Close()
		t.Fatal("empty database URL must not fall back to another local database")
	}
}
func TestPostgresConcurrentSameAnswerAndWithdrawal(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, p := setup(t, s)
	var wg sync.WaitGroup
	results := make(chan []Receipt, 12)
	errs := make(chan error, 12)
	for n := 0; n < 12; n++ {
		wg.Add(1)
		go func() { defer wg.Done(); r, e := s.Append(ctx, a, p.ID, []string{event(1)}); results <- r; errs <- e }()
	}
	wg.Wait()
	close(results)
	close(errs)
	for e := range errs {
		if e != nil {
			t.Fatal(e)
		}
	}
	newCount := 0
	for r := range results {
		if len(r) != 1 || r[0].Sequence != 1 {
			t.Fatal(r)
		}
		if !r[0].Duplicate {
			newCount++
		}
	}
	if newCount != 1 {
		t.Fatal("replay inserted multiple events", newCount)
	}
	tx, e := s.pool.Begin(ctx)
	if e != nil {
		t.Fatal(e)
	}
	defer tx.Rollback(ctx)
	if _, _, e = owned(ctx, tx, a, p.ID); e != nil {
		t.Fatal(e)
	}
	pending := make(chan error, 1)
	go func() { _, e := s.Append(ctx, a, p.ID, []string{event(2)}); pending <- e }()
	if _, e = tx.Exec(ctx, `INSERT INTO sync_consents(learner_id,owner_id,purpose,version,granted) VALUES($1,$2,'synthetic-offline-sync','synthetic-sync-v1',false)`, p.ID, a); e != nil {
		t.Fatal(e)
	}
	if e = tx.Commit(ctx); e != nil {
		t.Fatal(e)
	}
	if e = <-pending; !errors.Is(e, ErrConsent) {
		t.Fatal("queued upload bypassed withdrawal", e)
	}
}

func TestPostgresEveryCatalogActivityAndProvenance(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	a, adult := setup(t, s)
	child, e := s.CreateProfile(ctx, a, ProfileInput{ClientLearnerID: "lrn-child", Kind: "ANAK", Lang: "id", CreatedBy: adult.ID, Synthetic: true})
	if e != nil {
		t.Fatal(e)
	}
	if e = s.Consent(ctx, a, child.ID, true, "synthetic-sync-v1"); e != nil {
		t.Fatal(e)
	}
	responses := map[string]string{
		"choose": `{"kind":"choice","option_id":"a"}`, "pick_image": `{"kind":"choice","option_id":"a"}`, "true_false": `{"kind":"choice","option_id":"a"}`, "audio_match": `{"kind":"choice","option_id":"a","audio_status":"played"}`, "story_choice": `{"kind":"choice","option_id":"a"}`, "tap_hotspot": `{"kind":"choice","option_id":"a"}`, "daily_puzzle": `{"kind":"number","value":1}`,
		"type_in": `{"kind":"typed","text":"synthetic example"}`, "number_input": `{"kind":"number","value":1}`, "estimate_slider": `{"kind":"number","value":1}`,
		"fill_blank": `{"kind":"sequence","sequence":["a"]}`, "tiles": `{"kind":"sequence","sequence":["a"]}`, "order": `{"kind":"sequence","sequence":["a"]}`, "trace": `{"kind":"sequence","sequence":["1","2"]}`,
		"match_pairs": `{"kind":"pairs","pairs":[{"left":"a","right":"b"}]}`, "sort_buckets": `{"kind":"pairs","pairs":[{"left":"a","right":"b"}]}`, "memory_flip": `{"kind":"pairs","pairs":[{"left":"a","right":"b"}]}`,
		"info_card": `{"kind":"choice","option_id":"seen"}`, "mini_reading": `{"kind":"choice","option_id":"seen"}`, "story": `{"kind":"choice","option_id":"seen"}`,
	}
	seen := map[string]bool{}
	for _, pack := range s.registry.Packs {
		for itemID, item := range pack.Items {
			if seen[item.Type] {
				continue
			}
			seen[item.Type] = true
			t.Run(item.Type, func(t *testing.T) {
				p := adult
				if pack.Audiences[0] == "kids" {
					p = child
				}
				var m map[string]any
				json.Unmarshal([]byte(event(len(seen)+100)), &m)
				m["learner_id"] = p.ClientLearnerID
				m["item_id"] = itemID
				m["track"] = pack.Track
				m["content_version"] = pack.ContentVersion
				m["rules_version"] = pack.RulesVersion
				m["lang"] = pack.InstructionLangs[0]
				m["unit"] = item.Unit
				m["pool"] = item.Pool
				m["review_status"] = item.ReviewStatus
				m["item_type"] = item.Type
				m["raw_response"] = responses[item.Type]
				if item.Type == "story" || item.Type == "info_card" || item.Type == "mini_reading" {
					m["outcome"] = "not_assessed"
				}
				raw, _ := json.Marshal(m)
				rs, e := s.Append(ctx, a, p.ID, []string{string(raw)})
				if e != nil || len(rs) != 1 || rs[0].RegistryStatus != "registered" {
					t.Fatal(rs, e)
				}
				m["answer_id"] = m["answer_id"].(string) + "-bad"
				m["unit"] = "wrong-unit"
				raw, _ = json.Marshal(m)
				if _, e = s.Append(ctx, a, p.ID, []string{string(raw)}); !errors.Is(e, ErrInvalid) {
					t.Fatal("registered metadata mismatch accepted", e)
				}
			})
		}
	}
	if len(seen) != 20 {
		t.Fatal("catalog type coverage drift", len(seen))
	}
}
