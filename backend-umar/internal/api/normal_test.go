package api

import (
	"github.com/umarfadhil/ayailmu/backend-umar/internal/catalog"
	"testing"
)

func TestNormalReleasePolicyIsExplicitAndCatalogExcludesUnreviewedContent(t *testing.T) {
	if p, err := ParseReleasePolicy("", "", ""); err != nil || p.Enabled {
		t.Fatal("default was not closed")
	}
	if p, err := ParseReleasePolicy("yes", "adult-owner-v1", "owner-sync-1"); err != nil || p.Enabled {
		t.Fatal("non-exact readiness did not fail closed")
	}
	for _, values := range [][3]string{{"true", "", "owner-sync-1"}, {"true", "adult-owner-v1", "synthetic-sync-v1"}} {
		if p, err := ParseReleasePolicy(values[0], values[1], values[2]); err == nil || p.Enabled {
			t.Fatalf("unsafe policy accepted: %v", values)
		}
	}
	policy, err := ParseReleasePolicy("true", "adult-owner-v1", "owner-sync-1")
	if err != nil || !policy.Enabled {
		t.Fatal(err)
	}
	registry := &catalog.Registry{SourceCommit: "fixture-source", Packs: []catalog.Pack{
		{Track: "synthetic", Synthetic: true, Items: map[string]catalog.Item{"s": {ReviewStatus: "approved"}}},
		{Track: "normal", Synthetic: false, Items: map[string]catalog.Item{"a": {ReviewStatus: "approved"}, "d": {ReviewStatus: "draft"}}},
	}}
	a := &server{r: registry, normal: policy}
	got := a.catalogResponse()
	if len(got.Packs) != 1 || got.Packs[0].Track != "normal" || len(got.Packs[0].Items) != 1 {
		t.Fatalf("unsafe normal catalog: %#v", got)
	}
	if _, ok := got.Packs[0].Items["a"]; !ok {
		t.Fatal("approved fixture missing")
	}
	if len(registry.Packs[1].Items) != 2 {
		t.Fatal("source registry mutated")
	}
}

func TestDeploymentModeRejectsUnknownAndNormalOffCatalogHasNoLabContent(t *testing.T) {
	if _, err := ParseDeploymentDataMode("unexpected"); err == nil {
		t.Fatal("unknown deployment mode accepted")
	}
	registry := &catalog.Registry{SourceCommit: "fixture", Packs: []catalog.Pack{{Track: "lab", Synthetic: true, Items: map[string]catalog.Item{"d": {ReviewStatus: "draft"}}}}}
	a := &server{r: registry, mode: DeploymentNormalOnly}
	if got := a.catalogResponse(); len(got.Packs) != 0 {
		t.Fatal("normal OFF served lab catalog")
	}
	a.mode = DeploymentSyntheticLab
	if got := a.catalogResponse(); len(got.Packs) != 1 {
		t.Fatal("legacy lab catalog changed")
	}
}

func TestNormalReadinessCannotUseLabDeploymentMode(t *testing.T) {
	policy, _ := ParseReleasePolicy("true", "adult-owner-v1", "owner-sync-v1")
	defer func() {
		if recover() == nil {
			t.Fatal("lab mode with normal readiness accepted")
		}
	}()
	_ = NewWithRelease(nil, nil, nil, policy, DeploymentSyntheticLab)
}
