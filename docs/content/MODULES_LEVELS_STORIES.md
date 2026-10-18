# Modules, levels, values, history stories (follow-up 12 contract)

Status: **IN SOURCE (not compiled) 2026-10-18.** The contract shared by the engine, the app, the art set and
every pack written in follow-up 12. It extends `INTERACTIONS_AUDIO.md` (follow-up 11), which still applies:
picture-first rule, gestures, sound, voice clips, trace.

Decisions (Umar, 2026-10-18): one **Bahasa** module with a language picker; every module has **four levels per
audience** (Pemula, Menengah, Mahir, Master; kids and adults separately); this round writes **2 starter units**
for Menengah, Mahir and Master in every module, audience and language; two new modules: **Nilai** (universal
values, **free**) and **Sejarah** (noble people of history, a paid pack like the other subjects, unit 01 free);
history figures from Indonesia and the world, **drawn through their work and as silhouettes, never as face
likenesses**; history stories are **animated scenes with ElevenLabs narration** (Indonesian and English).
Image rule: **no component that should be a picture may show text instead** (§8).

## 1. Modules, languages and levels

| Module (`subject`) | Code | Free? | Languages |
|---|---|---|---|
| `bahasa` | BHS | unit 01 of each track | `ar` (adults, evidence course, own units A/B…), `en`, `ko`, `ja`, `zh` |
| `matematika` | MAT | unit 01 of each track | — |
| `sains` | SNS | unit 01 of each track | — |
| `sosial_seni` | SOS | unit 01 of each track | — |
| `nilai` (new) | NIL | **everything** (no product) | — |
| `sejarah` (new) | SJR | unit 01 of each track; `pack_sejarah_lifetime` 59.000 [UMAR: confirm price], in all-access | — |

- A **track** = one module × (language) × audience × level, one pack, one rules file, one catalog line. The pack
  meta gains `"level"` (`pemula` default, so every existing pack is Pemula). Arabic stays one evidence course
  (no Menengah+ tracks this round).
- Home shows **one card per module**. Tapping it opens the module screen: for Bahasa first a **language picker**
  (one cover per language), then the **level ladder** (four level badges, each with its progress; a level with
  no track yet shows «Segera / Coming soon»). Kids and adults never see each other's tracks: the profile's
  audience picks them. The profile remembers its language and level per module; Home's card shows them
  («Bahasa · Korea · Menengah») with «Mulai» and «Ganti».
- Any level may be chosen (no placement test); the ladder suggests the next level once ≥ 80 % of a level's
  units are done. Every level track's unit 01 is free (`free_units: ["01"]`), so anyone can try a level.

### Track ids and item prefixes

Pemula tracks keep their ids (`mat`, `mat-a`, `sns-k`, `ing-k`, `kor-a`, …). New tracks are
`<base>-<k|a>-<m|h|x>` (level code: Menengah `m`, Mahir `h`, Master `x`), item prefix `<BASE>-<K|A>-<M|H|X>-…`:

| Module | Pemula (kids / adults) | New levels |
|---|---|---|
| Matematika | `mat` / `mat-a` | `mat-k-m mat-a-m mat-k-h mat-a-h mat-k-x mat-a-x` (`MAT-K-M-01-001` …) |
| Sains | `sns-k` / `sns-a` | `sns-k-m sns-a-m sns-k-h sns-a-h sns-k-x sns-a-x` |
| Sosial & Seni | `sos-k` / `sos-a` | `sos-k-m sos-a-m sos-k-h sos-a-h sos-k-x sos-a-x` |
| Inggris | `ing-k` / `ing-a` | `ing-k-m ing-a-m ing-k-h ing-a-h ing-k-x ing-a-x` |
| Korea | `kor-k` / `kor-a` | `kor-k-m kor-a-m kor-k-h kor-a-h kor-k-x kor-a-x` |
| Jepang | `jpn-k` / `jpn-a` | `jpn-k-m jpn-a-m jpn-k-h jpn-a-h jpn-k-x jpn-a-x` |
| Mandarin | `zho-k` / `zho-a` | `zho-k-m zho-a-m zho-k-h zho-a-h zho-k-x zho-a-x` |
| Nilai | `nil-k` / `nil-a` (`NIL-K-P-…`) | `nil-k-m nil-a-m nil-k-h nil-a-h nil-k-x nil-a-x` |
| Sejarah | `sej-k` / `sej-a` (`SEJ-K-P-…`) | `sej-k-m sej-a-m sej-k-h sej-a-h sej-k-x sej-a-x` |

Packs: `android/content/src/main/assets/packs/<subject>/<track>/v1.json`; rules
`config/rules.<track>.json` (casual mode; copy the Pemula rules of the same audience; Mahir/Master may raise
`items_per_minute` slightly). Content version `<track>-0.1`. Each agent reports its catalog lines; the main
session registers them. Starter levels: **2 units, ~30 items** (15 per unit incl. REMED), 1 gem, 1 daily
puzzle. Nilai and Sejarah Pemula: **3 units**; their Menengah/Mahir/Master: 2 units.

Level meaning (framework §1, refined): **Pemula** first steps; **Menengah** everyday independence;
**Mahir** reasoning and longer tasks; **Master** transfer, nuance and creating. Kids levels track SD phases
(kelas 1–2, 3–4, 5–6, beyond); adult levels track real-life use. Each subject syllabus in `docs/syllabus/`
already describes its four levels — follow it.

## 2. Stories (new item type `story`)

A `story` item shows an animated story: 3–6 **panels**; each panel is a background scene plus up to 4 picture
layers that move gently, a caption of at most 2 short sentences, and a narration clip. The learner taps to go
on; the item is "seen", never scored (`evidenceCapable = false`, like `info_card`). Questions about the story are
ordinary items in the same unit with `"story_id"` set (the app offers «Lihat lagi / Watch again»).

Pack-level map `"stories"`:

```json
"stories": {
  "ST-KARTINI": {
    "figure": "Raden Ajeng Kartini (1879–1904)",
    "title": {"id": "Kartini dan surat-suratnya", "en": "Kartini and her letters"},
    "source": "Kartini, Habis Gelap Terbitlah Terang (1911); Britannica: Kartini",
    "emblem": "hist_kartini_letters",
    "panels": [
      {
        "scene": "hist_bg_room_lamp",
        "caption": {"id": "Kartini suka membaca sampai larut malam.", "en": "Kartini loved reading late into the night."},
        "narration": {"id": "id/sej_kartini_01", "en": "en/sej_kartini_01"},
        "layers": [
          {"art": "hist_sil_woman_kebaya", "x": 0.08, "y": 0.30, "w": 0.30, "motion": {"type": "fade_in", "ms": 600}},
          {"art": "hist_oil_lamp", "x": 0.62, "y": 0.22, "w": 0.16, "motion": {"type": "glow", "ms": 2400, "loop": true}},
          {"art": "hist_kartini_letters", "x": 0.40, "y": 0.62, "w": 0.26, "motion": {"type": "slide_in", "from": "bottom", "ms": 600, "delay_ms": 300}}
        ]
      }
    ]
  }
}
```

Item: `{"type": "story", "story_id": "ST-KARTINI", "pool": "PRACT", "prompt_id": "P-STORY", …}` (no options).

A panel may also carry `"zoom": {"scale_from": 1.0, "scale_to": 1.06, "ms": 5000}` for a slow push-in on the whole scene.

Layer geometry: `x`, `y` = top-left as fractions of the scene (0..1), `w` = width fraction (height follows the
drawing's aspect), optional `z` (draw order, default = list order), optional `flip` (mirror horizontally).
Scenes are 16:9 (`hist_bg_*`, 400×225 viewport).

Motion (`motion.type`; all optional fields have defaults; reduce-motion = every layer at its final state):

| type | fields | what it does | limits |
|---|---|---|---|
| `none` | — | still | — |
| `fade_in` | `ms`, `delay_ms` | appears | ms ≤ 900 |
| `slide_in` | `from` (left/right/top/bottom), `ms`, `delay_ms` | enters from that side by ~15 % of the scene, settles (eased, no bounce) | ms ≤ 900 |
| `drift` | `dx`, `dy` (fractions ≤ 0.08), `ms`, `loop` | slow back-and-forth move (clouds, a ship rocking forward) | ms ≥ 2000 when looping |
| `bob` | `amp` (fraction ≤ 0.02), `ms`, `loop` | small up-down on twos (water, breathing) | ms ≥ 1600 |
| `sway` | `deg` (≤ 6), `ms`, `loop` | small rotation about the bottom centre (trees, a lamp) | ms ≥ 1600 |
| `glow` | `ms`, `loop` | alpha pulses 0.65 ↔ 1 (lamp light, a lab flask) | ms ≥ 1600 |
| `path` | `points` [[x,y],…] (2–6), `ms`, `delay_ms`, `loop` | moves along the points (a ship's route, a plane's flight) | ms ≤ 6000 |
| `zoom` | `scale_from`, `scale_to` (1.0–1.12), `ms` | slow push-in (a layer; `"zoom"` on the panel itself zooms the scene) | ms ≤ 6000 |
| `reveal` | `ms`, `delay_ms`, `from` (left/right) | wipes in (a route line, a map) | ms ≤ 2000 |

At most 3 moving layers per panel; nothing flashes, spins, shakes or bounces (ART_DIRECTION §2.7). A panel's
motion never needs to finish before the learner may tap on.

Narration: clip keys `id/<slug>` and `en/<slug>` (slug `sej_<figure>_<nn>` or `nil_<topic>_<nn>`), played for
the profile's instruction language when the panel appears (if bundled; otherwise the caption alone). Narration
scripts go in `android/content/voice/<lang>.<topic>.json` (e.g. `id.sejarah-k.json`, `en.sejarah-a.json`) with
`"lang"` = the language; the text is the caption (or a slightly fuller spoken version, ≤ 2 sentences).

## 3. Nilai (universal values) — design guide

Universal, not tied to one religion; respectful of Indonesia's diversity; shows good behaviour rather than
shaming bad behaviour; no lecturing — picture scenarios, choices, sorting and short stories. Themes:

| Level | Kids | Adults |
|---|---|---|
| Pemula | antre (queueing) · terima kasih & maaf · berbagi · jujur · menjaga kebersihan | antre di layanan umum · sopan santun & salam · jujur dalam hal kecil · menghargai kerja orang lain · kebersihan bersama |
| Menengah | menghormati perbedaan · tanggung jawab · menepati janji · tolong-menolong / gotong royong | menghormati yang lebih tua dan yang berbeda · tepat waktu · gotong royong · menepati janji |
| Mahir | integritas (berbuat benar walau tak dilihat) · empati · adil · sabar & mengelola marah | integritas di tempat kerja · empati · adil · mengelola emosi |
| Master | berani bicara dengan santun · toleransi & dialog · syukur & sederhana · warga digital yang baik | kepemimpinan yang melayani · antikorupsi dalam keseharian · dialog & toleransi · etika digital |

Item forms: pick_image of the kind action among scenes; sort_buckets «baik / kurang baik» with scene cards
(feedback explains kindly why); order the steps (queueing, apologising); story_choice and `story` for short
animated stories with a choice after; true_false only on clear cases. Several "what would you do" items may
accept more than one good answer only if the schema can score them — otherwise pick one clearly best answer
and say why the others are less helpful. Nilai items never use red/negative glyphs on people.

## 4. Sejarah (noble people) — figures and depiction

Only people who have died; broadly honoured; never prophets or founders of a religion; no political figure
who divides people today. Each story: who, where and when, what they did, the value it shows, and a
real source (`source`). **No face likeness**: figures appear as silhouettes (from the side or behind) and
through the objects of their work; captions never invent quotes (only quotes with a reliable source, marked
as quotes). Violence and war are never shown; courage is shown as leadership, care and persistence.

| Figure (id) | Born–died | Shown through (art keys, §6.2) |
|---|---|---|
| Ki Hajar Dewantara (`ki_hajar`) | 1889–1959 | `hist_ki_hajar_school`, `hist_slate_board` |
| R.A. Kartini (`kartini`) | 1879–1904 | `hist_kartini_letters`, `hist_oil_lamp` |
| Dewi Sartika (`dewi_sartika`) | 1884–1947 | `hist_dewi_sartika_school`, `hist_sewing_kit` |
| Cut Nyak Dhien (`cut_nyak_dhien`) | 1848–1908 | `hist_rumoh_aceh`, `hist_bg_hills_aceh` (leadership; no weapons) |
| Mohammad Hatta (`hatta`) | 1902–1980 | `hist_hatta_books`, `hist_coop_shop` |
| B.J. Habibie (`habibie`) | 1936–2019 | `hist_habibie_plane`, `hist_blueprint` |
| Zheng He / Cheng Ho (`zheng_he`) | 1371–1433/35 | `hist_treasure_ship`, `hist_compass_old` |
| King Sejong (`sejong`) | 1397–1450 | `hist_sejong_scroll`, `hist_rain_gauge` |
| Mahatma Gandhi (`gandhi`) | 1869–1948 | `hist_spinning_wheel`, `hist_sandals_path` |
| Al-Khwarizmi (`khwarizmi`) | c. 780–c. 850 | `hist_khwarizmi_board`, `hist_astrolabe` |
| Ibn Sina (`ibn_sina`) | 980–1037 | `hist_ibn_sina_book`, `hist_herbs_mortar` |
| Ibn al-Haytham (`ibn_haytham`) | c. 965–c. 1040 | `hist_camera_obscura`, `hist_lens` |
| Ibn Battuta (`ibn_battuta`) | 1304–1368/69 | `hist_caravan`, `hist_route_map` |
| Fatima al-Fihri (`al_fihri`) | c. 800–880 | `hist_qarawiyyin`, `hist_book_stack` |
| Nelson Mandela (`mandela`) | 1918–2013 | `hist_handshake`, `hist_sunrise` |
| Wangari Maathai (`maathai`) | 1940–2011 | `hist_tree_seedlings`, `hist_bg_green_hills` |
| Marie Curie (`curie`) | 1867–1934 | `hist_curie_flask`, `hist_notebook` |
| Florence Nightingale (`nightingale`) | 1820–1910 | `hist_nightingale_lamp`, `hist_hospital_bed` |
| Louis Braille (`braille`) | 1809–1852 | `hist_braille_dots`, `hist_braille_book` |
| Galileo Galilei (`galileo`) | 1564–1642 | `hist_telescope`, `hist_jupiter_moons` |
| Wright brothers (`wright`) | 1867–1912 / 1871–1948 | `hist_wright_flyer`, `hist_bicycle_shop` |
| Helen Keller (`keller`) | 1880–1968 | `hist_water_pump`, `hist_hands_spelling` |
| George Washington Carver (`carver`) | c. 1864–1943 | `hist_peanut_plant`, `hist_soil_field` |

Levels and units (2 figures per unit):

| Level | Kids (`sej-k…`) | Adults (`sej-a…`) |
|---|---|---|
| Pemula | 01 Pahlawan pendidikan: Ki Hajar, Kartini · 02 Penolong: Nightingale, Dewi Sartika · 03 Penjelajah: Zheng He, Ibn Battuta | 01 Pendidikan perempuan: Kartini, Dewi Sartika · 02 Integritas: Ki Hajar, Hatta · 03 Nusantara dan dunia: Zheng He, Ibn Battuta |
| Menengah | 01 Ilmuwan: Curie, Ibn al-Haytham · 02 Penemu: Wright, Braille | 01 Rumah ilmu: Al-Khwarizmi, Al-Fihri · 02 Kesehatan: Ibn Sina, Nightingale |
| Mahir | 01 Masa keemasan ilmu: Al-Khwarizmi, Ibn Sina · 02 Pembangun bangsa: Hatta, Habibie | 01 Tekun meneliti: Galileo, Curie · 02 Terbang: Habibie, Wright |
| Master | 01 Pantang menyerah: Keller, Carver · 02 Damai dan bumi: Maathai, Mandela | 01 Tanpa kekerasan: Gandhi, Mandela · 02 Tulisan untuk semua: Sejong, Braille |

(Cut Nyak Dhien appears in adults Master 02 as a third story if the unit allows; otherwise in a later level.)
Each unit: the two stories, then 5–7 picture-led questions per figure (order the events, match the figure's
emblem to the work, true/false with pictures, a values sort "what can we learn"), a REMED item per skill, and a
gem per level.

## 5. Narration and voices

`voices.json` already has `id` and `en` voices (Umar picks). Narration texts are the captions; slugs per §2.
The app shows captions always (narration is optional). Clips are generated with `voice_gen.py` like the
pronunciation clips and heard by a reviewer before release.

## 6. New art keys (exact names; drawn this round as DRAFTS)

### 6.1 Covers, languages, levels (11)

`cover_nilai cover_sejarah cover_lang_arab cover_lang_inggris cover_lang_korea cover_lang_jepang
cover_lang_mandarin level_pemula level_menengah level_mahir level_master` — language covers show the script
and one everyday object, never a national flag; level badges grow one plant: seedling → sapling → young tree →
fruiting tree (Aya's family).

### 6.2 History (prefix `hist_`, transparent layers unless `hist_bg_*`)

- Backgrounds 16:9 (15): `hist_bg_sea hist_bg_harbor hist_bg_classroom_old hist_bg_library_old hist_bg_lab
  hist_bg_ward hist_bg_village_java hist_bg_desert_road hist_bg_sky_field hist_bg_green_hills hist_bg_hills_aceh
  hist_bg_city_old hist_bg_night_sky hist_bg_map_world hist_bg_room_lamp`
- Silhouettes (12, no faces): `hist_sil_man hist_sil_woman hist_sil_woman_kebaya hist_sil_woman_headscarf
  hist_sil_boy hist_sil_girl hist_sil_teacher_class hist_sil_sailor hist_sil_scholar hist_sil_traveler
  hist_sil_scientist hist_sil_nurse`
- Shared props (8): `hist_oil_lamp hist_compass_old hist_astrolabe hist_book_stack hist_globe_old hist_quill
  hist_small_boat hist_sunrise`
- Per figure (§4 table, 2 each minus shared): `hist_ki_hajar_school hist_slate_board hist_kartini_letters
  hist_dewi_sartika_school hist_sewing_kit hist_rumoh_aceh hist_hatta_books hist_coop_shop hist_habibie_plane
  hist_blueprint hist_treasure_ship hist_sejong_scroll hist_rain_gauge hist_spinning_wheel hist_sandals_path
  hist_khwarizmi_board hist_ibn_sina_book hist_herbs_mortar hist_camera_obscura hist_lens hist_caravan
  hist_route_map hist_qarawiyyin hist_handshake hist_tree_seedlings hist_curie_flask hist_notebook
  hist_nightingale_lamp hist_hospital_bed hist_braille_dots hist_braille_book hist_telescope hist_jupiter_moons
  hist_wright_flyer hist_bicycle_shop hist_water_pump hist_hands_spelling hist_peanut_plant hist_soil_field`

### 6.3 Values scenes (prefix `val_`, one moment each, kids and adults of many backgrounds)

`val_queue val_cut_queue val_give_seat val_help_cross val_say_thanks val_say_sorry val_share_food
val_return_wallet val_return_change val_tell_truth val_copy_answer val_clean_up val_throw_trash val_litter
val_listen val_interrupt val_wait_turn val_help_friend val_include_friend val_left_out val_keep_promise
val_on_time val_late val_borrow_return val_gotong_royong val_respect_elder val_visit_sick val_greet_neighbor
val_friends_diverse val_save_water val_kind_animal val_phone_kind val_phone_unkind val_calm_breath
val_angry_face val_teamwork` (36)

### 6.4 Vocabulary for the new levels

- Clothes (8): `pic_pants pic_dress pic_skirt pic_jacket pic_socks pic_uniform pic_sarong pic_glasses`
- Jobs (10): `pic_farmer pic_chef pic_driver pic_nurse pic_pilot pic_firefighter pic_police pic_fisher
  pic_seller pic_mechanic`
- Weather, seasons, nature (12): `pic_snow pic_wind pic_storm pic_spring_blossom pic_autumn_leaves pic_snowman
  pic_river pic_forest pic_volcano pic_beach pic_lake pic_moon`
- Daily routine (10): `pic_wake_up pic_shower pic_brush_teeth pic_get_dressed pic_breakfast pic_go_school
  pic_study pic_tidy_room pic_watch_tv pic_go_home`
- Hobbies (8): `pic_draw_paint pic_guitar pic_football pic_badminton pic_dance pic_camera pic_gardening
  pic_fishing`
- Town & travel (14): `pic_bank pic_post_office pic_restaurant pic_library pic_hotel pic_airport pic_suitcase
  pic_ticket pic_map_paper pic_traffic_light pic_bridge glyph_arrow_left glyph_arrow_right glyph_arrow_straight`
  (no places of worship this round)
- Technology (6): `pic_computer pic_tv pic_radio pic_tablet pic_headphones pic_robot_toy`
- Health (8): `pic_fever pic_cough pic_medicine pic_heart_organ pic_lungs pic_teeth pic_exercise
  pic_healthy_plate`
- Animals (6): `pic_tiger pic_frog pic_butterfly pic_snake pic_turtle pic_orangutan`
- Science (14): `sci_plant_parts sci_seed_sprout sci_butterfly_egg sci_caterpillar sci_pupa sci_ice_cube
  sci_water_drop sci_steam_kettle sci_solar_system sci_magnet sci_battery_bulb sci_water_cycle sci_food_chain
  sci_microscope`
- Maths (8): `math_bar_chart math_pie_half math_number_line math_ruler math_angle_right math_angle_acute
  math_money_notes math_thermometer`
- Culture & society (9): `soc_rumah_gadang soc_joglo soc_tongkonan soc_gamelan soc_sasando soc_wayang
  soc_batik soc_world_continents soc_saman_dance`

## 7. Content plan (who writes what)

| Agent | Packs |
|---|---|
| Matematika | `mat-k-m mat-a-m mat-k-h mat-a-h mat-k-x mat-a-x` |
| Sains | `sns-k-m … sns-a-x` (6) |
| Sosial & Seni | `sos-k-m … sos-a-x` (6) |
| Inggris | `ing-k-m … ing-a-x` (6) + voice `en.levels.json` |
| Korea | `kor-k-m … kor-a-x` (6) + voice `ko.levels.json` |
| Jepang | `jpn-k-m … jpn-a-x` (6) + voice `ja.levels.json` |
| Mandarin | `zho-k-m … zho-a-x` (6) + voice `zh.levels.json` |
| Nilai | `nil-k nil-a nil-k-m … nil-a-x` (8) |
| Sejarah kids | `sej-k sej-k-m sej-k-h sej-k-x` + voice `id.sejarah-k.json`, `en.sejarah-k.json` |
| Sejarah adults | `sej-a sej-a-m sej-a-h sej-a-x` + voice `id.sejarah-a.json`, `en.sejarah-a.json` |
| Picture pass 2 | existing packs: adults Pemula (mat-a, sns-a, sos-a), the 8 language Pemula packs, the kids items left without art in follow-up 11 |

## 8. Picture completeness (the image rule)

- A card or option that names a concrete thing, person, place, action or scene shows its picture; its words
  become the TalkBack label (picture cards never show their label, `INTERACTIONS_AUDIO.md`).
- Text-only options remain only for numbers, abstract words, target-language reading tests, sentences and
  grammar — never for something a child could recognise in a drawing.
- Every module, language, level, unit and empty state has its own drawing; no screen uses a letter, emoji or
  text symbol where an icon or picture belongs.
