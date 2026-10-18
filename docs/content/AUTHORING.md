# Content authoring — packs v1 schema (P8 edition, follow-up 11 and 12 additions)

How to write a content pack that the app can load. The schema lives in
`android/core/content/src/main/kotlin/id/petalytix/ayailmu/core/content/ContentSchema.kt`; the rules that the build
enforces are in `PackValidator.kt` (`./gradlew :core:content:validatePacks`). The syllabus says *what* to teach
(`docs/syllabus/`), the framework says *how* (`00_FRAMEWORK.md`), this file says *how to write it down*.

## 1. Files

- A pack: `android/content/src/main/assets/packs/<subject>/<track>/v1.json`.
- Its rules: `android/content/src/main/assets/config/rules.<track>.json` (copy `rules.mat.json`, change `track`).
- Register both in `android/content/src/main/assets/config/catalog.json` with the units that are free
  (`free_units`); every other unit needs the subject pack or all-access (MONETIZATION_SCHEME).
- Pictures: only keys from `docs/ART_CATALOG.md` (checked against `assets/art/index.json`).
- Picture-first interactions, voice clips, `trace` and the language tracks (`ing-*`, `kor-*`, `jpn-*`, `zho-*`):
  **`INTERACTIONS_AUDIO.md`** is the contract; where it and this file disagree on a field it names, it wins.
- Levels, the Nilai and Sejarah modules, new track ids and `story` items: **`MODULES_LEVELS_STORIES.md`** is the
  contract (follow-up 12); it extends `INTERACTIONS_AUDIO.md`, which still applies.

| Track | Pack | Audience | Prefix |
|---|---|---|---|
| `arab` | `packs/bahasa/arab/v1.json` | adults | `DEMO-` (synthetic until reviewed items arrive) |
| `mat` | `packs/matematika/mat/v1.json` | kids | `MAT-K-P-<unit>-<nnn>` |
| `mat-a` | `packs/matematika/mat-a/v1.json` | adults | `MAT-A-P-<unit>-<nnn>` |
| `sns-k` | `packs/sains/sns-k/v1.json` | kids | `SNS-K-P-<unit>-<nnn>` |
| `sns-a` | `packs/sains/sns-a/v1.json` | adults | `SNS-A-P-<unit>-<nnn>` |
| `sos-k` | `packs/sosial_seni/sos-k/v1.json` | kids | `SOS-K-P-<unit>-<nnn>` |
| `sos-a` | `packs/sosial_seni/sos-a/v1.json` | adults | `SOS-A-P-<unit>-<nnn>` |
| `ing-k` / `ing-a` | `packs/bahasa/ing-k|ing-a/v1.json` | kids / adults | `ING-K-P-…` / `ING-A-P-…` (target `en`, instruction `id` only) |
| `kor-k` / `kor-a` | `packs/bahasa/kor-k|kor-a/v1.json` | kids / adults | `KOR-K-P-…` / `KOR-A-P-…` (target `ko`) |
| `jpn-k` / `jpn-a` | `packs/bahasa/jpn-k|jpn-a/v1.json` | kids / adults | `JPN-K-P-…` / `JPN-A-P-…` (target `ja`) |
| `zho-k` / `zho-a` | `packs/bahasa/zho-k|zho-a/v1.json` | kids / adults | `ZHO-K-P-…` / `ZHO-A-P-…` (target `zh`, Simplified) |
| `nil-k` / `nil-a` | `packs/nilai/nil-k\|nil-a/v1.json` | kids / adults | `NIL-K-P-…` / `NIL-A-P-…` (Nilai Pemula, `"subject": "nilai"`, free) |
| `sej-k` / `sej-a` | `packs/sejarah/sej-k\|sej-a/v1.json` | kids / adults | `SEJ-K-P-…` / `SEJ-A-P-…` (Sejarah Pemula, `"subject": "sejarah"`) |
| `<base>-<k\|a>-<m\|h\|x>` | `packs/<subject>/<track>/v1.json` | kids (`k`) / adults (`a`) | `<BASE>-<K\|A>-<M\|H\|X>-<unit>-<nnn>` |

New levels (follow-up 12): every module has Menengah (`m`), Mahir (`h`) and Master (`x`) tracks per audience, e.g.
`mat-k-m` (`MAT-K-M-01-001`), `sns-a-h`, `ing-k-x`, `nil-a-m`, `sej-k-h`. `<base>` is the Pemula id without its
audience (`mat`, `sns`, `sos`, `ing`, `kor`, `jpn`, `zho`, `nil`, `sej`); the full list is in
`MODULES_LEVELS_STORIES.md` §1. The pack meta says `"level"` (below); its rules file copies the Pemula rules of
the same audience; content version `<track>-0.1`.

Units are two digits (`"01"` … `"10"`). Lesson screens: `<prefix-without-nnn>-S1`, `-S2` (e.g. `MAT-K-P-03-S1`).
Daily puzzles: `<P>-DP-<nn>` (e.g. `MAT-K-P-DP-01`).

## 2. Pack skeleton

```json
{
  "meta": { "schema_version": 1, "content_version": "mat-k-pemula-0.1", "subject": "matematika", "track": "mat",
            "mode": "casual", "audiences": ["kids"], "instruction_langs": ["id", "en"],
            "title": { "id": "Matematika — Pemula (Anak)", "en": "Mathematics — Beginner (Kids)" } },
  "synthetic": false,
  "note": "Draft written 2026-10-17; needs a subject reviewer and both language reviewers.",
  "prompts": { "P-COUNT": { "id": "Ada berapa?", "en": "How many?" } },
  "feedback": { "FB-OK": { "id": "Betul!", "en": "That's right!" } },
  "units": [ { "unit": "01", "title": { "id": "Bilangan sampai 100", "en": "Numbers to 100" }, "sticker": "sticker_mango" } ],
  "screens": [ ... ],
  "readings": { ... },
  "items": [ ... ]
}
```

- Every learner-facing string is `{ "id": …, "en": … }`, both filled, both natural (not word-for-word).
- `content_version` is identical on the pack meta and on every item.
- `review_status` is `"draft"` on everything you write. Only reviewers set `approved` (prod shows approved only).
- `synthetic` is `false` for real drafts (it is `true` only for made-up developer fixtures).
- `feedback` templates may use `{model}` (the item's `model_answer`), `{benar}` (the correct option's text).
- `meta.level` (follow-up 12): `pemula` (default when left out, so every older pack is Pemula), `menengah`,
  `mahir` or `master`. `meta.subject` may also be `nilai` or `sejarah`.

## 3. Items — fields every item has

`item_id`, `unit`, `type`, `audience` (`kids`/`adults`), `level` (the pack's `meta.level`; the validator rejects any
other), `step` (1 or 2 within the unit),
`skills` (1–2 skill ids, e.g. `"NUM-COMPARE"`; first one is the primary skill), `pool`, `order` (planner order for
PRACT items, unique within the pack), `prompt_id`, `model_answer` (bilingual; shown after an answer),
`feedback_ids` (`correct`, `wrong`, `dont_know`), `review_status`, `content_version`.

Pools: `PRACT` (normal practice, most items), `REMED` (fresh follow-up items for a skill after a mistake — give
each skill at least one), `GEM` (hidden gems, `gem: true` + `source`, type `info_card`), `SPARE` (daily puzzles only).

## 4. Types (all available to packs)

| Type | Answer shape | Notes |
|---|---|---|
| `choose`, `true_false`, `pick_image`, `story_choice`, `tap_hotspot` | `options` with exactly one `"correct": true` | `true_false` has exactly 2 options. `pick_image` options use `"image": "<art key>"`. `story_choice` needs `reading_id`. `tap_hotspot` needs `image` (a scene) and each option a `region` copied from ART_CATALOG. |
| `type_in` | `accepted.<lang>.terms` per language | Short answers only (one word or number word). Add common spellings. |
| `number_input` | `numeric: { value, tolerance }` | Optional `numeric.unit` (bilingual). |
| `estimate_slider` | `numeric` with `tolerance > 0` + `slider: { min, max, step }` | Value must be inside the range. |
| `order`, `tiles`, `fill_blank` | `options` + `solution` (option ids in order) | Shuffle the options in the file (the app does not). `fill_blank` usually has a 1-element solution. |
| `match_pairs`, `sort_buckets`, `memory_flip` | `options` + `solution_pairs` (left id → right id) | `sort_buckets`: buckets are options too; many items → one bucket. `memory_flip` must be one-to-one; practice only. |
| `audio_match` | `audio` clip key + `options` with exactly one `"correct": true` | "Listen, then tap": options are pictures (`image`), words (`target_text`) or text. Hidden until the clip exists. |
| `trace` | `trace` stroke key (`assets/strokes/index.json`) | Trace a letter stroke by stroke. No `options`, no `solution`. Practice only (never evidence). |
| `mini_reading` | `reading_id` | Not scored ("seen"); questions about the reading are ordinary items with the same `reading_id`. |
| `info_card` | `model_answer` holds the card text | Not scored. Gems are info cards in pool `GEM`. |
| `story` | `story_id` naming an entry of the pack's `stories` | An animated story (§4.2). No `options`, no `solution`. Not scored ("seen", like `info_card`), never evidence. Questions about it are ordinary items with the same `story_id`. |
| `daily_puzzle` | options (one correct) **or** `numeric` | Pool `SPARE`; shown on Home once a day; never in sessions; practice only. |

Do **not** use `speed_round` (a practice mode, not an item).

An optional `image` on any item shows a picture with the question (e.g. `count_mango_7` with "Ada berapa?").
Optional `help_lines: [{ "word": "", "meaning": {…} }]` show a hint line under the question (math and science
leave `word` empty).

### 4.1 Follow-up 11 fields (all optional; details in `INTERACTIONS_AUDIO.md` §2–§4)

| Field | On | Rule (checked by the validator) |
|---|---|---|
| `gesture` | item | `match_pairs`: `connect` (default) or `drag`; `sort_buckets`: `drag`; `order`/`tiles`/`fill_blank`: `drag` (default) or `tap`. Any other type: leave it out. |
| `audio` | item, option | Clip key `<lang>/<slug>` (`ja/ringo`, `zh/ni_hao`): two lower-case letters, `/`, then `a-z 0-9 _`. Also list it in the voice script `android/content/voice/<lang>.json` (not checked here). Item: what `audio_match` plays; option: a speaker button on that card. |
| `romanization` | item, option | Reading aid under `target_text` (pinyin with tone marks, Hepburn, Revised Romanization); not blank; not for English. |
| `trace` | item | Only on `trace` items; a key listed in `INTERACTIONS_AUDIO.md` §4 (checked against `strokes/index.json` when it exists). |

```json
{ "item_id": "JPN-K-P-01-003", "unit": "01", "audience": "kids", "level": "pemula", "step": 1, "type": "trace",
  "skills": ["KANA-A-O"], "pool": "PRACT", "order": 3, "prompt_id": "P-TRACE",
  "trace": "hira_a", "target_text": "あ", "romanization": "a", "audio": "ja/a",
  "model_answer": { "id": "あ dibaca \"a\".", "en": "あ is read \"a\"." },
  "feedback_ids": { "correct": "FB-OK", "wrong": "FB-NO", "dont_know": "FB-DONTKNOW" },
  "review_status": "draft", "content_version": "jpn-k-pemula-0.1" }
```

### 4.2 Stories (follow-up 12; contract: `MODULES_LEVELS_STORIES.md` §2)

A pack-level map `"stories": { "ST-KARTINI": { … } }` holds each story: `figure` (name and years), `title`
(bilingual), `source` (real, checkable), optional `emblem` (art key) and 3–6 `panels`. A panel has a `scene`
(`hist_bg_*`, 16:9), a bilingual `caption` (at most 2 sentences and 40 words in each language), optional
`narration` (`{"id": "id/sej_kartini_01", "en": "en/sej_kartini_01"}` — keys are instruction languages, each clip
of that language), optional `zoom` (`{"scale_from": 1.0, "scale_to": 1.06, "ms": 5000}`) and up to 4 `layers`
(`art`, `x`, `y`, `w` as scene fractions, optional `z`, `flip`, `motion`; at most 3 of them moving).

The item that plays it: `{"type": "story", "story_id": "ST-KARTINI", "pool": "PRACT", "prompt_id": "P-STORY", …}`.
Its questions sit in the **same unit** and carry `"story_id"` too (the app offers «Lihat lagi / Watch again»).
Every story needs a `story` item.

Motion limits the validator enforces (lengths are scene fractions; `ms` defaults per type are within them):

| `motion.type` | Fields | Limits |
|---|---|---|
| `none` | — | — |
| `fade_in` | `ms`, `delay_ms` | ms ≤ 900 |
| `slide_in` | `from` (`left`/`right`/`top`/`bottom`, default `bottom`), `ms`, `delay_ms` | ms ≤ 900 |
| `drift` | `dx`, `dy`, `ms`, `loop` | \|dx\|, \|dy\| ≤ 0.08; ms ≥ 2000 when looping |
| `bob` | `amp`, `ms`, `loop` | amp ≤ 0.02; ms ≥ 1600 |
| `sway` | `deg`, `ms`, `loop` | \|deg\| ≤ 6; ms ≥ 1600 |
| `glow` | `ms`, `loop` | ms ≥ 1600 |
| `path` | `points` `[[x, y], …]`, `ms`, `delay_ms`, `loop` | 2–6 points within 0..1; ms ≤ 6000 |
| `zoom` | `scale_from`, `scale_to`, `ms` | both within 1.0–1.12; ms ≤ 6000 |
| `reveal` | `from` (`left`/`right`, default `left`), `ms`, `delay_ms` | ms ≤ 2000 |

How they play (`MotionMath` in `:core:content`): `ms` is one leg for `drift` and `path` (there, and back again when
`loop` is true), the whole push-in for `zoom` (never loops) and one full cycle for `bob`, `sway` and `glow`; without
`"loop": true` a move plays once and stays at its end, a pulse plays one cycle and rests. Reduce-motion shows every
layer at its end (a looping one at its start). `path` points are where the layer's top-left goes: give the
layer the first point as its `x`, `y`. Layers stay on the scene: `x`, `y` within 0..1, `w` in (0, 1], `x + w` ≤ 1.05.

## 5. Examples

```json
{ "item_id": "MAT-K-P-03-004", "unit": "03", "audience": "kids", "level": "pemula", "step": 1, "type": "tap_hotspot",
  "skills": ["GEO-SHAPES-2D"], "pool": "PRACT", "order": 34, "prompt_id": "P-TAP-TRIANGLE", "image": "scene_kampung_shapes",
  "model_answer": { "id": "Atap rumah berbentuk segitiga.", "en": "The roof is a triangle." },
  "options": [
    { "id": "sun", "text": { "id": "matahari", "en": "sun" }, "region": { "x": 0.06, "y": 0.06, "w": 0.18, "h": 0.24 } },
    { "id": "roof", "text": { "id": "atap", "en": "roof" }, "region": { "x": 0.30, "y": 0.20, "w": 0.36, "h": 0.22 }, "correct": true },
    { "id": "kite", "text": { "id": "layang-layang", "en": "kite" }, "region": { "x": 0.74, "y": 0.06, "w": 0.16, "h": 0.26 } }
  ],
  "feedback_ids": { "correct": "FB-OK-MODEL", "wrong": "FB-NO-MODEL", "dont_know": "FB-DONTKNOW" },
  "review_status": "draft", "content_version": "mat-k-pemula-0.1" }

{ "item_id": "MAT-A-P-07-003", "unit": "07", "audience": "adults", "level": "pemula", "step": 1, "type": "estimate_slider",
  "skills": ["EST-FERMI"], "pool": "PRACT", "order": 71, "prompt_id": "P-ESTIMATE",
  "help_lines": [{ "word": "", "meaning": { "id": "Kira-kira berapa jam dalam satu tahun?", "en": "Roughly how many hours are in a year?" } }],
  "numeric": { "value": 8760, "tolerance": 1500 }, "slider": { "min": 0, "max": 20000, "step": 100 },
  "model_answer": { "id": "365 × 24 = 8.760 jam", "en": "365 × 24 = 8,760 hours" },
  "feedback_ids": { "correct": "FB-OK-MODEL", "wrong": "FB-NO-MODEL", "dont_know": "FB-DONTKNOW" },
  "review_status": "draft", "content_version": "mat-a-pemula-0.1" }

{ "item_id": "MAT-K-P-DP-01", "unit": "01", "audience": "kids", "level": "pemula", "type": "daily_puzzle",
  "skills": ["PUZZLE"], "pool": "SPARE", "prompt_id": "P-PUZZLE",
  "help_lines": [{ "word": "", "meaning": { "id": "Aku bilangan dua angka. Angka puluhanku 3, satuanku dua kali puluhanku.", "en": "I am a two-digit number. My tens digit is 3 and my ones digit is double that." } }],
  "numeric": { "value": 36, "tolerance": 0 },
  "model_answer": { "id": "36", "en": "36" },
  "feedback_ids": { "correct": "FB-OK-MODEL", "wrong": "FB-NO-MODEL", "dont_know": "FB-DONTKNOW" },
  "review_status": "draft", "content_version": "mat-k-pemula-0.1" }
```

## 6. Quality bar (reviewers will check; write as if they will approve it)

- Correct. Every answer is right, every gem is true and has a real, checkable `source` (book, encyclopedia entry,
  official site) — if you are not sure, leave the gem out.
- Bilingual and natural: Indonesian as a good SD teacher or a friendly adult educator writes it (EYD V spelling,
  "kamu" for kids, "Anda" for adults); English plain and warm. Numbers in Indonesian use `.` for thousands and `,`
  for decimals inside text; English the reverse.
- Indonesian everyday context (warung, pasar, angkot, sawah, arisan, rupiah amounts), respectful of every religion
  and region. Kids content is kind: no fear, no shaming, no violence, no brands.
- Health, safety and money content is general information, never personal advice; say when to see a doctor or
  call 112/119; follow official Indonesian sources (Kemenkes, BMKG, OJK).
- Each unit: 1 lesson screen (2–4 short paragraphs + optional examples), 8–12 `PRACT` items mixing at least four
  types from the syllabus "Mix" column, 2 `REMED` items, 1 gem (`info_card`, pool `GEM`). Steps 1 and 2 split
  the unit roughly in half. `order` increases through the unit; units in order.
- Feedback: kind and specific. "Belum tepat" is fine; never "Salah!".
- Validate before you finish: `art`/index check and schema check (see §7). Zero problems.

## 7. Validating without Gradle

In a cloud session: `scratchpad/core_build.sh` compiles the pure-Kotlin core with kotlinc 2.2.20, then
`scratchpad/validate.sh android/content/src/main/assets` runs the same validator as `validatePacks`. It also checks
`strokes/index.json` (when present) and every `trace` key against it.
On Windows: `./gradlew :core:content:validatePacks`.
