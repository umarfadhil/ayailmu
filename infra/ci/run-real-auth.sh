#!/bin/sh
# Full adult real-auth run (real GoTrue + PostgreSQL containers, race detector, zero skips), the same command locally and in CI.
#   sh infra/ci/run-real-auth.sh
# Pre-caches the two pinned public images first (the fixture helper never pulls). Run warm-go.sh first. PG_BIN must be set; on
# Linux DOCKER_HOST must be explicit (unix:///var/run/docker.sock). Uses its own runtime root, AYA_CI_ROOT/real-auth, and removes
# only what its own label-checked manifest records.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
. "$here/go-env.sh"
[ -f "$repo/infra/real-auth/run_real_auth_tests.py" ] || ci_fail "this clone has no infra/real-auth (adult backend only)"
export PYTHONDONTWRITEBYTECODE=1
ci_use_pinned_android_packs "$repo"
export AYA_REAL_AUTH_RUNTIME="$AYA_CI_ROOT/real-auth"
echo "source: $repo @ $(git -C "$repo" rev-parse HEAD)"
sh "$here/check-tools.sh" --real-auth
python3 -B -I "$here/precache-images.py"

mkdir -p "$AYA_CI_ROOT/logs"
log="$AYA_CI_ROOT/logs/real-auth.log"
rcfile="$AYA_CI_ROOT/logs/real-auth.rc"
( rc=0; python3 -B -I "$repo/infra/real-auth/run_real_auth_tests.py" --full --race 2>&1 || rc=$?; echo "$rc" >"$rcfile" ) | tee "$log"
rc=$(cat "$rcfile")
[ "$rc" = 0 ] || ci_fail "run_real_auth_tests.py --full --race failed (exit $rc)"
grep -Eq '^full suite \(race\): passed=[0-9]+ .* failed=0 skipped=0 real-GoTrue passed=6 go test exit=0$' "$log" \
  || ci_fail "the summary line does not show failed=0 skipped=0 and six real-GoTrue passes (see $log)"
echo "real-auth ok (log: $log)"
