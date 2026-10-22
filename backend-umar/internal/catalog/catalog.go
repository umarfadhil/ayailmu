package catalog

import (
	"embed"
	"encoding/json"
)

//go:embed registry.json
var files embed.FS

type Item struct {
	Type         string `json:"type"`
	Unit         string `json:"unit"`
	Pool         string `json:"pool"`
	ReviewStatus string `json:"review_status"`
}
type Pack struct {
	Track            string          `json:"track"`
	ContentVersion   string          `json:"content_version"`
	Subject          string          `json:"subject"`
	Audiences        []string        `json:"audiences"`
	InstructionLangs []string        `json:"instruction_langs"`
	Synthetic        bool            `json:"synthetic"`
	SHA256           string          `json:"sha256"`
	SourcePath       string          `json:"source_path"`
	RulesSHA256      string          `json:"rules_sha256"`
	RulesPath        string          `json:"rules_path"`
	RulesVersion     string          `json:"rules_version"`
	Items            map[string]Item `json:"items"`
}
type Registry struct {
	SourceCommit string `json:"source_commit"`
	Packs        []Pack `json:"packs"`
}

func Load() (*Registry, error) {
	b, e := files.ReadFile("registry.json")
	if e != nil {
		return nil, e
	}
	var r Registry
	e = json.Unmarshal(b, &r)
	return &r, e
}
func (r *Registry) Find(track, version string) (Pack, bool) {
	for _, p := range r.Packs {
		if p.Track == track && p.ContentVersion == version {
			return p, true
		}
	}
	return Pack{}, false
}
