#!/bin/sh
# Infra readiness checks for this clone. Needs: python3, go (1.27), openssl and PostgreSQL binaries (PG_BIN).
# Everything runs against a fresh disposable loopback cluster under /tmp that is removed afterwards. Nothing here contacts
# Supabase, Docker, the network or any existing database. Set INFRA_PEER_CLONE to the sibling clone for the cross-app test.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
PY="${PYTHON:-python3} -B"  # -B: importing the tools must not write bytecode into the tree
cd "$here"
echo "== 1. offline manifest / DSN / wrapper tests"
$PY -I tests/test_manifest.py
$PY -I tests/test_review_regressions.py
$PY -I tests/test_run_tests_script.py
if [ -d "$repo/backend-umar" ]; then
  echo "== 2. Umar lifecycle on disposable PostgreSQL (TLS, real binaries)"
  $PY -I -W error::ResourceWarning tests/test_umar_local.py
  echo "== 3. Umar application suite (existing scripts/integration.sh, race detector, fresh cluster)"
  # begin: umar-suite (tests/test_run_tests_script.py runs exactly this block against a fake integration script)
  (
    cd "$repo/backend-umar"
    log=$(mktemp "${TMPDIR:-/tmp}/infra-umar-suite.XXXXXX")
    rc=0
    GO=${GO:-go} sh scripts/integration.sh >"$log" 2>&1 || rc=$?
    grep -E '^(ok|FAIL|---)' "$log" | grep -v '^--- PASS' || true
    rm -f "$log"
    exit $rc
  )
  # end: umar-suite
else
  echo "== 2. Ayangaji lifecycle on disposable PostgreSQL (TLS, real binaries, real config loader)"
  $PY -I -W error::ResourceWarning tests/test_ayangaji_local.py
  echo "== 3. Ayangaji application suites that need only PostgreSQL (real-GoTrue tests excluded by name, see script)"
  $PY -I tests/run_adult_go_suites.py
fi
echo "== 4. cross-app isolation (both clones, one cluster, two databases)"
$PY -I -W error::ResourceWarning tests/test_cross_app.py
echo "ALL INFRA CHECKS PASSED"
