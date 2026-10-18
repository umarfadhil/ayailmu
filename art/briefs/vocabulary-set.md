# Illustration brief: picture vocabulary set (118 keys)

| Field | Value |
|---|---|
| Brief id | `vocabulary-set` |
| Client | Petalytix, for the AyaIlmu Android app |
| Status | DRAFT, not sent. Send after the style bible (`00_style_bible_brief.md`) is accepted; can run alongside `01_core_set_brief.md` |
| Deadline | [UMAR] (suggest: first rough of 12 keys, one per group, then batches: people & actions → food → animals & things → places & nature → colours & glyphs) |
| Contact | [UMAR] |
| Fee and rights | OPEN (quote per batch). Full commercial rights in artwork and sources transfer to Petalytix (confirm in the contract) |

## 0. Read this first

- **What the set is for.** These pictures carry the language lessons for English, Korean, Japanese and Mandarin (kids
  and adults), and later other subjects: "tap the picture you hear", "match the word to the picture", picture flash
  cards. The same picture must work for every language, so it shows the thing itself, with no letters, digits or
  words anywhere. A child of 7 who cannot read must be able to name every picture in Indonesian.
- **The code drafts are composition references only.** Every key already exists in the app as a placeholder drawn by
  code (`art/tools/draw.py`; previews `art/preview/<key>.svg`, contact sheets `art/preview/sheet_9_pic_people.png`,
  `sheet_10_pic_colours_food.png`, `sheet_11_pic_animals_things.png`, `sheet_12_pic_places_nature.png`, the four glyphs in
  `sheet_1_characters.png`, all also as `*_night`). They fix *what* is in each picture, nothing more. Do not trace or
  copy their linework; redraw in the style bible's hand. Each key stays DRAFT until you redraw it or we approve it
  against ART_DIRECTION §7.
- **Keys are a contract.** Content packs already use these exact keys. Do not rename, merge or drop pictures.
- **Read at 48 dp.** Most pictures appear as answer tiles about 48–96 dp wide, often four side by side. Squint test
  every picture at thumbnail size; silhouette first, detail second.
- **People are one family** with the core set's `fam_*` people: same face, proportions and hand. Pictures in the same
  group are often shown together (e.g. `pic_boy`, `pic_girl`, `pic_man`, `pic_woman` as four options), so they must
  differ clearly by silhouette, not by colour alone.

## 1. Subject and single idea

One object, one figure or one gesture per picture, loosely off-centre, generous paper around it.

## 2. Mood (three words)

Warm, clear, everyday.

## 3. Must show (by group)

**People & greetings** — `pic_boy` (about 8, T-shirt and shorts), `pic_girl` (dress, ponytail), `pic_man`, `pic_woman`
(no headscarf here; a kerudung appears on other women and girls in the set, not on all), `pic_friends` (two children
holding hands), `pic_teacher` (with a small chalkboard; chalk marks are shapes only), `pic_doctor` (white coat,
stethoscope; a plain green plus at most), `pic_wave_hello` (facing us, open hand raised, standing still),
`pic_wave_bye` (walking away, looking back while waving: must be distinguishable from hello at 48 dp),
`pic_thanks` (palms pressed together at the chest with a slight nod: polite in Indonesia, Japan and Korea; avoid any
reading as prayer: no closed-eye devotion pose, no prayer beads or religious setting), `pic_sorry` (hand at the back of
the head, shy smile), `pic_yes_nod` (a nodding head with small motion marks; the weakest draft: please find a clearer
"yes").

**Colours** — `pic_color_red`, `_blue`, `_yellow`, `_green`, `_black`, `_white`, `_orange`, `_purple`, `_brown`,
`_pink`: one paint daub or brush stroke on paper each, flat, no gloss, the same shape language for all ten. These are
the only pictures allowed a clearly named learning colour; the colour must be unambiguous to a child (orange not
reading as red or brown, pink not as purple). White needs a visible ink edge. Exact hex in
`android/core/design/src/main/res/values(-night)/art_learn_colors.xml` (draft values: propose final ones with the
style bible, light and night).

**Food & drink** — `pic_rice_bowl`, `pic_noodle_bowl`, `pic_bread`, `pic_egg_fried` (telur ceplok), `pic_apple`,
`pic_orange_fruit` (jeruk, with a cut half so it is not just "a ball"), `pic_watermelon`, `pic_fish_dish` (fried fish on
a plate), `pic_chicken_dish` (fried chicken), `pic_vegetables`, `pic_soup`, `pic_tea_cup`, `pic_coffee_cup` (tea and
coffee must not be confused: cup and saucer with amber tea vs. mug with dark coffee), `pic_milk_glass` (white milk must
read on paper), `pic_juice`, `pic_cake`, `pic_kimchi` (a small dish of kimchi, recognisably cabbage), `pic_onigiri`
(rice ball with nori), `pic_dumplings` (jiaozi on a plate), `pic_chopsticks`, `pic_spoon_fork` (the Indonesian table set).

**Animals** — `pic_cat`, `pic_dog`, `pic_bird`, `pic_fish` (alive, swimming: distinct from `pic_fish_dish`), `pic_cow`
(a Bali-type brown cow is welcome), `pic_chicken` (a hen; distinct from `pic_chicken_dish`), `pic_rabbit`, `pic_horse`,
`pic_goat`, `pic_duck`, `pic_elephant`, `pic_monkey`. Whole animal, side or three-quarter view, friendly faces, no
anthropomorphic clothes.

**Things at home & school** — `pic_house`, `pic_school`, `pic_book`, `pic_pen`, `pic_pencil` (pen and pencil must
differ at 48 dp), `pic_bag` (school backpack), `pic_table`, `pic_chair`, `pic_door`, `pic_window`, `pic_bed` (empty),
`pic_phone`, `pic_ball`, `pic_shoes`, `pic_shirt`, `pic_hat`.

**Places & transport** — `pic_market` (stall with an awning and produce), `pic_hospital` (building plus a neutral sign;
see must-avoid), `pic_park` (tree, bench, grass), `pic_station` (platform and a train front), `pic_car`, `pic_bus`,
`pic_train`, `pic_motorbike` (an everyday Indonesian scooter), `pic_bicycle`, `pic_plane`, `pic_ship`.

**Nature & weather** — `pic_sun`, `pic_rain`, `pic_cloud`, `pic_rainbow`, `pic_tree`, `pic_flower`, `pic_mountain`,
`pic_sea`, `pic_star`.

**Actions** — `pic_eat`, `pic_drink`, `pic_sleep`, `pic_read`, `pic_write`, `pic_walk`, `pic_run` (walk and run must
differ clearly), `pic_play`, `pic_sing`, `pic_cook` (no visible flame or knife), `pic_swim` (head well above water,
smiling; never a lone hand reaching out of water), `pic_sit`.

**Feelings & describing** — `pic_happy`, `pic_sad`, `pic_tired`, `pic_hot`, `pic_cold`, `pic_hungry` (big, readable
faces: these are close-ups), `pic_big` and `pic_small` (a pair: the same reference animal at the same size in both, only
the object's size changes).

**Body** — `pic_head`, `pic_mouth` (a smiling mouth, distinct from `sense_tongue`), `pic_foot`.

**Interaction glyphs** (24 dp-style icons, same family as `glyph_correct` / `glyph_not_yet`: a broad offset colour
stroke under a confident ink line) — `glyph_listen` (speaker or ear with sound arcs), `glyph_drag` (hand with a short
arrow), `glyph_trace` (pencil with a dotted stroke), `glyph_connect` (two dots joined by a wobbly line).

## 4. Must avoid

Corporate-Memphis figures (noodle limbs, giant hands, flat purple people) · 3-D clay or render look · glossy gradients,
neon, purple-teal "AI" palette · perfectly symmetric faces or objects · uniform stroke weight · sticker-style white
outlines · particle bursts or confetti · emoji or emoji-like icons · stock-photo compositions · glow, bokeh, lens flare,
drop shadows (also: no grey ellipse "shadow" under clouds or objects) · more than about 6 colours · any text, letters or
digits inside the picture (chalkboards, signs, labels, book covers and phone screens stay blank or use shapes) · anything
made with an image generator, or traced from one.

Subject-specific: no Red Cross / Red Crescent emblem (protected; use a plain plus in green or neutral, or no symbol) ·
no brand logos or recognisable product designs (phone, shoes, ball, cars, scooter, plane livery, ship) · no national
emblems except the school flag question below · no religious symbols beyond ordinary clothing (kerudung, peci) · no
weapons, knives or open flame · nothing that reads as danger (swimming, cooking, traffic).

## 5. Size, aspect and exports

| Item | Value |
|---|---|
| Aspect / viewport | 1:1, 240 × 240 for every key in this brief |
| Export | colours and glyphs: layered SVG (we convert to VectorDrawable); all other keys: WebP at xxhdpi (720 × 720 px), ≤ 150 KB, or layered SVG if you work in vector |
| Source | layered Procreate / PSD / Krita, one layer per colour role (`paper`, `ink`, `clay`, `ochre`, `sage`, `slate`, `blush`; `learn_*` for the colour daubs) |
| Night | colour layers kept separate so we can build the night variant (ink becomes the light line) |

## 6. Palette pick (≤ 6 colours, one accent)

- People, actions, feelings, body: paper, ink, ochre / clay / slate for skin (one recipe, three tones: light, mid,
  deep sawo matang), clothing in sage, clay, slate or ochre; blush for cheeks only. Accent: the clothing colour.
- Colours: paper, ink and the one learning colour. Nothing else.
- Food: paper, ink, clay, ochre, sage, slate (plates, bowls, glass). Accent: the food's own colour.
- Animals: paper, ink, plus two of ochre / clay / slate / sage. Accent: one feature (comb, bill, collar).
- Things, places, transport: paper, ink, ochre, clay, sage, slate. Accent: one (roof, awning, body colour).
- Nature: paper, ink, ochre (sun, star), sage (tree, mountain), slate (rain, sea), clay (flower). Rainbow: the four
  muted bands (clay, ochre, sage, slate) are acceptable; propose otherwise if the bible allows.
- Glyphs: ink plus one broad colour (ochre for listen and trace, sage for drag and connect, clay dots).

## 7. Indonesian context notes

Figures are everyday Indonesians of different ages and skin tones; modest everyday clothing; a kerudung on some
women and girls (teacher, a friend, a reader), not on every woman; hair dark. Food is what Indonesian families eat
(nasi, mie, telur ceplok, ikan goreng, ayam goreng, sayur sop, teh, kopi) plus the three foods the Korean, Japanese and
Mandarin tracks teach (kimchi, onigiri, jiaozi), drawn as a curious visitor would see them. The table set is spoon and
fork. Transport is what children see daily: motor matic, angkot-style bus, KRL-style train. Animals include ones seen in
a kampung (ayam, kambing, sapi, bebek).

## 8. Kids-safe reminder

No violence, scary imagery, weapons, open flame, brand logos or real banknote and coin designs. Calm humour is welcome.
Water scenes always show a happy, safe swimmer.

## 9. References

- Composition reference: `art/preview/<key>.svg` and the contact sheets named in section 0 (code drafts: layout and
  content only, never to be traced).
- Meaning of every key: `docs/ART_CATALOG.md` (section "Picture vocabulary").
- Style: the style bible and `ai-memory/ART_DIRECTION.md`.

## 10. Acceptance (ART_DIRECTION §7, run on delivery)

1. Squint test at 48 dp and thumbnail. 2. Paper present, not #FFFFFF, no gradient. 3. Two or more stroke weights, open
corners. 4. ≤ 6 palette colours, one accent. 5. No forbidden effects. 6. Not mirrored or dead-centred without reason.
7. Culture check. 8. Kids-safe. 9. Motion (if any) ≤ 600 ms, eased, reduce-motion still pose. 10. Sources in `art/`,
exports within size limits, FILE_MAP updated.

## 11. Open points for Umar before sending

- **School flag** [UMAR]: the draft `pic_school` flies a plain red-over-white flag (merah putih), the strongest "school"
  signal for Indonesian children. Keep it, or use a neutral pennant to stay clear of national symbols?
- **Learning colours** [UMAR]: confirm the ten draft hex values (light and night) or let the illustrator propose them
  with the style bible.
- **Night pass**: paper-white things (rice, milk, egg white, clouds, white coat, duck, goat, onigiri, teeth) and dark
  hair need the illustrator's night treatment; the code drafts invert them.
- **Weakest drafts** to rethink rather than redraw: `pic_yes_nod` (nod marks), `pic_wave_bye` (small figure), `pic_walk`
  (stride reads only at larger sizes), `pic_drink` (glass partly hides the face), `pic_cook` (busy arms).
