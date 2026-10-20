// Package provenance reports which build a binary is, as the Go toolchain itself stamped it into the binary
// (runtime/debug.ReadBuildInfo), reduced to values that are safe to put in a log line. It is a startup record for
// operators and is never served.
package provenance

import (
	"regexp"
	"runtime/debug"
)

// unknown stands for a value that is missing, duplicated, malformed or unsafe.
const unknown = "unknown"

// revisionPattern is a VCS revision as the toolchain stamps it, full or abbreviated: 7 to 40 lowercase hex digits.
var revisionPattern = regexp.MustCompile(`^[0-9a-f]{7,40}$`)

// Build is a binary's build provenance, safe to log: Revision is 7 to 40 lowercase hex digits or "unknown", and Dirty
// is "true", "false" or "unknown".
type Build struct {
	Revision string
	Dirty    string
}

// FromBuildInfo takes runtime/debug.ReadBuildInfo's two results and reads vcs.revision and vcs.modified, nothing else.
// A field is "unknown" when its setting is missing, appears more than once, or is not exactly a lowercase hex revision
// of 7 to 40 digits (vcs.revision) or "true" or "false" (vcs.modified). No raw value is passed on: nothing is trimmed,
// shortened or quoted.
func FromBuildInfo(info *debug.BuildInfo, ok bool) Build {
	build := Build{Revision: unknown, Dirty: unknown}
	if !ok || info == nil {
		return build
	}
	if revision, found := single(info.Settings, "vcs.revision"); found && revisionPattern.MatchString(revision) {
		build.Revision = revision
	}
	if modified, found := single(info.Settings, "vcs.modified"); found && (modified == "true" || modified == "false") {
		build.Dirty = modified
	}
	return build
}

// single returns the value of the one setting named key; found is false when there is none, or more than one.
func single(settings []debug.BuildSetting, key string) (value string, found bool) {
	count := 0
	for _, setting := range settings {
		if setting.Key == key {
			value = setting.Value
			count++
		}
	}
	return value, count == 1
}
