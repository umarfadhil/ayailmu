# Stroke data for `trace` items

**Review status: DRAFT.** Needs three native reviewers before release — a Japanese reviewer (hiragana), a Korean
reviewer (hangul jamo, which are hand-drawn) and a Chinese reviewer (hanzi, Mainland order) — to confirm stroke
order, stroke direction and shape for every glyph, using `contact_sheet.png`.

## What it is

`android/content/src/main/assets/strokes/index.json` holds one entry per traceable glyph (format and the 95 keys:
`docs/content/INTERACTIONS_AUDIO.md` §4):

```json
{"keys": {"hira_a": {"glyph": "あ", "script": "hiragana", "strokes": [[[0.284, 0.303], ...], ...]}, ...}}
```

Each stroke is a polyline in writing order and writing direction (first point = pen down, last = pen up).
Coordinates are 0..1 in the character's square cell, origin top-left, 3 decimals, 6–24 points per stroke
(corners and curves are kept; extra points are spread along straight runs). The app checks `trace` keys against
this file (`PackValidator`) and draws/checks the strokes from it.

| Script | Keys | Source |
|---|---|---|
| `hiragana` | 46 `hira_*` | KanjiVG (CC BY-SA 3.0), unchanged order/direction |
| `hanzi` | 25 `hanzi_*` | KanjiVG (CC BY-SA 3.0); checked against the Mainland order (GB 现代汉语通用字笔顺规范): no differences for these 25, so nothing was reordered |
| `hangul` | 24 `hangul_*` | drawn by hand in `hangul.py` (Petalytix) |

KanjiVG: © Ulrich Apel, CC BY-SA 3.0, <https://kanjivg.tagaini.net>, pinned to commit
`70a0b7ae0c18ceb5cb358274b029cce0234a43bc`. The derived `hira_*` and `hanzi_*` entries are shared under the same
licence; the attribution ships in `android/content/src/main/assets/licenses/KanjiVG.txt`.

## Files

- `hangul.py` — the hand-drawn jamo: one entry per jamo, strokes in order, points in writing direction, on a
  0..100 grid, with a comment on the order for each. A Korean reviewer edits this file.
- `contact_sheet.py` — renders every glyph (strokes coloured, number at the start, arrowhead at the end, over a
  faint Noto Sans CJK rendering). Needs Pillow.
- `contact_sheet.png` — the current sheet, for review.
- `../../android/tools/strokes_build.py` — the builder (Python stdlib only).

## Rebuild

```sh
# from the repo root; DIR caches the KanjiVG SVGs (downloaded from the pinned commit when missing)
python3 -I android/tools/strokes_build.py --cache DIR
python3 -I android/tools/strokes_build.py --cache DIR --offline   # no network; DIR must hold all 71 SVGs
python3 art/strokes/contact_sheet.py                              # -> art/strokes/contact_sheet.png
```

Then run the pack validator (it loads `strokes/index.json` and checks its structure and every `trace` key).

## Choices a reviewer should check

- **Hiragana**: KanjiVG stroke counts are used as-is: き 4, さ 3, ふ 4, そ 1, ら 2, り 2, を 3, ゆ 2, ん 1
  (some fonts/teachers join き's or さ's last strokes, or write そ in 2 — we follow KanjiVG).
- **Hanzi**: KanjiVG draws the Japanese glyph forms. The order of all 25 matches the Mainland standard
  (上 丨一一, 下 一丨丶, 九 丿乙, 火 丶丿丿㇏, 小 亅丶丶, 山 丨𠃊丨, 我 丿一亅㇀㇂丿丶, 好 ㇛丿㇀㇇亅一, …).
  Small shape differences from Mainland fonts remain (e.g. the left stroke of 小 is a short ノ in KanjiVG and a
  dot in Mainland fonts; 女 in 好 ends in a near-horizontal stroke rather than a clear rising 提) — direction is
  the same. If a reviewer finds an order difference, add it to `MAINLAND_ORDER` in the builder.
- **Hangul** (all hand-drawn, standard handwriting order: horizontals left→right, verticals top→bottom, top
  before bottom, left before right):
  - ㄱ 1 (right, then down) · ㄴ 1 (down, then right) · ㄷ 2 (top bar, then ㄴ) · ㄹ 3 (ㄱ, middle bar, ㄴ) ·
    ㅁ 3 (left side, top+right side, bottom) · ㅂ 4 (left side, right side, middle bar, bottom bar) ·
    ㅅ 2 · ㅇ 1 (from the top, counter-clockwise) · ㅋ 2 (ㄱ, middle bar) · ㅍ 4 (top bar, left leg, right
    leg, bottom bar) · ㅎ 3 (top dash, bar, ㅇ).
  - **ㅈ uses the 2-stroke handwritten form** (bar turning into a sweep down-left like ス, then the right leg
    from the middle of the sweep), not the 3-stroke print form. **ㅊ** = top dash + that ㅈ = 3 strokes.
  - **ㅌ** = top bar, middle bar, then ㄴ (3 strokes). Some teachers write ㄷ first and the middle bar last —
    please confirm.
  - The top dash (꼭지) of ㅊ and ㅎ is drawn as a short stroke straight down.
  - Vowels: ㅏ ㅑ vertical first, then the bar(s) to the right; ㅓ ㅕ bar(s) first, then the vertical; ㅗ ㅛ short
    vertical(s) first, then the long bar; ㅜ ㅠ long bar first, then the short vertical(s); ㅡ 1; ㅣ 1.
  - Jamo are drawn alone and centred in the cell (consonants roughly in the 20..80 band), close to the
    proportions of Noto Sans CJK KR's compatibility jamo.
