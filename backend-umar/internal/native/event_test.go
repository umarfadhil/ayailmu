package native

import (
	"encoding/json"
	"strings"
	"testing"
)

func fixture(typ, response string) string {
	b, _ := json.Marshal(response)
	return `{"answer_id":"ans-synthetic-1","learner_id":"lrn-local-1","item_id":"DEMO-1","track":"arab","content_version":"demo-synthetic-0.1","rules_version":"pilot-0.1","app_version":"test","timestamp":"2026-10-18T10:00:00Z","local_date":"2026-10-18","session_id":"ses-1","lang":"id","pool":"PRACT","unit":"A","skills":["S1"],"raw_response":` + string(b) + `,"auto_score":{},"outcome":"not_assessed","first_attempt":true,"fresh_evidence":false,"review_status":"draft","synthetic":true,"item_type":"` + typ + `"}`
}
func TestNativeResponseContracts(t *testing.T) {
	cases := map[string]string{
		"choose":       `{"kind":"choice","option_id":"a"}`,
		"type_in":      `{"kind":"typed","text":"contoh","ref":"perempuan"}`,
		"number_input": `{"kind":"number","value":0}`,
		"tiles":        `{"kind":"sequence","sequence":["a","b"]}`,
		"match_pairs":  `{"kind":"pairs","pairs":[{"left":"a","right":"b"}]}`,
		"trace":        `{"kind":"sequence","sequence":["1","2"]}`,
		"story":        `{"kind":"choice","option_id":"seen"}`,
		"audio_match":  `{"kind":"dont_know"}`,
	}
	for typ, r := range cases {
		t.Run(typ, func(t *testing.T) {
			e, err := Parse([]byte(fixture(typ, r)), false)
			if err != nil {
				t.Fatal(err)
			}
			if e.ItemType != typ {
				t.Fatal(e.ItemType)
			}
		})
	}
}
func TestRejectUnsafeOrMalformedEvents(t *testing.T) {
	base := fixture("choose", `{"kind":"choice","option_id":"a"}`)
	cases := []string{
		strings.Replace(base, `"synthetic":true`, `"synthetic":false`, 1),
		strings.Replace(base, `"item_type":"choose"`, `"item_type":"speed_round"`, 1),
		strings.Replace(base, `"answer_id":`, `"answer_id":"duplicate","answer_id":`, 1),
		strings.Replace(base, `"local_date":"2026-10-18"`, `"local_date":"2026-02-31"`, 1),
		strings.Replace(base, `"first_attempt":true,`, "", 1),
		strings.Replace(base, `"lang":"id"`, `"lang":"ar"`, 1),
		strings.Replace(base, `"auto_score":{}`, `"auto_score":{"a":"great"}`, 1),
		fixture("trace", `{"kind":"typed","text":"name"}`),
		fixture("story", `{"kind":"choice","option_id":"a"}`),
		fixture("choose", `{"kind":"choice","option_id":"a","text":"secret"}`),
		fixture("choose", `{"kind":"choice","option_id":"a","kind":"number"}`),
		fixture("choose", `{"kind":"choice","option_id":null}`),
		fixture("number_input", `{"kind":"number","value":1e999}`),
	}
	for i, b := range cases {
		if _, err := Parse([]byte(b), false); err == nil {
			t.Errorf("case %d accepted", i)
		}
	}
	if _, err := Parse([]byte(fixture("type_in", `{"kind":"typed","text":"private"}`)), true); err == nil {
		t.Fatal("child typed text accepted")
	}
	if _, err := Parse([]byte(strings.Replace(fixture("trace", `{"kind":"dont_know"}`), `"fresh_evidence":false`, `"fresh_evidence":true`, 1)), false); err == nil {
		t.Fatal("trace evidence accepted")
	}
}

func TestRejectCaseAliasesThatChangePreservedNativeMeaning(t *testing.T) {
	base := fixture("choose", `{"kind":"choice","option_id":"a"}`)
	for _, payload := range []string{
		strings.Replace(base, `"synthetic":true`, `"synthetic":false,"SYNTHETIC":true`, 1),
		strings.Replace(base, `"synthetic":true`, `"SYNTHETIC":true`, 1),
		strings.Replace(base, `"learner_id":"lrn-local-1"`, `"learner_id":"foreign-learner","LEARNER_ID":"lrn-local-1"`, 1),
		fixture("choose", `{"kind":"choice","option_id":"a","OPTION_ID":"b"}`),
		fixture("match_pairs", `{"kind":"pairs","pairs":[{"left":"a","LEFT":"other","right":"b"}]}`),
	} {
		if _, err := Parse([]byte(payload), false); err == nil {
			t.Error("case alias accepted")
		}
	}
}

func TestChildTypedResponseCannotUseCaseAliases(t *testing.T) {
	payload := fixture("choose", `{"kind":"typed","text":"private","KIND":"choice","TEXT":null,"option_id":"a"}`)
	if _, err := Parse([]byte(payload), true); err == nil {
		t.Fatal("child typed response hidden by case aliases")
	}
}

func TestRejectNullsOutsideNativeNullableFields(t *testing.T) {
	base := fixture("choose", `{"kind":"choice","option_id":"a"}`)
	for _, field := range []string{`"hint_used":null,`, `"time_on_item_ms":null,`, `"help_lines_shown":[null],`, `"error_tags":null,`} {
		if _, err := Parse([]byte(strings.Replace(base, `"outcome":`, field+`"outcome":`, 1)), false); err == nil {
			t.Errorf("nonnullable field accepted: %s", field)
		}
	}
	if _, err := Parse([]byte(strings.Replace(base, `"auto_score":{}`, `"auto_score":{"meaning":null}`, 1)), false); err == nil {
		t.Fatal("null score accepted")
	}
	valid := fixture("choose", `{"kind":"choice","option_id":"a","text":null,"sequence":null,"pairs":null,"audio_status":null}`)
	if _, err := Parse([]byte(valid), false); err != nil {
		t.Fatal("native nullable response fields rejected", err)
	}
}
