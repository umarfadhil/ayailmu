package curriculum_test

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
)

// The active Expo pack demo-synthetic-0.3 was first registered against the frontend bytes at ef28606 and is now registered
// against the frontend's authoritative bytes at 8b29a91a2ae4a83d89cbfbfe58c8fdfa67670923. The only difference between the two
// files is three lesson-screen copy strings (/lesson_screens/0/body/0, /lesson_screens/0/body/1, /lesson_screens/4/body/0);
// the 45 items, their IDs, choices, keys, content_version and review statuses are identical. The pack's source SHA-256 is
// registry metadata served by GET /v1/curricula: it is not an input of the envelope's semantic hash, of the registry key, of
// event validation or of any stored column, which these tests pin.
const (
	historicalV03SHA    = "af0c4bdd7b1db1cc188259dc7ebf484207773cd0657e66b5ec379c6f4fa71cf5" // frontend ef28606
	authoritativeV03SHA = "80eb638ace35e1ad39bd15b2f48d3d31ace78a776a344e1b948789c9ad161fee" // frontend 8b29a91
)

// goldenSemanticHashes were computed from the contract fixtures with the registry as it was before the realignment.
var goldenSemanticHashes = map[string]string{
	"expo-v1-pending.envelope.json":                        "051e1b960c9f0fc6a4b7ae8fb1ed46c876706918791cc831ba83aedf26515196",
	"expo-v1-typed.envelope.json":                          "84289ff89dd54c02ca3b520125106bcb51126d628df7cecb7c6c45fb265d2b3e",
	"expo-v2-check-deferred.envelope.json":                 "24663397d780decb3813a13034825e2e37b23fd89ed70a9de97e12aea32b921b",
	"expo-v2-practice.envelope.json":                       "6cec78dd417873b135c194779f84c3c63c38b9b01c2dd58a24242a2a3283542a",
	"kotlin-v1-arab-choose-defaults-omitted.envelope.json": "cfbdaac0f63817b933a347384926d87f50b70d0585201aa16e3e1a3d5f109c70",
	"kotlin-v1-arab-type-in-hinted.envelope.json":          "7495f9da79f96a185a641c36d40a1653254280ddfc5aeefd86c0c885888c626e",
}

// withV03Pin is the embedded registry with only the demo-synthetic-0.3 source SHA-256 replaced.
func withV03Pin(t *testing.T, sha string) *curriculum.Registry {
	t.Helper()
	reg := curriculum.Default()
	packs := reg.Packs()
	n := 0
	for i := range packs {
		if packs[i].Family == "expo-trial-arabic" && packs[i].Track == "arab" && packs[i].ContentVersion == "demo-synthetic-0.3" {
			packs[i].Source.SHA256 = sha
			n++
		}
	}
	if n != 1 {
		t.Fatalf("found %d demo-synthetic-0.3 Expo packs, want exactly 1", n)
	}
	return curriculum.NewRegistryForTest(reg.Families(), packs)
}

func TestActiveV03PinIsTheAuthoritativeFrontendBytes(t *testing.T) {
	p, ok := curriculum.Default().Pack("expo-trial-arabic", "arab", "demo-synthetic-0.3")
	if !ok {
		t.Fatal("demo-synthetic-0.3 is not registered")
	}
	if p.Source.SHA256 != authoritativeV03SHA {
		t.Fatalf("active pin = %s, want the authoritative frontend 8b29a91 bytes %s (historical ef28606 bytes were %s)",
			p.Source.SHA256, authoritativeV03SHA, historicalV03SHA)
	}
	if p.Lifecycle != curriculum.LifecycleActive || !p.Synthetic || p.ReviewedProductionContent ||
		!reflect.DeepEqual(p.ReviewStatusCounts, map[string]int{"draft": 53}) {
		t.Fatalf("realignment must not change lifecycle or honest status: %+v", p)
	}
}

func TestRealignmentChangesOnlyTheSourceHashInTheServedMetadata(t *testing.T) {
	old, now := withV03Pin(t, historicalV03SHA), curriculum.Default()
	if !reflect.DeepEqual(old.Families(), now.Families()) {
		t.Fatal("families differ")
	}
	a, b := old.Packs(), now.Packs()
	if len(a) != len(b) {
		t.Fatalf("pack count %d -> %d", len(a), len(b))
	}
	changed := 0
	for i := range a {
		if reflect.DeepEqual(a[i], b[i]) {
			continue
		}
		changed++
		a[i].Source.SHA256 = b[i].Source.SHA256
		if !reflect.DeepEqual(a[i], b[i]) {
			t.Fatalf("pack %s/%s/%s differs in more than the source SHA-256:\n%+v\n%+v", b[i].Family, b[i].Track, b[i].ContentVersion, a[i], b[i])
		}
	}
	if changed != 1 {
		t.Fatalf("%d packs differ, want exactly the demo-synthetic-0.3 Expo pack", changed)
	}
	// The wire form (GET /v1/curricula) differs by exactly one 64-hex string.
	oj, _ := json.Marshal(struct{ Packs []curriculum.Pack }{old.Packs()})
	nj, _ := json.Marshal(struct{ Packs []curriculum.Pack }{now.Packs()})
	if strings.Count(string(oj), historicalV03SHA) != 1 || strings.Replace(string(oj), historicalV03SHA, authoritativeV03SHA, 1) != string(nj) {
		t.Fatal("served pack metadata differs by more than the one source SHA-256")
	}
}

func TestSourceHashPinDoesNotAffectEventIdentity(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "..", "contract", "fixtures", "*.envelope.json"))
	if err != nil || len(files) != len(goldenSemanticHashes) {
		t.Fatalf("contract fixtures = %d (%v), want %d", len(files), err, len(goldenSemanticHashes))
	}
	registries := map[string]*curriculum.Registry{
		"historical ef28606 pin": withV03Pin(t, historicalV03SHA),
		"active 8b29a91 pin":     curriculum.Default(),
		"arbitrary pin":          withV03Pin(t, strings.Repeat("0", 64)),
	}
	for _, f := range files {
		name := filepath.Base(f)
		want, ok := goldenSemanticHashes[name]
		if !ok {
			t.Fatalf("fixture %s has no golden semantic hash", name)
		}
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		var first *envelope.Event
		for label, reg := range registries {
			ev, err := envelope.Parse(raw, reg)
			if err != nil {
				t.Fatalf("%s under %s: %v", name, label, err)
			}
			if got := hex.EncodeToString(ev.SemanticSHA256[:]); got != want {
				t.Fatalf("%s under %s: semantic hash %s, want the pre-realignment %s", name, label, got, want)
			}
			if ev.CurriculumStatus != envelope.StatusRegistered {
				t.Fatalf("%s under %s: status %s", name, label, ev.CurriculumStatus)
			}
			if first == nil {
				first = &ev
			} else if !reflect.DeepEqual(*first, ev) {
				t.Fatalf("%s: parsed event differs between registries", name)
			}
		}
	}
}

func TestRealignmentKeepsRegistryMembershipUnchanged(t *testing.T) {
	// The registry key is (family, track, content_version): an old or a new client's v0.3 events stay registered, and
	// an unshipped version stays unregistered, whatever source bytes are pinned.
	for _, reg := range []*curriculum.Registry{withV03Pin(t, historicalV03SHA), curriculum.Default()} {
		for _, cv := range []string{"demo-synthetic-0.1", "demo-synthetic-0.2", "demo-synthetic-0.3"} {
			if _, ok := reg.Pack("expo-trial-arabic", "arab", cv); !ok {
				t.Errorf("%s is not registered", cv)
			}
		}
		if _, ok := reg.Pack("expo-trial-arabic", "arab", "demo-synthetic-0.4"); ok {
			t.Error("an unshipped version is registered")
		}
	}
}
