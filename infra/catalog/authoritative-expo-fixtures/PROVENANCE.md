# Authoritative Expo fixtures (exact bytes the ACTIVE registry pins)

These three files are byte-for-byte copies of `app/src/content/fixtures/{demo-unit-a,demo-v0.2,demo-v0.3}.json` at the canonical
frontend revision `8b29a91a2ae4a83d89cbfbfe58c8fdfa67670923` (branch `feature/rn-session-recovery-20261020`), extracted read-only with
`git show 8b29a91...:<path>`. They are not edited, normalised or regenerated. They equal the working-tree files of that checkout and
the pins in `backend/internal/curriculum/packs.go`:

| file | sha256 (= active registry pin) |
| --- | --- |
| demo-unit-a.json | 34013947405d765e11d44baa7830c620ae417b90d24dbc845fca95625f2ac44e |
| demo-v0.2.json | be4f8038fd71b56266ca257aae9d0fdf0b9110d220a968bf98adc05f57af7a02 |
| demo-v0.3.json | 80eb638ace35e1ad39bd15b2f48d3d31ace78a776a344e1b948789c9ad161fee |

They let the unchanged `TestRegistryPinsExactPackBytesAndHonestStatus` run reproducibly without the frontend checkout
(`../run_pin_test.sh`). The historical bytes the registry pinned before (frontend `ef28606`) stay archived, unchanged, in
`../pinned-expo-fixtures`; `../verify_alignment_proof.py` proves the exact, bounded difference between the two.

## Why the active pin moved (reviewed alignment, not a policy)

`demo-v0.3.json` kept `content_version = demo-synthetic-0.3` while frontend commit `7f5d9a79672a55f3565fcad410bb7bd049a80050`
("fix(ui): polish learner copy and responsive layouts", 2026-10-21) shortened three lesson-screen strings:
`/lesson_screens/0/body/0`, `/lesson_screens/0/body/1`, `/lesson_screens/4/body/0`. The 45 items (IDs, choices, answer keys, versions)
and their 53 draft statuses are identical. In the frontend, `lesson_screens[].body` is display text only (`LessonPanel`,
`UnitAPilotScreen`; `gating.ts` only checks `clue_paragraph < body.length`, and the paragraph counts are unchanged), and the sync
journal hashes `{curriculum{family,track,content_version,rules_version},kind,payload,schema,schema_version}`, never a catalog
hash; it does not call `GET /v1/curricula`. In the backend the source SHA-256 is read only by `GET /v1/curricula`. The registry
key, the envelope semantic hash and every stored event column are independent of it
(`backend/internal/curriculum/source_alignment_test.go`). The alignment therefore changes one served metadata string and nothing an
old or new client, a stored event or a replay depends on.

This does not authorise future copy edits: `../check_current_compat.py` still fails on any byte of any fixture that differs from the
active pins, and a future change needs its own reviewed re-pin.
