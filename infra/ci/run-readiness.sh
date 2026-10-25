#!/bin/sh
# The full infra readiness run, the same command locally and in the workflow. Offline Go, explicit peer, no skips.
#   sh infra/ci/run-readiness.sh --peer PEER_ROOT [--fixtures DIR]
# PEER_ROOT (or INFRA_PEER_CLONE) is required and has no default: a stale sibling checkout must never be tested by accident.
# --fixtures DIR is the frontend's app/src/content/fixtures to check against the Ayangaji registry pins (sets
# AYA_CURRENT_EXPO_FIXTURES_DIR; only the Ayangaji clone consumes it). Run warm-go.sh first; PG_BIN must be set.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
. "$here/go-env.sh"
peer="${INFRA_PEER_CLONE:-}"
fixtures=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --peer) [ "$#" -ge 2 ] || ci_fail "--peer needs a directory"; peer=$2; shift 2 ;;
    --fixtures) [ "$#" -ge 2 ] || ci_fail "--fixtures needs a directory"; fixtures=$2; shift 2 ;;
    *) ci_fail "unknown option: $1" ;;
  esac
done
[ -n "$peer" ] || ci_fail "no peer clone: pass --peer or set INFRA_PEER_CLONE"
peer=$(cd "$peer" 2>/dev/null && pwd) || ci_fail "peer clone directory does not exist"
[ "$peer" != "$repo" ] || ci_fail "the peer clone must be a different directory from the source clone"
[ -f "$peer/infra/supabase/supabase_target.py" ] || ci_fail "$peer is not a clone with infra/supabase"
ci_module_dir "$peer" >/dev/null
if [ -n "$fixtures" ]; then
  [ -d "$fixtures" ] || ci_fail "--fixtures directory does not exist: $fixtures"
  AYA_CURRENT_EXPO_FIXTURES_DIR=$(cd "$fixtures" && pwd)
  export AYA_CURRENT_EXPO_FIXTURES_DIR
else
  unset AYA_CURRENT_EXPO_FIXTURES_DIR
fi
export INFRA_PEER_CLONE="$peer" PYTHONDONTWRITEBYTECODE=1
ci_use_pinned_android_packs "$repo"

echo "source: $repo @ $(git -C "$repo" rev-parse HEAD)"
echo "peer:   $peer @ $(git -C "$peer" rev-parse HEAD)"
echo "INFRA_PEER_CLONE=$INFRA_PEER_CLONE AYA_CURRENT_EXPO_FIXTURES_DIR=${AYA_CURRENT_EXPO_FIXTURES_DIR:-<unset: committed snapshot only>} AYA_TEST_ANDROID_PACKS_ROOT=${AYA_TEST_ANDROID_PACKS_ROOT:-<unset>}"
sh "$here/check-tools.sh"

mkdir -p "$AYA_CI_ROOT/logs"
log="$AYA_CI_ROOT/logs/readiness.log"
rcfile="$AYA_CI_ROOT/logs/readiness.rc"
( rc=0; sh "$repo/infra/supabase/run-tests.sh" 2>&1 || rc=$?; echo "$rc" >"$rcfile" ) | tee "$log"
rc=$(cat "$rcfile")
[ "$rc" = 0 ] || ci_fail "infra/supabase/run-tests.sh failed (exit $rc)"
grep -q '^ALL INFRA CHECKS PASSED$' "$log" || ci_fail "run-tests.sh did not print its success line"
if grep -Eiq 'skipped=|--- SKIP|^SKIP' "$log"; then
  ci_fail "a test was skipped; zero skips are required (see $log)"
fi
echo "readiness ok (log: $log)"
