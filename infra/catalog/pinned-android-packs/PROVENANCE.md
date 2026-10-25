# Pinned Android catalog packs (exact bytes the ACTIVE registry pins)

`TestRegistryPinsExactPackBytesAndHonestStatus` reads the two `android-catalog` packs from `<root>/android/content/src/main/assets/packs/...`
(`backend/internal/curriculum/packs.go`). In the adult backend's own history that root is the repository itself. This integration branch
is frontend-only and deliberately does not import the legacy `android/` tree, so the two files are archived here instead, and the test
takes the root from `AYA_TEST_ANDROID_PACKS_ROOT` (unset: the old repository-relative default, unchanged).

These files are byte-for-byte copies of the same paths at the adult backend payload revision
`384b515b09bd42b3f9a02634369efdc72216e93f` (`git show 384b515...:<path>`), not edited, normalised or regenerated:

| file (below `android/content/src/main/assets/packs/`) | sha256 (= active registry pin) |
| --- | --- |
| bahasa/arab/v1.json | 94a879edd88c69a4beaf1ebca34dfb17c0ab473e063441dbfe1cb4ecbb665a10 |
| matematika/mat/v1.json | ae93ba089a1526314070c6e771133060a9653705daf626a39fc16949573970ce |

Note for reviewers: the companion AyaIlmu/Umar branch carries its own Android packs. Its `arab/v1.json` is byte-identical to the pin above;
its `matematika/mat/v1.json` is NOT (sha256 `25e656a5e82b3640d733f357e4e1fb3eb6939518cfe081900259ae2f3d7716d5`). The adult registry pin
therefore describes the payload bytes archived here, not the companion's current Android pack. This CI work records the difference and
changes no pin.

`SHA256SUMS` is verified by `infra/ci/run-readiness.sh` and `infra/ci/run-real-auth.sh` before they point the test at this directory.
