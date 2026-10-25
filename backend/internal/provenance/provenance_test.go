// Build provenance for the API's startup log (C3 in the RN worktree's app/docs/plans/2026-10-20-correctness.md), written
// before the helper exists. FromBuildInfo reads only what the Go toolchain itself stamped into the binary
// (runtime/debug.ReadBuildInfo: vcs.revision and vcs.modified) and reduces it to values a startup line may carry: a
// revision of 7 to 40 lowercase hex digits, and a dirty flag of exactly "true" or "false". Anything missing, malformed,
// duplicated or unsafe (a path, a user or host, a token, a line break that would forge a log line) becomes "unknown",
// and no raw value is ever passed on. The fixtures are synthetic, and a failure here never prints a value that is not
// safe to log.
package provenance

import (
	"fmt"
	"regexp"
	"runtime/debug"
	"testing"
)

const (
	fixtureFull    = "0123456789abcdef0123456789abcdef01234567"
	fixtureShort   = "0123abc"
	fixtureUnknown = "unknown"
)

var (
	testSafeRevision = regexp.MustCompile(`^(?:[0-9a-f]{7,40}|unknown)$`)
	testSafeDirty    = regexp.MustCompile(`^(?:true|false|unknown)$`)
)

// testShown names a result for a failure message, printing only values a startup line may carry.
func testShown(b Build) string {
	revision, dirty := b.Revision, b.Dirty
	if !testSafeRevision.MatchString(revision) {
		revision = fmt.Sprintf("<%d unsafe bytes, not shown>", len(revision))
	}
	if !testSafeDirty.MatchString(dirty) {
		dirty = fmt.Sprintf("<%d unsafe bytes, not shown>", len(dirty))
	}
	return fmt.Sprintf("{Revision: %s, Dirty: %s}", revision, dirty)
}

// testStamped is build information as runtime/debug.ReadBuildInfo gives it, with these settings.
func testStamped(settings ...debug.BuildSetting) *debug.BuildInfo {
	return &debug.BuildInfo{GoVersion: "go1.24.0", Path: "ayailmu.local/backend/cmd/ayailmu-api", Settings: settings}
}

func testSetting(key, value string) debug.BuildSetting {
	return debug.BuildSetting{Key: key, Value: value}
}

func TestFromBuildInfo(t *testing.T) {
	vcs := testSetting("vcs", "git")
	stampedAt := testSetting("vcs.time", "2026-10-20T03:00:00Z")
	clean := testSetting("vcs.modified", "false")
	revision := func(value string) debug.BuildSetting { return testSetting("vcs.revision", value) }
	unknownBoth := Build{Revision: fixtureUnknown, Dirty: fixtureUnknown}

	type check struct {
		name string
		info *debug.BuildInfo
		ok   bool
		want Build
	}
	checks := []check{
		// What the toolchain stamps.
		{"a clean build at a full revision", testStamped(vcs, revision(fixtureFull), stampedAt, clean), true, Build{Revision: fixtureFull, Dirty: "false"}},
		{"a build with uncommitted changes", testStamped(vcs, revision(fixtureFull), stampedAt, testSetting("vcs.modified", "true")), true, Build{Revision: fixtureFull, Dirty: "true"}},
		{"a short revision", testStamped(vcs, revision(fixtureShort), clean), true, Build{Revision: fixtureShort, Dirty: "false"}},

		// Missing: no build information, none vouched for, or no VCS stamp (go run, go test, -buildvcs=false, no .git).
		{"no build information", nil, false, unknownBoth},
		{"build information claimed but absent", nil, true, unknownBoth},
		{"build information that ReadBuildInfo did not vouch for", testStamped(vcs, revision(fixtureFull), clean), false, unknownBoth},
		{"no VCS stamp", testStamped(testSetting("-compiler", "gc"), testSetting("GOOS", "linux")), true, unknownBoth},
		{"a revision without a modified flag", testStamped(vcs, revision(fixtureFull)), true, Build{Revision: fixtureFull, Dirty: fixtureUnknown}},
		{"a modified flag without a revision", testStamped(vcs, testSetting("vcs.modified", "true")), true, Build{Revision: fixtureUnknown, Dirty: "true"}},

		// Invalid or unsafe revisions: never shortened, trimmed or echoed.
		{"a revision too short", testStamped(revision("abc12"), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"a revision too long", testStamped(revision(fixtureFull+"0"), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"an uppercase revision", testStamped(revision("0123456789ABCDEF0123456789ABCDEF01234567"), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"a revision with a leading space", testStamped(revision(" "+fixtureFull), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"a revision that is a path", testStamped(revision("/home/builder/secret-path-marker"), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"a revision naming a user and a host", testStamped(revision("builder@build-host-marker.internal:ayailmu.git"), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"a revision that is a token", testStamped(revision("ghp_tokenmarker0123456789abcdefABCDEF0123"), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"a revision that would forge a log line", testStamped(revision(fixtureFull+"\nlevel=ERROR msg=forged"), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},

		// Duplicates: the toolchain never writes a key twice, so a second one makes that field unknown, even when identical.
		{"a duplicated revision", testStamped(revision(fixtureFull), revision(fixtureFull), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"conflicting revisions", testStamped(revision(fixtureFull), revision(fixtureShort), clean), true, Build{Revision: fixtureUnknown, Dirty: "false"}},
		{"conflicting modified flags", testStamped(revision(fixtureFull), clean, testSetting("vcs.modified", "true")), true, Build{Revision: fixtureFull, Dirty: fixtureUnknown}},
	}
	// A modified flag that is not exactly true or false.
	for _, flag := range []string{"TRUE", "False", "1", "0", "yes", "", " false", "true\n", "dirty"} {
		checks = append(checks, check{
			name: fmt.Sprintf("modified flag %q", flag),
			info: testStamped(revision(fixtureFull), testSetting("vcs.modified", flag)),
			ok:   true,
			want: Build{Revision: fixtureFull, Dirty: fixtureUnknown},
		})
	}

	for _, c := range checks {
		t.Run(c.name, func(t *testing.T) {
			if got := FromBuildInfo(c.info, c.ok); got != c.want {
				t.Fatalf("FromBuildInfo = %s, want %s", testShown(got), testShown(c.want))
			}
		})
	}
}
