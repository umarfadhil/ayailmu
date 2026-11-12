package envelope

import "time"

// schemaSpec is what envelope v1 knows about one client record schema.
type schemaSpec struct {
	versions []int
	// validate mirrors the check the client's own store applies to a stored record.
	validate func(p *value) *Problem
	// trackOK reports whether the curriculum track agrees with the record.
	trackOK func(p *value, track string) bool
	// version checks schema_version against the record; nil when the record cannot disagree.
	version func(p *value, sv int) *Problem
	facts   func(p *value, at time.Time) Facts
}

var schemas = map[string]*schemaSpec{
	SchemaExpoAnswer: {
		versions: []int{1, 2},
		validate: validateExpo,
		// Expo records carry no track: the Expo family teaches Arabic only.
		trackOK: func(_ *value, track string) bool { return track == expoTrack },
		version: expoVersion,
		facts:   expoFacts,
	},
	SchemaKotlinAnswer: {
		versions: []int{1},
		validate: validateKotlin,
		trackOK: func(p *value, track string) bool {
			t, _ := p.stringMember("track")
			return t == track
		},
		// Kotlin records have no role, lineage, evidence mode or retention members.
		facts: commonFacts,
	},
}

const (
	expoTrack = "arab"
	// expoRecognition is the only evidence mode of a v2 (four-choice) Expo record.
	expoRecognition = "recognition-4"
)

var (
	expoOutcomes = setOf("correct", "wrong", "pending", "dont_know")
	expoUnits    = setOf("ENTRY", "A", "B")
	expoRoles    = setOf("practice", "remed", "focus", "review", "check")
)

// validateExpo is an exact port of answerProblem in ayailmu-publish app/src/storage/validate.ts, the
// check the Expo store applies to every stored answer before it opens. "Present" means the member
// exists whatever its value, as JavaScript's !== undefined does on parsed JSON. Members it does not
// check (synthetic, feedback_deferred, the v2 selection fields, ...) are kept as received.
func validateExpo(a *value) *Problem {
	bad := func(field string) *Problem { return invalidPayload(SchemaExpoAnswer, field) }
	for _, k := range []string{"answer_id", "item_id", "timestamp", "pool", "raw_response"} {
		if _, ok := a.stringMember(k); !ok {
			return bad(k)
		}
	}
	if d, ok := a.stringMember("local_date"); !ok || !dateShaped(d) {
		return bad("local_date")
	}
	if !a.stringIn("unit", expoUnits) {
		return bad("unit")
	}
	if v, ok := a.get("skills"); !ok || !v.isStringArray() {
		return bad("skills")
	}
	if !a.stringIn("outcome", expoOutcomes) {
		return bad("outcome")
	}
	if a.has("role") && !a.stringIn("role", expoRoles) {
		return bad("role")
	}
	if v, ok := a.get("lineage"); ok && v.kind != kindString {
		return bad("lineage")
	}
	if v, ok := a.get("serious_tag"); ok && v.kind != kindNull && v.kind != kindString {
		return bad("serious_tag")
	}
	for _, k := range []string{"fresh_evidence", "first_attempt", "hint_used"} {
		if v, ok := a.get(k); ok && v.kind != kindBool {
			return bad(k)
		}
	}
	// Retention provenance: when present it is exactly false.
	if v, ok := a.get("retention_valid"); ok && (v.kind != kindBool || v.boolean) {
		return bad("retention_valid")
	}
	if v, ok := a.get("exposure"); ok && !v.isStringArray() {
		return bad("exposure")
	}
	if v, ok := a.get("presented_options"); ok && !presentedOptionsOK(v) {
		return bad("presented_options")
	}
	return nil
}

// presentedOptionsOK: an array of objects that each have a string text.
func presentedOptionsOK(v *value) bool {
	if v.kind != kindArray {
		return false
	}
	for _, o := range v.elems {
		if o.kind != kindObject {
			return false
		}
		if _, ok := o.stringMember("text"); !ok {
			return false
		}
	}
	return true
}

// expoVersion applies schema_version = answer_schema ?? 1, with answer_schema typed as in
// storage/types.ts (absent, or the number 2). A v2 record is a four-choice recognition record
// (evidence_mode "recognition-4", never typed or constructed evidence); a v1 record has no evidence
// mode.
func expoVersion(a *value, sv int) *Problem {
	declared := 1
	if v, ok := a.get("answer_schema"); ok {
		if v.kind != kindNumber || v.str != "2" {
			return problem(CodeSchemaVersionMismatch, "payload.answer_schema must be absent or the number 2")
		}
		declared = 2
	}
	if declared != sv {
		return problem(CodeSchemaVersionMismatch, "schema_version differs from payload.answer_schema (absent means 1)")
	}
	mode, ok := a.get("evidence_mode")
	switch {
	case sv == 1 && ok:
		return problem(CodeSchemaVersionMismatch, "a version 1 record has no evidence_mode")
	case sv == 2 && (!ok || mode.kind != kindString || mode.str != expoRecognition):
		return problem(CodeSchemaVersionMismatch, `a version 2 record has evidence_mode "recognition-4"`)
	}
	return nil
}

// Kotlin serial names (core/model Lang, Pool, Outcome and PartScore, ErrorTag, AudioStatus,
// ReviewStatus, ItemType).
var (
	kotlinLangs          = setOf("id", "en")
	kotlinPools          = setOf("INSTR", "PRACT", "READY", "D7", "D30", "REMED", "TRANS", "SPARE", "MT", "ENTRY", "REPROBE", "FOCUS", "GEM")
	kotlinScores         = setOf("correct", "wrong", "pending", "dont_know", "not_assessed")
	kotlinErrorTags      = setOf("wrong-referent", "possession", "invented-action", "wrong-form", "lexical", "look-alike", "decoding", "ta-confusion", "wrong-speaker", "calculation", "misconception", "sequence")
	kotlinAudioStatuses  = setOf("played", "failed", "unavailable")
	kotlinReviewStatuses = setOf("draft", "reviewed_subject", "reviewed_language", "approved")
	kotlinItemTypes      = setOf("choose", "pick_image", "true_false", "type_in", "number_input", "fill_blank", "tiles", "order", "match_pairs", "sort_buckets", "audio_match", "mini_reading", "info_card", "tap_hotspot", "estimate_slider", "memory_flip", "story_choice", "speed_round", "daily_puzzle")
)

// validateKotlin accepts only records the Android app decodes as core/model AnswerEvent with its
// ContentJson settings (strict types, unknown keys ignored): members without a Kotlin default are
// required, members with one may be omitted, enums use the Kotlin serial names, null is accepted only
// for nullable members, and time_on_item_ms is an integer literal. Where kotlinx may also accept a
// spelling no Kotlin client writes, this check is the stricter one: it never passes a record the app
// would fail to decode.
func validateKotlin(a *value) *Problem {
	bad := func(field string) *Problem { return invalidPayload(SchemaKotlinAnswer, field) }
	for _, k := range []string{"answer_id", "learner_id", "item_id", "track", "content_version", "rules_version",
		"app_version", "timestamp", "local_date", "session_id", "unit", "raw_response"} {
		if _, ok := a.stringMember(k); !ok {
			return bad(k)
		}
	}
	for _, e := range []struct {
		key string
		set map[string]bool
	}{{"lang", kotlinLangs}, {"pool", kotlinPools}, {"outcome", kotlinScores}, {"review_status", kotlinReviewStatuses}, {"item_type", kotlinItemTypes}} {
		if !a.stringIn(e.key, e.set) {
			return bad(e.key)
		}
	}
	if v, ok := a.get("skills"); !ok || !v.isStringArray() {
		return bad("skills")
	}
	if v, ok := a.get("auto_score"); !ok || !v.isEnumObject(kotlinScores) {
		return bad("auto_score")
	}
	for _, k := range []string{"first_attempt", "fresh_evidence"} {
		if v, ok := a.get(k); !ok || v.kind != kindBool {
			return bad(k)
		}
	}
	// Members with a Kotlin default.
	for _, k := range []string{"hint_used", "report_flag", "synthetic", "gem"} {
		if v, ok := a.get(k); ok && v.kind != kindBool {
			return bad(k)
		}
	}
	if v, ok := a.get("error_tags"); ok && !v.isEnumArray(kotlinErrorTags) {
		return bad("error_tags")
	}
	if v, ok := a.get("serious_tag"); ok && v.kind != kindNull && !v.isEnum(kotlinErrorTags) {
		return bad("serious_tag")
	}
	if v, ok := a.get("help_lines_shown"); ok && !v.isStringArray() {
		return bad("help_lines_shown")
	}
	if v, ok := a.get("time_on_item_ms"); ok && !v.isInt64() {
		return bad("time_on_item_ms")
	}
	if v, ok := a.get("audio_status"); ok && v.kind != kindNull && !v.isEnum(kotlinAudioStatuses) {
		return bad("audio_status")
	}
	return nil
}

// commonFacts reads the members both families share; validation has typed the required ones.
func commonFacts(p *value, at time.Time) Facts {
	item, _ := p.stringMember("item_id")
	date, _ := p.stringMember("local_date")
	outcome, _ := p.stringMember("outcome")
	pool, _ := p.stringMember("pool")
	return Facts{
		ItemID:        item,
		OccurredAt:    at,
		LocalDate:     date,
		Outcome:       outcome,
		Pool:          pool,
		Skills:        p.stringList("skills"),
		FreshEvidence: p.optBool("fresh_evidence"),
		HintUsed:      p.optBool("hint_used"),
		Synthetic:     p.optBool("synthetic"),
	}
}

// expoFacts adds the Expo v2 provenance members, which v1 records do not have.
func expoFacts(p *value, at time.Time) Facts {
	f := commonFacts(p, at)
	f.Role = p.optString("role")
	f.Lineage = p.optString("lineage")
	f.EvidenceMode = p.optString("evidence_mode")
	f.RetentionValid = p.optBool("retention_valid")
	f.FeedbackDeferred = p.optBool("feedback_deferred")
	return f
}

func invalidPayload(schema, field string) *Problem {
	return problem(CodeInvalidPayload, schema+": payload."+field+" is missing or invalid")
}

func setOf(values ...string) map[string]bool {
	m := make(map[string]bool, len(values))
	for _, v := range values {
		m[v] = true
	}
	return m
}
