# Illustration brief: picture vocabulary for the new levels (82 keys, follow-up 12)

| Field | Value |
|---|---|
| Brief id | `follow-up-12-vocabulary` |
| Client | Petalytix, for the AyaIlmu Android app |
| Status | DRAFT, not sent. Send after the style bible (`00_style_bible_brief.md`) is accepted; it extends `vocabulary-set.md` (the first 118 `pic_*` keys) and can run alongside it or right after it |
| Deadline | [UMAR] (suggest: a first rough of 9 keys, one per group, then batches: jobs → routine → nature → town & travel → clothes, hobbies, technology → health and animals) |
| Contact | [UMAR] |
| Fee and rights | OPEN (quote per batch). Full commercial rights in artwork and sources transfer to Petalytix (confirm in the contract) |

## 0. Read this first

- **What the set is for.** These 82 pictures carry the Menengah, Mahir and Master levels (MODULES_LEVELS_STORIES §6.4):
  English, Korean, Japanese and Mandarin word lessons for kids and adults, plus Sains, Sosial and Nilai items ("tap the
  picture you hear", "match the word to the picture", flash cards). The same picture must work for every language, so
  it shows the thing itself, with no letters, digits or words anywhere. A child of 7 who cannot read must be able to
  name each picture in Indonesian.
- **Same family as `vocabulary-set.md`.** These keys sit next to the first 118 `pic_*` pictures in the same lessons
  (often four tiles side by side), so they must look like one set: the same hand, palette, line weights, people and
  faces. Read that brief's sections 0 and 7 first; everything there applies here.
- **The code drafts are composition references only.** Every key already exists in the app as a placeholder drawn by
  code (`art/tools/art_vocab2.py`, a drawing module of `art/tools/draw.py`; previews `art/preview/<key>.svg`; contact
  sheets `art/preview/sheet_13v1_fu12_vocab_clothes_jobs.png`, `sheet_13v2_fu12_vocab_nature_routine.png`,
  `sheet_13v3_fu12_vocab_hobbies_town.png`, `sheet_13v4_fu12_vocab_tech_health_animals.png`, each also as `*_night`).
  They fix *what* is in each picture, nothing more. Do not trace or copy their linework; redraw in the style bible's
  hand. Each key stays DRAFT until you redraw it or we approve it against ART_DIRECTION §7.
- **Keys are a contract.** Content packs already use these exact keys. Do not rename, merge or drop pictures.
- **Read at 48 dp.** Most pictures appear as answer tiles about 48–96 dp wide. Squint test every picture at thumbnail
  size; silhouette first, detail second. Jobs, routine and hobby pictures carry their meaning in one prop (the hat, the
  tool, the lamp, the net): make that prop big enough to read.
- **Pairs that appear together must differ by shape, not colour alone** (section 3, "confusable pairs").

## 1. Subject and single idea

One object, one figure or one small scene per picture, loosely off-centre, generous paper around it. People do one
thing with one tool.

## 2. Mood (three words)

Warm, clear, everyday.

## 3. Must show (by group)

**Clothes** (8, flat lay or on a hanger, no wearer) — `pic_pants` (long trousers, waistband, fly, pockets),
`pic_dress` (one piece: sleeves, collar, waist, flared skirt), `pic_skirt` (the skirt alone: waistband and pleats; no
top), `pic_jacket` (long sleeves, front zip, hood or collar, cuffs), `pic_socks` (a pair), `pic_uniform` (the
Indonesian SD uniform: white short-sleeved shirt, red tie, red (merah hati) shorts, a plain badge on the pocket with no
text or emblem; on a hanger), `pic_sarong` (a checked sarung with its kepala band; must not read as a towel or a
skirt), `pic_glasses`.

**Jobs** (10, adults in work clothes with one tool each; five women, five men, three skin tones, a kerudung on two
women) — `pic_farmer` (caping and cangkul; young rice), `pic_chef` (toque, white double-breasted jacket, ladle; no
knife), `pic_driver` (cap, both hands on a big steering wheel), `pic_nurse` (nurse cap with a plain plus, scrub tunic,
clipboard), `pic_pilot` (peaked cap, white shirt, tie, epaulettes, flight bag; a small plane in the corner),
`pic_firefighter` (helmet, reflective bands, hose with water; never flame), `pic_police` (traffic officer: cap,
reflective vest, raised palm, whistle; never a weapon, no Polri emblem), `pic_fisher` (in a perahu casting a jala net),
`pic_seller` (behind a fruit counter, handing over an orange), `pic_mechanic` (coverall, wrench, tyre).

**Weather, seasons, nature** (12) — `pic_snow` (flakes, snowy pine, snowy ground), `pic_wind` (bending tree, leaves
blown away, gust marks; no cloud, no rain), `pic_storm` (dark heavy cloud, lightning, slanting rain), `pic_spring_blossom`
(a branch of small pink five-petal blossoms), `pic_autumn_leaves` (maple-type leaves in warm colours falling),
`pic_snowman`, `pic_river` (winding, narrow far away and wide near), `pic_forest` (many trees together), `pic_volcano`
(cone with a crater and a smoke plume; calm, not an eruption), `pic_beach` (sand, sea edge, coconut palm), `pic_lake`
(water closed in by shore all round), `pic_moon` (a crescent with small stars).

**Daily routine** (10, children) — `pic_wake_up` (sitting up in bed, stretching; morning sun), `pic_shower` (MODEST:
the body stays behind the curtain; only the head peeks out, shampoo bubbles, the shower spraying), `pic_brush_teeth`,
`pic_get_dressed` (pulling a shirt on), `pic_breakfast` (a morning table: nasi goreng with telur ceplok, tea, sunrise),
`pic_go_school` (SD uniform, backpack, walking towards the school flag), `pic_study` (desk lamp, books, thinking),
`pic_tidy_room` (putting toys in a toy box), `pic_watch_tv` (a child on a cushion turned to the TV), `pic_go_home`
(backpack, walking to a house, late sun).

**Hobbies** (8) — `pic_draw_paint` (painting, brush, palette), `pic_guitar`, `pic_football` (the game: ball flying
into a goal), `pic_badminton` (racket and shuttlecock), `pic_dance` (a girl in a traditional dance pose with a
selendang), `pic_camera` (no logo), `pic_gardening` (a child with a watering can and flowers), `pic_fishing` (a child
with a rod on a jetty, float on the water).

**Town & travel** (14) — buildings say what they are by shape and one object, never by words or real logos:
`pic_bank` (pillars and pediment, a plain coin), `pic_post_office` (envelope sign, pillar mailbox), `pic_restaurant`
(awning, a sign with plate, spoon and fork, a steaming bowl in the window), `pic_library` (shelves full of books, a
reading table), `pic_hotel` (tall building, three stars over the entrance, a bed sign, a suitcase at the door),
`pic_airport` (control tower, terminal, runway, plane taking off), `pic_suitcase`, `pic_ticket` (stub, tear line, a
small train shape; no digits, no barcode numbers), `pic_map_paper` (folded map, dotted route, pin), `pic_traffic_light`
(red, amber, green in the palette's clay, ochre, sage), `pic_bridge` (arch bridge over a river). Plus three direction
glyphs in the interaction-glyph family (`glyph_correct`, `glyph_listen` …: a broad offset colour stroke under a
confident ink line): `glyph_arrow_left` (turn left: up, then bending left), `glyph_arrow_right` (turn right),
`glyph_arrow_straight` (straight on).

**Technology** (6) — `pic_computer` (monitor, keyboard, mouse), `pic_tv` (a TV set; screens always show a simple
picture, never text), `pic_radio` (speaker grille, dial, antenna, handle), `pic_tablet` (landscape, stylus),
`pic_headphones`, `pic_robot_toy` (clearly a friendly toy).

**Health** (8) — gentle, never scary: `pic_fever` (thermometer, cool cloth on the forehead, tired eyes), `pic_cough`
(coughing into the sleeve or elbow: the good habit), `pic_medicine` (syrup bottle with a blank label and plain plus,
spoon, capsules; no needle), `pic_heart_organ` (the organ, simple and friendly: no blood, no gore, no face),
`pic_lungs` (two lungs, windpipe, airways), `pic_teeth` (a molar and a front tooth with roots), `pic_exercise` (a star
jump in sports clothes), `pic_healthy_plate` (Isi Piringku: half vegetables and fruit, half rice and protein; a glass
of water).

**Animals** (6, friendly, never menacing: no bared teeth, claws or fangs) — `pic_tiger` (Sumatran-type tiger, soft
closed smile), `pic_frog` (on a lily pad), `pic_butterfly` (from above), `pic_snake` (coiled, head up, round eyes, no
fangs), `pic_turtle` (kura-kura walking), `pic_orangutan` (hanging from a branch by one long arm; no tail).

**Confusable pairs (must read differently at 48 dp)**

| Pair | What separates them in the drafts |
|---|---|
| `pic_skirt` / `pic_dress` | skirt alone, short and wide, waistband and pleats vs. sleeves, collar and waist on the dress |
| `pic_uniform` / `pic_shirt` | hanger, tie, badge and red shorts vs. a plain T-shirt |
| `pic_nurse` / `pic_doctor` | nurse cap, sage scrubs, clipboard vs. long white coat, stethoscope, glasses |
| `pic_seller` / `pic_chef` / `pic_cook` | fruit counter and kerudung vs. toque and white jacket vs. man in an apron at a wok |
| `pic_pilot` / `pic_police` | white shirt, tie and the plane vs. khaki shirt, reflective vest and raised palm |
| `pic_fisher` / `pic_fishing` | adult in a boat with a net vs. child on a jetty with a rod |
| `pic_wind` / `pic_storm` / `pic_rain` | no cloud, bent tree and gusts vs. dark cloud with lightning vs. light cloud and drops |
| `pic_lake` / `pic_river` / `pic_sea` / `pic_beach` | closed shore vs. winding water vs. horizon vs. sand and palm |
| `pic_volcano` / `pic_mountain` | crater and smoke vs. peak and path |
| `pic_snow` / `pic_snowman` | falling flakes and a snowy tree vs. the figure |
| `pic_tablet` / `pic_phone` / `pic_computer` / `pic_tv` | landscape slab and stylus vs. upright phone with app squares vs. keyboard and mouse vs. box set with antennas |
| `pic_go_school` / `pic_go_home` | uniform, walking to the flag vs. walking to a house, late sun |
| `pic_study` / `pic_read` / `pic_write` | desk lamp and stacked books vs. reading only vs. writing close-up |
| `pic_wake_up` / `pic_sleep` | sitting up and stretching vs. lying down with z marks |
| `pic_brush_teeth` / `toothbrush` / `pic_teeth` / `pic_mouth` | a child brushing vs. the brush alone vs. teeth alone vs. lips |
| `pic_fever` / `pic_hot` / `pic_cough` / `pic_tired` | thermometer and cloth vs. sun, fan, sweat vs. arm at the mouth and puffs vs. yawn |
| `pic_exercise` / `pic_dance` / `pic_happy` | star jump in sports clothes vs. dress and sash vs. close-up face |
| `pic_football` / `pic_ball` / `pic_play` | the goal vs. the ball alone vs. a child kicking |
| `pic_hotel` / `pic_hospital` / `pic_bank` | stars, bed sign, suitcase vs. plus sign vs. pillars and coin |
| `pic_orangutan` / `pic_monkey` | hanging, long arms, no tail vs. sitting with tail and banana |
| `pic_ticket` / `note_generic` | notched stub, tear line, train shape vs. the banknote |

## 4. Must avoid

Corporate-Memphis figures (noodle limbs, giant hands, flat purple people) · 3-D clay or render look · glossy gradients,
neon, purple-teal "AI" palette · perfectly symmetric faces or objects · uniform stroke weight · sticker-style white
outlines · particle bursts or confetti · emoji or emoji-like icons · stock-photo compositions · glow, bokeh, lens flare,
drop shadows (also: no grey ellipse "shadow" under objects) · more than about 6 colours · any text, letters or digits
inside the picture (signs, labels, tickets, screens, maps and badges stay blank or use shapes) · anything made with an
image generator, or traced from one.

Subject-specific: no Red Cross / Red Crescent emblem (nurse cap and medicine: a plain plus in sage or neutral) · no
real logos or brand-recognisable designs (camera, phone, tablet, computer, TV, guitar, headphones, airline livery, Pos
Indonesia or bank marks, Polri or Damkar emblems) · no national emblems except the school flag question below · no
religious symbols beyond ordinary clothing (kerudung, peci); no places of worship in this round · no weapons on the
police officer, no knife for the chef, no open flame for the firefighter, no needle or syringe in health, no blood or
gore in the organs · no nudity: `pic_shower` keeps the body behind the curtain · animals never menacing.

## 5. Size, aspect and exports

| Item | Value |
|---|---|
| Aspect / viewport | 1:1, 240 × 240 for every key in this brief |
| Export | the three `glyph_arrow_*`: layered SVG (we convert to VectorDrawable); all other keys: WebP at xxhdpi (720 × 720 px), ≤ 150 KB, or layered SVG if you work in vector |
| Source | layered Procreate / PSD / Krita, one layer per colour role (`paper`, `ink`, `clay`, `ochre`, `sage`, `slate`, `blush`) |
| Night | colour layers kept separate so we can build the night variant (ink becomes the light line) |

## 6. Palette pick (≤ 6 colours, one accent)

- People (jobs, routine, some hobbies and health): paper, ink, the one skin recipe (ochre / clay / slate tints, light,
  mid and deep sawo matang), clothing in sage, clay, slate or ochre; blush for cheeks only. Accent: the job's prop (hat,
  helmet, vest, tool).
- Clothes: paper, ink and one or two garment colours; accent the trim (stitching, sash, stripe, tie).
- Nature: paper, ink, sage (land, trees), slate (water, sky, cloud), ochre (sun, moon, sand, autumn), clay (autumn,
  lava), blush (blossom).
- Town, travel, technology: paper, ink, ochre, clay, sage, slate. Accent: one (the sign, the coin, the mailbox, the lamp).
  Traffic light: clay, ochre and sage stand for red, amber and green; propose stronger values with the style bible if
  children misread them.
- Health: paper, ink, clay and blush for organs (no saturated red), sage for the plus, slate for veins and glass.
- Animals: paper, ink plus two of ochre / clay / slate / sage. Accent: one feature (stripes, eyes, wing spots).
- Glyphs: ink plus one broad colour (slate for the three road arrows).

## 7. Indonesian context notes

Figures are everyday Indonesians of different ages and skin tones in modest clothing; a kerudung on some women (the
seller, the mechanic) and not on others; hair dark. Jobs as seen in Indonesia: petani with caping and cangkul in the
sawah, nelayan in a perahu with a jala, polantas with a reflective vest and a whistle, a pedagang at a fruit counter.
School is the SD uniform (white shirt, merah hati shorts or skirt, red tie). Breakfast is nasi goreng with telur ceplok
and teh manis; the healthy plate follows Isi Piringku (Kemenkes) with tempe. The sarung is checked with its kepala band.
The dance is an Indonesian traditional pose with a selendang (no specific regional costume, so it does not misrepresent
one). Animals include Indonesian ones (Sumatran tiger, orangutan). Snow, snowman, spring blossom and autumn leaves are
for the Korean, Japanese and Mandarin tracks: draw them as a curious visitor would see them.

## 8. Kids-safe reminder

No violence, scary imagery, weapons, open flame, needles, blood, brand logos or real banknote and coin designs. Calm
humour is welcome. Water scenes show safe, happy people (the fisher stands steady in the boat; the fishing child sits
on a low jetty above calm water). Lightning in `pic_storm` stays small and graphic, not frightening.

## 9. References

- Composition reference: `art/preview/<key>.svg` and the four `sheet_13v*_fu12_vocab_*` contact sheets (code drafts:
  layout and content only, never to be traced).
- Meaning of every key: `docs/ART_CATALOG.md` (section "Picture vocabulary, new levels").
- The family to match: `vocabulary-set.md` and `art/preview/sheet_9_pic_people.png` … `sheet_12_pic_places_nature.png`.
- Style: the style bible and `ai-memory/ART_DIRECTION.md`.

## 10. Acceptance (ART_DIRECTION §7, run on delivery)

1. Squint test at 48 dp and thumbnail (and the confusable pairs above side by side). 2. Paper present, not #FFFFFF, no
gradient. 3. Two or more stroke weights, open corners. 4. ≤ 6 palette colours, one accent. 5. No forbidden effects.
6. Not mirrored or dead-centred without reason (the left and right arrows are the one mirrored pair). 7. Culture check.
8. Kids-safe. 9. Motion (if any) ≤ 600 ms, eased, reduce-motion still pose. 10. Sources in `art/`, exports within size
limits, FILE_MAP updated.

## 11. Open points for Umar before sending

- **School flag** [UMAR]: `pic_go_school` flies the same plain red-over-white flag as `pic_school`. Keep both, or use a
  neutral pennant in both?
- **Police officer** [UMAR]: the draft is a male traffic officer in a generic khaki shirt and reflective vest, with no
  Polri emblem. Keep, or prefer a Polwan (the jobs set is already five women and five men)?
- **Traffic light colours** [UMAR]: muted clay / ochre / sage may be too soft for "red / yellow / green" questions. If
  packs ask for the colours, allow the learning colours (`art_learn_red` …) for these three lamps only?
- **Night pass**: paper-white things (uniform and pilot shirts, chef's toque and jacket, nurse cap, snow, snowman,
  teeth, rice, the thermometer) and dark hair invert in the code drafts' night theme; the illustrator's night pass
  should keep them light.
- **Weakest drafts** to rethink rather than redraw: `pic_get_dressed` (at a glance it can read as cheering; the down
  arrows carry it), `pic_sarong` (reads as checked cloth; find a stronger sarung signal, e.g. worn with a peci or folded
  the way it is sold), `pic_wind` (gust marks are abstract), `pic_breakfast` (the "morning" rests on a small sun),
  `pic_shower` (the peek pose works but the hand and neck are awkward), `pic_volcano` (the lava trickles can read as
  drips), `pic_fisher` (the net needs to read as a net, not a fan of lines).
