// Package envelope parses and validates event envelope v1, the transport wrapper around one
// client-stored answer record, and computes its canonical semantic hash.
//
// The payload is the client's stored record, kept as the exact bytes received. The server never adds
// defaults, never re-grades, and never rewrites provenance (raw_response, presented options, role,
// exposure, retention_valid, feedback_deferred, synthetic, review_status, hint and help flags).
// Validation mirrors what each client's own store requires to replay a record, so a pulled event can
// never make a client refuse to open its store.
package envelope

import (
	"bytes"
	"crypto/sha256"
	"slices"
	"strconv"
	"strings"
	"time"

	"ayailmu.local/backend/internal/curriculum"
)

// Contract constants.
const (
	Version = 1

	KindAnswer = "answer"

	SchemaExpoAnswer   = "expo.answer_record"
	SchemaKotlinAnswer = "kotlin.answer_event"

	FamilyExpo    = "expo-trial-arabic"
	FamilyAndroid = "android-catalog"

	// StatusRegistered: (family, track, content_version) is in the curriculum registry.
	StatusRegistered = "registered"
	// StatusUnregistered: known family, unknown track or content version. Stored losslessly and
	// excluded from progress counts.
	StatusUnregistered = "unregistered"

	MaxPayloadBytes = 64 << 10
)

// Problem codes. Stable: they are part of the API contract. Parse checks in this order and reports
// the first failure: JSON well-formedness, envelope structure, payload shape and size, the family
// validator, envelope/payload consistency, then timestamps and dates.
const (
	CodeInvalidJSON                = "invalid_json"
	CodeDuplicateKey               = "duplicate_key"
	CodeUnknownField               = "unknown_envelope_field"
	CodeMissingField               = "missing_envelope_field"
	CodeUnsupportedEnvelopeVersion = "unsupported_envelope_version"
	CodeInvalidEventID             = "invalid_event_id"
	CodeUnsupportedKind            = "unsupported_kind"
	CodeUnsupportedSchema          = "unsupported_schema"
	CodeUnsupportedSchemaVersion   = "unsupported_schema_version"
	CodeUnknownFamily              = "unknown_family"
	CodeSchemaFamilyMismatch       = "schema_family_mismatch"
	CodeSourceAppMismatch          = "source_app_mismatch"
	CodeInvalidSource              = "invalid_source"
	CodePayloadNotObject           = "payload_not_object"
	CodePayloadTooLarge            = "payload_too_large"
	CodeInvalidPayload             = "invalid_payload"
	CodeEventIDMismatch            = "event_id_mismatch"
	CodeCurriculumMismatch         = "curriculum_mismatch"
	CodeSchemaVersionMismatch      = "schema_version_mismatch"
	CodeLearnerMismatch            = "learner_mismatch"
	CodeInvalidTimestamp           = "invalid_timestamp"
	CodeInvalidLocalDate           = "invalid_local_date"
)

// Problem is a validation failure with a stable code. Detail never echoes payload content.
type Problem struct {
	Code   string
	Detail string
}

func (p *Problem) Error() string {
	return p.Code + ": " + p.Detail
}

func problem(code, detail string) *Problem {
	return &Problem{Code: code, Detail: detail}
}

// Curriculum is the envelope's claim about what the payload was recorded against.
type Curriculum struct {
	Family         string `json:"family"`
	Track          string `json:"track"`
	ContentVersion string `json:"content_version"`
	RulesVersion   string `json:"rules_version"`
}

// Source describes the sending install. It is transport metadata: it is stored with the first
// accepted copy and excluded from the semantic hash.
type Source struct {
	App            string `json:"app"`
	InstallID      string `json:"install_id"`
	AppVersion     string `json:"app_version"`
	LocalProfileID string `json:"local_profile_id"`
}

// Facts are values read from the payload for indexing and factual counts. Pointer fields are nil
// when the payload omits the field; nothing is defaulted. They are also nil for members the record's
// family does not have, and when a member the family's store leaves unchecked (Expo synthetic and
// feedback_deferred) holds another JSON type.
type Facts struct {
	ItemID string
	// OccurredAt is payload.timestamp parsed as RFC 3339 (an offset is required).
	OccurredAt       time.Time
	LocalDate        string
	Outcome          string
	Pool             string
	Skills           []string
	Role             *string
	Lineage          *string
	EvidenceMode     *string
	FreshEvidence    *bool
	HintUsed         *bool
	Synthetic        *bool
	RetentionValid   *bool
	FeedbackDeferred *bool
}

// Event is a validated envelope.
type Event struct {
	EventID       string
	Kind          string
	Schema        string
	SchemaVersion int
	Curriculum    Curriculum
	Source        Source
	// Payload holds the exact payload bytes as received.
	Payload []byte
	// SemanticSHA256 = SHA-256(aya-cjson-1({curriculum, kind, payload, schema, schema_version})).
	SemanticSHA256 [32]byte
	// CurriculumStatus is StatusRegistered or StatusUnregistered.
	CurriculumStatus string
	Facts            Facts
}

// Member names: envelope v1 has exactly these, and so do its curriculum and source objects.
var (
	envelopeFields   = []string{"envelope_version", "event_id", "kind", "schema", "schema_version", "curriculum", "source", "payload"}
	curriculumFields = []string{"family", "track", "content_version", "rules_version"}
	sourceFields     = []string{"app", "install_id", "app_version", "local_profile_id"}
)

// maxIDBytes bounds the event ID and each source identifier.
const maxIDBytes = 128

// Parse validates one envelope against the registry. Failures are *Problem values.
func Parse(raw []byte, reg *curriculum.Registry) (Event, error) {
	root, prob := decode(raw)
	if prob != nil {
		return Event{}, prob
	}
	ev, prob := build(root, reg)
	if prob != nil {
		return Event{}, prob
	}
	return ev, nil
}

// build runs every check after JSON well-formedness, in the documented order.
func build(root *value, reg *curriculum.Registry) (Event, *Problem) {
	// Envelope structure.
	if root.kind != kindObject {
		return Event{}, problem(CodeMissingField, "the envelope is not a JSON object")
	}
	curV, _ := root.get("curriculum")
	srcV, _ := root.get("source")
	switch {
	case hasUnknown(root, envelopeFields):
		return Event{}, problem(CodeUnknownField, "the envelope has a member outside envelope v1")
	case hasUnknown(curV, curriculumFields):
		return Event{}, problem(CodeUnknownField, "curriculum has a member outside envelope v1")
	case hasUnknown(srcV, sourceFields):
		return Event{}, problem(CodeUnknownField, "source has a member outside envelope v1")
	}
	for _, name := range envelopeFields {
		if !root.has(name) {
			return Event{}, problem(CodeMissingField, name+" is missing")
		}
	}
	cur, prob := curriculumOf(curV)
	if prob != nil {
		return Event{}, prob
	}
	if v, _ := root.get("envelope_version"); v.kind != kindNumber || v.str != strconv.Itoa(Version) {
		return Event{}, problem(CodeUnsupportedEnvelopeVersion, "envelope_version must be 1")
	}
	eventID, ok := root.stringMember("event_id")
	if !ok || !validEventID(eventID) {
		return Event{}, problem(CodeInvalidEventID, "event_id must match [A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
	}
	if kind, _ := root.stringMember("kind"); kind != KindAnswer {
		return Event{}, problem(CodeUnsupportedKind, `kind must be "answer"; session snapshots are never synced`)
	}
	schema, _ := root.stringMember("schema")
	spec := schemas[schema]
	if spec == nil {
		return Event{}, problem(CodeUnsupportedSchema, "schema must be expo.answer_record or kotlin.answer_event")
	}
	svV, _ := root.get("schema_version")
	sv, ok := versionOf(svV, spec.versions)
	if !ok {
		return Event{}, problem(CodeUnsupportedSchemaVersion, "schema_version is not a supported version of the schema")
	}
	fam, ok := reg.Family(cur.Family)
	if !ok {
		return Event{}, problem(CodeUnknownFamily, "curriculum.family is not a registered family")
	}
	if fam.Schema != schema {
		return Event{}, problem(CodeSchemaFamilyMismatch, "schema is not the family's schema")
	}
	if !slices.Contains(fam.SchemaVersions, sv) {
		return Event{}, problem(CodeUnsupportedSchemaVersion, "schema_version is not registered for the family")
	}
	src, prob := sourceOf(srcV, fam.App)
	if prob != nil {
		return Event{}, prob
	}

	// Payload shape and size.
	payload, _ := root.get("payload")
	if payload.kind != kindObject {
		return Event{}, problem(CodePayloadNotObject, "payload must be a JSON object")
	}
	if len(payload.raw) > MaxPayloadBytes {
		return Event{}, problem(CodePayloadTooLarge, "payload exceeds 65536 bytes")
	}

	// The family validator, then envelope/payload consistency.
	if prob := spec.validate(payload); prob != nil {
		return Event{}, prob
	}
	if prob := consistent(spec, payload, eventID, cur, sv, src); prob != nil {
		return Event{}, prob
	}

	// Timestamps and dates; both validators have typed these members as strings.
	ts, _ := payload.stringMember("timestamp")
	at, ok := parseTimestamp(ts)
	if !ok {
		return Event{}, problem(CodeInvalidTimestamp, "payload.timestamp must be an RFC 3339 date-time with an offset")
	}
	if date, _ := payload.stringMember("local_date"); !validDate(date) {
		return Event{}, problem(CodeInvalidLocalDate, "payload.local_date must be a real YYYY-MM-DD date")
	}

	status := StatusUnregistered
	if _, ok := reg.Pack(cur.Family, cur.Track, cur.ContentVersion); ok {
		status = StatusRegistered
	}
	return Event{
		EventID:          eventID,
		Kind:             KindAnswer,
		Schema:           schema,
		SchemaVersion:    sv,
		Curriculum:       cur,
		Source:           src,
		Payload:          bytes.Clone(payload.raw),
		SemanticSHA256:   semanticHash(cur, schema, sv, payload),
		CurriculumStatus: status,
		Facts:            spec.facts(payload, at),
	}, nil
}

// hasUnknown reports whether v is an object with a member outside allowed.
func hasUnknown(v *value, allowed []string) bool {
	if v == nil {
		return false
	}
	for _, m := range v.members {
		if !slices.Contains(allowed, m.key) {
			return true
		}
	}
	return false
}

// curriculumOf reads the curriculum object: four non-empty strings.
func curriculumOf(v *value) (Curriculum, *Problem) {
	if v.kind != kindObject {
		return Curriculum{}, problem(CodeMissingField, "curriculum must be an object")
	}
	var c Curriculum
	for _, f := range []struct {
		name string
		dst  *string
	}{{"family", &c.Family}, {"track", &c.Track}, {"content_version", &c.ContentVersion}, {"rules_version", &c.RulesVersion}} {
		m, ok := v.get(f.name)
		if !ok {
			return Curriculum{}, problem(CodeMissingField, "curriculum."+f.name+" is missing")
		}
		if m.kind != kindString || m.str == "" {
			return Curriculum{}, problem(CodeMissingField, "curriculum."+f.name+" must be a non-empty string")
		}
		*f.dst = m.str
	}
	return c, nil
}

// sourceOf reads the source object. Its app must be the family's app, and every member is a non-empty
// string of at most maxIDBytes bytes.
func sourceOf(v *value, familyApp string) (Source, *Problem) {
	if v.kind != kindObject {
		return Source{}, problem(CodeInvalidSource, "source must be an object")
	}
	app, ok := v.stringMember("app")
	if !ok || app == "" {
		return Source{}, problem(CodeInvalidSource, "source.app must be a non-empty string")
	}
	if app != familyApp {
		return Source{}, problem(CodeSourceAppMismatch, "source.app is not the family's app")
	}
	s := Source{App: app}
	for _, f := range []struct {
		name string
		dst  *string
	}{{"install_id", &s.InstallID}, {"app_version", &s.AppVersion}, {"local_profile_id", &s.LocalProfileID}} {
		val, ok := v.stringMember(f.name)
		if !ok || val == "" || len(val) > maxIDBytes {
			return Source{}, problem(CodeInvalidSource, "source."+f.name+" must be a non-empty string of at most 128 bytes")
		}
		*f.dst = val
	}
	return s, nil
}

// validEventID matches [A-Za-z0-9][A-Za-z0-9._:-]{0,127}; client answer IDs ("ans-" and a UUID) fit.
func validEventID(s string) bool {
	if s == "" || len(s) > maxIDBytes {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		alnum := (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
		if !alnum && (i == 0 || (c != '.' && c != '_' && c != ':' && c != '-')) {
			return false
		}
	}
	return true
}

// versionOf accepts schema_version written as the plain decimal literal of a supported version.
func versionOf(v *value, versions []int) (int, bool) {
	if v.kind == kindNumber {
		for _, n := range versions {
			if v.str == strconv.Itoa(n) {
				return n, true
			}
		}
	}
	return 0, false
}

// consistent checks that the envelope repeats the record's own claims.
func consistent(spec *schemaSpec, p *value, eventID string, cur Curriculum, sv int, src Source) *Problem {
	if id, _ := p.stringMember("answer_id"); id != eventID {
		return problem(CodeEventIDMismatch, "event_id differs from payload.answer_id")
	}
	if !spec.trackOK(p, cur.Track) {
		return problem(CodeCurriculumMismatch, "curriculum.track does not match the record")
	}
	if v, ok := p.stringMember("content_version"); !ok || v != cur.ContentVersion {
		return problem(CodeCurriculumMismatch, "curriculum.content_version differs from payload.content_version")
	}
	if v, ok := p.stringMember("rules_version"); !ok || v != cur.RulesVersion {
		return problem(CodeCurriculumMismatch, "curriculum.rules_version differs from payload.rules_version")
	}
	if spec.version != nil {
		if prob := spec.version(p, sv); prob != nil {
			return prob
		}
	}
	if v, ok := p.stringMember("learner_id"); !ok || v != src.LocalProfileID {
		return problem(CodeLearnerMismatch, "source.local_profile_id differs from payload.learner_id")
	}
	return nil
}

// semanticHash is SHA-256 of aya-cjson-1({curriculum, kind, payload, schema, schema_version}). The
// event ID repeats payload.answer_id; source and envelope_version are transport and stay out, so a
// retry from an upgraded or reinstalled app is identical.
func semanticHash(cur Curriculum, schema string, sv int, payload *value) [32]byte {
	str := func(s string) *value { return &value{kind: kindString, str: s} }
	doc := &value{kind: kindObject, members: []member{
		{"curriculum", &value{kind: kindObject, members: []member{
			{"family", str(cur.Family)},
			{"track", str(cur.Track)},
			{"content_version", str(cur.ContentVersion)},
			{"rules_version", str(cur.RulesVersion)},
		}}},
		{"kind", str(KindAnswer)},
		{"payload", payload},
		{"schema", str(schema)},
		{"schema_version", &value{kind: kindNumber, str: strconv.Itoa(sv)}},
	}}
	return sha256.Sum256(appendCanonical(nil, doc))
}

// parseTimestamp accepts an RFC 3339 date-time with an explicit offset: YYYY-MM-DDTHH:MM:SS, an
// optional fraction of 1 to 9 digits, then Z or ±HH:MM. time.Parse then checks every range.
func parseTimestamp(s string) (time.Time, bool) {
	if len(s) < 20 || !dateShaped(s[:10]) || s[10] != 'T' || !digitsAt(s, 11, 13) || s[13] != ':' ||
		!digitsAt(s, 14, 16) || s[16] != ':' || !digitsAt(s, 17, 19) {
		return time.Time{}, false
	}
	rest := s[19:]
	if strings.HasPrefix(rest, ".") {
		n := 1
		for n < len(rest) && rest[n] >= '0' && rest[n] <= '9' {
			n++
		}
		if n == 1 || n > 10 {
			return time.Time{}, false
		}
		rest = rest[n:]
	}
	offset := len(rest) == 6 && (rest[0] == '+' || rest[0] == '-') && digitsAt(rest, 1, 3) && rest[3] == ':' && digitsAt(rest, 4, 6)
	if rest != "Z" && !offset {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	return t, err == nil
}

func digitsAt(s string, from, to int) bool {
	for i := from; i < to; i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// dateShaped is the Expo store's /^\d{4}-\d{2}-\d{2}$/.
func dateShaped(s string) bool {
	if len(s) != 10 || s[4] != '-' || s[7] != '-' {
		return false
	}
	return digitsAt(s, 0, 4) && digitsAt(s, 5, 7) && digitsAt(s, 8, 10)
}

// validDate accepts a real calendar date written YYYY-MM-DD.
func validDate(s string) bool {
	if !dateShaped(s) {
		return false
	}
	_, err := time.Parse(time.DateOnly, s)
	return err == nil
}
