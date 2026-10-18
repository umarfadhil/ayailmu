# art/

Sources for AyaIlmu illustrations (not shipped). The standard every picture must meet is
`ai-memory/ART_DIRECTION.md`; the list of pictures is `docs/ART_CATALOG.md`.

> **Everything currently in the app is DRAFT art.** The 543 pictures were drawn as code by Claude (ART_DIRECTION §6:
> vector drafts that follow §2, no image generator of any kind, nothing traced). They are placeholders and composition
> references. Each one stays DRAFT until a human illustrator redraws it, or approves it, against the ART_DIRECTION §7
> acceptance checklist. Do not use them in marketing.

## Layout

| Path | What |
|---|---|
| `tools/draw.py` | The drawing tool: a small "hand" library plus one composition per catalog key |
| `preview/<key>.svg` | One SVG preview per key (light palette, no background) |
| `preview/sheet_*.png` | Contact sheets for review, light and `*_night` (sheets 9–12: the `pic_*` picture vocabulary) |
| `briefs/` | Illustrator briefs: `TEMPLATE.md`, `00_style_bible_brief.md`, `01_core_set_brief.md`, `vocabulary-set.md` |

## Run it

```
python3 art/tools/draw.py                 # everything (about 5 s)
python3 art/tools/draw.py --no-sheets     # skip the PNG contact sheets
python3 art/tools/draw.py --only aya_idle,clock_7_30 --png /tmp/review [--night] [--scale 2]
                                          # review helper: PNGs + review_sheet.png, touches nothing else
```

Python 3 standard library only, except `cairosvg` for PNG sheets. No network. Deterministic: each key seeds its own
random hand from `crc32(key)`, so a re-run with unchanged code is byte-identical.

One full run writes:

- `art/preview/<key>.svg` and `art/preview/sheet_*.png`;
- `android/core/design/src/main/res/drawable/art_<key>.xml`, one VectorDrawable per key;
- `android/content/src/main/assets/art/index.json`: `{"keys": [...], "regions": {...}}`, read by
  `:core:content:validatePacks`, so packs can only use keys and tap regions that exist;
- `android/core/design/src/main/java/id/petalytix/ayailmu/core/design/art/ArtRegistry.kt`: key → `R.drawable.art_<key>`
  and the aspect ratio;
- `android/core/design/src/main/res/values(-night)/art_learn_colors.xml`: the learning colours of the ten `pic_color_*`
  paint daubs (from `LEARN` in `draw.py`).

A full run stops with an error if a key listed in `PIC_GROUPS` (INTERACTIONS_AUDIO §5) has no drawing.

The palette lives in `android/core/design/src/main/res/values/art_colors.xml` and `values-night/art_colors.xml`
(hand-written; `LIGHT` and `NIGHT` in `draw.py` mirror them for previews). The learning colours (`art_learn_*`) are the
one generated colour file: only the `pic_color_*` daubs may use them.

## Rules the tool enforces

- VectorDrawables use only `@color/art_*` references (paper, ink, clay, ochre, sage, slate, blush; `learn_*` only in
  the `pic_color_*` daubs), never literal hex, so pictures follow the night theme.
- `pathData` uses only absolute `M L C Q Z`, rounded to one decimal. Round caps and joins. Alpha only via
  `fillAlpha` / `strokeAlpha` where needed.
- Viewports: 240 × 240 (square keys), 400 × 300 (covers, `scene_kampung_shapes` and `scene_garden`), 300 × 400 (`body_child`),
  400 × 200 (`map_indonesia`); dp size equals the viewport.
- Each file stays under about 25 KB: repeated objects (counting, groups) are drawn stage by stage so same-style
  paths merge, and long curves use quadratic splines. Known exception: `pic_friends` (two whole figures, about 30 KB,
  already interleaved so matching marks merge).
- Question pictures have no background rectangle (the app draws paper behind them).
- The look follows ART_DIRECTION §2: two or more stroke weights, contours that stop short or run past their start,
  slight wobble, colour plates offset from the ink like print mis-registration, hatching and stippling instead of
  shadows, no gradients, glow, shadows, confetti, text or digits.

## Changing the set

1. Change `docs/ART_CATALOG.md` first: keys and tap regions are a contract with the content packs.
2. Add or change the composition in `tools/draw.py` (register it with `@art_key("name", vw, vh, k)`); copy any new
   regions into `REGIONS`.
3. Run the tool, then **look at the contact sheets, light and night**, before committing (CR-REL-6: art-only commits).
4. Check: every drawable parses, no file over ~25 KB, regions still contain their objects.

## Known limits of the drafts

- People in `pic_*` come from one posable figure (`figure()` / `Fig` in `draw.py`, same construction as `draw_person`);
  poses use joint angles or a two-bone reach (`("ik", point, bend)`), busts use a soft bottom edge (`cut=`).
- Paper-white objects (rice, milk, egg white, clouds, the doctor's coat, the duck, the goat, onigiri, teeth) turn dark
  at night, like the eggs of the core set; the illustrator's night pass should keep them light.

- Night theme: ink becomes the light line, so dark hair reads light grey at night and paper-filled shapes (eggs, eye
  whites, pages, grey hair) print dark. Skin uses colour plates only, so its tone stays close in both themes. The
  illustrator's night pass should fix hair.
- The night colours are muted to mid tones (not lifted) so light ink stays visible on them.
- The app is expected to composite the shared paper-grain texture over pictures; none is baked into the drawables.
- The night colours follow the Android `-night` resource qualifier. If the app switches to dark theme inside the app
  without changing the configuration's night mode, the pictures stay in their light colours.
