// The API names the build it runs in its startup log (C3 in the RN worktree's app/docs/plans/2026-10-20-correctness.md),
// written before the change. run() writes exactly one line with the sanitized revision and dirty state of the Go
// toolchain's own stamp before it refuses a configuration or serves, so an operator can tell which build refused or
// served. A test binary carries no VCS stamp, so both values are expected to be "unknown" here; whatever they are, they
// must be safe to log. Production mode without its opt-in is refused before anything is opened, so nothing is bound or
// contacted.
package main

import (
	"bytes"
	"io"
	"log"
	"log/slog"
	"os"
	"regexp"
	"strings"
	"testing"

	"ayailmu.local/backend/internal/config"
)

var (
	testBuildLine    = regexp.MustCompile(`\brevision=(\S*) dirty=(\S*)`)
	testSafeRevision = regexp.MustCompile(`^(?:[0-9a-f]{7,40}|unknown)$`)
	testSafeDirty    = regexp.MustCompile(`^(?:true|false|unknown)$`)
)

// runCapturingStderr runs run() with its log going to a pipe instead of the process's stderr, and gives back its exit
// code and what it wrote. The process's stderr and default loggers are put back afterwards.
func runCapturingStderr(t *testing.T) (int, string) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	savedStderr, savedSlog, savedLogOutput, savedLogFlags := os.Stderr, slog.Default(), log.Writer(), log.Flags()
	restore := func() {
		os.Stderr = savedStderr
		slog.SetDefault(savedSlog)
		log.SetOutput(savedLogOutput)
		log.SetFlags(savedLogFlags)
	}
	t.Cleanup(restore)
	written := make(chan string, 1)
	go func() {
		var out bytes.Buffer
		_, _ = io.Copy(&out, r)
		written <- out.String()
	}()
	os.Stderr = w
	code := run()
	restore()
	_ = w.Close()
	logged := <-written
	_ = r.Close()
	return code, logged
}

func TestRunLogsSanitizedBuildProvenanceBeforeRefusing(t *testing.T) {
	// Production without its exact opt-in is refused before anything is opened, whatever else this environment holds.
	t.Setenv(config.EnvMode, config.ModeProduction)
	t.Setenv("AYA_DEPLOYMENT_ENV", "")

	code, logged := runCapturingStderr(t)
	if code != 1 {
		t.Fatalf("run() = %d, want 1: production without its opt-in is refused", code)
	}
	lines := strings.Split(strings.TrimRight(logged, "\n"), "\n")
	builds, first, refused := 0, -1, -1
	for i, line := range lines {
		if testBuildLine.MatchString(line) {
			builds++
			if first < 0 {
				first = i
			}
		}
		if refused < 0 && strings.Contains(line, "refusing to start") {
			refused = i
		}
	}
	if refused < 0 {
		t.Fatalf("the startup log (%d lines) has no refusal line", len(lines))
	}
	if builds != 1 {
		t.Fatalf("the startup log has %d lines with revision=… dirty=…, want exactly 1 before the refusal (%d lines in all)", builds, len(lines))
	}
	if first > refused {
		t.Fatalf("the build line (line %d) comes after the refusal (line %d); want it before", first+1, refused+1)
	}
	m := testBuildLine.FindStringSubmatch(lines[first])
	if !testSafeRevision.MatchString(m[1]) || !testSafeDirty.MatchString(m[2]) {
		t.Fatalf("the build line carries a value that is not safe to log (revision %d bytes, dirty %d bytes); want 7-40 lowercase hex or unknown, and true, false or unknown", len(m[1]), len(m[2]))
	}
}
