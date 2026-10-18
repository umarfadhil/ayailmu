# Illustration brief 01: AyaIlmu core picture set (187 keys)

| Field | Value |
|---|---|
| Brief id | `01_core_set_brief` |
| Client | Petalytix, for the AyaIlmu Android app |
| Status | DRAFT, not sent. Send after the style bible (`00_style_bible_brief.md`) is accepted |
| Deadline | OPEN: suggest batches (characters and covers → stickers → question pictures → scenes) |
| Fee and rights | OPEN (quote per batch). Full commercial rights in artwork and sources transfer to Petalytix (confirm in the contract) |

## 0. Read this first

- **The code drafts are composition references only.** Every key below already exists in the app as a placeholder drawn
  by code (`art/tools/draw.py`, previews in `art/preview/<key>.svg` and the contact sheets `art/preview/sheet_*.png`).
  They fix *what* is in each picture and *where*, nothing more. Do not trace or copy their linework; redraw everything
  in the style bible's hand. Every draft stays DRAFT until you redraw it or we approve it against ART_DIRECTION §7.
- **Keys are a contract.** Content packs already reference these exact keys and, for three scenes, exact tap regions.
  Do not rename, add or drop pictures; keep scene objects inside their published regions (section 9).
- **No text, letters or digits inside any picture.** Numbers and words live in the app's text.
- One idea per picture, generous empty space, ≤ 6 colours with one accent, paper behind everything (the app draws the
  paper; question pictures have no background rectangle of their own).

## 1. Sizes and exports

| Viewport (dp) | Keys | Export at xxhdpi |
|---|---|---|
| 240 × 240 (1:1) | everything not listed below | 720 × 720 px |
| 400 × 300 (4:3) | `cover_*`, `scene_kampung_shapes` | 1200 × 900 px |
| 300 × 400 (3:4) | `body_child` | 900 × 1200 px |
| 400 × 200 (2:1) | `map_indonesia` | 1200 × 600 px |

Flat, mostly-line pictures (glyphs, shapes, clocks, counting) are best delivered as layered SVG so we can keep them as
VectorDrawables; painterly spots (covers, stickers, people, scenes) as WebP ≤ 150 KB. Always also deliver the layered
source with one layer per colour role (`paper`, `ink`, `clay`, `ochre`, `sage`, `slate`, `blush`). We build the night
variant from those layers: at night ink becomes a warm light line on dark paper, so keep line and colour on separate
layers, and give people's hair and eyes a night pass (our code draft cannot keep hair dark at night).

## 2. Must avoid (whole set)

Corporate-Memphis figures · 3-D clay / render look · glossy gradients, neon, purple-teal · perfect symmetry · uniform
stroke weight · sticker white outlines · confetti or particle bursts · emoji-like icons · stock-photo compositions ·
glow, bokeh, lens flare, drop shadows · more than about 6 colours · text, letters or digits · image-generator output.
Also: no brand logos, no national emblems or real currency designs, no religious symbols beyond ordinary clothing.

## 3. Characters, chrome and states (1:1)

| Key | What to draw | Palette pick |
|---|---|---|
| `aya_idle` | Aya standing calmly, stub arms down, small smile, a short ground mark | sage, ink, blush; accent sage leaves |
| `aya_wave` | Aya waving one arm up, two small motion arcs by the hand | sage, ink, blush |
| `aya_happy` | Eyes as small arcs, open smile, both arms lifted a little, leaves lifted | sage, ink, blush; accent clay mouth |
| `aya_think` | One arm to the chin, eyes looking up, leaves tilted, a small drawn curl (not a "?") with two thought dots | sage, ink, blush |
| `aya_sleep` | Body tilted and curled, eyes closed arcs, leaves drooping, two small "z" zigzag marks | sage, ink, blush |
| `app_icon_draft` | Aya silhouette large on a paper rounded square, two colours, paper grain | paper, sage, ink |
| `glyph_correct` | A drawn tick in two weights: a broad sage under-stroke and a confident ink line | sage, ink |
| `glyph_not_yet` | A looping "let's look" arrow (one loop, then onward), encouraging, not a cross | ochre, ink |
| `glyph_saved` | A small closed notebook with spine band, elastic and ribbon | ochre, clay, paper, ink |
| `state_error` | A loose knot of thread with two free ends: calm, slightly funny | clay, ink |
| `state_seedling` | A seed just sprouting in a clay pot with a painted rim | clay, ochre, sage, slate soil, ink |
| `gem` | A cut gem (permata) with facets; hatching on the shaded facets, one paper highlight stroke | slate, paper, ink |
| `gem_box` | A small wooden box with a clasp, hatched side, wood grain | clay, ochre, ink |

## 4. Subject covers (4:3)

| Key | What to draw | Palette pick |
|---|---|---|
| `cover_bahasa` | An open book with a speech curl or bubble rising from it (wavy marks inside, no letters) | clay, paper, sage, ink; ochre ground |
| `cover_matematika` | Counting beads on rods in groups of five (rekenrek feel) and a ruler with ticks, no digits | ochre, clay, sage, ink |
| `cover_sains` | A sprout in a mound of soil, a magnifying glass leaning in to look | sage, clay, slate, ochre, ink |
| `cover_sosial_seni` | An angklung and a paintbrush with a broad clay brush stroke | ochre, clay, slate, ink; sage ground |

## 5. Stickers (1:1, one per unit, collectible: slightly different hands, one idea each)

Each sits on a soft tinted round patch (no white outline). Palette: ink plus at most three colours.

| Key | What to draw |
|---|---|
| `sticker_mango` | One ripe mango with a leaf and a clay blush |
| `sticker_kite` | A layangan (rhombus kite), two-colour panels, cross sticks, tail with small bows, string |
| `sticker_angklung` | An angklung: two bamboo tubes of different heights cut to a tongue, in a frame over a base tube |
| `sticker_bicycle` | A simple bicycle side view, clay frame, spoked wheels |
| `sticker_teapot` | A clay teapot with a painted band, small steam curls, a little cup |
| `sticker_cat` | A sitting kucing oren (ginger cat) with stripes and a curled tail |
| `sticker_star_fruit` | A belimbing and a star-shaped slice with seeds |
| `sticker_boat` | A small perahu with a sail on two or three wave lines |
| `sticker_lantern` | A hanging lentera with a small flame (no glow) |
| `sticker_leaf` | One big leaf with veins and a water drop |
| `sticker_shell` | A scallop shell with ribs |
| `sticker_rice_field` | Sawah terraces with rice tufts in a round window |
| `sticker_drum` | A kendang lying on a stand, laced cords |
| `sticker_umbrella` | An open payung with alternating panels, a few rain strokes |
| `sticker_book` | An open book with a ribbon bookmark |
| `sticker_compass` | A brass compass with a two-colour needle, no letters |

## 6. Counting and groups (1:1)

Facts must be exact: QA will count every picture.

| Keys | What to draw | Palette pick |
|---|---|---|
| `count_mango_1` … `count_mango_20` | n mangoes (ochre, sage leaf), rows of five, last row starts at the left (ten-frame logic), slight irregular placement and tilt, every mango clearly separate | ochre, sage, clay blush, ink |
| `count_egg_1` … `count_egg_20` | n eggs, same layout; paper-coloured with an ink outline and a light hatch | paper, ink |
| `count_marble_1` … `count_marble_20` | n marbles (kelereng), same layout, slate or clay with a small highlight stroke | slate, clay, paper, ink |
| `groups_<g>x<n>`, g and n in 2 to 5 (16 keys) | g wobbly circled groups, each holding exactly n marbles in a dice-like pattern; groups never touch | sage tint, slate or clay, ink |

For 1 to 5 objects use one larger row; 6 to 20 use rows of five. Object size stays the same within a picture.

## 7. Maths pictures (1:1)

| Keys | What to draw | Palette pick |
|---|---|---|
| `shape_circle`, `shape_square`, `shape_triangle`, `shape_rectangle`, `shape_oval`, `shape_rhombus` | One flat shape each, clearly that shape (a child must name it), slightly off-centre, a corner of hatching | one colour each + ink |
| `solid_cube`, `solid_cuboid`, `solid_cylinder`, `solid_cone`, `solid_sphere`, `solid_pyramid` | One solid each, the shaded side hatched (no gradients) | one colour each + ink |
| `clock_<h>_<mm>`, h 1 to 12, mm 00 or 30 (24 keys) | Round wall clock, 12 ticks (longer at 12, 3, 6, 9), no digits; short thick hour hand, long thin minute hand; at :30 the hour hand sits halfway to the next hour | paper face, clay rim, ink |
| `frac_1_2`, `frac_1_3`, `frac_2_3`, `frac_1_4`, `frac_3_4`, `frac_1_8` | A round cake from above on a plate, cut into equal slices, the fraction's slices clay with hatching, first cut at 12 o'clock | ochre cake, clay slices, slate plate, ink |
| `balance_left_heavy`, `balance_right_heavy`, `balance_even` | Two-pan balance; heavy side lower (a watermelon against a small ochre ball); even: two equal balls, level beam | ochre wood, slate pans, sage, clay, ink |
| `length_short`, `length_medium`, `length_long` | A pencil of three lengths starting at the same mark over the same ticked baseline (no digits) | ochre, clay, slate, paper, ink |

## 8. World pictures (1:1)

| Keys | What to draw | Palette pick |
|---|---|---|
| `pos_cat_above`, `pos_cat_below`, `pos_cat_left`, `pos_cat_right`, `pos_cat_inside` | A ginger cat and the same slate box: on top; lying under a bench that holds the box; left of it; right of it; peeking out of the open box | ochre cat, clay stripes, slate box, ink |
| `sense_eye`, `sense_ear`, `sense_nose`, `sense_tongue`, `sense_hand` | Eye with lashes and brow; ear with sound arcs; a child's profile smelling a melati flower; open mouth with tongue out; open palm with a sleeve cuff | skin recipe, slate, clay, sage, ink |
| `wash_hands`, `sleep_moon`, `drink_water`, `toothbrush` | Hands under a tap with bubbles and soap; a child asleep under a blanket with a crescent moon; a kendi beside a glass of water; a toothbrush with paste by a cup | slate, ochre, clay, sage, skin, ink |
| `fam_grandmother`, `fam_grandfather`, `fam_mother`, `fam_father`, `fam_sister`, `fam_brother`, `fam_baby` | One kind figure each, standing on the same ground line at a consistent scale so heights differ: grandmother (grey bun, glasses, kebaya and kain), grandfather (peci, baju koko, sarung, cane), mother (kerudung, long dress), father (batik shirt), sister (pigtails, dress), brother (t-shirt, shorts), baby (sitting) | skin recipe + two clothing colours each, ink |
| `fruit_mango`, `fruit_banana`, `fruit_rambutan`, `fruit_papaya` | One big mango; a pair of bananas on a stem; a whole and a half-peeled rambutan; a papaya cut lengthwise with seeds | ochre, clay, sage, paper, ink |
| `coin_generic`, `note_generic` | A coin and a small stack; a banknote over a second one. Invented motifs only (a leaf), no denominations, no emblems, no portraits | ochre or sage, clay, slate, ink |

## 9. Scenes with tap regions (copy exactly; objects stay inside their regions)

Regions are fractions of the picture (x, y, w, h; origin top-left). The same numbers are in `docs/ART_CATALOG.md` and
`android/content/src/main/assets/art/index.json`.

**`scene_kampung_shapes` (4:3):** a kampung house, the sun, a kite and a noticeboard on grass. Shapes must stay pure:
sun = circle, roof = triangle, wall = square, kite = rhombus, board = rectangle. Tails, strings, legs and paths may
leave the regions.

| Region | x | y | w | h |
|---|---|---|---|---|
| sun | 0.06 | 0.06 | 0.18 | 0.24 |
| roof | 0.30 | 0.20 | 0.36 | 0.22 |
| wall | 0.34 | 0.44 | 0.28 | 0.37 |
| kite | 0.74 | 0.06 | 0.16 | 0.26 |
| board | 0.72 | 0.56 | 0.22 | 0.18 |

**`body_child` (3:4):** a friendly child standing, front view, arms a little out, simple t-shirt and shorts.

| Region | x | y | w | h |
|---|---|---|---|---|
| eyes | 0.36 | 0.10 | 0.28 | 0.07 |
| nose | 0.45 | 0.175 | 0.10 | 0.05 |
| mouth | 0.42 | 0.235 | 0.16 | 0.05 |
| ear (picture left) | 0.24 | 0.11 | 0.09 | 0.10 |
| hand (picture left) | 0.06 | 0.46 | 0.14 | 0.10 |
| foot (picture right) | 0.54 | 0.89 | 0.20 | 0.08 |

**`map_indonesia` (2:1):** stylised island groups roughly in place, a light sea hatch, no labels, no borders: Sumatra
diagonal NW to SE, Jawa long and thin, Kalimantan large, Sulawesi K-shaped, Papua bird-shaped, a chain for Bali–Nusa
Tenggara, a scatter for Maluku. This is a picture, not a survey map.

| Region | x | y | w | h |
|---|---|---|---|---|
| sumatra | 0.02 | 0.05 | 0.22 | 0.55 |
| jawa | 0.24 | 0.62 | 0.20 | 0.14 |
| kalimantan | 0.28 | 0.08 | 0.20 | 0.40 |
| sulawesi | 0.50 | 0.20 | 0.14 | 0.40 |
| bali_nusa_tenggara | 0.45 | 0.78 | 0.22 | 0.12 |
| maluku | 0.66 | 0.25 | 0.10 | 0.35 |
| papua | 0.77 | 0.25 | 0.22 | 0.45 |

## 10. Acceptance

Every delivered key passes ART_DIRECTION §7 (squint test at 48 dp, paper, two or more line weights with open corners,
≤ 6 colours, no forbidden effects, asymmetry, culture check, kids-safe, files and sizes). Counting, clock, fraction and
balance facts are checked one by one. Scene objects are checked against their regions with an overlay.

## Appendix: every key (187)

- **Characters and chrome (13):** `app_icon_draft`, `aya_happy`, `aya_idle`, `aya_sleep`, `aya_think`, `aya_wave`, `gem`, `gem_box`, `glyph_correct`, `glyph_not_yet`, `glyph_saved`, `state_error`, `state_seedling`
- **Covers (4:3) (4):** `cover_bahasa`, `cover_matematika`, `cover_sains`, `cover_sosial_seni`
- **Stickers (16):** `sticker_angklung`, `sticker_bicycle`, `sticker_boat`, `sticker_book`, `sticker_cat`, `sticker_compass`, `sticker_drum`, `sticker_kite`, `sticker_lantern`, `sticker_leaf`, `sticker_mango`, `sticker_rice_field`, `sticker_shell`, `sticker_star_fruit`, `sticker_teapot`, `sticker_umbrella`
- **Counting (60):** `count_egg_1`, `count_egg_2`, `count_egg_3`, `count_egg_4`, `count_egg_5`, `count_egg_6`, `count_egg_7`, `count_egg_8`, `count_egg_9`, `count_egg_10`, `count_egg_11`, `count_egg_12`, `count_egg_13`, `count_egg_14`, `count_egg_15`, `count_egg_16`, `count_egg_17`, `count_egg_18`, `count_egg_19`, `count_egg_20`, `count_mango_1`, `count_mango_2`, `count_mango_3`, `count_mango_4`, `count_mango_5`, `count_mango_6`, `count_mango_7`, `count_mango_8`, `count_mango_9`, `count_mango_10`, `count_mango_11`, `count_mango_12`, `count_mango_13`, `count_mango_14`, `count_mango_15`, `count_mango_16`, `count_mango_17`, `count_mango_18`, `count_mango_19`, `count_mango_20`, `count_marble_1`, `count_marble_2`, `count_marble_3`, `count_marble_4`, `count_marble_5`, `count_marble_6`, `count_marble_7`, `count_marble_8`, `count_marble_9`, `count_marble_10`, `count_marble_11`, `count_marble_12`, `count_marble_13`, `count_marble_14`, `count_marble_15`, `count_marble_16`, `count_marble_17`, `count_marble_18`, `count_marble_19`, `count_marble_20`
- **Equal groups (16):** `groups_2x2`, `groups_2x3`, `groups_2x4`, `groups_2x5`, `groups_3x2`, `groups_3x3`, `groups_3x4`, `groups_3x5`, `groups_4x2`, `groups_4x3`, `groups_4x4`, `groups_4x5`, `groups_5x2`, `groups_5x3`, `groups_5x4`, `groups_5x5`
- **Shapes and solids (12):** `shape_circle`, `shape_oval`, `shape_rectangle`, `shape_rhombus`, `shape_square`, `shape_triangle`, `solid_cone`, `solid_cube`, `solid_cuboid`, `solid_cylinder`, `solid_pyramid`, `solid_sphere`
- **Clocks (24):** `clock_1_00`, `clock_1_30`, `clock_2_00`, `clock_2_30`, `clock_3_00`, `clock_3_30`, `clock_4_00`, `clock_4_30`, `clock_5_00`, `clock_5_30`, `clock_6_00`, `clock_6_30`, `clock_7_00`, `clock_7_30`, `clock_8_00`, `clock_8_30`, `clock_9_00`, `clock_9_30`, `clock_10_00`, `clock_10_30`, `clock_11_00`, `clock_11_30`, `clock_12_00`, `clock_12_30`
- **Fractions, balance, length (12):** `balance_even`, `balance_left_heavy`, `balance_right_heavy`, `frac_1_2`, `frac_1_3`, `frac_1_4`, `frac_1_8`, `frac_2_3`, `frac_3_4`, `length_long`, `length_medium`, `length_short`
- **Position, senses, habits (14):** `drink_water`, `pos_cat_above`, `pos_cat_below`, `pos_cat_inside`, `pos_cat_left`, `pos_cat_right`, `sense_ear`, `sense_eye`, `sense_hand`, `sense_nose`, `sense_tongue`, `sleep_moon`, `toothbrush`, `wash_hands`
- **Family, fruit, money (13):** `coin_generic`, `fam_baby`, `fam_brother`, `fam_father`, `fam_grandfather`, `fam_grandmother`, `fam_mother`, `fam_sister`, `fruit_banana`, `fruit_mango`, `fruit_papaya`, `fruit_rambutan`, `note_generic`
- **Scenes with tap regions (3):** `body_child`, `map_indonesia`, `scene_kampung_shapes`
