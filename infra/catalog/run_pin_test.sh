#!/bin/sh
# Runs the application's own, unchanged registry pin test (TestRegistryPinsExactPackBytesAndHonestStatus) against the exact
# bytes of the frontend's authoritative revision 8b29a91 (authoritative-expo-fixtures), which the ACTIVE registry pins, after
# verifying that archive against SHA256SUMS. With one argument it runs the same test against that directory instead (for
# example the read-only frontend checkout's app/src/content/fixtures). It never skips and does not edit any pin.
# It also re-proves the bounded ef28606 -> 8b29a91 difference against the archived historical bytes. Needs go (1.27).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
dir="$here/authoritative-expo-fixtures"
(cd "$here/pinned-expo-fixtures" && shasum -a 256 -c SHA256SUMS)
(cd "$dir" && shasum -a 256 -c SHA256SUMS)
python3 -I "$here/verify_alignment_proof.py" "$here/pinned-expo-fixtures" "$dir"
target=${1:-$dir}
cd "$repo/backend"
AYA_TEST_EXPO_FIXTURES_DIR="$target" go test -count=1 -run '^TestRegistryPinsExactPackBytesAndHonestStatus$' ./internal/curriculum/
