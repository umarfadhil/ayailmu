package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDeploymentRegistryRequiresExactReviewedHashSourceAndExplicitNormalMode(t *testing.T) {
	path, err := filepath.Abs("../../candidates/reviewed-math/finalized-registry.json")
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(raw)
	pin := hex.EncodeToString(sum[:])
	source := "b6e0d6123cb359436f83ce3ae0685198ee13a815"
	r, err := LoadDeployment("", "", "", false)
	if err != nil || len(r.Packs) != 73 {
		t.Fatal("legacy default changed")
	}
	r, err = LoadDeployment(path, pin, source, true)
	if err != nil || len(r.Packs) != 1 || len(r.Packs[0].Items) != 14 || r.SourceCommit != source {
		t.Fatal("reviewed deployment load failed", err)
	}
	for _, in := range []struct {
		path, pin, source string
		normal            bool
	}{
		{path, pin, source, false}, {path, "", source, true}, {path, pin, "", true}, {path, strings.Repeat("0", 64), source, true}, {path, pin, strings.Repeat("0", 40), true}, {"relative.json", pin, source, true}, {"", pin, source, true},
	} {
		if _, err := LoadDeployment(in.path, in.pin, in.source, in.normal); err == nil {
			t.Fatal("unapproved registry selection accepted")
		}
	}
}

func TestDeploymentRegistryDoesNotTurnDraftOrSyntheticMetadataIntoApproval(t *testing.T) {
	r, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	path, err := filepath.Abs("../../candidates/reviewed-math/finalized-registry.json")
	if err != nil {
		t.Fatal(err)
	}
	valid, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var reviewed Registry
	if json.Unmarshal(valid, &reviewed) != nil {
		t.Fatal("reviewed fixture invalid")
	}
	for _, kind := range []string{"legacy-draft", "synthetic", "draft", "duplicate-version"} {
		var candidate Registry
		json.Unmarshal(valid, &candidate)
		switch kind {
		case "legacy-draft":
			candidate = *r
		case "synthetic":
			candidate.Packs[0].Synthetic = true
		case "draft":
			for id, item := range candidate.Packs[0].Items {
				item.ReviewStatus = "draft"
				candidate.Packs[0].Items[id] = item
				break
			}
		case "duplicate-version":
			candidate.Packs = append(candidate.Packs, candidate.Packs[0])
		}
		bytes, _ := json.Marshal(candidate)
		sum := sha256.Sum256(bytes)
		file := filepath.Join(t.TempDir(), "registry.json")
		os.WriteFile(file, bytes, 0600)
		if _, err := LoadDeployment(file, hex.EncodeToString(sum[:]), candidate.SourceCommit, true); err == nil {
			t.Fatal("invalid catalog admitted", kind)
		}
	}
}
