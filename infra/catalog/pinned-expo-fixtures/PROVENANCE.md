# Historical Expo fixtures (exact bytes the registry pinned at frontend ef28606)

> **Status:** historical archive, kept unchanged and independently verifiable (`SHA256SUMS`). Since the reviewed alignment, the *active*
> registry pin for `demo-v0.3.json` is the 8b29a91 hash in `../authoritative-expo-fixtures`; `demo-unit-a.json` and `demo-v0.2.json` are
> byte-identical in both archives. The sections below describe the state before that alignment.

These three files are byte-for-byte copies of `app/src/content/fixtures/{demo-unit-a,demo-v0.2,demo-v0.3}.json` at
`ayailmu-publish` / `ayailmu-rn-ux` revision `ef28606ce68bae962695a9d7fb23d0c52b36b392` (2026-10-16, "Fix Arabic draft content and
learning evidence persistence"), extracted read-only with `git show <rev>:<path>` from the canonical frontend checkout. They are
not edited, normalised or regenerated. `SHA256SUMS` lists their hashes; they equal the pins in
`backend/internal/curriculum/packs.go`, which was not changed:

| file | sha256 (= registry pin) |
| --- | --- |
| demo-unit-a.json | 34013947405d765e11d44baa7830c620ae417b90d24dbc845fca95625f2ac44e |
| demo-v0.2.json | be4f8038fd71b56266ca257aae9d0fdf0b9110d220a968bf98adc05f57af7a02 |
| demo-v0.3.json | af0c4bdd7b1db1cc188259dc7ebf484207773cd0657e66b5ec379c6f4fa71cf5 |

Purpose: they let the *unchanged* `TestRegistryPinsExactPackBytesAndHonestStatus` run reproducibly without the frontend checkout
(`../run_pin_test.sh`). They prove only that the registry pins the bytes of revision ef28606. They do **not** prove the pins match
the frontend's current content: that is `../check_current_compat.py`, which fails visibly while the two differ.

Known divergence (evidence, not a fix): the canonical frontend revision `8b29a91a2ae4a83d89cbfbfe58c8fdfa67670923` serves
`demo-v0.3.json` with sha256 `80eb638ace35e1ad39bd15b2f48d3d31ace78a776a344e1b948789c9ad161fee`. `demo-unit-a.json` and
`demo-v0.2.json` are byte-identical at both revisions. The `demo-v0.3.json` change arrived with frontend commit
`7f5d9a79672a55f3565fcad410bb7bd049a80050` (2026-10-21, "fix(ui): polish learner copy and responsive layouts"): the 45 items are
identical, the content version is still `demo-synthetic-0.3`, and only lesson-screen body copy differs
(JSON pointers `/lesson_screens/0/body/0`, `/lesson_screens/0/body/1`, `/lesson_screens/4/body/0`). Whether to re-pin, to have the
frontend bump the content version, or to keep serving the old bytes is the curriculum owner's decision.
