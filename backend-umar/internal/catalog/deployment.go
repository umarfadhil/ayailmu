package catalog

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"

	"github.com/umarfadhil/ayailmu/backend-umar/internal/native"
)

var registrySHA = regexp.MustCompile(`^[0-9a-f]{64}$`)
var registryCommit = regexp.MustCompile(`^[0-9a-f]{40}$`)

// LoadDeployment is startup-only, with no reload, approval inference or DB write.
// Exact artifact/source pins must be supplied from a reviewed rollout. Default
// lab/legacy startup still loads the untouched embedded registry.
func LoadDeployment(path, expectedSHA, expectedSource string, normal bool) (*Registry, error) {
	fail := errors.New("reviewed registry selection invalid")
	if path == "" && expectedSHA == "" && expectedSource == "" {
		return Load()
	}
	if !normal || !filepath.IsAbs(path) || !registrySHA.MatchString(expectedSHA) || !registryCommit.MatchString(expectedSource) {
		return nil, fail
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, fail
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
		return nil, fail
	}
	raw, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 {
		return nil, fail
	}
	sum := sha256.Sum256(raw)
	if hex.EncodeToString(sum[:]) != expectedSHA {
		return nil, fail
	}
	var r Registry
	if native.Decode(raw, &r) != nil || r.SourceCommit != expectedSource || len(r.Packs) == 0 || len(r.Packs) > 100 {
		return nil, fail
	}
	seen := map[string]bool{}
	for _, p := range r.Packs {
		key := p.Track + "|" + p.ContentVersion
		if seen[key] || !native.ID(p.Track) || !native.ID(p.ContentVersion) || !native.ID(p.RulesVersion) || p.Synthetic || !registrySHA.MatchString(p.SHA256) || !registrySHA.MatchString(p.RulesSHA256) || len(p.Items) == 0 || len(p.Audiences) == 0 || len(p.InstructionLangs) == 0 {
			return nil, fail
		}
		seen[key] = true
		for id, item := range p.Items {
			if !native.ID(id) || !native.ID(item.Unit) || !native.ID(item.Type) || !native.ID(item.Pool) || item.ReviewStatus != "approved" {
				return nil, fail
			}
		}
	}
	return &r, nil
}
