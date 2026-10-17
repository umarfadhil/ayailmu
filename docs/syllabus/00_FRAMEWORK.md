# AyaIlmu Syllabus Framework

**Status:** DRAFT 2026-10-16, written for Umar's review. Working language of this document is English; learner-facing names are given as *Indonesian / English* because every learner-facing string ships in both (see §5). Subject files: `01_BAHASA.md`, `02_MATEMATIKA.md`, `03_SAINS.md`, `04_SOSIAL_SENI.md`.

## 1. Two audiences, four levels

Every subject has a **Kids** track (readers, about 7–12, SD) and an **Adults** track (16+; teens use the adult track). Both use the same four level names, with different meanings:

| Level (ID / EN) | Kids 7–12 | Adults |
|---|---|---|
| **Pemula / Beginner** | Roughly SD kelas 1–2 outcomes; short text, lots of pictures | Refresh what school taught; zero assumptions, no shame |
| **Menengah / Intermediate** | Kelas 3–4; reading short paragraphs, two-step reasoning | Everyday competence: use it in life, work, conversation |
| **Mahir / Advanced** | Kelas 5–6; multi-step problems, explaining why | Depth and fluency; the "I'm actually good at this now" tier |
| **Master** | Beyond grade: enrichment, olympiad-lite puzzles, projects | Expert-grade puzzles, proofs, long reads, synthesis across topics |

Each level has **6–8 units**; each unit has 3–6 **steps** (one step ≈ one daily session of 10–15 minutes) and ends with a **Tantangan / Challenge** step (a mini-reading, puzzle, or "boss" set) that unlocks the unit's hand-drawn sticker. Levels are not gates: a learner may jump in anywhere after a short **Cek Awal / Placement check** (10 items, never blocks, only suggests).

Kids and adults never share items verbatim: the same concept gets different contexts (kids: school, home, kampung, animals, games; adults: money, work, health, news, travel, parenting).

### 1a. Essentials checklist (every level must satisfy all seven before a pack is "complete")

1. **Core concepts** of the level, named in both languages. 2. **Skills** practised to mastery, not just shown. 3. **Vocabulary** the level needs (language tracks: a counted word list; other subjects: the 20–40 terms). 4. **"Kenapa penting / Why it matters"**: at least one unit connects to the learner's life now. 5. **One cross-subject link** (math in art, science in geography…). 6. **One making / doing prompt** done offline. 7. **Hidden gems** (§2a): 5–8 per level, tagged, at least one surfacing per unit.

### 1b. Hidden gems — "Permata / Gems"

A hidden gem is a short, true, surprising piece of knowledge that an expert would be delighted to tell you and a textbook usually skips: an etymology, an Indonesian first, a counter-intuitive fact, a trick that reveals a structure. Gems are the variable reward that makes sessions worth returning to, honestly (no loot boxes: a gem is always knowledge, never cosmetics).

Mechanics: items carry `gem: true`; a gem appears **once per step at an unpredictable position** as a 40-word `info_card` with its own illustration, often followed by one `true_false` or `choose` to make it stick; collecting a gem adds it to the learner's **Kotak Permata / Gem box** (a hand-drawn gem per subject, see ART_DIRECTION §4); the **daily puzzle** draws from the gem pool; gems never count as evidence. Every gem has a one-line source note in the pack (`source`) that reviewers verify; a gem that cannot be sourced is cut.

## 2. Activity catalog (the "not boring" layer)

Every unit mixes at least **five** types; no two consecutive items of the same type unless it's a speed round. Types marked **v1** map to the renderer registry in CODE_RULES CR-ENG-5; **v2** need a new renderer (schema + renderer + scoring + fixture + test in one PR).

| # | Type id | ID / EN name | What the learner does | Engine type | Ship |
|---|---|---|---|---|---|
| 1 | `choose` | Pilih jawaban / Pick one | 2–4 text options + «Saya belum tahu / I don't know yet» | choose | v1 |
| 2 | `pick_image` | Pilih gambar / Pick the picture | 2–4 hand-drawn illustrations, tap one | choose (image options) | v1 |
| 3 | `true_false` | Benar atau salah / True or false | Swipe left/right on a statement card; fast, low-stakes | choose (2) | v1 |
| 4 | `type_in` | Ketik jawaban / Type it | Short Latin-keyboard answer; fuzzy accepted list; unclear → human check | type_in | v1 |
| 5 | `number_input` | Masukkan angka / Enter the number | Numeric pad, optional unit | number_input | v1 |
| 6 | `fill_blank` | Isi titik-titik / Fill the blank | Sentence with a gap; tap a tile or type | tiles / type_in | v1 |
| 7 | `tiles` | Susun / Build it | Build a word, sentence, equation or sequence from tiles | tiles | v1 |
| 8 | `order` | Urutkan / Put in order | Drag cards into sequence (steps, timeline, size, story) | order | v1 |
| 9 | `match_pairs` | Pasangkan / Match | Connect two columns (word–meaning, picture–label, cause–effect) | match_pairs | v1 |
| 10 | `sort_buckets` | Kelompokkan / Sort into groups | Drag items into 2–3 labelled baskets | match_pairs (n:1) | v1 |
| 11 | `audio_match` | Dengar dan pilih / Listen and pick | Play clip(s), choose; audio failure = "not assessed" | audio_match | v1 |
| 12 | `mini_reading` | Bacaan mini / Mini reading | 2–5 sentences or a short infographic, then 2–4 questions | mini_reading | v1 |
| 13 | `info_card` | Kartu belajar / Learn card | Illustrated explanation, two worked examples, "Lanjut"; never scored | info_card | v1 |
| 14 | `tap_hotspot` | Tunjuk / Tap the spot | Tap a region on an illustration (map, body, diagram, clock face) | new | v2 |
| 15 | `estimate_slider` | Perkirakan / Estimate | Slide to an estimate; scored by tolerance band | new | v2 |
| 16 | `memory_flip` | Kartu ingat / Memory flip | Flip cards to find pairs; practice only, never evidence | new | v2 |
| 17 | `story_choice` | Cerita pilihanmu / Choose the story | Short branching story; choices test comprehension or values | mini_reading + choose | v2 |
| 18 | `speed_round` | Putaran cepat / Speed round | 8–12 quick items with a *soft* timer (bar, no countdown digits); **opt-in, adults and kids Mahir+ only**; practice, never evidence | wrapper | v2 |
| 19 | `daily_puzzle` | Teka-teki harian / Daily puzzle | One cross-subject puzzle per day on Home, shared by all tracks | wrapper | v2 |

Rules of fun that keep us honest (CODE_RULES §6): no lives, no hearts, no countdown digits for kids, no penalties; variety, surprise (a sticker you didn't know existed), visible progress scenes, and short sessions do the "addictive" work.

## 3. Learning rules per track mode

| | `evidence` mode (Arabic course; later any track with a reviewed curriculum) | `casual` mode (everything else) |
|---|---|---|
| "Learned" | Trial_App_Spec §7 rules: 4/5 fresh, typed/built evidence, later-day check, D7/D30 | Mastery bands per skill: 3 correct of last 4 incl. one on a later day → "Bisa / Got it"; D7 light check |
| Review | 1 → 3 → 7 days, step back on a mistake, ≤ 50 % of session | 1 → 3 → 7 → 21 days, ≤ 40 % of session |
| Mistakes | Specific feedback + fresh REMED item; serious-mistake blocks | Specific feedback + one fresh item; no blocks |
| Progress screen | Three honest lines (learned / remembered / transfers) | One mastery bar per unit + sticker shelf |
| Hints | Instruction items only | Allowed anywhere; hinted items don't count toward mastery |

## 4. Session composition (planner defaults, all in `rules.<track>.json`)

1. Due **daily puzzle** (if not done today) — 1 item, any subject.
2. Due **reviews** (cap per mode above).
3. **Current step**: 1 info_card (if new concept) → 6–10 practice items in mixed types → 1 "aha" item (transfer to a new context).
4. Every 4th step is a **Tantangan / Challenge** instead: mini_reading or puzzle set; sticker on completion (not on perfection).
5. Stop at the time budget at the end of the current item; interim summary if the learner leaves early.

Kids profiles: default 10 minutes, speed rounds off, reminder off, story contexts age-checked, no external links.

## 5. Bilingual content model (DECIDED 2026-10-16: UI + all content in ID and EN)

- App language = **instruction language** (`id` or `en`), chosen at profile creation, changeable in Settings. Everything the learner reads that is *about* learning (prompts, options, feedback, info cards, syllabus names, stickers' names) exists in both.
- Item schema: every learner-facing string is a `{ "id": "...", "en": "..." }` object; the validator rejects a pack with a missing language unless the track declares `instruction_langs: ["id"]` only (allowed for a track still in translation; such a track is hidden from EN profiles).
- Language tracks additionally declare a **target language** and the instruction languages they support:

| Track | Target | Instruction langs | Note |
|---|---|---|---|
| Arab / Arabic | ar | id (v1), en (later) | Reviewed curriculum; evidence mode |
| Inggris / English | en | id; en allowed from Mahir (immersion) | Kids + adults |
| Bahasa Indonesia (Literasi) | id | id | Indonesian kids literacy & adult writing craft |
| Indonesian for English speakers | id | en | Adults (expats, diaspora); kids later |
| Jepang · Korea · Mandarin | ja · ko · zh | id, en | PLANNED, no syllabus yet |

- Non-language subjects are concept-identical across languages; numbers, units and currency stay Indonesian-context in both languages (Rp, km, Celsius) because the audience is the same people, not two markets.
- Translation workflow: author in Indonesian, translate to English in the same PR, both reviewed; `content_version` bumps when either language changes. Never machine-translate without review.

## 6. Reward and progression vocabulary (shared by all subjects)

- **Stiker / Sticker** per unit challenge (hand-drawn, ART_DIRECTION §4), **Adegan / Scene** per level that fills in as units complete, **Lencana level / Level badge** on level completion.
- **Rangkaian hari / Day chain** counts up, never resets with shame (CR-HAB-2).
- **Koleksi kata / Word shelf** for language tracks; **Kotak rumus / Formula box** for math; **Peta pengetahuan / Knowledge map** for science and social.

## 7. How a syllabus becomes content

Syllabus unit → `content/packs/<subject>/<track>/v1.json` with items tagged `audience` (kids|adults), `level`, `unit`, `step`, `type`, `skills`, `pool`, bilingual strings, `review_status`. Item IDs: `<TRACK>-<AUD>-<LVL>-<UNIT>-<nnn>` (e.g. `MAT-K-P-03-012`), immutable. Only `approved` items reach release builds (CR-ENG-2). Reviewers: one subject reviewer + one Indonesian-language reviewer + one English reviewer per pack.
