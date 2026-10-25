package curriculum_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"ayailmu.local/backend/internal/curriculum"
)

// packCase names a shipped pack and where its exact bytes live. Expo four-choice packs are not in
// this repository's base commit: AYA_TEST_EXPO_FIXTURES_DIR points at the approved read-only Expo
// source (ayailmu-publish/app/src/content/fixtures). Android packs are read from this repository.
type packCase struct {
	family, track, version, lifecycle string
	repo, path, format                string
	expo                              bool
}

var packCases = []packCase{
	{"expo-trial-arabic", "arab", "demo-synthetic-0.1", curriculum.LifecycleLegacy, "ayailmu-publish", "app/src/content/fixtures/demo-unit-a.json", "expo-content-pack", true},
	{"expo-trial-arabic", "arab", "demo-synthetic-0.2", curriculum.LifecycleLegacy, "ayailmu-publish", "app/src/content/fixtures/demo-v0.2.json", "expo-content-pack", true},
	{"expo-trial-arabic", "arab", "demo-synthetic-0.3", curriculum.LifecycleActive, "ayailmu-publish", "app/src/content/fixtures/demo-v0.3.json", "expo-content-pack", true},
	{"android-catalog", "arab", "demo-synthetic-0.1", curriculum.LifecycleActive, "ayailmu", "android/content/src/main/assets/packs/bahasa/arab/v1.json", "android-pack", false},
	{"android-catalog", "mat", "mat-sample-0.2", curriculum.LifecycleActive, "ayailmu", "android/content/src/main/assets/packs/matematika/mat/v1.json", "android-pack", false},
}

func (c packCase) file(t *testing.T) string {
	t.Helper()
	if !c.expo {
		// Default: this repository. A frontend-only checkout has no android/ tree; AYA_TEST_ANDROID_PACKS_ROOT then names a
		// directory holding the same paths (infra/catalog/pinned-android-packs). The pins and byte checks are unchanged.
		root := os.Getenv("AYA_TEST_ANDROID_PACKS_ROOT")
		if root == "" {
			root = filepath.Join("..", "..", "..")
		}
		return filepath.Join(root, filepath.FromSlash(c.path))
	}
	dir := os.Getenv("AYA_TEST_EXPO_FIXTURES_DIR")
	if dir == "" {
		t.Fatal("AYA_TEST_EXPO_FIXTURES_DIR is not set: it must point at ayailmu-publish/app/src/content/fixtures (read-only); refusing to skip")
	}
	return filepath.Join(dir, filepath.Base(c.path))
}

// packFacts is what the pack file itself says, computed independently of the registry.
type packFacts struct {
	sha256            string
	contentVersion    string
	track             string
	synthetic         bool
	answerFormat      string
	metaSchemaVersion int
	reviewCounts      map[string]int
	note              string
}

func readFacts(t *testing.T, c packCase) packFacts {
	t.Helper()
	raw, err := os.ReadFile(c.file(t))
	if err != nil {
		t.Fatalf("read pack: %v", err)
	}
	sum := sha256.Sum256(raw)
	f := packFacts{sha256: hex.EncodeToString(sum[:]), reviewCounts: map[string]int{}}
	type reviewed struct {
		ReviewStatus *string `json:"review_status"`
	}
	count := func(list []reviewed) {
		for _, r := range list {
			if r.ReviewStatus == nil {
				f.reviewCounts["(absent)"]++
			} else {
				f.reviewCounts[*r.ReviewStatus]++
			}
		}
	}
	if c.expo {
		var p struct {
			ContentVersion string     `json:"content_version"`
			AnswerFormat   string     `json:"answer_format"`
			Synthetic      bool       `json:"synthetic"`
			Note           string     `json:"note"`
			Screens        []reviewed `json:"lesson_screens"`
			Items          []reviewed `json:"items"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatalf("parse Expo pack: %v", err)
		}
		f.contentVersion, f.track, f.synthetic, f.answerFormat, f.note = p.ContentVersion, "arab", p.Synthetic, p.AnswerFormat, p.Note
		count(p.Screens)
		count(p.Items)
	} else {
		var p struct {
			Meta struct {
				SchemaVersion  int    `json:"schema_version"`
				ContentVersion string `json:"content_version"`
				Track          string `json:"track"`
			} `json:"meta"`
			Synthetic bool       `json:"synthetic"`
			Note      string     `json:"note"`
			Screens   []reviewed `json:"screens"`
			Items     []reviewed `json:"items"`
		}
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatalf("parse Android pack: %v", err)
		}
		f.contentVersion, f.track, f.synthetic, f.note = p.Meta.ContentVersion, p.Meta.Track, p.Synthetic, p.Note
		f.metaSchemaVersion = p.Meta.SchemaVersion
		count(p.Screens)
		count(p.Items)
	}
	return f
}

func approvedOnly(counts map[string]int, approved string) bool {
	if len(counts) == 0 {
		return false
	}
	for status, n := range counts {
		if status != approved && n > 0 {
			return false
		}
	}
	return true
}

// The failure message prints the facts computed from the files so the registry can be pinned to them.
func TestRegistryPinsExactPackBytesAndHonestStatus(t *testing.T) {
	reg := curriculum.Default()
	for _, c := range packCases {
		t.Run(c.family+"/"+c.track+"/"+c.version, func(t *testing.T) {
			facts := readFacts(t, c)
			if facts.contentVersion != c.version || facts.track != c.track {
				t.Fatalf("pack file declares %s/%s, test expects %s/%s", facts.track, facts.contentVersion, c.track, c.version)
			}
			got, ok := reg.Pack(c.family, c.track, c.version)
			if !ok {
				t.Fatalf("registry has no pack %s/%s/%s; file facts: sha256=%s synthetic=%v answer_format=%q meta_schema_version=%d review_status_counts=%v",
					c.family, c.track, c.version, facts.sha256, facts.synthetic, facts.answerFormat, facts.metaSchemaVersion, facts.reviewCounts)
			}
			fam, ok := reg.Family(c.family)
			if !ok {
				t.Fatalf("registry has no family %s", c.family)
			}
			want := curriculum.Pack{
				Family:         c.family,
				Track:          c.track,
				ContentVersion: c.version,
				Lifecycle:      c.lifecycle,
				Source: curriculum.PackSource{
					Repo: c.repo, Path: c.path, SHA256: facts.sha256, Format: c.format,
					AnswerFormat: facts.answerFormat, MetaSchemaVersion: facts.metaSchemaVersion,
				},
				Synthetic:                 facts.synthetic,
				ReviewStatusCounts:        facts.reviewCounts,
				ReviewedProductionContent: !facts.synthetic && approvedOnly(facts.reviewCounts, fam.ApprovedReviewStatus),
				Note:                      facts.note,
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("registry pack differs from the file\n got: %+v\nwant: %+v", got, want)
			}
			if got.Synthetic && got.ReviewedProductionContent {
				t.Fatal("a synthetic pack is labelled reviewed production content")
			}
		})
	}
	if n := len(reg.Packs()); n != len(packCases) {
		t.Fatalf("registry lists %d packs, want exactly the %d shipped packs", n, len(packCases))
	}
}

func TestRegistryFamiliesAreSeparateDataModels(t *testing.T) {
	reg := curriculum.Default()
	want := []curriculum.Family{
		{Name: "android-catalog", App: "android", Schema: "kotlin.answer_event", SchemaVersions: []int{1}, ApprovedReviewStatus: "approved"},
		{Name: "expo-trial-arabic", App: "expo", Schema: "expo.answer_record", SchemaVersions: []int{1, 2}, ApprovedReviewStatus: "approved-for-trial"},
	}
	if got := reg.Families(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Families() = %+v, want %+v", got, want)
	}
	for _, w := range want {
		got, ok := reg.Family(w.Name)
		if !ok || !reflect.DeepEqual(got, w) {
			t.Errorf("Family(%q) = %+v, %v", w.Name, got, ok)
		}
	}
	if _, ok := reg.Family("web-trial"); ok {
		t.Error(`Family("web-trial") is registered; unknown families must stay unknown`)
	}
	if _, ok := reg.Pack("expo-trial-arabic", "arab", "demo-synthetic-0.9"); ok {
		t.Error("an unshipped content version is registered")
	}
	packs := reg.Packs()
	keys := make([]string, 0, len(packs))
	for _, p := range packs {
		keys = append(keys, fmt.Sprintf("%s/%s/%s", p.Family, p.Track, p.ContentVersion))
	}
	if !sort.StringsAreSorted(keys) {
		t.Errorf("Packs() order = %v, want sorted by family, track, content version", keys)
	}
}
