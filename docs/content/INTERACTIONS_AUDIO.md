# Picture-first interactions, sound and the language tracks (follow-up 11 contract)

Status: **IN SOURCE (not compiled) 2026-10-18.** This file is the contract shared by the engine, the app
renderers, the art set, the sound system and every pack written in follow-up 11. Packs follow `AUTHORING.md`
plus the additions below; where they disagree, this file wins for the fields it names.

Decisions (Umar, 2026-10-18): languages = English, Korean, Japanese and Mandarin, **Pemula units 01–05 for
kids and adults** (8 packs, ~75 items each, drafts); pronunciation voice = **ElevenLabs** (pre-generated clips
bundled in the APK, no SDK in the app); sound effects = **Claude-made drafts** a sound designer may replace
under the same names; new interactions = **drag & drop, connect with lines, listen & tap the picture, trace
the letters**.

## 1. Less text: the picture-first rule

- At least **70 %** of the PRACT items in a follow-up-11 pack are picture, gesture or listening items:
  `pick_image`, `match_pairs` / `sort_buckets` / `order` / `tiles` with pictures, `audio_match`, `trace`,
  `tap_hotspot`, `memory_flip`.
- A prompt is at most **6 words** ("Pasangkan gambar dan katanya.", "Dengar, lalu pilih."). The picture,
  the gesture and the sound carry the question; text is a label, not a paragraph.
- Model answers are one short line. Lesson screens (`screens`) stay, but at most 3 short body lines each.
- Every target-language word that appears on screen should have a picture (`image`) and, when it is a word
  learners will hear, an `audio` clip key (§3).

## 2. New and changed fields (schema v1, additive; old packs stay valid)

| Field | On | Values | Meaning |
|---|---|---|---|
| `gesture` | item | `"connect"`, `"drag"`, `"tap"` | How a pair/sequence item is answered (§2.1). Omit for the default. |
| `romanization` | item, option | string | Reading aid shown small under `target_text`: pinyin with tone marks (`nǐ hǎo`), Hepburn romaji (`konnichiwa`), Revised Romanization (`annyeonghaseyo`). Not for English. |
| `audio` | item (existed), option (new) | clip key `^[a-z]{2}/[a-z0-9_]+$` | Item: the clip an `audio_match` plays, or a "hear it" speaker next to the target text / under the picture. Option: a speaker button on a word card. Picture cards and the options of a listening question never show a speaker (it would say the answer). |
| `trace` | item | stroke key from §4 | The glyph a `trace` item asks the learner to trace. |
| type `trace` | item | — | New catalog type: trace a letter stroke by stroke. Practice only (never evidence, like `memory_flip`). |

`audio_match` options may now be pictures (`image`) as well as text: "listen, then tap the picture".

### 2.1 Gestures per type (renderer defaults)

| Type | Default | Allowed | What the learner does |
|---|---|---|---|
| `match_pairs` | `connect` | `connect`, `drag` | `connect`: draw a pencil line from a left card to its partner. `drag`: drag each left card (usually a picture) onto its target (usually a word). |
| `sort_buckets` | `drag` | `drag` | Drag each card into a basket. |
| `order`, `tiles`, `fill_blank` | `drag` | `drag`, `tap` | Drag cards/tiles into the slots (`tap` = the old tap-to-place only). |
| everything else | — | — | `gesture` must be absent. |

Accessibility (CR-A11Y): every drag or connect also works **tap, then tap** (tap a card, tap its target),
and TalkBack gets a custom action per target. A gesture never needs speed or precision; nothing is timed.

Motion (ART_DIRECTION §2.7, CR-VIS-2): a dropped card *settles* into its slot (≤ 300 ms, eased, no bounce);
a connect line is drawn on as a wobbly pencil stroke (≤ 250 ms); correct = a small settle of the card and the
`glyph_correct` mark; not yet = a gentle sideways sway (≤ 360 ms), never a shake or red flash. Everything is
still when animations are off.

## 3. Sound

### 3.1 Voice clips (ElevenLabs, pre-generated)

- Clip key `<lang>/<slug>`: `en/apple`, `ko/sagwa`, `ja/ringo`, `zh/pingguo`. Slug = lower-case ASCII
  romanization, `_` between words, digits allowed (`zh/ni_hao`, `ja/konnichiwa`, `ko/annyeonghaseyo`).
  One key = one spoken text; the same key is reused by every item and both audiences.
- File in the app: `android/content/src/main/assets/audio/<lang>/<slug>.mp3` (mono, 22.05 kHz, 32 kbps),
  listed in `assets/audio/index.json` (`{"clips": {"en/apple": "<fingerprint>"}}`, the sha1 of text + voice +
  model + settings written by `voice_gen.py`; the app reads only the keys).
- Every key used by a pack is listed in the voice script `android/content/voice/<lang>.json`:
  `{"lang": "ko", "clips": [{"key": "ko/sagwa", "text": "사과", "note": "apple"}]}` — the text in the
  target script exactly as it must be spoken, and a short note for the reviewer.
- `android/tools/voice_gen.py` turns the scripts into clips with the ElevenLabs API (key from the
  environment variable `ELEVENLABS_API_KEY` on Umar's machine; never committed). Voice ids live in
  `android/content/voice/voices.json`. A native-speaker reviewer listens to every clip before release.
- **Missing clip = item hidden.** Until a clip exists, `audio_match` items that need it are left out of
  sessions and option speaker buttons are not shown. Packs therefore stay playable without audio.

### 3.2 Sound effects

| Key (`res/raw/<key>.ogg`) | When |
|---|---|
| `sfx_tap` | a card is selected (tap-tap mode) |
| `sfx_pick` | a card is lifted for dragging |
| `sfx_drop` | a card is dropped outside any target (it slides back) |
| `sfx_snap` | a card settles into a slot or basket |
| `sfx_connect` | a pencil line connects two cards |
| `sfx_correct` | an answer is correct |
| `sfx_not_yet` | an answer is not right yet (soft, low, never a buzzer) |
| `sfx_stroke` | one trace stroke done |
| `sfx_sticker` | a sticker is earned |
| `sfx_session_done` | the session summary appears |
| `sfx_page` | a lesson screen turns |

Drafts are Claude-made from code (wood, marimba, paper; no generator), ≤ 25 KB each, ≤ 600 ms. Settings has
one switch, «Efek suara / Sound effects» (on by default, device-level). Voice clips play only when the learner
taps a speaker, plus once automatically when a listening question appears. Media volume applies.

## 4. Trace (stroke keys)

Stroke data: `android/content/src/main/assets/strokes/index.json`:
`{"keys": {"hira_a": {"glyph": "あ", "script": "hiragana", "strokes": [[[x, y], ...], ...]}}}` — each stroke
is a polyline in drawing order and direction, coordinates 0..1 (origin top-left). Kana and hanzi come from
KanjiVG (CC BY-SA 3.0, `assets/licenses/KanjiVG.txt`); hangul jamo are drawn by hand to standard stroke
order. Keys:

- Hiragana (46): `hira_a hira_i hira_u hira_e hira_o hira_ka hira_ki hira_ku hira_ke hira_ko hira_sa hira_shi
  hira_su hira_se hira_so hira_ta hira_chi hira_tsu hira_te hira_to hira_na hira_ni hira_nu hira_ne hira_no
  hira_ha hira_hi hira_fu hira_he hira_ho hira_ma hira_mi hira_mu hira_me hira_mo hira_ya hira_yu hira_yo
  hira_ra hira_ri hira_ru hira_re hira_ro hira_wa hira_wo hira_n`
- Hangul basic jamo (24): consonants `hangul_g` ㄱ `hangul_n` ㄴ `hangul_d` ㄷ `hangul_r` ㄹ `hangul_m` ㅁ
  `hangul_b` ㅂ `hangul_s` ㅅ `hangul_ng` ㅇ `hangul_j` ㅈ `hangul_ch` ㅊ `hangul_k` ㅋ `hangul_t` ㅌ
  `hangul_p` ㅍ `hangul_h` ㅎ; vowels `hangul_a` ㅏ `hangul_ya` ㅑ `hangul_eo` ㅓ `hangul_yeo` ㅕ `hangul_o` ㅗ
  `hangul_yo` ㅛ `hangul_u` ㅜ `hangul_yu` ㅠ `hangul_eu` ㅡ `hangul_i` ㅣ
- Hanzi (25): `hanzi_yi` 一 `hanzi_er` 二 `hanzi_san` 三 `hanzi_si` 四 `hanzi_wu` 五 `hanzi_liu` 六
  `hanzi_qi` 七 `hanzi_ba` 八 `hanzi_jiu` 九 `hanzi_shi` 十 `hanzi_ren` 人 `hanzi_kou` 口 `hanzi_da` 大
  `hanzi_xiao` 小 `hanzi_shan` 山 `hanzi_shui` 水 `hanzi_huo` 火 `hanzi_mu` 木 `hanzi_ri` 日 `hanzi_yue` 月
  `hanzi_zhong` 中 `hanzi_shang` 上 `hanzi_xia` 下 `hanzi_wo` 我 `hanzi_hao` 好

A `trace` item: `{"type": "trace", "trace": "hira_a", "target_text": "あ", "romanization": "a",
"audio": "ja/a", "prompt_id": "P-TRACE", ...}` — no options, no solution. The app shows the glyph faintly,
a start dot and an arrow for the next stroke, checks each stroke loosely (start, end, direction, closeness)
and lets the learner try a stroke again without any penalty. Finishing all strokes counts as done
(practice only, CR-ENG-9).

## 5. Picture vocabulary (new art keys, prefix `pic_`)

One object or one figure per drawing, ART_DIRECTION style, shared by every language. Content may use only
these plus the keys already in `docs/ART_CATALOG.md` (e.g. `fam_*`, `fruit_*`, `drink_water`, `sense_*`,
`count_*`, `shape_*`, `clock_*`, `pos_cat_*`, `sleep_moon`, `wash_hands`, `toothbrush`).

- People & greetings (12): `pic_boy pic_girl pic_man pic_woman pic_friends pic_teacher pic_doctor
  pic_wave_hello pic_wave_bye pic_thanks pic_sorry pic_yes_nod`
- Colours (10): `pic_color_red pic_color_blue pic_color_yellow pic_color_green pic_color_black
  pic_color_white pic_color_orange pic_color_purple pic_color_brown pic_color_pink` (a paint daub on paper; the
  one place a fully saturated learning colour is allowed — still flat, no gloss)
- Food & drink (21): `pic_rice_bowl pic_noodle_bowl pic_bread pic_egg_fried pic_apple pic_orange_fruit
  pic_watermelon pic_fish_dish pic_chicken_dish pic_vegetables pic_soup pic_tea_cup pic_coffee_cup
  pic_milk_glass pic_juice pic_cake pic_kimchi pic_onigiri pic_dumplings pic_chopsticks pic_spoon_fork`
- Animals (12): `pic_cat pic_dog pic_bird pic_fish pic_cow pic_chicken pic_rabbit pic_horse pic_goat
  pic_duck pic_elephant pic_monkey`
- Things at home & school (16): `pic_house pic_school pic_book pic_pen pic_pencil pic_bag pic_table pic_chair
  pic_door pic_window pic_bed pic_phone pic_ball pic_shoes pic_shirt pic_hat`
- Places & transport (11): `pic_market pic_hospital pic_park pic_station pic_car pic_bus pic_train
  pic_motorbike pic_bicycle pic_plane pic_ship`
- Nature & weather (9): `pic_sun pic_rain pic_cloud pic_rainbow pic_tree pic_flower pic_mountain pic_sea
  pic_star`
- Actions (12): `pic_eat pic_drink pic_sleep pic_read pic_write pic_walk pic_run pic_play pic_sing pic_cook
  pic_swim pic_sit`
- Feelings & describing (8): `pic_happy pic_sad pic_tired pic_hot pic_cold pic_big pic_small pic_hungry`
- Body (3): `pic_head pic_mouth pic_foot`
- Interaction glyphs (4): `glyph_listen glyph_drag glyph_trace glyph_connect`

## 6. Language tracks (Pemula, units 01–05)

| Track | Pack | Audience | Target | Instruction | Prefix | Reading aid |
|---|---|---|---|---|---|---|
| `ing-k` | `packs/bahasa/ing-k/v1.json` | kids | `en` | `id` | `ING-K-P-<unit>-<nnn>` | — |
| `ing-a` | `packs/bahasa/ing-a/v1.json` | adults | `en` | `id` | `ING-A-P-<unit>-<nnn>` | — |
| `kor-k` | `packs/bahasa/kor-k/v1.json` | kids | `ko` | `id`, `en` | `KOR-K-P-…` | Revised Romanization |
| `kor-a` | `packs/bahasa/kor-a/v1.json` | adults | `ko` | `id`, `en` | `KOR-A-P-…` | Revised Romanization |
| `jpn-k` | `packs/bahasa/jpn-k/v1.json` | kids | `ja` | `id`, `en` | `JPN-K-P-…` | Hepburn romaji |
| `jpn-a` | `packs/bahasa/jpn-a/v1.json` | adults | `ja` | `id`, `en` | `JPN-A-P-…` | Hepburn romaji |
| `zho-k` | `packs/bahasa/zho-k/v1.json` | kids | `zh` (Simplified) | `id`, `en` | `ZHO-K-P-…` | pinyin with tone marks |
| `zho-a` | `packs/bahasa/zho-a/v1.json` | adults | `zh` (Simplified) | `id`, `en` | `ZHO-A-P-…` | pinyin with tone marks |

All tracks are `mode: casual`, `subject: bahasa`, `content_version` `<track>-pemula-0.1`, every item
`review_status: draft` (native-speaker reviewer + Indonesian/English reviewer before release). English packs
still fill both halves of every `{id, en}` text; their instruction language is Indonesian only. Unit 01 is
free (catalog `free_units`). Shared unit themes so the pictures serve every language:

| Unit | English | Korean | Japanese | Mandarin |
|---|---|---|---|---|
| 01 | Hello & me | Hangul vowels + greetings | Hiragana あ–そ + greetings | Pinyin & tones + greetings |
| 02 | Numbers & colours | Hangul consonants + numbers | Hiragana た–ほ + numbers | Numbers 一–十 (trace) |
| 03 | Family & friends | Syllable blocks + family | Hiragana ま–ん + family | Family & people |
| 04 | Food & drink | Food & drink | Food & drink | Food & drink |
| 05 | Animals & things (kids) · Places & getting around (adults) | same split | same split | same split |

Each pack: ≥ 10 `audio_match` items (hidden until clips exist), a `trace` item for every new letter in the
script units (Korean, Japanese, Mandarin), REMED items for every skill, 2–3 gems with sources, 2 daily
puzzles. Kids packs use pictures and gestures almost everywhere; adult packs add short phrases and two-line
dialogues, still picture-led.
