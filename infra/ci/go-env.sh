# Sourced by the other infra/ci scripts. Gives Go a task-specific, runner-owned world: no ambient Go configuration, caches or
# toolchain downloads, and HOME is left alone. AYA_CI_ROOT holds every cache and scratch path (default: a per-user directory
# under RUNNER_TEMP/TMPDIR). AYA_CI_GO_ONLINE=1 is for the warm-up step only and permits fetching public modules from the
# module proxy (go.sum still verifies every module); everything else runs with the proxy off.
AYA_CI_ROOT="${AYA_CI_ROOT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/aya-ci-$(id -u)}"
export AYA_CI_ROOT
# Files the tests create (for example the throwaway root CA) must not be group-writable whatever the runner's login umask is.
umask 022
export GOENV=off GOWORK=off GOTOOLCHAIN=local GOFLAGS=-mod=readonly
export GOPATH="$AYA_CI_ROOT/go/path" GOMODCACHE="$AYA_CI_ROOT/go/mod" GOCACHE="$AYA_CI_ROOT/go/build"
unset GOROOT GOPRIVATE GONOPROXY GONOSUMDB GONOSUMCHECK GOINSECURE GOVCS
if [ "${AYA_CI_GO_ONLINE:-}" = 1 ]; then
  export GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org
else
  export GOPROXY=off GOSUMDB=off
fi
mkdir -p "$GOPATH" "$GOMODCACHE" "$GOCACHE"

ci_fail() {
  echo "infra/ci: $*" >&2
  exit 1
}

# The Go module directory of a clone root: backend-umar (AyaIlmu/Umar) or backend (Ayangaji).
ci_module_dir() {
  if [ -f "$1/backend-umar/go.mod" ]; then echo "$1/backend-umar"
  elif [ -f "$1/backend/go.mod" ]; then echo "$1/backend"
  else ci_fail "no backend-umar/go.mod or backend/go.mod under $1"
  fi
}

# A frontend-only clone has no android/ tree; its registry pin test reads the two pinned Android packs from the archive
# infra/catalog/pinned-android-packs instead (verified against its SHA256SUMS first). Clones without the archive are untouched.
ci_use_pinned_android_packs() {
  archive="$1/infra/catalog/pinned-android-packs"
  [ -d "$archive" ] || { unset AYA_TEST_ANDROID_PACKS_ROOT; return 0; }
  (cd "$archive" && shasum -a 256 -c SHA256SUMS >/dev/null) || ci_fail "pinned Android pack archive does not match its SHA256SUMS"
  AYA_TEST_ANDROID_PACKS_ROOT="$archive"
  export AYA_TEST_ANDROID_PACKS_ROOT
}
