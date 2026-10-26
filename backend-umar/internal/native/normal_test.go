package native

import (
	"strings"
	"testing"
)

func TestNormalNativeResponsesRequireApprovedNonSyntheticEvents(t *testing.T) {
	for _, typ := range []string{"choose", "trace", "story"} {
		response := `{"kind":"sequence","sequence":["1","2"]}`
		if typ == "choose" {
			response = `{"kind":"choice","option_id":"a"}`
		}
		if typ == "story" {
			response = `{"kind":"choice","option_id":"seen"}`
		}
		raw := fixture(typ, response)
		raw = strings.Replace(raw, `"review_status":"draft"`, `"review_status":"approved"`, 1)
		raw = strings.Replace(raw, `"synthetic":true`, `"synthetic":false`, 1)
		if _, err := ParseForMode([]byte(raw), false, false); err != nil {
			t.Fatalf("%s: %v", typ, err)
		}
		if _, err := Parse([]byte(raw), false); err == nil {
			t.Fatalf("%s crossed into synthetic lane", typ)
		}
		draft := strings.Replace(raw, `"review_status":"approved"`, `"review_status":"draft"`, 1)
		if _, err := ParseForMode([]byte(draft), false, false); err == nil {
			t.Fatalf("%s draft accepted", typ)
		}
	}
}
