package generalingress

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func TestWireBatchBoundsMatchExistingNativeBackendContract(t *testing.T) {
	u, _ := url.Parse(origin)
	body, _ := json.Marshal(map[string]any{"schema_version": 1, "synthetic": false, "events": []string{strings.Repeat("x", 16384), strings.Repeat("y", 16384)}})
	request := Request{TLS: true, Peer: "192.0.2.1", Method: "POST", Target: "/v1/learners/" + learnerA + "/events", Headers: [][2]string{{"Host", u.Host}, {"Content-Type", "application/json"}}, Body: body}
	if _, err := parse(request, u.Host, Policy{}); err != nil {
		t.Fatal("existing 100-event/1MiB backend envelope was narrowed to auth JSON size")
	}
	request.Body = []byte(strings.Repeat("x", 1048577))
	if _, err := parse(request, u.Host, Policy{}); err == nil {
		t.Fatal("oversized backend envelope accepted")
	}
	request.Target = "/signup"
	request.Body = body
	if _, err := parse(request, u.Host, Policy{}); err == nil {
		t.Fatal("auth body bound expanded")
	}
}
