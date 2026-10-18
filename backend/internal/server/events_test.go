package server_test

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
	"ayailmu.local/backend/internal/server"
)

func TestEventsAreImmutableLosslessAndQuarantined(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	expo := sourceRef{App: "expo", InstallID: "inst-e-1", LocalProfileID: "lrn-e-1"}
	droid := sourceRef{App: "android", InstallID: "inst-e-2", LocalProfileID: "prf-e-1"}
	pid := s.seedProfile(t, u, expo, droid)
	events := "/v1/profiles/" + pid + "/events"
	ex := func(id string) answer { return answer{id: id, learner: expo.LocalProfileID, install: expo.InstallID} }
	kept := map[string][]byte{} // event ID → the envelope whose copy the server must keep

	e1 := ex("ans-e-1").envelope()
	k1 := answer{kotlin: true, id: "ans-e-k1", learner: droid.LocalProfileID, install: droid.InstallID}.envelope()
	unshipped := ex("ans-e-u1")
	unshipped.content = "demo-synthetic-0.9"
	u1 := unshipped.envelope()
	var original []result

	for _, st := range []struct {
		name string
		fn   func(t *testing.T)
	}{
		{"new events are stored in order with receipts and curriculum status", func(t *testing.T) {
			res := s.upload(t, u.token, pid, e1, k1, u1)
			for i, r := range res.Results {
				if r.Index != i || r.Result != "stored" || r.Status != http.StatusCreated || r.Seq != int64(i+1) ||
					!sha256RE.MatchString(r.SemanticSHA256) || !isRFC3339(r.ReceivedAt) || r.ClockFlags == nil || len(r.ClockFlags) != 0 {
					t.Fatalf("result %d = %+v", i, r)
				}
			}
			statuses := []string{res.Results[0].CurriculumStatus, res.Results[1].CurriculumStatus, res.Results[2].CurriculumStatus}
			if !slices.Equal(statuses, []string{envelope.StatusRegistered, envelope.StatusRegistered, envelope.StatusUnregistered}) || res.HighSeq != 3 {
				t.Fatalf("curriculum statuses %v, high_seq %d; want the unshipped version quarantined as unregistered", statuses, res.HighSeq)
			}
			original = res.Results
			kept["ans-e-1"], kept["ans-e-k1"], kept["ans-e-u1"] = e1, k1, u1
		}},
		{"identical retries return the original receipts, whatever the spelling or sending app version", func(t *testing.T) {
			upgraded := swap(t, e1, `"app_version":"0.3.0","local_profile_id"`, `"app_version":"0.4.0","local_profile_id"`)
			respelled := swap(t, reformat(t, e1), "sahabat", `sahabat`)
			res := s.upload(t, u.token, pid, e1, k1, upgraded, respelled)
			for i, r := range res.Results {
				want := original[0]
				if i == 1 {
					want = original[1]
				}
				if r.Result != "identical" || r.Status != http.StatusOK || r.Seq != want.Seq || r.ReceivedAt != want.ReceivedAt || r.SemanticSHA256 != want.SemanticSHA256 {
					t.Fatalf("retry %d = %+v, want the original receipt %+v", i, r, want)
				}
			}
			if res.HighSeq != 3 {
				t.Fatalf("high_seq = %d after retries, want 3", res.HighSeq)
			}
		}},
		{"changed content under a stored ID is a 409 and the stored copy is untouched", func(t *testing.T) {
			changed := swap(t, e1, `"time_on_item_ms":5300`, `"time_on_item_ms":5301`)
			r := s.upload(t, u.token, pid, changed).Results[0]
			if r.Result != "conflict" || r.Status != http.StatusConflict || r.Code != "event_conflict" || r.Seq != 1 ||
				r.StoredSHA256 != original[0].SemanticSHA256 || !sha256RE.MatchString(r.ReceivedSHA256) || r.ReceivedSHA256 == r.StoredSHA256 {
				t.Fatalf("conflict = %+v", r)
			}
			if pg := s.pull(t, u.token, pid, "after=0&limit=1"); len(pg.Events) != 1 || !bytes.Equal(pg.Events[0].Payload, payloadOf(t, e1)) {
				t.Fatal("the stored copy changed")
			}
		}},
		{"invalid events are refused one by one while the rest are stored", func(t *testing.T) {
			e2 := ex("ans-e-2").envelope()
			badUnit := swap(t, ex("ans-e-3").envelope(), `"unit":"A"`, `"unit":"C"`)
			webTrial := swap(t, ex("ans-e-4").envelope(), `"family":"expo-trial-arabic"`, `"family":"web-trial"`)
			res := s.upload(t, u.token, pid, e2, badUnit, webTrial)
			if r := res.Results[0]; r.Status != http.StatusCreated || r.Seq != 4 {
				t.Fatalf("valid event = %+v, want stored as seq 4", r)
			}
			for i, code := range map[int]string{1: envelope.CodeInvalidPayload, 2: envelope.CodeUnknownFamily} {
				if r := res.Results[i]; r.Index != i || r.Result != "invalid" || r.Status != http.StatusUnprocessableEntity || r.Code != code || r.Seq != 0 {
					t.Fatalf("result %d = %+v, want 422 %s", i, r, code)
				}
			}
			if res.HighSeq != 4 {
				t.Fatalf("high_seq = %d, want 4", res.HighSeq)
			}
			kept["ans-e-2"] = e2
		}},
		{"NUL is refused in indexed metadata but kept inside the opaque payload", func(t *testing.T) {
			nulSource := swap(t, ex("ans-e-n1").envelope(), `"install_id":"inst-e-1"`, `"install_id":"inst-e-1\u0000x"`)
			version := ex("ans-e-n2")
			version.content = `demo-synthetic-0.3\u0000`
			opaque := ex("ans-e-o1")
			opaque.extra = `,"note":"a\u0000b ` + sadiqun + ` 😀 \/ ` + string(rune(0xe9)) + `"`
			o1 := opaque.envelope()
			res := s.upload(t, u.token, pid, nulSource, version.envelope(), o1)
			for i := 0; i < 2; i++ {
				if r := res.Results[i]; r.Status != http.StatusUnprocessableEntity || r.Code != "nul_in_indexed_text" {
					t.Fatalf("result %d = %+v, want 422 nul_in_indexed_text", i, r)
				}
			}
			if r := res.Results[2]; r.Status != http.StatusCreated || r.Seq != 5 {
				t.Fatalf("opaque-payload event = %+v, want stored as seq 5", r)
			}
			kept["ans-e-o1"] = o1
			if pg := s.pull(t, u.token, pid, "after=4"); len(pg.Events) != 1 || !bytes.Equal(pg.Events[0].Payload, payloadOf(t, o1)) {
				t.Fatal("the payload with an escaped NUL, Arabic and a surrogate pair did not come back byte for byte")
			}
		}},
		{"events from an unlinked device are refused as a batch", func(t *testing.T) {
			stranger := answer{id: "ans-e-s1", learner: "lrn-e-9", install: "inst-e-9"}.envelope()
			linked := ex("ans-e-s2").envelope()
			for _, b := range [][]byte{batch(stranger), batch(linked, stranger)} {
				wantProblem(t, s.call(t, http.MethodPost, events, u.token, b), http.StatusConflict, "source_not_linked")
			}
			if n := s.count(t, "SELECT count(*) FROM events WHERE event_id IN ('ans-e-s1', 'ans-e-s2')"); n != 0 {
				t.Fatalf("a refused batch stored %d events", n)
			}
		}},
		{"clock skew is flagged, never refused", func(t *testing.T) {
			future := ex("ans-e-f1")
			future.at = time.Now().UTC().Add(2 * time.Hour).Truncate(time.Millisecond)
			old := ex("ans-e-p1")
			old.at = time.Date(2019, 12, 31, 23, 30, 0, 0, time.UTC)
			farDate := swap(t, ex("ans-e-d1").envelope(), `"local_date":"2026-10-16"`, `"local_date":"2026-10-19"`)
			envs := [][]byte{future.envelope(), old.envelope(), farDate}
			res := s.upload(t, u.token, pid, envs...)
			for i, flag := range []string{"future_skew", "pre_2020", "local_date_far"} {
				if r := res.Results[i]; r.Status != http.StatusCreated || !slices.Equal(r.ClockFlags, []string{flag}) {
					t.Fatalf("result %d = %+v, want stored with clock flag %s", i, r, flag)
				}
			}
			kept["ans-e-f1"], kept["ans-e-p1"], kept["ans-e-d1"] = envs[0], envs[1], envs[2]
		}},
		{"every stored event comes back byte for byte with its first accepted source", func(t *testing.T) {
			pg := s.pull(t, u.token, pid, "after=0&limit=500")
			if len(pg.Events) != len(kept) {
				t.Fatalf("pulled %d events, want %d", len(pg.Events), len(kept))
			}
			for i, e := range pg.Events {
				env, ok := kept[e.EventID]
				if !ok || e.Seq != int64(i+1) || e.Kind != envelope.KindAnswer || !bytes.Equal(e.Payload, payloadOf(t, env)) {
					t.Fatalf("pulled event %d (%s) is not the stored original", i, e.EventID)
				}
				var want struct {
					Source     envelope.Source     `json:"source"`
					Curriculum envelope.Curriculum `json:"curriculum"`
				}
				decodeJSON(t, env, &want)
				if e.Source != want.Source || e.Curriculum != want.Curriculum {
					t.Fatalf("event %s: source/curriculum %+v / %+v, want the first accepted %+v / %+v", e.EventID, e.Source, e.Curriculum, want.Source, want.Curriculum)
				}
			}
		}},
	} {
		if !t.Run(st.name, st.fn) {
			return
		}
	}
}

func TestPullPagesByCursorAndProgressStaysFactual(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	expo := sourceRef{App: "expo", InstallID: "inst-q-1", LocalProfileID: "lrn-q-1"}
	droid := sourceRef{App: "android", InstallID: "inst-q-2", LocalProfileID: "prf-q-1"}
	pid := s.seedProfile(t, u, expo, droid)
	at := func(m int) time.Time { return baseTime.Add(time.Duration(m) * time.Minute) }
	ex := func(id string, m int) answer { return answer{id: id, learner: expo.LocalProfileID, install: expo.InstallID, at: at(m)} }
	kt := func(id string, m int) answer {
		return answer{kotlin: true, id: id, learner: droid.LocalProfileID, install: droid.InstallID, at: at(m)}
	}

	// Same item and lineage answered twice: the second fresh claim is contradicted.
	e2 := ex("ans-q-2", 2)
	e2.outcome = "wrong"
	// A typed v1 record whose unchecked members hold non-booleans: unknown facts, never false.
	e3 := ex("ans-q-3", 3)
	e3.expoV1, e3.synthetic, e3.extra = true, `"yes"`, `,"feedback_deferred":1`
	e4 := ex("ans-q-4", 4)
	e4.content = "demo-synthetic-0.9"
	// Kotlin omits default-valued members: synthetic is absent, not false.
	k2 := kt("ans-q-k2", 6)
	k2.item, k2.synthetic = "DEMO-M02", "-"
	envs := [][]byte{ex("ans-q-1", 1).envelope(), e2.envelope(), e3.envelope(), e4.envelope(), kt("ans-q-k1", 5).envelope(), k2.envelope()}
	for _, env := range envs {
		s.seedEvent(t, pid, env) // seq 1..6, independent of the ingest route
	}
	seqs := func(p page) []int64 {
		var out []int64
		for _, e := range p.Events {
			out = append(out, e.Seq)
		}
		return out
	}

	t.Run("pages follow the commit-ordered cursor", func(t *testing.T) {
		for _, w := range []struct {
			query     string
			seqs      []int64
			nextAfter int64
			hasMore   bool
		}{
			{"after=0&limit=2", []int64{1, 2}, 2, true},
			{"after=2&limit=2", []int64{3, 4}, 4, true},
			{"after=4&limit=2", []int64{5, 6}, 6, false},
			{"after=6&limit=2", nil, 6, false},
			{"", []int64{1, 2, 3, 4, 5, 6}, 6, false},
		} {
			p := s.pull(t, u.token, pid, w.query)
			if !slices.Equal(seqs(p), w.seqs) || p.NextAfter != w.nextAfter || p.HasMore != w.hasMore || p.HighSeq != 6 {
				t.Fatalf("%q: seqs %v next_after %d has_more %v high_seq %d", w.query, seqs(p), p.NextAfter, p.HasMore, p.HighSeq)
			}
			for _, e := range p.Events {
				if !bytes.Equal(e.Payload, payloadOf(t, envs[e.Seq-1])) {
					t.Fatalf("seq %d payload changed", e.Seq)
				}
			}
		}
	})

	t.Run("family filters keep the data models apart", func(t *testing.T) {
		p := s.pull(t, u.token, pid, "family="+envelope.FamilyAndroid)
		if !slices.Equal(seqs(p), []int64{5, 6}) || p.HasMore || p.NextAfter != 6 {
			t.Fatalf("android-catalog pull: seqs %v has_more %v next_after %d", seqs(p), p.HasMore, p.NextAfter)
		}
		for _, e := range p.Events {
			if e.Schema != envelope.SchemaKotlinAnswer || e.Curriculum.Family != envelope.FamilyAndroid {
				t.Fatalf("seq %d is not an android-catalog event", e.Seq)
			}
		}
		p = s.pull(t, u.token, pid, "family="+envelope.FamilyExpo+"&limit=3")
		if !slices.Equal(seqs(p), []int64{1, 2, 3}) || !p.HasMore || p.NextAfter != 3 {
			t.Fatalf("first Expo page: seqs %v has_more %v next_after %d", seqs(p), p.HasMore, p.NextAfter)
		}
		p = s.pull(t, u.token, pid, "family="+envelope.FamilyExpo+"&after=3&limit=3")
		if !slices.Equal(seqs(p), []int64{4}) || p.HasMore || p.NextAfter != 4 || p.Events[0].CurriculumStatus != envelope.StatusUnregistered {
			t.Fatalf("second Expo page: seqs %v has_more %v next_after %d; want the quarantined event still pulled", seqs(p), p.HasMore, p.NextAfter)
		}
	})

	t.Run("invalid pull queries are 400", func(t *testing.T) {
		for _, q := range []string{"after=-1", "after=x", "limit=0", "limit=501", "limit=abc", "family=web-trial", "family="} {
			wantProblem(t, s.call(t, http.MethodGet, "/v1/profiles/"+pid+"/events?"+q, u.token, nil), http.StatusBadRequest, "invalid_query")
		}
	})

	getProgress := func(t *testing.T, family string) progress {
		t.Helper()
		r := s.call(t, http.MethodGet, "/v1/profiles/"+pid+"/progress?family="+family, u.token, nil)
		wantStatus(t, r, http.StatusOK)
		var p progress
		decodeJSON(t, r.body, &p)
		if p.ProfileID != pid || p.Family != family || p.AsOfSeq != 6 || p.Derivation != "factual-counts-v1" ||
			p.Learned.Status != "not_assessed_by_server" || p.Retention.Status != "not_assessed_by_server" {
			t.Fatalf("progress header = %+v", p)
		}
		for _, k := range keysIn(t, r.body) {
			lk := strings.ToLower(k)
			if strings.Contains(lk, "master") || lk == "readiness" || lk == "retained" || lk == "skill_state" || lk == "level" {
				t.Fatalf("progress carries %q", k)
			}
		}
		return p
	}
	skill := func(t *testing.T, p progress, name string) skillFacts {
		t.Helper()
		for _, sk := range p.Skills {
			if sk.Skill == name {
				return sk
			}
		}
		t.Fatalf("progress has no skill %s: %+v", name, p.Skills)
		return skillFacts{}
	}
	version := func(t *testing.T, p progress, contentVersion string) versionFacts {
		t.Helper()
		for _, v := range p.Versions {
			if v.ContentVersion == contentVersion {
				return v
			}
		}
		t.Fatalf("progress has no version %s: %+v", contentVersion, p.Versions)
		return versionFacts{}
	}

	t.Run("Expo progress counts only registered Expo events, factually", func(t *testing.T) {
		p := getProgress(t, envelope.FamilyExpo)
		if p.Events != 3 || p.ExcludedUnregistered != 1 || p.ClockFlagged != 0 || p.SourceInstalls != 1 || len(p.Skills) != 3 || len(p.Versions) != 2 {
			t.Fatalf("progress totals = %+v", p)
		}
		lex := skill(t, p, "LEX-A:W-A3")
		if lex.Events != 2 || !reflect.DeepEqual(lex.ByOutcome, counts{"correct": 1, "wrong": 1}) ||
			!reflect.DeepEqual(lex.ByRoleOrPool, counts{"practice": 2}) || !reflect.DeepEqual(lex.EvidenceModes, counts{"recognition-4": 2}) ||
			lex.DistinctExposureKeys != 1 || lex.LocalDays != 1 || lex.FreshClaims != 2 || lex.FreshClaimsContradicted != 1 {
			t.Fatalf("LEX-A:W-A3 = %+v (the Android event with the same skill name must not count)", lex)
		}
		if nom := skill(t, p, "NOM-01"); nom.Events != 1 || !reflect.DeepEqual(nom.ByRoleOrPool, counts{"PRACT": 1}) || !reflect.DeepEqual(nom.EvidenceModes, counts{"absent": 1}) {
			t.Fatalf("NOM-01 = %+v", nom)
		}
		v3, v1 := version(t, p, "demo-synthetic-0.3"), version(t, p, "demo-synthetic-0.1")
		if v3.Events != 2 || v3.RulesVersion != "pilot-0.3-local" || v3.Pack.Lifecycle != curriculum.LifecycleActive || v3.Pack.AnswerFormat != "mcq4" ||
			!v3.Pack.Synthetic || v3.Pack.ReviewedProductionContent {
			t.Fatalf("demo-synthetic-0.3 = %+v", v3)
		}
		if v1.Events != 1 || v1.RulesVersion != "pilot-0.1-local" || v1.Pack.Lifecycle != curriculum.LifecycleLegacy || !v1.Pack.Synthetic || v1.Pack.ReviewedProductionContent {
			t.Fatalf("demo-synthetic-0.1 = %+v", v1)
		}
		if !reflect.DeepEqual(p.Provenance.Synthetic, counts{"true": 2, "false": 0, "absent": 0, "unknown": 1}) ||
			!reflect.DeepEqual(p.Provenance.FeedbackDeferred, counts{"true": 0, "false": 0, "absent": 2, "unknown": 1}) ||
			!reflect.DeepEqual(p.Provenance.HintUsed, counts{"true": 0, "false": 3, "absent": 0, "unknown": 0}) {
			t.Fatalf("provenance = %+v: absent and unknown values must stay apart from false", p.Provenance)
		}
	})

	t.Run("Android progress counts only Android events and keeps omitted defaults absent", func(t *testing.T) {
		p := getProgress(t, envelope.FamilyAndroid)
		if p.Events != 2 || p.ExcludedUnregistered != 0 || p.SourceInstalls != 1 || len(p.Skills) != 1 || len(p.Versions) != 1 {
			t.Fatalf("progress totals = %+v", p)
		}
		if lex := skill(t, p, "LEX-A:W-A3"); lex.Events != 2 || !reflect.DeepEqual(lex.EvidenceModes, counts{"absent": 2}) ||
			lex.DistinctExposureKeys != 2 || lex.FreshClaims != 2 || lex.FreshClaimsContradicted != 0 {
			t.Fatalf("LEX-A:W-A3 = %+v", lex)
		}
		if v := version(t, p, "demo-synthetic-0.1"); v.Events != 2 || v.RulesVersion != "pilot-0.1" || !v.Pack.Synthetic || v.Pack.ReviewedProductionContent {
			t.Fatalf("demo-synthetic-0.1 = %+v", v)
		}
		if !reflect.DeepEqual(p.Provenance.Synthetic, counts{"true": 1, "false": 0, "absent": 1, "unknown": 0}) ||
			!reflect.DeepEqual(p.Provenance.HintUsed, counts{"true": 0, "false": 0, "absent": 2, "unknown": 0}) {
			t.Fatalf("provenance = %+v: an omitted Kotlin default is absent, not false", p.Provenance)
		}
	})

	t.Run("progress needs a registered family", func(t *testing.T) {
		for _, q := range []string{"", "?family=web-trial", "?family="} {
			wantProblem(t, s.call(t, http.MethodGet, "/v1/profiles/"+pid+"/progress"+q, u.token, nil), http.StatusBadRequest, "invalid_query")
		}
	})
}

func TestCommitOrderedCursorNeverSkipsLateCommits(t *testing.T) {
	var armed atomic.Bool
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	s := newStack(t, server.Options{BeforeCommit: func(context.Context) {
		if armed.CompareAndSwap(true, false) {
			entered <- struct{}{}
			<-release
		}
	}})
	t.Cleanup(unblock) // runs before the server closes, so no request stays parked
	u := newUser(t, s.emu)
	a := sourceRef{App: "expo", InstallID: "inst-c-1", LocalProfileID: "lrn-c-1"}
	b := sourceRef{App: "expo", InstallID: "inst-c-2", LocalProfileID: "lrn-c-2"}
	pid := s.seedProfile(t, u, a, b)
	ev := func(src sourceRef, id string) []byte {
		return answer{id: id, learner: src.LocalProfileID, install: src.InstallID}.envelope()
	}
	type outcome struct {
		r   reply
		err error
	}
	post := func(envs ...[]byte) <-chan outcome {
		c := make(chan outcome, 1)
		go func() {
			r, err := s.send(http.MethodPost, "/v1/profiles/"+pid+"/events", u.token, batch(envs...))
			c <- outcome{r, err}
		}()
		return c
	}
	await := func(t *testing.T, c <-chan outcome) batchReply {
		t.Helper()
		var o outcome
		select {
		case o = <-c:
		case <-time.After(20 * time.Second):
			t.Fatal("upload did not finish")
		}
		if o.err != nil {
			t.Fatalf("upload: %v", o.err)
		}
		wantStatus(t, o.r, http.StatusOK)
		var br batchReply
		decodeJSON(t, o.r.body, &br)
		return br
	}

	t.Run("a pull during an open ingest transaction never sees a later commit first", func(t *testing.T) {
		defer unblock()
		defer armed.Store(false)
		if first := s.upload(t, u.token, pid, ev(a, "ans-c-1"), ev(a, "ans-c-2")); first.HighSeq != 2 {
			t.Fatalf("setup high_seq = %d, want 2", first.HighSeq)
		}
		armed.Store(true)
		slow := post(ev(b, "ans-c-3"), ev(b, "ans-c-4"))
		select {
		case <-entered:
		case <-time.After(10 * time.Second):
			t.Fatal("the ingest transaction never reached its commit barrier")
		}
		late := post(ev(a, "ans-c-5"))
		time.Sleep(300 * time.Millisecond) // every chance for a wrong implementation to commit the later batch first
		if p := s.pull(t, u.token, pid, "after=2"); len(p.Events) != 0 || p.HighSeq != 2 {
			t.Fatalf("while an earlier transaction was open a pull returned %d events and high_seq %d: a client cursor could pass the earlier commit", len(p.Events), p.HighSeq)
		}
		unblock()
		slowRes, lateRes := await(t, slow), await(t, late)
		if len(slowRes.Results) != 2 || len(lateRes.Results) != 1 || slowRes.Results[0].Seq != 3 || slowRes.Results[1].Seq != 4 || lateRes.Results[0].Seq != 5 {
			t.Fatalf("results %+v then %+v, want seq 3 and 4, then 5, in commit order", slowRes.Results, lateRes.Results)
		}
		var got []string
		for _, e := range s.pull(t, u.token, pid, "after=2").Events {
			got = append(got, fmt.Sprintf("%d:%s", e.Seq, e.EventID))
		}
		if !slices.Equal(got, []string{"3:ans-c-3", "4:ans-c-4", "5:ans-c-5"}) {
			t.Fatalf("pull from the earlier cursor = %v", got)
		}
	})

	t.Run("concurrent overlapping uploads from two devices store each ID once with gapless sequence numbers", func(t *testing.T) {
		before := s.pull(t, u.token, pid, "after=0&limit=500").HighSeq
		var pending []<-chan outcome
		for w := 0; w < 8; w++ {
			src := a
			if w%2 == 1 {
				src = b
			}
			var envs [][]byte
			for i := 0; i < 6; i++ {
				envs = append(envs, ev(src, fmt.Sprintf("ans-c-%s-%d", src.InstallID, (w/2+i)%8)))
			}
			pending = append(pending, post(envs...))
		}
		for _, c := range pending {
			for _, r := range await(t, c).Results {
				if r.Status != http.StatusCreated && r.Status != http.StatusOK {
					t.Fatalf("overlapping upload result = %+v, want stored or identical", r)
				}
			}
		}
		p := s.pull(t, u.token, pid, fmt.Sprintf("after=%d&limit=500", before))
		seen := map[string]bool{}
		for i, e := range p.Events {
			if e.Seq != before+int64(i+1) || seen[e.EventID] {
				t.Fatalf("event %d: seq %d id %s; want gapless sequence numbers and one row per ID", i, e.Seq, e.EventID)
			}
			seen[e.EventID] = true
		}
		if len(seen) != 16 {
			t.Fatalf("stored %d distinct events, want 16", len(seen))
		}
	})
}

func TestReopenedServicePreservesProfilesEventsAndReceipts(t *testing.T) {
	s := newStack(t, server.Options{})
	u := newUser(t, s.emu)
	src := sourceRef{App: "expo", InstallID: "inst-r-1", LocalProfileID: "lrn-r-1"}
	ev := func(n int) []byte {
		return answer{id: fmt.Sprintf("ans-r-%d", n), learner: src.LocalProfileID, install: src.InstallID, at: baseTime.Add(time.Duration(n) * time.Minute)}.envelope()
	}
	importReq := importBody("imp-r-1", src, newAdult, ev(1), ev(2))
	r := s.call(t, http.MethodPost, "/v1/imports", u.token, importReq)
	wantStatus(t, r, http.StatusCreated)
	var first receipt
	decodeJSON(t, r.body, &first)
	pid := first.ProfileID
	third := s.upload(t, u.token, pid, ev(3)).Results[0]
	if third.Status != http.StatusCreated || third.Seq != 3 {
		t.Fatalf("upload = %+v", third)
	}
	wantStatus(t, s.call(t, http.MethodPatch, "/v1/profiles/"+pid, u.token, []byte(`{"settings":{"session_minutes":25}}`),
		"Content-Type", "application/merge-patch+json", "If-Match", `"r1"`), http.StatusOK)
	beforeDoc, beforeTag, _ := s.profile(t, u.token, pid)
	before := s.pull(t, u.token, pid, "after=0")
	r = s.call(t, http.MethodGet, "/v1/me", u.token, nil)
	wantStatus(t, r, http.StatusOK)
	var beforeMe me
	decodeJSON(t, r.body, &beforeMe)

	s.reopen(t)

	t.Run("the account, profile, settings and revision are unchanged", func(t *testing.T) {
		doc, tag, _ := s.profile(t, u.token, pid)
		if !reflect.DeepEqual(doc, beforeDoc) || tag != beforeTag || doc.Revision != 2 || val(doc.Settings.SessionMinutes) != 25 {
			t.Fatalf("profile after reopening = %+v (ETag %s), want %+v (ETag %s)", doc, tag, beforeDoc, beforeTag)
		}
		r := s.call(t, http.MethodGet, "/v1/me", u.token, nil)
		wantStatus(t, r, http.StatusOK)
		var m me
		decodeJSON(t, r.body, &m)
		if m.AccountID != beforeMe.AccountID || len(m.Profiles) != 1 {
			t.Fatalf("me after reopening = %+v, want %+v", m, beforeMe)
		}
	})
	t.Run("events keep their sequence, receipt time, hash and exact bytes", func(t *testing.T) {
		if after := s.pull(t, u.token, pid, "after=0"); len(after.Events) != 3 || !reflect.DeepEqual(after, before) {
			t.Fatalf("events after reopening = %+v, want %+v", after, before)
		}
	})
	t.Run("retries after reopening are recognized, not duplicated", func(t *testing.T) {
		r := s.call(t, http.MethodPost, "/v1/imports", u.token, importReq)
		wantStatus(t, r, http.StatusOK)
		var again receipt
		decodeJSON(t, r.body, &again)
		replayed := again.Replayed
		again.Replayed = false
		if !replayed || again != first {
			t.Fatalf("import retry = %+v, want the original receipt %+v replayed", again, first)
		}
		if res := s.upload(t, u.token, pid, ev(3)).Results[0]; res.Status != http.StatusOK || res.Seq != third.Seq || res.ReceivedAt != third.ReceivedAt {
			t.Fatalf("event retry = %+v, want the original receipt %+v", res, third)
		}
	})
	t.Run("the cursor continues after reopening", func(t *testing.T) {
		res := s.upload(t, u.token, pid, ev(4))
		if res.Results[0].Status != http.StatusCreated || res.Results[0].Seq != 4 || res.HighSeq != 4 {
			t.Fatalf("upload after reopening = %+v (high_seq %d), want seq 4", res.Results[0], res.HighSeq)
		}
	})
}
