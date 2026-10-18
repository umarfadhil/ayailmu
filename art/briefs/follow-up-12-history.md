# Illustration brief: Sejarah (history) story set — scenes, silhouettes and the objects of their work

| Field | Value |
|---|---|
| Brief id | `follow-up-12-history` |
| Client | Petalytix, for the AyaIlmu Android app (module Sejarah, `docs/content/MODULES_LEVELS_STORIES.md`) |
| Status | DRAFT (code drafts exist for all 74 keys, `art/tools/art_history.py`; nothing commissioned yet) |
| Deadline | [UMAR: set; suggest first roughs of 3 scenes + 2 silhouettes 2 weeks after commission, full set 6 weeks] |
| Contact | Umar Fadhil Ramadhan, umar@petalytix.id |
| Fee and rights | [UMAR]; full commercial rights in artwork and layered sources transfer to Petalytix (confirm in the contract) |

## 1. Subject and single idea

74 pictures for animated history stories about noble people (Kartini, Ki Hajar Dewantara, Zheng He, Marie Curie,
Ibn Sina, …): **15 full scenes, 12 human silhouettes, 8 shared props and 39 "objects of their work"**. Each story
panel is one scene with up to four of the other pictures placed and gently animated on top. One idea per picture.

## 2. Mood (three words)

Calm, dignified, curious.

## 3. The layer/scene system (read before drawing anything)

- **Scenes** (`hist_bg_*`, 16:9, 400 × 225 viewport) are complete, opaque pictures on paper. They are *quieter* than
  everything placed over them: thinner lines at partial strength, pale flat washes, nothing high-contrast. Leave the
  **left third and the lower third calm and open** (that is where figures and objects land). Any surface a prop
  would stand on (a table top, a bench, a floor line) is a clean horizontal.
- **Layers** (every other `hist_*` key) are single objects or figures on a **transparent background**: no paper
  behind them, no cast shadow, no ground wash except a short ground line where the drawing needs it. They are drawn
  with full-strength ink and colour so they read over a scene. Shown at 15–55 % of the scene width, so lines are a
  little bolder than the vocabulary set.
- The app moves layers with slow fades, slides, drifts, bobs and sways (≤ 6°, no bounce, no spin, ART_DIRECTION
  §2.7). Keep every layer's silhouette compact so a 2 % bob or a 15 % slide never clips something important.
- **Scale rule for people:** all `hist_sil_*` share one 240 × 240 frame; an adult is ~218 units tall with feet on the
  bottom edge, a child ~158. `hist_sil_teacher_class` is 320 × 240 (one adult + three seated children). Keep these so
  one `w` in the pack means one scale.

### The no-likeness rule (the content contract, §4)

Historical people are **never drawn as recognisable faces**. They appear as flat ink silhouettes seen from the side
or from behind — a plain head profile with **no eyes, nose detail, mouth or glasses** — and through the objects of
their work. Clothing is told by the outline plus a few fine paper-coloured inner lines, and at most one colour plate
(a headband, a sash, a held book). Nobody may be able to say "that is a portrait of X".

## 4. Must show (per group; period notes to research, with the drafts' sources)

**Scenes** — sea (open water, far island); harbour (warehouses, pier, a far ship); old classroom (chalkboard with
abstract marks only); old library (arched window, book cases); old laboratory (bench, shelves of glassware); 19th-c.
hospital ward (tall arched windows, small far beds); Javanese village (volcano, terraced sawah, limasan house,
coconut palms); desert road (dunes, track to the horizon, small oasis); wide sky over dunes by the sea (Kitty Hawk,
one wooden shed); green highland hills (Kenya, far snow peak, flat acacias); forested hills of Aceh (mist band, river,
palms); old town street (tiled roofs, arched windows, awning — no places of worship, no signs); night sky (stars,
crescent, dark hills); old world map on parchment (rough continents, faint grid, small compass rose, no letters);
quiet night room (shuttered window with the moon, wooden table whose top is free).

**Silhouettes** — man (hip jacket, trousers); woman c. 1900 (high-necked blouse, long skirt, high bun); woman in long
**kebaya and batik kain with a low sanggul** (Kartini's and Dewi Sartika's era); woman in a long dress and
**headscarf over head and shoulders**, one hand open forward (leadership and care: Cut Nyak Dhien, Fatima al-Fihri);
boy with a hand raised; girl with a book to her chest, ponytail; teacher in kebaya with an open book and three
children seated on the floor; sailor shading the eyes, rope coil, rolled trousers, barefoot, cloth headband; medieval
scholar in a **long robe, cloak, turban and short beard** reading; traveller with staff, water gourd, hip bag and
head-wrap; scientist (a woman) in a knee-length **lab coat**, holding a flask up; nurse in a long dress, **apron and
cap, holding the lantern out**.

**Shared props** — kerosene table lamp c. 1900 with glass chimney; ship's compass on a square board, tick marks only;
brass astrolabe (ring and throne, tick-marked limb, openwork rete with star pointers, alidade); stack of four old
books; old globe on a stand with a meridian ring (continents as loose blobs); quill in an ink pot; small Nusantara
perahu with a slanted tanja sail and an outrigger; a sunrise over water.

**Per figure** — check these against the sources before drawing:

| Key | What, with the period point to respect |
|---|---|
| `hist_ki_hajar_school` | Taman Siswa (Yogyakarta, 1922): an open Javanese **pendopo under a joglo roof**, a chalkboard inside, children seated on the floor. |
| `hist_slate_board` | A pupil's writing slate in a wooden frame, slate pencil, sponge on a string; chalk marks abstract. |
| `hist_kartini_letters` | A bundle of envelopes tied with ribbon, one open letter of hand-writing (lines, never readable), a dip pen. Source: *Habis Gelap Terbitlah Terang* (1911). |
| `hist_dewi_sartika_school` | Sakola Istri (Bandung, 16 Jan 1904, first in a corner of the Bandung Regency pendopo, later Jl. Ciguriang): a small **Sundanese** school house on low posts, woven bamboo (bilik) walls, a julang-ngapak roof with crossed capit gunting, blank board. |
| `hist_sewing_kit` | Woven basket, embroidered cloth, spool with threaded needle, pincushion, thimble. |
| `hist_rumoh_aceh` | **Rumoh Aceh**: stilt house on round posts (kolong 2.5–3 m), plank walls with a carved band, steep rumbia-thatch roof, carved gable screen (tulak angen) with pierced pattern, front ladder with an **odd number of rungs** (draft: 9). |
| `hist_hatta_books` | An open wooden trunk packed with books (Hatta took his library into exile), round reading glasses on top. |
| `hist_coop_shop` | A village koperasi kiosk: striped awning, shelves of jars, a two-pan balance on the counter, rice sacks, a produce basket; blank sign. |
| `hist_habibie_plane` | **N-250 Gatotkaca** (first flight 10 Aug 1995): twin-turboprop regional airliner, **high wing**, T-tail, **six-bladed** propellers, plain livery, **no logos or registration**. |
| `hist_blueprint` | Pinned blueprint with a pale aeroplane side view, construction circles, dimension arrows without numbers, ruler and pencil. |
| `hist_treasure_ship` | **Baochuan**: a very large multi-masted Chinese junk (the draft shows six masts) with **battened lug sails**, high stern castle, square bow, big rudder. No cannon, no banners with symbols. |
| `hist_sejong_scroll` | A hanging scroll with columns of **abstract ink dabs** (not Hangul, not any script), rollers, a small red seal. |
| `hist_rain_gauge` | **Cheugugi** (1441): a bronze cylinder standing on a carved stone pedestal (cheugudae), rain falling in. |
| `hist_spinning_wheel` | Gandhi's **charkha**: wheel with a string-zigzag rim, crank, drive band to a spindle, a thread drawn from a cotton tuft. |
| `hist_sandals_path` | A long dusty road with footprints to the horizon; a pair of simple leather sandals (Salt March, 1930). |
| `hist_khwarizmi_board` | A **dust board** (wooden tray of sand): a square completed with rectangles, dots, a circle — his geometric method; a stylus; **no digits**. |
| `hist_ibn_sina_book` | *The Canon of Medicine*: large open book, abstract text lines, a drawn medicinal plant, tooled cover. |
| `hist_herbs_mortar` | Bronze mortar and pestle with herbs, dried flowers and seeds. |
| `hist_camera_obscura` | Ibn al-Haytham: a candle outside a dark box, rays through a pinhole, the flame's **inverted** image inside. |
| `hist_lens` | A convex lens in a brass rim, parallel rays bending to one focal point. |
| `hist_caravan` | Three loaded camels tied in line, a walker leading them (Ibn Battuta). |
| `hist_route_map` | A rolled travel map: coasts and islands, a dotted route between ports, a small ship, compass rose; no names. |
| `hist_qarawiyyin` | **Al-Qarawiyyin, Fez (859, Fatima al-Fihri)**: a courtyard front of horseshoe arches, green tiled roof, a zellige band of geometric tiles, a round fountain. No inscriptions, no religious symbols. |
| `hist_handshake` | Two hands of **different skin tones** clasped; one patterned cuff, one plain (Mandela). |
| `hist_tree_seedlings` | A young tree just planted in a soil ring, seedlings in bags, a watering can (Maathai's Green Belt Movement). |
| `hist_curie_flask` | A round-bottomed flask of faintly shining liquid on a cork ring, a test tube — shine drawn as short marks, **never a glow effect**. |
| `hist_notebook` | A scientist's notebook: abstract writing, a sketched apparatus, a rising curve with dots, pencil. |
| `hist_nightingale_lamp` | Her actual lamp: a **Turkish folding lantern (fanoos)**, pleated body between metal caps, candle inside — not the "genie lamp" of the statues. |
| `hist_hospital_bed` | Empty iron-framed 19th-c. bed, white sheets, folded blanket, bedside table with a cup. |
| `hist_braille_dots` | Rows of raised six-dot cells on a card, a fingertip reading; the pattern is abstract. |
| `hist_braille_book` | A thick open Braille book, pages covered in raised dots, no print. |
| `hist_telescope` | Galileo's refractor (1609–10): a long leather-covered tube with tooled bands, small eyepiece, simple wooden stand. |
| `hist_jupiter_moons` | Banded Jupiter with the four Galilean moons in a line. |
| `hist_wright_flyer` | **1903 Flyer**: muslin biplane, **elevator in front (canard)**, twin rudders behind, two **pusher** propellers, pilot lying prone left of centre, engine right of centre, **skids, no wheels**. |
| `hist_bicycle_shop` | Wright Cycle Company (Dayton, 1890s): small shop front, awning, display window with a safety bicycle, blank sign board. |
| `hist_water_pump` | An old cast-iron hand pump pouring water over an open hand (Helen Keller, 1887). |
| `hist_hands_spelling` | One open palm; another hand pressing letters into it with a fingertip, small touch marks. |
| `hist_peanut_plant` | A peanut plant lifted to show pegs, roots and pods below the soil line (Carver). |
| `hist_soil_field` | A field in ridged rows going into the distance, alternating peanut and sweet-potato rows (crop rotation), blank marker stake. |

## 5. Must avoid (anti-slop list, ART_DIRECTION §3, plus the history rules)

Corporate-Memphis figures · 3-D clay or render look · glossy gradients, neon, purple-teal "AI" palette · perfectly
symmetric faces or objects · uniform stroke weight · sticker-style white outlines · particle bursts or confetti ·
emoji-like icons · stock-photo compositions · glow, bokeh, lens flare, drop shadows · more than about 6 colours ·
any text, letters, digits or real script inside a picture (writing is always abstract marks) · anything made with
an image generator, or traced from one.

History-specific: **no face likeness** of any real person (see §3) · **no weapons, war, battle, soldiers, blood,
prisons or violence** (Cut Nyak Dhien and Mandela are shown through a house, hills, a handshake and a sunrise; courage
is leadership, care and persistence) · **no prophets, religious founders, places of worship or religious symbols**
(a headscarf, kerudung or turban is ordinary clothing; the Qarawiyyin is drawn as arcades, tiles and a fountain) ·
no national flags, coats of arms, company logos, aircraft registrations or ship banners with symbols · no real
Braille or Hangul text, no readable numbers on gauges, maps or blueprints.

## 6. Size, aspect and exports

| Item | Value |
|---|---|
| Scenes | 16:9, 400 × 225 viewport; opaque paper; layered source with `paper` as its own layer |
| Layers | 1:1 (240 × 240); wide objects 4:3 (320 × 240): `hist_sil_teacher_class`, `hist_sunrise`, `hist_ki_hajar_school`, `hist_dewi_sartika_school`, `hist_rumoh_aceh`, `hist_coop_shop`, `hist_habibie_plane`, `hist_treasure_ship`, `hist_spinning_wheel`, `hist_sandals_path`, `hist_camera_obscura`, `hist_caravan`, `hist_route_map`, `hist_qarawiyyin`, `hist_hospital_bed`, `hist_wright_flyer`, `hist_bicycle_shop`, `hist_soil_field`. Transparent background, nothing touching the frame edge except silhouettes' feet. |
| Export | layered SVG for flat work (we convert to VectorDrawable, ≤ ~25 KB each) or WebP at xxhdpi ≤ 150 KB |
| Source | layered Procreate / PSD / Krita, one layer per colour role (`paper`, `ink`, `clay`, `ochre`, `sage`, `slate`, `blush`); silhouettes as one `ink` shape plus a `paper` line layer, so Rive can rig arms separately if we animate later |
| Night | colour layers separate; ink becomes the light line. Silhouettes print light on night paper (accepted); keep paper-coloured objects (pages, sheets, sails' highlights) light in the night pass |

## 7. Palette pick (≤ 6 colours, one accent)

Scenes: paper, ink (at 40–55 % strength), slate, sage, ochre; accent clay on roofs and small details. Layers: paper,
ink, ochre, clay, slate, sage; **one accent per layer** (the headband, the sash, the ribbon, the flame). Silhouettes:
ink + paper lines + at most one colour plate.

## 8. Indonesian context notes

Kebaya and kain with sanggul (Kartini, Dewi Sartika, the teacher); rumoh Aceh, pendopo/joglo, the Sundanese school,
a koperasi kiosk and the Javanese village are drawn with affection and plausible detail, not postcard clichés.
Children of the class include one girl in a kerudung. Skin tones in the hands keys are varied (handshake: deep and
light; Keller/Sullivan: light; Braille reader: mid).

## 9. Kids-safe reminder

No violence, scary imagery, weapons, brand logos, flags or banknotes. The ward is calm and empty, the lab has no
fire, the sea has no storm.

## 10. References

- Composition drafts: `art/preview/hist_*.svg` after the next full run, and composites of scene + layers in the
  follow-up 12 review folder (layout and content only, never to be traced).
- Period references used for the drafts: Wright Flyer (Wikipedia; NPS "The Wright Flyer"); IPTN N-250 (Wikipedia;
  Flight International 1995 article on the high-wing layout); baochuan (treasure-ship literature; junk rig
  references); cheugugi (Wikipedia "Rain gauge" / "Cheugugi"); Nightingale's fanoos (Smithsonian Magazine, 2020
  Florence Nightingale Museum exhibition); rumoh Aceh (archify.com and katadata.co.id articles on rumah adat Aceh);
  Dewi Sartika's Sakola Istri (Wikipedia); Al-Qarawiyyin courtyard photographs; charkha photographs.
- Style: the style bible (`00_style_bible_brief.md` deliverable) and `ai-memory/ART_DIRECTION.md`.

## 11. Acceptance (ART_DIRECTION §7, run on delivery)

1. Squint test at 48 dp and thumbnail; scene + layers also checked composited at 360 px wide. 2. Paper present, not
#FFFFFF, no gradient. 3. Two or more stroke weights, open corners. 4. ≤ 6 palette colours, one accent. 5. No forbidden
effects. 6. Not mirrored or dead-centred without reason. 7. Culture and period check against the table above.
8. Kids-safe and the history rules (no likeness, no weapons, no religious depiction). 9. Layers survive a 15 % slide
and a 6° sway without clipping. 10. Sources in `art/`, exports within size limits, FILE_MAP updated.
