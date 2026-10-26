package native

import (
	"fmt"
	"math"
	"regexp"
	"slices"
	"strings"
	"time"
)

var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$`)

func ID(s string) bool                    { return idPattern.MatchString(s) }
func one(s string, values ...string) bool { return slices.Contains(values, s) }

type Event struct {
	AnswerID       string            `json:"answer_id"`
	LearnerID      string            `json:"learner_id"`
	ItemID         string            `json:"item_id"`
	Track          string            `json:"track"`
	ContentVersion string            `json:"content_version"`
	RulesVersion   string            `json:"rules_version"`
	AppVersion     string            `json:"app_version"`
	Timestamp      string            `json:"timestamp"`
	LocalDate      string            `json:"local_date"`
	SessionID      string            `json:"session_id"`
	Lang           string            `json:"lang"`
	Pool           string            `json:"pool"`
	Unit           string            `json:"unit"`
	Skills         []string          `json:"skills"`
	RawResponse    string            `json:"raw_response"`
	AutoScore      map[string]string `json:"auto_score"`
	Outcome        string            `json:"outcome"`
	ErrorTags      []string          `json:"error_tags"`
	SeriousTag     *string           `json:"serious_tag"`
	HintUsed       bool              `json:"hint_used"`
	HelpLinesShown []string          `json:"help_lines_shown"`
	FirstAttempt   *bool             `json:"first_attempt"`
	FreshEvidence  *bool             `json:"fresh_evidence"`
	TimeOnItemMS   int64             `json:"time_on_item_ms"`
	AudioStatus    *string           `json:"audio_status"`
	ReportFlag     bool              `json:"report_flag"`
	ReviewStatus   string            `json:"review_status"`
	Synthetic      bool              `json:"synthetic"`
	ItemType       string            `json:"item_type"`
	Gem            bool              `json:"gem"`
}
type Pair struct {
	Left  string `json:"left"`
	Right string `json:"right"`
}
type Response struct {
	Kind        string   `json:"kind"`
	Text        *string  `json:"text"`
	Ref         *string  `json:"ref"`
	OptionID    *string  `json:"option_id"`
	Value       *float64 `json:"value"`
	Sequence    []string `json:"sequence" jsonnull:"true"`
	Pairs       []Pair   `json:"pairs" jsonnull:"true"`
	AudioStatus *string  `json:"audio_status"`
}

func score(s string) bool { return one(s, "correct", "wrong", "pending", "dont_know", "not_assessed") }
func tag(s string) bool {
	return one(s, "wrong-referent", "possession", "invented-action", "wrong-form", "lexical", "look-alike", "decoding", "ta-confusion", "wrong-speaker", "calculation", "misconception", "sequence")
}
func audio(p *string) bool                      { return p == nil || one(*p, "played", "failed", "unavailable") }
func Parse(b []byte, child bool) (Event, error) { return ParseForMode(b, child, true) }

// ParseForMode preserves the native response contract while enforcing the account data lane.
func ParseForMode(b []byte, child bool, synthetic bool) (Event, error) {
	var e Event
	fail := func() (Event, error) { return e, fmt.Errorf("invalid native answer event") }
	if len(b) > 16384 || Decode(b, &e) != nil {
		return fail()
	}
	for _, s := range []string{e.AnswerID, e.LearnerID, e.ItemID, e.Track, e.ContentVersion, e.RulesVersion, e.AppVersion, e.SessionID, e.Unit} {
		if !ID(s) {
			return fail()
		}
	}
	if e.Synthetic != synthetic || e.FirstAttempt == nil || e.FreshEvidence == nil || e.Skills == nil || e.AutoScore == nil {
		return fail()
	}
	if _, err := time.Parse(time.RFC3339Nano, e.Timestamp); err != nil {
		return fail()
	}
	if _, err := time.Parse(time.DateOnly, e.LocalDate); err != nil {
		return fail()
	}
	if !synthetic && e.ReviewStatus != "approved" {
		return fail()
	}
	if !one(e.Lang, "id", "en") || !one(e.Pool, "INSTR", "PRACT", "READY", "D7", "D30", "REMED", "TRANS", "SPARE", "MT", "ENTRY", "REPROBE", "FOCUS", "GEM") || !score(e.Outcome) || !one(e.ReviewStatus, "draft", "reviewed_subject", "reviewed_language", "approved") || !audio(e.AudioStatus) || e.TimeOnItemMS < 0 {
		return fail()
	}
	if len(e.Skills) > 100 || len(e.ErrorTags) > 30 || len(e.HelpLinesShown) > 100 {
		return fail()
	}
	for _, s := range e.Skills {
		if !ID(s) {
			return fail()
		}
	}
	for _, s := range e.ErrorTags {
		if !tag(s) {
			return fail()
		}
	}
	if e.SeriousTag != nil && !tag(*e.SeriousTag) {
		return fail()
	}
	for _, s := range e.HelpLinesShown {
		if len(s) > 512 {
			return fail()
		}
	}
	for k, v := range e.AutoScore {
		if !ID(k) || !score(v) {
			return fail()
		}
	}
	var r Response
	if Decode([]byte(e.RawResponse), &r) != nil || !r.valid() {
		return fail()
	}
	if child && r.Kind == "typed" {
		return fail()
	}
	allowed := map[string][]string{
		"choose": {"choice"}, "pick_image": {"choice"}, "true_false": {"choice"}, "audio_match": {"choice"}, "story_choice": {"choice"}, "tap_hotspot": {"choice"},
		"type_in": {"typed"}, "number_input": {"number"}, "estimate_slider": {"number"}, "fill_blank": {"sequence"}, "tiles": {"sequence"}, "order": {"sequence"},
		"match_pairs": {"pairs"}, "sort_buckets": {"pairs"}, "memory_flip": {"pairs"}, "daily_puzzle": {"choice", "number"}, "trace": {"sequence"}, "story": {"choice"}, "info_card": {"choice"}, "mini_reading": {"choice"},
	}
	kinds, ok := allowed[e.ItemType]
	if !ok || (r.Kind != "dont_know" && !slices.Contains(kinds, r.Kind)) {
		return fail()
	}
	if one(e.ItemType, "story", "info_card", "mini_reading") && (r.OptionID == nil || *r.OptionID != "seen" || e.Outcome != "not_assessed") {
		return fail()
	}
	if *e.FreshEvidence && (e.HintUsed || !*e.FirstAttempt || e.Gem || one(e.Pool, "INSTR", "FOCUS", "GEM") || one(e.ItemType, "trace", "story", "info_card", "memory_flip", "daily_puzzle")) {
		return fail()
	}
	return e, nil
}
func (r Response) valid() bool {
	if !audio(r.AudioStatus) {
		return false
	}
	fields := 0
	if r.Text != nil {
		fields++
	}
	if r.OptionID != nil {
		fields++
	}
	if r.Value != nil {
		fields++
	}
	if r.Sequence != nil {
		fields++
	}
	if r.Pairs != nil {
		fields++
	}
	if r.Kind == "dont_know" {
		return fields == 0 && r.Ref == nil
	}
	if fields != 1 || r.Ref != nil && r.Kind != "typed" {
		return false
	}
	switch r.Kind {
	case "typed":
		return r.Text != nil && len(*r.Text) <= 2048 && strings.TrimSpace(*r.Text) != "" && (r.Ref == nil || one(*r.Ref, "laki-laki", "perempuan", "dont_know"))
	case "choice":
		return r.OptionID != nil && ID(*r.OptionID)
	case "number":
		return r.Value != nil && !math.IsNaN(*r.Value) && !math.IsInf(*r.Value, 0)
	case "sequence":
		if len(r.Sequence) == 0 || len(r.Sequence) > 100 {
			return false
		}
		for _, s := range r.Sequence {
			if !ID(s) {
				return false
			}
		}
		return true
	case "pairs":
		if len(r.Pairs) == 0 || len(r.Pairs) > 100 {
			return false
		}
		left := map[string]bool{}
		for _, p := range r.Pairs {
			if !ID(p.Left) || !ID(p.Right) || left[p.Left] {
				return false
			}
			left[p.Left] = true
		}
		return true
	}
	return false
}
