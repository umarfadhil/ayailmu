// Package curriculum is the server's registry of answer-event families and of the exact content
// packs their events reference.
//
// It records pack identity (source path and SHA-256 of the exact bytes) together with the pack's own
// synthetic flag and review-status counts, so unreviewed developer fixtures are never presented as
// reviewed production content. It holds no item content or answer keys, serves no content, and
// defines no prerequisites: prerequisites, mastery, adaptive practice and spaced review stay in each
// client's engine and rules.
package curriculum

import (
	"cmp"
	"fmt"
	"maps"
	"slices"
)

// Family is one client data model. Events of different families are never merged or compared.
type Family struct {
	Name           string `json:"family"`
	App            string `json:"app"`
	Schema         string `json:"schema"`
	SchemaVersions []int  `json:"schema_versions"`
	// ApprovedReviewStatus is the value the family's own release gate requires
	// ("approved-for-trial" in Expo, "approved" in Kotlin).
	ApprovedReviewStatus string `json:"approved_review_status"`
}

// Lifecycle values for a pack.
const (
	// LifecycleActive: the pack the client currently ships.
	LifecycleActive = "active"
	// LifecycleLegacy: kept only to interpret old answers; never offered to learners.
	LifecycleLegacy = "legacy"
)

// Pack identifies one shipped content pack by family, track and content version.
type Pack struct {
	Family         string     `json:"family"`
	Track          string     `json:"track"`
	ContentVersion string     `json:"content_version"`
	Lifecycle      string     `json:"lifecycle"`
	Source         PackSource `json:"source"`
	// Synthetic is the pack's own top-level flag, copied verbatim.
	Synthetic bool `json:"synthetic"`
	// ReviewStatusCounts counts review_status values over the pack's items and lesson screens.
	ReviewStatusCounts map[string]int `json:"review_status_counts"`
	// ReviewedProductionContent is true only for a non-synthetic pack whose every item and screen
	// carries the family's approved status. It is false for every pack registered today.
	ReviewedProductionContent bool `json:"reviewed_production_content"`
	// Note is the pack's own note, copied verbatim.
	Note string `json:"note"`
}

// PackSource pins the exact bytes a content version refers to.
type PackSource struct {
	Repo   string `json:"repo"`
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
	// Format is "expo-content-pack" or "android-pack".
	Format string `json:"format"`
	// AnswerFormat is the Expo pack's answer_format ("mcq4"); empty for the legacy v0.1 pack.
	AnswerFormat string `json:"answer_format,omitempty"`
	// MetaSchemaVersion is the Android pack's meta.schema_version.
	MetaSchemaVersion int `json:"meta_schema_version,omitempty"`
}

// Registry is an immutable set of families and packs. Accessors return copies; a nil Registry is
// empty.
type Registry struct {
	families []Family
	packs    []Pack
}

var defaultRegistry = newRegistry(registeredFamilies, registeredPacks)

// Default returns the registry embedded in the binary.
func Default() *Registry {
	return defaultRegistry
}

// newRegistry copies and sorts the families and packs, and derives each pack's
// ReviewedProductionContent from its own synthetic flag and review counts, never from a label.
// Inconsistent embedded data (a repeated family or pack, a pack of an unregistered family, an
// unknown lifecycle) panics at start-up.
func newRegistry(families []Family, packs []Pack) *Registry {
	r := &Registry{families: make([]Family, 0, len(families)), packs: make([]Pack, 0, len(packs))}
	for _, f := range families {
		if _, dup := r.Family(f.Name); dup {
			panic(fmt.Sprintf("curriculum: repeated embedded family %s", f.Name))
		}
		r.families = append(r.families, copyFamily(f))
	}
	slices.SortFunc(r.families, func(a, b Family) int { return cmp.Compare(a.Name, b.Name) })
	for _, p := range packs {
		fam, ok := r.Family(p.Family)
		if !ok || (p.Lifecycle != LifecycleActive && p.Lifecycle != LifecycleLegacy) {
			panic(fmt.Sprintf("curriculum: invalid embedded pack %s/%s/%s", p.Family, p.Track, p.ContentVersion))
		}
		if _, dup := r.Pack(p.Family, p.Track, p.ContentVersion); dup {
			panic(fmt.Sprintf("curriculum: repeated embedded pack %s/%s/%s", p.Family, p.Track, p.ContentVersion))
		}
		p = copyPack(p)
		p.ReviewedProductionContent = !p.Synthetic && approvedOnly(p.ReviewStatusCounts, fam.ApprovedReviewStatus)
		r.packs = append(r.packs, p)
	}
	slices.SortFunc(r.packs, func(a, b Pack) int {
		return cmp.Or(cmp.Compare(a.Family, b.Family), cmp.Compare(a.Track, b.Track), cmp.Compare(a.ContentVersion, b.ContentVersion))
	})
	return r
}

// approvedOnly reports whether there are counts and every counted status is the approved one.
func approvedOnly(counts map[string]int, approved string) bool {
	if approved == "" || len(counts) == 0 {
		return false
	}
	for status, n := range counts {
		if status != approved && n > 0 {
			return false
		}
	}
	return true
}

// Families returns every registered family, sorted by name.
func (r *Registry) Families() []Family {
	if r == nil {
		return nil
	}
	out := make([]Family, len(r.families))
	for i, f := range r.families {
		out[i] = copyFamily(f)
	}
	return out
}

// Packs returns every registered pack, sorted by family, track and content version.
func (r *Registry) Packs() []Pack {
	if r == nil {
		return nil
	}
	out := make([]Pack, len(r.packs))
	for i, p := range r.packs {
		out[i] = copyPack(p)
	}
	return out
}

// Family looks up a family by name.
func (r *Registry) Family(name string) (Family, bool) {
	if r != nil {
		for _, f := range r.families {
			if f.Name == name {
				return copyFamily(f), true
			}
		}
	}
	return Family{}, false
}

// Pack looks up a registered (family, track, content version).
func (r *Registry) Pack(family, track, contentVersion string) (Pack, bool) {
	if r != nil {
		for _, p := range r.packs {
			if p.Family == family && p.Track == track && p.ContentVersion == contentVersion {
				return copyPack(p), true
			}
		}
	}
	return Pack{}, false
}

func copyFamily(f Family) Family {
	f.SchemaVersions = slices.Clone(f.SchemaVersions)
	return f
}

func copyPack(p Pack) Pack {
	p.ReviewStatusCounts = maps.Clone(p.ReviewStatusCounts)
	return p
}
