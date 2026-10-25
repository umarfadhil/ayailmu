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
echo "== 3a. real-auth runner and fixture cleanup regressions (fake helper and cluster, mocked Docker: nothing real is started)"
$PY -I "$repo/infra/real-auth/test_run_real_auth_tests.py"
$PY -I "$repo/infra/real-auth/test_real_auth_fixture_down.py"
echo "== 3b. catalog: unchanged registry pin test on the authoritative 8b29a91 bytes (active pins), historical ef28606 archive + bounded proof, gate self-tests"
sh "$repo/infra/catalog/run_pin_test.sh"
$PY -I "$repo/infra/catalog/test_alignment_proof.py"
$PY -I "$repo/infra/catalog/test_compat_gate.py"
if [ -n "${AYA_CURRENT_EXPO_FIXTURES_DIR:-}" ]; then
  echo "== 3c. CHECKED: live frontend fixtures at $AYA_CURRENT_EXPO_FIXTURES_DIR vs the active registry pins (any byte difference fails)"
  $PY -I "$repo/infra/catalog/check_current_compat.py" "$AYA_CURRENT_EXPO_FIXTURES_DIR"
  AYA_TEST_EXPO_FIXTURES_DIR="$AYA_CURRENT_EXPO_FIXTURES_DIR" sh -c 'cd "$1/backend" && go test -count=1 -run "^TestRegistryPinsExactPackBytesAndHonestStatus$" ./internal/curriculum/' _ "$repo"
else
  echo "== 3c. CHECKED against the committed exact 8b29a91 snapshot only (not a live checkout; set AYA_CURRENT_EXPO_FIXTURES_DIR to the frontend's app/src/content/fixtures to check it)"
  $PY -I "$repo/infra/catalog/check_current_compat.py" "$repo/infra/catalog/authoritative-expo-fixtures"
fi
echo "== 4. cross-app isolation (both clones, one cluster, two databases)"
$PY -I -W error::ResourceWarning tests/test_cross_app.py
echo "ALL INFRA CHECKS PASSED"
