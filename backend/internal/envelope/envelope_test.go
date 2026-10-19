package envelope_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ayailmu.local/backend/internal/curriculum"
	"ayailmu.local/backend/internal/envelope"
)

// Synthetic records shaped exactly like the stored client records (Expo session.ts submitAnswer key
// order; Kotlin AnswerEvent with encodeDefaults=false, explicitNulls=false).
const baseV2Payload = `{"answer_id":"ans-t-1","learner_id":"lrn-t-1","item_id":"A3-M01","content_version":"demo-synthetic-0.3","rules_version":"pilot-0.3-local","app_version":"0.3.0","timestamp":"2026-10-16T02:00:01.000Z","local_date":"2026-10-16","session_id":"ses-t-1","pool":"PRACT","unit":"A","skills":["LEX-A:W-A3"],"raw_response":"{\"kind\":\"choice\",\"option_id\":\"k\"}","auto_score":{"answer":"correct"},"outcome":"correct","error_tags":[],"serious_tag":null,"hint_used":false,"help_lines_shown":[],"first_attempt":true,"fresh_evidence":true,"time_on_item_ms":5300,"audio_status":null,"report_flag":false,"review_status":"draft","synthetic":true,"answer_schema":2,"evidence_mode":"recognition-4","lineage":"A:word-form:صَادِقٌ","role":"practice","presented_options":[{"id":"d2","text":"sahabat","position":0},{"id":"d3","text":"orang yang sakit","position":1},{"id":"k","text":"orang yang jujur","position":2},{"id":"d1","text":"orang yang bersedekah","position":3}],"selected_option_id":"k","selected_position":2,"misconceptions":[]}`

const baseKotlinPayload = `{"answer_id":"ans-k-1","learner_id":"prf-k-1","item_id":"DEMO-M01","track":"arab","content_version":"demo-synthetic-0.1","rules_version":"pilot-0.1","app_version":"0.1.0","timestamp":"2026-10-17T02:03:04Z","local_date":"2026-10-17","session_id":"ses-k-1","lang":"id","pool":"PRACT","unit":"A","skills":["LEX-A:W-A3"],"raw_response":"{\"kind\":\"typed\",\"text\":\"orang yang jujur\"}","auto_score":{"meaning":"correct"},"outcome":"correct","first_attempt":true,"fresh_evidence":true,"time_on_item_ms":3100,"review_status":"draft","synthetic":true,"item_type":"type_in"}`

// parts builds an envelope from raw JSON fragments so each case can change exactly one thing.
type parts struct {
	version, eventID, kind, schema, schemaVersion, curriculum, source, payload, extra string
}

func expoParts() parts {
	return parts{
		version: `1`, eventID: `"ans-t-1"`, kind: `"answer"`, schema: `"expo.answer_record"`, schemaVersion: `2`,
		curriculum: `{"family":"expo-trial-arabic","track":"arab","content_version":"demo-synthetic-0.3","rules_version":"pilot-0.3-local"}`,
		source:     `{"app":"expo","install_id":"inst-t-a","app_version":"0.3.0","local_profile_id":"lrn-t-1"}`,
		payload:    baseV2Payload,
	}
}

func kotlinParts() parts {
	return parts{
		version: `1`, eventID: `"ans-k-1"`, kind: `"answer"`, schema: `"kotlin.answer_event"`, schemaVersion: `1`,
		curriculum: `{"family":"android-catalog","track":"arab","content_version":"demo-synthetic-0.1","rules_version":"pilot-0.1"}`,
		source:     `{"app":"android","install_id":"inst-k-a","app_version":"0.1.0","local_profile_id":"prf-k-1"}`,
		payload:    baseKotlinPayload,
	}
}

func (p parts) build() []byte {
	var b strings.Builder
	b.WriteString(`{"envelope_version":` + p.version)
	b.WriteString(`,"event_id":` + p.eventID)
	b.WriteString(`,"kind":` + p.kind)
	b.WriteString(`,"schema":` + p.schema)
	b.WriteString(`,"schema_version":` + p.schemaVersion)
	b.WriteString(`,"curriculum":` + p.curriculum)
	b.WriteString(`,"source":` + p.source)
	if p.payload != "" {
		b.WriteString(`,"payload":` + p.payload)
	}
	b.WriteString(p.extra)
	b.WriteString("}")
	return []byte(b.String())
}

func swap(t *testing.T, s, old, repl string) string {
	t.Helper()
	if !strings.Contains(s, old) {
		t.Fatalf("test setup: %q not found", old)
	}
	return strings.Replace(s, old, repl, 1)
}

// esc returns the JSON escape for one UTF-16 code unit. It is assembled at run time so the source
// holds no escape sequences that an editor or transport could silently decode.
func esc(hex4 string) string {
	return `\` + "u" + hex4
}

// runes builds a string from code points, independent of how the source file encodes them.
func runes(cps ...rune) string {
	return string(cps)
}

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "contract", "fixtures", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return raw
}

// payloadOf extracts the exact payload bytes of an envelope without re-encoding them.
func payloadOf(t *testing.T, env []byte) []byte {
	t.Helper()
	var e struct {
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(env, &e); err != nil || len(e.Payload) == 0 {
		t.Fatalf("envelope has no payload: %v", err)
	}
	return e.Payload
}

func parse(t *testing.T, raw []byte) envelope.Event {
	t.Helper()
	ev, err := envelope.Parse(raw, curriculum.Default())
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	return ev
}

func str(p *string) string {
	if p == nil {
		return "<absent>"
	}
	return *p
}

func boolean(p *bool) string {
	if p == nil {
		return "<absent>"
	}
	return fmt.Sprint(*p)
}

func factLine(f envelope.Facts) string {
	return fmt.Sprintf("item=%s at=%s date=%s outcome=%s pool=%s skills=%s role=%s lineage=%s mode=%s fresh=%s hint=%s synthetic=%s retention_valid=%s feedback_deferred=%s",
		f.ItemID, f.OccurredAt.UTC().Format(time.RFC3339Nano), f.LocalDate, f.Outcome, f.Pool, strings.Join(f.Skills, ","),
		str(f.Role), str(f.Lineage), str(f.EvidenceMode), boolean(f.FreshEvidence), boolean(f.HintUsed),
		boolean(f.Synthetic), boolean(f.RetentionValid), boolean(f.FeedbackDeferred))
}

func TestParseAcceptsContractFixturesLosslessly(t *testing.T) {
	cases := []struct {
		file   string
		schema string
		sv     int
		// facts uses {lineage} for the payload's own lineage value.
		facts string
	}{
		{"expo-v1-typed.envelope.json", envelope.SchemaExpoAnswer, 1,
			"item=DEMO-P01 at=2026-10-15T01:01:00Z date=2026-10-15 outcome=correct pool=PRACT skills=NOM-01,LEX-P3 role=<absent> lineage=<absent> mode=<absent> fresh=true hint=false synthetic=true retention_valid=<absent> feedback_deferred=<absent>"},
		{"expo-v1-pending.envelope.json", envelope.SchemaExpoAnswer, 1,
			"item=DEMO-M02 at=2026-10-15T01:02:00Z date=2026-10-15 outcome=pending pool=PRACT skills=LEX-A:W-A5 role=<absent> lineage=<absent> mode=<absent> fresh=true hint=false synthetic=true retention_valid=<absent> feedback_deferred=<absent>"},
		{"expo-v2-practice.envelope.json", envelope.SchemaExpoAnswer, 2,
			"item=A3-M01 at=2026-10-16T02:00:01Z date=2026-10-16 outcome=correct pool=PRACT skills=LEX-A:W-A3 role=practice lineage={lineage} mode=recognition-4 fresh=true hint=false synthetic=true retention_valid=<absent> feedback_deferred=<absent>"},
		{"expo-v2-check-deferred.envelope.json", envelope.SchemaExpoAnswer, 2,
			"item=A3-D7S1 at=2026-10-23T02:10:00Z date=2026-10-23 outcome=wrong pool=D7 skills=NOM-01,LEX-P3 role=check lineage={lineage} mode=recognition-4 fresh=true hint=false synthetic=true retention_valid=false feedback_deferred=true"},
		{"kotlin-v1-arab-type-in-hinted.envelope.json", envelope.SchemaKotlinAnswer, 1,
			"item=DEMO-M01 at=2026-10-17T02:03:04Z date=2026-10-17 outcome=correct pool=PRACT skills=LEX-A:W-A3 role=<absent> lineage=<absent> mode=<absent> fresh=false hint=true synthetic=true retention_valid=<absent> feedback_deferred=<absent>"},
		{"kotlin-v1-arab-choose-defaults-omitted.envelope.json", envelope.SchemaKotlinAnswer, 1,
			"item=DEMO-F01 at=2026-10-17T02:04:10.25Z date=2026-10-17 outcome=dont_know pool=PRACT skills=NOM-02 role=<absent> lineage=<absent> mode=<absent> fresh=true hint=<absent> synthetic=true retention_valid=<absent> feedback_deferred=<absent>"},
	}
	for _, c := range cases {
		t.Run(c.file, func(t *testing.T) {
			raw := fixture(t, c.file)
			payload := payloadOf(t, raw)
			var want struct {
				EventID    string              `json:"event_id"`
				Curriculum envelope.Curriculum `json:"curriculum"`
				Source     envelope.Source     `json:"source"`
			}
			var p struct {
				Lineage string `json:"lineage"`
			}
			if err := json.Unmarshal(raw, &want); err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal(payload, &p); err != nil {
				t.Fatal(err)
			}

			ev := parse(t, raw)
			if !bytes.Equal(ev.Payload, payload) {
				t.Fatalf("payload bytes changed:\n got %s\nwant %s", ev.Payload, payload)
			}
			if ev.EventID != want.EventID || ev.Kind != envelope.KindAnswer || ev.Schema != c.schema || ev.SchemaVersion != c.sv {
				t.Fatalf("envelope = %s/%s/%s@%d, want %s/answer/%s@%d", ev.EventID, ev.Kind, ev.Schema, ev.SchemaVersion, want.EventID, c.schema, c.sv)
			}
			if ev.Curriculum != want.Curriculum || ev.Source != want.Source {
				t.Fatalf("curriculum/source = %+v / %+v, want %+v / %+v", ev.Curriculum, ev.Source, want.Curriculum, want.Source)
			}
			if ev.CurriculumStatus != envelope.StatusRegistered {
				t.Fatalf("curriculum status = %q, want registered", ev.CurriculumStatus)
			}
			if got, wantFacts := factLine(ev.Facts), strings.ReplaceAll(c.facts, "{lineage}", p.Lineage); got != wantFacts {
				t.Fatalf("facts:\n got %s\nwant %s", got, wantFacts)
			}
			if ev.SemanticSHA256 == [32]byte{} {
				t.Fatal("semantic hash not computed")
			}
		})
	}
}

func TestParseKeepsExactPayloadBytes(t *testing.T) {
	// Whitespace, an escaped ASCII letter, an escaped slash and raw non-ASCII text must all survive.
	pretty := "{\n  " + strings.TrimPrefix(baseV2Payload, "{")
	pretty = swap(t, pretty, `,"skills":`, ",\n\t\"skills\" :  ")
	pretty = swap(t, pretty, `"text":"sahabat"`, `"text":"sah`+esc("0061")+`bat"`)
	pretty = swap(t, pretty, `"session_id":"ses-t-1"`, `"session_id":"ses-t-1","note":"  Dia  orangnya JUJUR!! `+esc("00e9")+` \/ `+runes(0x00e9)+`"`)
	pretty = strings.TrimSuffix(pretty, "}") + "\n}"
	p := expoParts()
	p.payload = pretty
	ev := parse(t, p.build())
	if !bytes.Equal(ev.Payload, []byte(pretty)) {
		t.Fatalf("payload bytes changed:\n got %q\nwant %q", ev.Payload, pretty)
	}
}

func TestParseAcceptsUnknownVersionsOfKnownFamiliesAsUnregistered(t *testing.T) {
	exU := expoParts()
	exU.curriculum = swap(t, exU.curriculum, "demo-synthetic-0.3", "demo-synthetic-0.9")
	exU.payload = swap(t, exU.payload, `"content_version":"demo-synthetic-0.3"`, `"content_version":"demo-synthetic-0.9"`)

	ktU := kotlinParts()
	ktU.curriculum = `{"family":"android-catalog","track":"sains","content_version":"sains-0.1","rules_version":"casual-0.1"}`
	ktU.payload = swap(t, ktU.payload, `"track":"arab"`, `"track":"sains"`)
	ktU.payload = swap(t, ktU.payload, `"content_version":"demo-synthetic-0.1"`, `"content_version":"sains-0.1"`)
	ktU.payload = swap(t, ktU.payload, `"rules_version":"pilot-0.1"`, `"rules_version":"casual-0.1"`)

	// Rules versions are recorded verbatim, not registered: a new rules version on a shipped pack
	// stays registered.
	exR := expoParts()
	exR.curriculum = swap(t, exR.curriculum, "pilot-0.3-local", "pilot-9.9-local")
	exR.payload = swap(t, exR.payload, `"rules_version":"pilot-0.3-local"`, `"rules_version":"pilot-9.9-local"`)

	cases := []struct {
		name string
		p    parts
		want string
	}{
		{"Expo base", expoParts(), envelope.StatusRegistered},
		{"Kotlin base", kotlinParts(), envelope.StatusRegistered},
		{"unshipped Expo content version", exU, envelope.StatusUnregistered},
		{"unshipped Android track", ktU, envelope.StatusUnregistered},
		{"new rules version on a shipped pack", exR, envelope.StatusRegistered},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			raw := c.p.build()
			ev := parse(t, raw)
			if ev.CurriculumStatus != c.want {
				t.Fatalf("curriculum status = %q, want %q", ev.CurriculumStatus, c.want)
			}
			if !bytes.Equal(ev.Payload, payloadOf(t, raw)) {
				t.Fatal("payload bytes changed")
			}
		})
	}
}

func TestParseRejectsInvalidEnvelopesWithStableCodes(t *testing.T) {
	ex, kt := expoParts(), kotlinParts()
	with := func(p parts, f func(*parts)) parts {
		f(&p)
		return p
	}
	payload := func(p parts, old, repl string) parts {
		p.payload = swap(t, p.payload, old, repl)
		return p
	}
	long := strings.Repeat("x", 129)

	cases := []struct {
		name string
		raw  []byte
		code string
	}{
		// JSON well-formedness
		{"truncated JSON", []byte(`{"envelope_version":1,`), envelope.CodeInvalidJSON},
		{"invalid UTF-8 in the payload", payload(ex, `"sahabat"`, "\"sah\xffabat\"").build(), envelope.CodeInvalidJSON},
		{"lone surrogate escape in the payload", payload(ex, `"sahabat"`, `"sah`+esc("d800")+`abat"`).build(), envelope.CodeInvalidJSON},
		{"trailing data after the envelope", append(ex.build(), []byte(` {}`)...), envelope.CodeInvalidJSON},
		{"duplicate envelope key", with(ex, func(p *parts) { p.extra = `,"kind":"answer"` }).build(), envelope.CodeDuplicateKey},
		{"duplicate payload key", payload(ex, `"outcome":"correct"`, `"outcome":"correct","outcome":"correct"`).build(), envelope.CodeDuplicateKey},
		{"duplicate key in a nested payload object", payload(ex, `{"id":"k","text"`, `{"id":"k","id":"k","text"`).build(), envelope.CodeDuplicateKey},
		{"duplicate payload key spelled with an escape", payload(ex, `"outcome":"correct"`, `"outcome":"correct","`+esc("006f")+`utcome":"correct"`).build(), envelope.CodeDuplicateKey},
		// envelope structure
		{"unknown envelope field", with(ex, func(p *parts) { p.extra = `,"received_at":"2026-10-17T00:00:00Z"` }).build(), envelope.CodeUnknownField},
		{"unknown curriculum field", with(ex, func(p *parts) { p.curriculum = swap(t, p.curriculum, `"track":"arab"`, `"track":"arab","lang":"id"`) }).build(), envelope.CodeUnknownField},
		{"unknown source field", with(ex, func(p *parts) { p.source = swap(t, p.source, `"app":"expo"`, `"app":"expo","device_model":"x"`) }).build(), envelope.CodeUnknownField},
		{"missing payload", with(ex, func(p *parts) { p.payload = "" }).build(), envelope.CodeMissingField},
		{"envelope version 2", with(ex, func(p *parts) { p.version = `2` }).build(), envelope.CodeUnsupportedEnvelopeVersion},
		{"event id with spaces", with(ex, func(p *parts) { p.eventID = `"ans t 1"` }).build(), envelope.CodeInvalidEventID},
		{"empty event id", with(ex, func(p *parts) { p.eventID = `""` }).build(), envelope.CodeInvalidEventID},
		{"event id longer than 128", with(ex, func(p *parts) { p.eventID = `"` + long + `"` }).build(), envelope.CodeInvalidEventID},
		{"session snapshot kind (never synced)", with(ex, func(p *parts) { p.kind = `"session_snapshot"` }).build(), envelope.CodeUnsupportedKind},
		{"screen view kind (deferred)", with(ex, func(p *parts) { p.kind = `"screen_view"` }).build(), envelope.CodeUnsupportedKind},
		{"item report kind (deferred)", with(ex, func(p *parts) { p.kind = `"item_report"` }).build(), envelope.CodeUnsupportedKind},
		{"unknown schema", with(ex, func(p *parts) { p.schema = `"expo.learner"` }).build(), envelope.CodeUnsupportedSchema},
		{"Expo schema version 3", with(ex, func(p *parts) { p.schemaVersion = `3` }).build(), envelope.CodeUnsupportedSchemaVersion},
		{"Kotlin schema version 2", with(kt, func(p *parts) { p.schemaVersion = `2` }).build(), envelope.CodeUnsupportedSchemaVersion},
		{"unknown family", with(ex, func(p *parts) { p.curriculum = swap(t, p.curriculum, envelope.FamilyExpo, "web-trial") }).build(), envelope.CodeUnknownFamily},
		{"Kotlin schema in the Expo family", with(ex, func(p *parts) { p.schema, p.schemaVersion = `"kotlin.answer_event"`, `1` }).build(), envelope.CodeSchemaFamilyMismatch},
		{"Android source in the Expo family", with(ex, func(p *parts) { p.source = swap(t, p.source, `"app":"expo"`, `"app":"android"`) }).build(), envelope.CodeSourceAppMismatch},
		{"source without install id", with(ex, func(p *parts) { p.source = `{"app":"expo","app_version":"0.3.0","local_profile_id":"lrn-t-1"}` }).build(), envelope.CodeInvalidSource},
		{"source with empty local profile id", with(ex, func(p *parts) { p.source = swap(t, p.source, `"local_profile_id":"lrn-t-1"`, `"local_profile_id":""`) }).build(), envelope.CodeInvalidSource},
		// payload shape and size
		{"payload is an array", with(ex, func(p *parts) { p.payload = `[1]` }).build(), envelope.CodePayloadNotObject},
		{"payload over 64 KiB", payload(ex, `"session_id":"ses-t-1"`, `"session_id":"`+strings.Repeat("s", 70000)+`"`).build(), envelope.CodePayloadTooLarge},
		// Expo validator: an exact port of storage/validate.ts answerProblem
		{"Expo outcome outside the vocabulary", payload(ex, `"outcome":"correct"`, `"outcome":"great"`).build(), envelope.CodeInvalidPayload},
		{"Expo unit outside the vocabulary", payload(ex, `"unit":"A"`, `"unit":"C"`).build(), envelope.CodeInvalidPayload},
		{"Expo skills not strings", payload(ex, `"skills":["LEX-A:W-A3"]`, `"skills":[1]`).build(), envelope.CodeInvalidPayload},
		{"Expo role outside the vocabulary", payload(ex, `"role":"practice"`, `"role":"teacher"`).build(), envelope.CodeInvalidPayload},
		{"Expo lineage not a string", payload(ex, `"lineage":"A:word-form:`, `"lineage":5,"x_was":"A:word-form:`).build(), envelope.CodeInvalidPayload},
		{"Expo serious_tag not a string", payload(ex, `"serious_tag":null`, `"serious_tag":1`).build(), envelope.CodeInvalidPayload},
		{"Expo fresh_evidence not a boolean", payload(ex, `"fresh_evidence":true`, `"fresh_evidence":"yes"`).build(), envelope.CodeInvalidPayload},
		{"Expo first_attempt null", payload(ex, `"first_attempt":true`, `"first_attempt":null`).build(), envelope.CodeInvalidPayload},
		{"Expo retention_valid true", payload(ex, `"misconceptions":[]`, `"misconceptions":[],"retention_valid":true`).build(), envelope.CodeInvalidPayload},
		{"Expo exposure not an array", payload(ex, `"misconceptions":[]`, `"misconceptions":[],"exposure":"guide:DEMO-S4"`).build(), envelope.CodeInvalidPayload},
		{"Expo presented option without text", payload(ex, `{"id":"d2","text":"sahabat","position":0}`, `{"id":"d2","position":0}`).build(), envelope.CodeInvalidPayload},
		{"Expo raw_response not a string", payload(ex, `"raw_response":"{\"kind\":\"choice\",\"option_id\":\"k\"}"`, `"raw_response":{"kind":"choice"}`).build(), envelope.CodeInvalidPayload},
		{"Expo local_date not YYYY-MM-DD", payload(ex, `"local_date":"2026-10-16"`, `"local_date":"16-10-2026"`).build(), envelope.CodeInvalidPayload},
		{"Expo item_id missing", payload(ex, `"item_id":"A3-M01",`, ``).build(), envelope.CodeInvalidPayload},
		// Kotlin validator: fields without a Kotlin default are required; enums use Kotlin vocabularies
		{"Kotlin item_type missing", payload(kt, `,"item_type":"type_in"`, ``).build(), envelope.CodeInvalidPayload},
		{"Kotlin first_attempt missing", payload(kt, `"first_attempt":true,`, ``).build(), envelope.CodeInvalidPayload},
		{"Kotlin lang outside the vocabulary", payload(kt, `"lang":"id"`, `"lang":"ar"`).build(), envelope.CodeInvalidPayload},
		{"Kotlin pool REVIEW (an Expo-only pool)", payload(kt, `"pool":"PRACT"`, `"pool":"REVIEW"`).build(), envelope.CodeInvalidPayload},
		{"Kotlin review_status in the Expo vocabulary", payload(kt, `"review_status":"draft"`, `"review_status":"reviewed-arabic"`).build(), envelope.CodeInvalidPayload},
		{"Kotlin auto_score part outside the vocabulary", payload(kt, `"auto_score":{"meaning":"correct"}`, `"auto_score":{"meaning":"great"}`).build(), envelope.CodeInvalidPayload},
		{"Kotlin time_on_item_ms not an integer", payload(kt, `"time_on_item_ms":3100`, `"time_on_item_ms":1.5`).build(), envelope.CodeInvalidPayload},
		{"Kotlin synthetic not a boolean", payload(kt, `"synthetic":true`, `"synthetic":"true"`).build(), envelope.CodeInvalidPayload},
		{"Kotlin item_type outside the catalog", payload(kt, `"item_type":"type_in"`, `"item_type":"mcq4"`).build(), envelope.CodeInvalidPayload},
		// envelope/payload consistency
		{"event id differs from answer_id", with(ex, func(p *parts) { p.eventID = `"ans-t-2"` }).build(), envelope.CodeEventIDMismatch},
		{"content version differs from the payload", with(ex, func(p *parts) { p.curriculum = swap(t, p.curriculum, "demo-synthetic-0.3", "demo-synthetic-0.2") }).build(), envelope.CodeCurriculumMismatch},
		{"rules version differs from the payload", with(ex, func(p *parts) { p.curriculum = swap(t, p.curriculum, "pilot-0.3-local", "pilot-0.2-local") }).build(), envelope.CodeCurriculumMismatch},
		{"Kotlin track differs from the payload", with(kt, func(p *parts) { p.curriculum = swap(t, p.curriculum, `"track":"arab"`, `"track":"mat"`) }).build(), envelope.CodeCurriculumMismatch},
		{"Expo family track other than arab", with(ex, func(p *parts) { p.curriculum = swap(t, p.curriculum, `"track":"arab"`, `"track":"mat"`) }).build(), envelope.CodeCurriculumMismatch},
		{"Expo v2 record declared as schema version 1", with(ex, func(p *parts) { p.schemaVersion = `1` }).build(), envelope.CodeSchemaVersionMismatch},
		{"Expo record without answer_schema declared as version 2", payload(ex, `"answer_schema":2,`, ``).build(), envelope.CodeSchemaVersionMismatch},
		{"Expo evidence_mode without answer_schema declared as version 1", with(payload(ex, `"answer_schema":2,`, ``), func(p *parts) { p.schemaVersion = `1` }).build(), envelope.CodeSchemaVersionMismatch},
		{"Expo answer_schema as a string", payload(ex, `"answer_schema":2`, `"answer_schema":"2"`).build(), envelope.CodeSchemaVersionMismatch},
		{"Expo v2 record with another evidence mode", payload(ex, `"evidence_mode":"recognition-4"`, `"evidence_mode":"typed"`).build(), envelope.CodeSchemaVersionMismatch},
		{"payload learner differs from the source profile", with(ex, func(p *parts) { p.source = swap(t, p.source, `"local_profile_id":"lrn-t-1"`, `"local_profile_id":"lrn-t-other"`) }).build(), envelope.CodeLearnerMismatch},
		// timestamps and dates
		{"timestamp not RFC 3339", payload(ex, `"timestamp":"2026-10-16T02:00:01.000Z"`, `"timestamp":"yesterday"`).build(), envelope.CodeInvalidTimestamp},
		{"timestamp without an offset", payload(ex, `"timestamp":"2026-10-16T02:00:01.000Z"`, `"timestamp":"2026-10-16T02:00:01.000"`).build(), envelope.CodeInvalidTimestamp},
		{"impossible local date", payload(ex, `"local_date":"2026-10-16"`, `"local_date":"2026-02-30"`).build(), envelope.CodeInvalidLocalDate},
	}
	reg := curriculum.Default()
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ev, err := envelope.Parse(c.raw, reg)
			var p *envelope.Problem
			if !errors.As(err, &p) {
				t.Fatalf("Parse = event %q, %v; want *envelope.Problem with code %s", ev.EventID, err, c.code)
			}
			if p.Code != c.code {
				t.Fatalf("code = %s (%s), want %s", p.Code, p.Detail, c.code)
			}
			if len(p.Error()) > 512 {
				t.Fatal("problem detail echoes request content")
			}
		})
	}
}

func TestCanonicalizeVectors(t *testing.T) {
	eAcute := runes(0x00e9)
	sadiqun := runes(0x0635, 0x064e, 0x0627, 0x062f, 0x0650, 0x0642, 0x064c)
	cases := []struct {
		name, in, want string
	}{
		{"whitespace and member order", ` { "b" : 1 , "a" : [ true , null , false ] } `, `{"a":[true,null,false],"b":1}`},
		{"nested objects sorted, array order kept", `{"z":{"y":2,"x":[{"b":1,"a":2},3]},"a":0}`, `{"a":0,"z":{"x":[{"a":2,"b":1},3],"y":2}}`},
		{"keys sorted by UTF-8 bytes", `{"` + eAcute + `":1,"z":2,"A":3,"a":4,"_":5}`, `{"A":3,"_":5,"a":4,"z":2,"` + eAcute + `":1}`},
		{"numbers kept as literal text", `{"a":1.50,"b":-0,"c":1e3,"d":12345678901234567890}`, `{"a":1.50,"b":-0,"c":1e3,"d":12345678901234567890}`},
		{"needless escapes removed", `{"s":"` + esc("00e9") + esc("0041") + `\/"}`, `{"s":"` + eAcute + `A/"}`},
		{"control characters escaped minimally",
			`{"s":"` + esc("0001") + esc("001F") + esc("0008") + esc("000c") + esc("000A") + esc("000d") + esc("0009") + `"}`,
			`{"s":"` + esc("0001") + esc("001f") + `\b\f\n\r\t"}`},
		{"quote and backslash", `{"s":"a\"b\\c"}`, `{"s":"a\"b\\c"}`},
		{"Arabic decoded from escapes",
			`{"s":"` + esc("0635") + esc("064e") + esc("0627") + esc("062f") + esc("0650") + esc("0642") + esc("064c") + `"}`,
			`{"s":"` + sadiqun + `"}`},
		{"surrogate pair decoded", `{"s":"` + esc("d83d") + esc("de00") + `"}`, `{"s":"` + runes(0x1f600) + `"}`},
		{"DEL and U+2028 become literal", `{"s":"` + esc("007f") + esc("2028") + `"}`, `{"s":"` + runes(0x7f, 0x2028) + `"}`},
		{"top-level scalar", ` "x" `, `"x"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := envelope.Canonicalize([]byte(c.in))
			if err != nil {
				t.Fatalf("Canonicalize: %v", err)
			}
			if string(got) != c.want {
				t.Fatalf("Canonicalize = %q, want %q", got, c.want)
			}
		})
	}

	bad := []struct {
		name, in, code string
	}{
		{"duplicate key", `{"a":1,"a":1}`, envelope.CodeDuplicateKey},
		{"duplicate key after unescaping", `{"a":1,"` + esc("0061") + `":2}`, envelope.CodeDuplicateKey},
		{"nested duplicate key", `{"x":[{"k":1,"k":2}]}`, envelope.CodeDuplicateKey},
		{"invalid UTF-8", "{\"a\":\"\xff\"}", envelope.CodeInvalidJSON},
		{"lone high surrogate", `{"a":"` + esc("d800") + `"}`, envelope.CodeInvalidJSON},
		{"lone low surrogate", `{"a":"` + esc("dc00") + `x"}`, envelope.CodeInvalidJSON},
		{"high surrogate followed by a non-surrogate", `{"a":"` + esc("d83d") + esc("0041") + `"}`, envelope.CodeInvalidJSON},
		{"trailing data", `{"a":1} {"b":2}`, envelope.CodeInvalidJSON},
		{"truncated", `{"a":`, envelope.CodeInvalidJSON},
		{"empty input", ``, envelope.CodeInvalidJSON},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			got, err := envelope.Canonicalize([]byte(c.in))
			var p *envelope.Problem
			if !errors.As(err, &p) || p.Code != c.code {
				t.Fatalf("Canonicalize = %q, %v; want *envelope.Problem %s", got, err, c.code)
			}
		})
	}
}

func TestSemanticHashFollowsTheDocumentedInputAndIgnoresTransport(t *testing.T) {
	base := parse(t, expoParts().build())
	canon, err := envelope.Canonicalize([]byte(baseV2Payload))
	if err != nil {
		t.Fatalf("Canonicalize: %v", err)
	}
	want := sha256.Sum256([]byte(`{"curriculum":{"content_version":"demo-synthetic-0.3","family":"expo-trial-arabic","rules_version":"pilot-0.3-local","track":"arab"},"kind":"answer","payload":` + string(canon) + `,"schema":"expo.answer_record","schema_version":2}`))
	if base.SemanticSHA256 != want {
		t.Fatalf("semantic hash = %x, want SHA-256 of the documented aya-cjson-1 input %x", base.SemanticSHA256, want)
	}

	upgraded := expoParts()
	upgraded.source = `{"app":"expo","install_id":"inst-t-reinstalled","app_version":"0.4.0","local_profile_id":"lrn-t-1"}`

	body := swap(t, baseV2Payload, `{"answer_id":"ans-t-1",`, `{`)
	reorderedPayload := strings.TrimSuffix(body, "}") + `, "answer_id" : "ans-t-1" }`
	reordered := []byte(" {\n \"payload\" : " + reorderedPayload + ` , "source":` + expoParts().source +
		`, "curriculum" : {"rules_version":"pilot-0.3-local","content_version":"demo-synthetic-0.3","track":"arab","family":"expo-trial-arabic"},` +
		` "schema_version":2,"schema":"expo.answer_record","kind":"answer","event_id":"ans-t-1","envelope_version":1 } `)

	escaped := expoParts()
	escaped.payload = swap(t, escaped.payload, `"text":"orang yang jujur"`, `"text":"orang yang `+esc("006a")+`ujur"`)

	same := []struct {
		name string
		raw  []byte
	}{
		{"reinstalled app sends a newer app version", upgraded.build()},
		{"members reordered with whitespace", reordered},
		{"string written with an escape", escaped.build()},
	}
	for _, c := range same {
		t.Run(c.name, func(t *testing.T) {
			ev := parse(t, c.raw)
			if ev.SemanticSHA256 != base.SemanticSHA256 {
				t.Fatal("semantic hash changed for a semantically identical retry")
			}
		})
	}
}

func TestSemanticHashDistinguishesValidChanges(t *testing.T) {
	base := parse(t, expoParts().build())
	payload := func(pairs ...string) parts {
		p := expoParts()
		for i := 0; i+1 < len(pairs); i += 2 {
			p.payload = swap(t, p.payload, pairs[i], pairs[i+1])
		}
		return p
	}
	rules := payload(`"rules_version":"pilot-0.3-local"`, `"rules_version":"pilot-0.4-local"`)
	rules.curriculum = swap(t, rules.curriculum, "pilot-0.3-local", "pilot-0.4-local")

	changes := []struct {
		name string
		p    parts
	}{
		{"another option selected", payload(
			`"raw_response":"{\"kind\":\"choice\",\"option_id\":\"k\"}"`, `"raw_response":"{\"kind\":\"choice\",\"option_id\":\"d1\"}"`,
			`"auto_score":{"answer":"correct"},"outcome":"correct"`, `"auto_score":{"answer":"wrong"},"outcome":"wrong"`,
			`"selected_option_id":"k","selected_position":2`, `"selected_option_id":"d1","selected_position":3`)},
		{"deferred feedback recorded", payload(`"misconceptions":[]`, `"misconceptions":[],"feedback_deferred":true`)},
		{"same-day exposure recorded", payload(`"misconceptions":[]`, `"misconceptions":[],"retention_valid":false,"exposure":["guide:DEMO-S4"]`)},
		{"synthetic flag flipped", payload(`"synthetic":true`, `"synthetic":false`)},
		{"hint used", payload(`"hint_used":false`, `"hint_used":true`)},
		{"time on item", payload(`"time_on_item_ms":5300`, `"time_on_item_ms":5301`)},
		{"number literal form (numbers compare as text)", payload(`"time_on_item_ms":5300`, `"time_on_item_ms":5.3e3`)},
		{"rules version", rules},
	}
	for _, c := range changes {
		t.Run(c.name, func(t *testing.T) {
			ev := parse(t, c.p.build())
			if ev.SemanticSHA256 == base.SemanticSHA256 {
				t.Fatal("a changed event has the same semantic hash")
			}
		})
	}
}
