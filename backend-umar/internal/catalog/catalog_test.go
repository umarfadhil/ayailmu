package catalog

import "testing"

func TestPinnedRegistry(t *testing.T) {
	r, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if r.SourceCommit != "815e30f0da284b9818fadc0143f4da92544384d3" || len(r.Packs) != 73 {
		t.Fatal("registry drift")
	}
	total, drafts := 0, 0
	for _, p := range r.Packs {
		total += len(p.Items)
		for _, i := range p.Items {
			if i.ReviewStatus == "draft" {
				drafts++
			}
		}
		if len(p.SHA256) != 64 || len(p.RulesSHA256) != 64 {
			t.Fatal("missing hash")
		}
	}
	if total != 3162 || drafts != 3162 {
		t.Fatal(total, drafts)
	}
	p, ok := r.Find("arab", "demo-synthetic-0.1")
	if !ok || len(p.Items) != 17 || p.RulesVersion != "pilot-0.1" {
		t.Fatal("arabic drift")
	}
}
