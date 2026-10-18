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
