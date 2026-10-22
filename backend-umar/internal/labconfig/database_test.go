package labconfig

import "testing"

func TestMigrateOnStart(t *testing.T) {
	for _, value := range []string{"", "true", "false"} {
		got, err := MigrateOnStart(value)
		if err != nil || got != (value != "false") {
			t.Fatalf("%q: %v %v", value, got, err)
		}
	}
	for _, value := range []string{"FALSE", "0", "1", " false", "false\n", "disabled"} {
		if _, err := MigrateOnStart(value); err == nil {
			t.Fatalf("ambiguous migration setting accepted: %q", value)
		}
	}
}
