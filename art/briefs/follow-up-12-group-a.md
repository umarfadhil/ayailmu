# Illustration brief: covers, levels, values scenes, science, maths and culture (78 keys, follow-up 12, group A)

| Field | Value |
|---|---|
| Brief id | `follow-up-12-group-a` |
| Client | Petalytix, for the AyaIlmu Android app |
| Status | DRAFT, not sent. Send after the style bible (`00_style_bible_brief.md`) is accepted; it runs alongside `vocabulary-set.md` and `follow-up-12-vocabulary.md` |
| Deadline | [UMAR] (suggest: a first rough of 6 keys — `cover_lang_arab`, `level_master`, `val_queue`, `val_left_out`, `sci_plant_parts`, `soc_rumah_gadang` — then batches: covers and levels → values scenes (two batches of 18) → science and maths → culture) |
| Contact | [UMAR] |
| Fee and rights | OPEN (quote per batch; the 36 values scenes are multi-figure spots, quote them separately). Full commercial rights in artwork and sources transfer to Petalytix (confirm in the contract) |

## 0. Read this first

- **What the set is for.** Follow-up 12 adds two modules (Nilai, free; Sejarah, paid), a language picker for Bahasa
  and four levels in every module (MODULES_LEVELS_STORIES §1, §3, §6). This brief covers:
  - **Covers (7)** for the module and language screens: `cover_nilai`, `cover_sejarah`, `cover_lang_arab`,
    `cover_lang_inggris`, `cover_lang_korea`, `cover_lang_jepang`, `cover_lang_mandarin`;
  - **Level badges (4)** on the level ladder: `level_pemula`, `level_menengah`, `level_mahir`, `level_master`;
  - **Values scenes (36)** for the Nilai module (`val_*`): answer cards in "which is the kind action?" and sort cards
    "baik / kurang baik";
  - **Science, maths and culture (31)** for the new Sains, Matematika and Sosial levels (`sci_*`, `math_*`, `soc_*`).
- **The code drafts are composition references only.** Every key already exists in the app as a placeholder drawn by
  code (`art/tools/art_covers.py`, `art_values.py`, `art_school.py`, drawing modules of `art/tools/draw.py`; previews
  `art/preview/<key>.svg`; contact sheets `art/preview/sheet_13a_fu12_covers_levels.png`,
  `sheet_13b_fu12_science_maths.png`, `sheet_13c_fu12_culture.png`, `sheet_13d_fu12_values.png`, each also as
  `*_night`). They fix *what* is in each picture and roughly where, nothing more. Do not trace or copy their linework;
  redraw in the style bible's hand. Each key stays DRAFT until you redraw it or we approve it against ART_DIRECTION §7.
- **Keys are a contract.** Content packs already use these exact keys (and two pictures have tap regions, §3.5). Do
  not rename, merge or drop pictures; keep objects inside their regions.
- **One family.** People are the `fam_*` / `pic_*` people (same face, proportions, skin recipe, hand); covers sit next
  to `cover_bahasa`, `cover_matematika`, `cover_sains`, `cover_sosial_seni`; badges belong with Aya (the seedling
  mascot) and `plot_seed`.

## 1. Subject and single idea

One idea per picture. Covers: the subject in one or two objects. Badges: one plant at one stage of growth. Values
scenes: **one moment** of one action between two or three people. Science, maths, culture: the thing itself, drawn,
not charted.

## 2. Mood (three words)

Warm, kind, everyday. (Values scenes: gentle, never preachy.)

## 3. Must show

### 3.1 Covers (4:3, 400 × 300; same size, framing and soft ground tint as the four existing covers)

| Key | Must show |
|---|---|
| `cover_nilai` | Berbagi: an adult hand offers a mango on its open palm; a child's smaller hand reaches up to receive it. Hands only, no faces. Two skin tones. |
| `cover_sejarah` | An hourglass beside an unrolled scroll (squiggle lines for writing, a round seal). Time and kept stories; no faces, no flags, no weapons. |
| `cover_lang_arab` | The letters **ا ب ت** (alif, ba, ta: «alif ba ta»), hand-lettered as brush strokes, written right to left with their dots (ba: one dot below; ta: two dots above); a glass of tea on a saucer. |
| `cover_lang_inggris` | Hand-lettered **A a** (capital and single-storey small a, as children write it); one apple. |
| `cover_lang_korea` | The hangul syllable **한** as brush strokes (ㅎ top left, ㅏ right, ㄴ along the bottom); a bowl of rice with the Korean spoon and flat chopsticks (sujeo). |
| `cover_lang_jepang` | The hiragana **あ** in its three strokes; a folded paper crane. |
| `cover_lang_mandarin` | The hanzi **学** (xué, to learn) as brush strokes; a red paper lantern (lampion, familiar from Imlek). |

The script is the subject of each language cover and is drawn as hand-lettered strokes (shapes, not type). **Have a
native reader check every script cover** before acceptance (stroke shapes and proportions, the dots of ب and ت). Never
a national flag, map outline or landmark.

### 3.2 Level badges (1:1, 240 × 240, must read at 40 dp)

One plant growing, in Aya's leaf family (the two-leaf sprout, same leaf shape), on the same small soil mound and soft
round tint in all four, so the four read as one ladder: `level_pemula` seedling (short stem, two leaves) →
`level_menengah` sapling (taller stem, three pairs of leaves) → `level_mahir` young tree (slim trunk, two branches,
round crown of leaves) → `level_master` fruiting tree (sturdy trunk, wide crown, mangoes). Heavy outer contour; the
stage must be clear from the silhouette alone at 40 dp (no numbers, stars or medals).

### 3.3 Values scenes (4:3, 400 × 300; shown as cards about 120 dp tall, sort cards 64 dp tall)

Two or three people at most, large in the frame, one clear action readable from posture and objects. Settings are
light and everyday Indonesian: sekolah, pasar, warung, angkot/bus, rumah, kampung, halaman. People of many ages and
skin tones (light, mid, deep sawo matang); some women and girls in a kerudung and some not; elders with grey hair, peci,
sarung, a walking stick; a child in a wheelchair among friends. School scenes use the SD uniform (white shirt, red
shorts or skirt).

| Key | Must show |
|---|---|
| `val_queue` | Three people wait in a line at a service window (loket), a dashed line on the floor; the girl at the front holds her coins. |
| `val_cut_queue` | A woman and a child wait at the loket; a boy hurries in from the side and steps in front of them; the woman lifts a hand, surprised. |
| `val_give_seat` | In a bus or angkot a boy stands up and shows his empty seat with an open hand to a grandmother with a walking stick. |
| `val_help_cross` | On a zebra crossing a girl walks an elderly man (peci, stick) across, his arm in hers. |
| `val_say_thanks` | An aunt hands a boy a wrapped gift; he takes it with both hands, head a little bowed, eyes closed in a smile. |
| `val_say_sorry` | A tipped cup and a small puddle; the boy who knocked it scratches the back of his head and holds out his hand; his friend smiles and reaches to shake it. |
| `val_share_food` | A girl offers her friend a piece of kue from her open lunchbox (bekal); he reaches for it. |
| `val_return_wallet` | A boy holds out a found wallet to the man who dropped it (market bag); the man turns back, glad. |
| `val_return_change` | At a warung counter (toples jars) a woman hands back an extra note; the seller is pleasantly surprised. |
| `val_tell_truth` | A broken flower pot on the floor; the child points at it and tells his mother; she bends a little to listen, calm. |
| `val_copy_answer` | Two pupils at one desk during a test; the boy leans over, eyes on his neighbour's paper (a dashed line of sight); she keeps writing. |
| `val_clean_up` | After class a girl sweeps a small pile of dust; a boy puts books back on the shelf. |
| `val_throw_trash` | A girl drops a wrapper into a bin; a second bin beside it. |
| `val_litter` | A boy walks on eating a snack; the wrapper falls behind him; a bin stands close by, unused. |
| `val_listen` | A girl talks (a bubble of squiggles); her friend faces her, still and attentive. |
| `val_interrupt` | Two friends talk; a third pushes in between, hand up and mouth wide, his big spiky bubble covering theirs; the two stop, surprised. |
| `val_wait_turn` | One child on a swing; another waits beside it, hands behind his back, smiling. |
| `val_help_friend` | A girl carries a tall stack of books; her friend lifts the top half off. |
| `val_include_friend` | Two children play ball; one waves a new child over with an open hand; she smiles and comes closer. |
| `val_left_out` | Two children play ball together; a third sits alone on a bench at the side, watching, quiet. |
| `val_keep_promise` | Close up: two friends hook little fingers (a pinky promise), both smiling. |
| `val_on_time` | A pupil walks through the open school gate; the gate clock shows a quarter to seven; the teacher waves good morning. |
| `val_late` | The gate clock is past seven and the gate is closing; a pupil runs for it, bag bouncing. |
| `val_borrow_return` | A girl gives back a rolled umbrella with both hands; her friend takes it, smiling. |
| `val_gotong_royong` | Kerja bakti: two neighbours carry a long bamboo pole on their shoulders; a boy helps with a bucket; a kampung roof behind. |
| `val_respect_elder` | Salim: a girl bows and brings her grandfather's hand to her forehead; he smiles. |
| `val_visit_sick` | A friend rests in bed under a blanket; a girl visits with a small basket of fruit. |
| `val_greet_neighbor` | Behind her garden fence a neighbour waters plants and waves; a boy on the lane waves back. |
| `val_friends_diverse` | Three friends side by side, smiling: a girl in a kerudung, a boy in a wheelchair with glasses, a girl with long hair. |
| `val_save_water` | A girl turns the tap off after brushing her teeth (cup and toothbrush in her other hand); the last drop falls. |
| `val_kind_animal` | A boy squats and sets down a bowl of water for a cat. |
| `val_phone_kind` | A boy sends a kind message: a bubble with a small flower floats from his phone to his friend, who smiles at hers. |
| `val_phone_unkind` | The same two: a frowning boy sends a spiky scribble; his friend reads it and looks down, hurt. |
| `val_calm_breath` | A girl sits cross-legged on a mat, eyes closed, a hand on her belly, breathing out slowly (soft curls). |
| `val_angry_face` | A boy, close up, arms crossed, brows pulled down, flushed cheeks, a small scribble cloud over his head. |
| `val_teamwork` | Two children plant a young tree: one holds it straight, the other shovels soil; a watering can waits. |

**Tone rules for the values scenes (Nilai §3).** Show good behaviour rather than shame bad behaviour. The "not good"
scenes (`val_cut_queue`, `val_litter`, `val_interrupt`, `val_left_out`, `val_copy_answer`, `val_phone_unkind`,
`val_angry_face`, `val_late`) stay **gentle**: the action is clear from posture and objects, never from a villain's face;
no crying child, nobody mocking, pointing at or laughing at anyone, no shouting faces in close-up, no violence, nothing
broken in anger; the person doing the "not good" thing looks like an ordinary child having a lapse, so a learner can
recognise themselves without shame. **Never put a red cross, a red mark, a "wrong" glyph or any judging sign on a
person**; the app's feedback does the judging. Pairs must work side by side as answer options: `val_queue` /
`val_cut_queue`, `val_throw_trash` / `val_litter`, `val_listen` / `val_interrupt`, `val_include_friend` /
`val_left_out`, `val_on_time` / `val_late`, `val_phone_kind` / `val_phone_unkind`, `val_calm_breath` /
`val_angry_face` should share setting and people so only the action differs. Universal, not tied to one religion: no
religious setting or symbol beyond ordinary clothing (kerudung, peci).

### 3.4 Science, maths and culture

Square (240 × 240) unless noted. Diagrams are drawings, not textbook charts: **no text, letters or digits** (a number
line has ticks, a thermometer has marks, a clock has ticks, money is generic).

| Key | Must show |
|---|---|
| `sci_plant_parts` (4:3, regions) | A whole flowering plant with roots shown in a cut-away of the soil: flower, two big leaves, stem, roots. Parts must stay in their tap regions (§3.5). |
| `sci_seed_sprout` | Germination in a soil cut-away: split bean seed, first root down, curved shoot up with two small leaves. |
| `sci_butterfly_egg` | A leaf close up with a small cluster of round, ribbed butterfly eggs. |
| `sci_caterpillar` | A caterpillar on a leaf with eaten holes; friendly head. |
| `sci_pupa` | A chrysalis hanging from a twig (pale green, ring of gold dots). |
| `sci_ice_cube` | Three ice cubes on a small plate, a little melt-water. |
| `sci_water_drop` | One big falling drop, two small ones, ripple rings below. |
| `sci_steam_kettle` | A kettle on a small gas stove, small flames under it, steam curling from the spout. |
| `sci_solar_system` (4:3) | The Sun at the left edge, eight planets on orbit lines in order and roughly in size (banded Jupiter, ringed Saturn). Not to scale. |
| `sci_magnet` | A red horseshoe magnet with pale tips holding a chain of paper clips and pulling a nail; short pull arcs. |
| `sci_battery_bulb` | A battery, two wires and a lit bulb (short rays). No + or − signs. |
| `sci_water_cycle` (4:3) | Sun, sea, rising vapour arrows, a cloud drifting to a mountain, rain, a river back to the sea; drawn arrows only. |
| `sci_food_chain` (4:3) | Padi → tikus → ular → elang bondol (white head, chestnut wings), arrows the way the food goes. Gentle: no catching or eating shown. |
| `sci_microscope` | A school microscope, side view, a slide with a small green sample. |
| `math_bar_chart` | Four bars of different heights in four colours on a hand-drawn sheet, tick marks on the side, no numbers or labels. |
| `math_pie_half` | A circle, one half coloured, the other plain. |
| `math_number_line` | Arrows at both ends, evenly spaced ticks (the middle one taller), a small frog that has hopped along (dashed arcs). |
| `math_ruler` | A wooden ruler with tick marks (longer every fifth), a pencil drawing along it. |
| `math_angle_right` | Two rays from one corner, the small square marker. |
| `math_angle_acute` | Two rays about 40° apart, a small arc marker. |
| `math_money_notes` | Two generic notes, fanned, and two coins. **No real banknote or coin design, no denominations, no emblems, no portraits.** |
| `math_thermometer` | A glass thermometer, round bulb, red column about two thirds up, marks without numbers. |
| `soc_rumah_gadang` | Minangkabau house on posts under a dark roof sweeping up into gonjong horns, a smaller gonjong over the front stairs, carved walls. |
| `soc_joglo` | Javanese joglo: low stone base, open pendopo pillars, wide lower roof and the tall central brunjung roof. |
| `soc_tongkonan` | Toraja house on posts, side view, the long saddle roof sweeping up at both ends; a front post with stacked horns. |
| `soc_gamelan` | A saron (bronze keys on a carved box) with its mallet, a hanging gong on a frame behind. |
| `soc_sasando` | Rote's sasando: a strung bamboo tube inside a fan of folded lontar leaf. |
| `soc_wayang` | A wayang kulit puppet in profile on its rods, stuck in a banana trunk. **A generic figure, not one named character.** |
| `soc_batik` | A cloth with a kawung pattern and a canting drawing a wax line. |
| `soc_world_continents` (2:1, regions) | The seven continents, stylised, each a different colour from its neighbours; Indonesia's islands visible in Asia; Antarctica along the bottom. |
| `soc_saman_dance` (4:3) | Tari Saman (Aceh): three dancers kneeling close in a row, dark costume with bright woven bands, head cloths, clapping; the middle one's hands up on the off-beat. |

### 3.5 Tap regions (copy exactly from `docs/ART_CATALOG.md`; objects stay inside their boxes)

`sci_plant_parts` (400 × 300): flower (0.36, 0.04, 0.28, 0.30), leaf (0.22, 0.34, 0.56, 0.22), stem (0.46, 0.36, 0.08,
0.32, on top of leaf where they overlap), root (0.30, 0.70, 0.40, 0.27).

`soc_world_continents` (400 × 200): north_america (0.03, 0.00, 0.42, 0.44), south_america (0.25, 0.44, 0.15, 0.40),
europe (0.47, 0.06, 0.16, 0.22), africa (0.45, 0.28, 0.18, 0.44), asia (0.63, 0.02, 0.37, 0.52), australia (0.81, 0.54,
0.19, 0.30), antarctica (0.00, 0.86, 1.00, 0.14). The boxes touch but do not overlap; as rectangles they put the
western edge of Arabia in Africa's box, New Guinea in Asia's and Iceland in North America's. The map may be stylised a
little to help (a clearer Red Sea gap), but every continent's body must stay inside its own box.

## 4. Must avoid

Corporate-Memphis figures (noodle limbs, giant hands, flat purple people) · 3-D clay or render look · glossy gradients,
neon, purple-teal "AI" palette · perfectly symmetric faces or objects · uniform stroke weight · sticker-style white
outlines · particle bursts or confetti · emoji or emoji-like icons (no hearts, thumbs-up, stars or smiley stickers in
phone bubbles) · stock-photo compositions · glow, bokeh, lens flare, drop shadows · more than about 6 colours · any text,
letters or digits inside the picture, **except the hand-lettered script that is the subject of a language cover** ·
anything made with an image generator, or traced from one.

Subject-specific: no national flags, emblems, maps-as-flags or landmarks on the language covers · no real banknote or
coin design · no brand logos (phones, packaging, bins) · no religious symbols or settings beyond ordinary clothing
(kerudung, peci) · no weapons; the food chain shows no hunting or eating · no face likeness of any real person · in the
values scenes nothing humiliating, frightening or violent (see the tone rules) · the wayang is a generic puppet.

## 5. Size, aspect and exports

| Item | Value |
|---|---|
| Aspect / viewport | covers, values scenes, `sci_plant_parts`, `sci_solar_system`, `sci_water_cycle`, `sci_food_chain`, `soc_saman_dance`: 4:3 (400 × 300); `soc_world_continents`: 2:1 (400 × 200); everything else 1:1 (240 × 240) |
| Export | badges and the two region pictures: layered SVG (we convert to VectorDrawable; regions must keep their geometry); all other keys: WebP at xxhdpi (3× the viewport in px), ≤ 150 KB, or layered SVG if you work in vector |
| Source | layered Procreate / PSD / Krita, one layer per colour role (`paper`, `ink`, `clay`, `ochre`, `sage`, `slate`, `blush`) |
| Night | colour layers kept separate so we can build the night variant (ink becomes the light line) |

## 6. Palette pick (≤ 6 colours, one accent)

- Covers: paper, ink, plus three of clay / ochre / sage / slate; the script's offset colour plate is the accent.
- Badges: paper, ink, sage (leaves), clay (soil), ochre (tint, trunk, mangoes). Accent: the mangoes on `level_master`.
- Values scenes: paper, ink, skin recipe (ochre / clay / slate, three tones), clothing in sage, clay, slate or ochre,
  blush for cheeks; one soft tinted vignette behind the people. Accent: the object the action is about (the coin, the
  wallet, the wrapper, the gift, the bubble).
- Science and maths: paper, ink, ochre, clay, sage, slate. Accent: the one thing to look at (the flame, the column,
  the coloured half).
- Culture: paper, ink, clay, ochre, slate (roofs, costume), sage (banana trunk, lontar). Accent: one per picture.

## 7. Indonesian context notes

Everyday Indonesia drawn with affection: loket and warung counters with toples jars, an angkot/bus with grab poles, the
SD uniform, a bamboo pole for kerja bakti, sapu ijuk, a kampung fence and potted plants, salim to an elder, an elang
bondol in the food chain, padi in the field. Culture pictures are respectful, accurate in their key features (gonjong,
brunjung, the Toraja saddle roof, kawung, the lontar resonator of the sasando, Saman's kneeling row) and never
caricatured; have a reviewer from each region look at them if possible.

## 8. Kids-safe reminder

No violence, scary imagery, weapons, open flame beyond a small stove flame, brand logos or real banknote and coin
designs. Calm humour is welcome; nobody is laughed at.

## 9. References

- Composition reference: `art/preview/<key>.svg` and the contact sheets in §0 (code drafts: layout and content only,
  never to be traced).
- Meaning of every key: `docs/ART_CATALOG.md` (follow-up 12 sections) and `docs/content/MODULES_LEVELS_STORIES.md`
  §3 (Nilai design guide) and §6.
- Style: the style bible and `ai-memory/ART_DIRECTION.md`.

## 10. Acceptance (ART_DIRECTION §7, run on delivery)

1. Squint test at 48 dp and thumbnail (badges at 40 dp, values scenes at 64 dp sort-card height). 2. Paper present,
not #FFFFFF, no gradient. 3. Two or more stroke weights, open corners. 4. ≤ 6 palette colours, one accent. 5. No
forbidden effects. 6. Not mirrored or dead-centred without reason. 7. Culture check (scripts by native readers; culture
pictures by someone from the region). 8. Kids-safe, and the values tone rules (§3.3). 9. Motion (if any) ≤ 600 ms,
eased, reduce-motion still pose. 10. Sources in `art/`, exports within size limits, FILE_MAP updated.

## 11. Open points for Umar before sending

- **Script covers** [UMAR]: confirm the letters (ا ب ت, A a, 한, あ, 学) and their objects (tea glass, apple, rice
  with sujeo, paper crane, lantern), and name a native reader per script for the acceptance check.
- **Values scenes in vector** [UMAR]: the code drafts of the values scenes are heavy as VectorDrawables (about 25–50 KB
  each, 2–3 whole people per scene; the art README's guide is ~25 KB). Raster WebP from the illustrator would replace
  them; decide whether the drafts may ship as they are until then.
- **Weakest drafts** (rethink rather than redraw): `val_respect_elder` (the salim bow reads as a hug at card size),
  `val_keep_promise` (the hooked little fingers are small), `val_kind_animal` (the squat hides the legs),
  `cover_nilai` (sleeves too long, hands stiff), `soc_tongkonan` (the horn post), `sci_food_chain` (sparse, small
  animals), `soc_wayang` (needs a wayang maker's eye).
- **Night pass**: the SD uniform's white shirt and paper-white things (rice, eggs, pages, the eagle's head, Antarctica)
  turn dark in the code drafts' night colours, and dark hair turns light; the illustrator's night pass should fix them.
