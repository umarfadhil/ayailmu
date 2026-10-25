#!/bin/sh
# The eight real-Gradle Play public-key regressions, the same commands locally and in CI. Run from the repository root.
#   sh android/tools/play-license-offline.sh warm   # ONLINE: fills the isolated Gradle home (wrapper, plugins, dependencies)
#   sh android/tools/play-license-offline.sh test   # OFFLINE: python3 -B -m unittest -v android/tools/test_play_license_configuration.py
# GRADLE_USER_HOME is one isolated directory (default: <AYA_CI_ROOT>/gradle-home, created if missing) used by BOTH phases, so no
# developer gradle.properties, init script or credential is read, and a cache miss is repaired by `warm`, never assumed away.
# Only the committed PUBLIC RSA fixture is used as the key. Needs JDK 17 (JAVA_HOME) and the Android SDK 36 (ANDROID_HOME).
set -eu
mode="${1:-}"
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
fail() { echo "play-license-offline: $*" >&2; exit 1; }
AYA_CI_ROOT="${AYA_CI_ROOT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/aya-ci-$(id -u)}"
GRADLE_USER_HOME="${GRADLE_USER_HOME:-$AYA_CI_ROOT/gradle-home}"
[ "$GRADLE_USER_HOME" != "$HOME/.gradle" ] || fail "GRADLE_USER_HOME must be an isolated directory, not ~/.gradle"
mkdir -p "$GRADLE_USER_HOME"
export GRADLE_USER_HOME

[ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ] || fail "JAVA_HOME must point at a JDK 17"
case $("$JAVA_HOME/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p') in
  17) ;;
  *) fail "JAVA_HOME=$JAVA_HOME is not JDK 17" ;;
esac
sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[ -n "$sdk" ] || fail "ANDROID_HOME (Android SDK with platforms;android-36) is not set"
[ -d "$sdk/platforms/android-36" ] || fail "no platforms/android-36 under ANDROID_HOME=$sdk"
export ANDROID_HOME="$sdk" ANDROID_SDK_ROOT="$sdk"

key=$(cat "$here/fixtures/play_rsa_public_key.b64")
cd "$repo/android"
case "$mode" in
  warm)
    echo "warming $GRADLE_USER_HOME online with the public fixture key (JDK $JAVA_HOME)"
    sh gradlew --no-daemon --console=plain "-Payailmu.playLicenseKey=$key" :app:generateDemoDebugBuildConfig :app:checkPlayLicenseKey
    ;;
  test)
    cd "$repo"
    echo "running the offline tests with GRADLE_USER_HOME=$GRADLE_USER_HOME"
    mkdir -p "$AYA_CI_ROOT/logs"
    log="$AYA_CI_ROOT/logs/play-license.log"
    rcfile="$AYA_CI_ROOT/logs/play-license.rc"
    ( rc=0; PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest -v android/tools/test_play_license_configuration.py 2>&1 || rc=$?; echo "$rc" >"$rcfile" ) | tee "$log"
    [ "$(cat "$rcfile")" = 0 ] || fail "the Play public-key tests failed (see $log)"
    grep -q '^Ran 8 tests in ' "$log" || fail "expected exactly 8 tests (see $log)"
    if grep -Eq 'skipped=|\.\.\. skipped' "$log"; then fail "a test was skipped (see $log)"; fi
    ;;
  *) fail "usage: sh android/tools/play-license-offline.sh warm|test" ;;
esac
