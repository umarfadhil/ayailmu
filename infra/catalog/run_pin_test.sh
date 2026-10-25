#!/bin/sh
# Runs the application's own, unchanged registry pin test against the archived pinned fixtures (exact bytes of ef28606).
# It verifies the archive against SHA256SUMS first. Needs go (1.27). It does not read the frontend checkout.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
dir="$here/pinned-expo-fixtures"
(cd "$dir" && shasum -a 256 -c SHA256SUMS)
cd "$repo/backend"
AYA_TEST_EXPO_FIXTURES_DIR="$dir" go test -count=1 -run '^TestRegistryPinsExactPackBytesAndHonestStatus$' ./internal/curriculum/
