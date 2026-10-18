# Illustration brief: <title>

Copy this file for every new commission or asset batch (ART_DIRECTION §5.3). Fill every field; delete nothing. A brief
without a must-avoid list or a palette pick is not ready to send.

| Field | Value |
|---|---|
| Brief id | `NN_short_name` (file name in `art/briefs/`) |
| Client | Petalytix, for the AyaIlmu Android app |
| Status | DRAFT / SENT / IN PROGRESS / DELIVERED / ACCEPTED (§7 checklist passed) |
| Deadline | YYYY-MM-DD (plus the date for the first rough) |
| Contact | name, channel |
| Fee and rights | agreed fee; full commercial rights in the delivered artwork and sources transfer to Petalytix (confirm in the contract) |

## 1. Subject and single idea

What the picture is, in one sentence. One idea per picture (§2.4). If you need "and" twice, split the brief.

## 2. Mood (three words)

For example: calm, warm, curious.

## 3. Must show

- The objects or people that make the picture readable at 48 dp (squint test, §7.1).
- Any tap regions or layout constraints (copy them from `docs/ART_CATALOG.md`; objects stay inside their regions).
- Counting, time or fraction facts the picture must state exactly (e.g. "exactly 7 mangoes, rows of five").

## 4. Must avoid (anti-slop list, ART_DIRECTION §3)

Corporate-Memphis figures (noodle limbs, giant hands, flat purple people) · 3-D clay or render look · glossy gradients,
neon, purple-teal "AI" palette · perfectly symmetric faces or objects · uniform stroke weight · sticker-style white
outlines · particle bursts or confetti · emoji or emoji-like icons · stock-photo compositions · glow, bokeh, lens flare,
drop shadows · more than about 6 colours · any text, letters or digits inside the picture · anything made with an image
generator, or traced from one.

Add subject-specific avoids here (brand logos, national emblems on money, religious symbols beyond ordinary clothing).

## 5. Size, aspect and exports

| Item | Value |
|---|---|
| Aspect / viewport | 1:1 (240), 4:3 (400 × 300), 3:4 (300 × 400) or 2:1 (400 × 200) |
| Export | flat glyphs: layered SVG (we convert to VectorDrawable); painterly spots: WebP at xxhdpi (3× the dp size), ≤ 150 KB |
| Source | layered Procreate / PSD / Krita, one layer per colour role, named `paper`, `ink`, `clay`, `ochre`, `sage`, `slate`, `blush` |
| Night | colour layers kept separate so we can build the night variant (ink becomes the light line) |

## 6. Palette pick (≤ 6 colours, one accent)

Name the roles used, e.g. "paper, ink, sage, ochre; accent clay". Hex values come from the style bible.

## 7. Indonesian context notes

Clothing, props and settings plausible for Indonesia and drawn with affection (warung, sawah, angkot, pasar, kampung).
Kerudung and peci are ordinary clothing; no other religious symbols unless the brief asks. Skin tones sawo matang and
varied; hair dark unless the person is old.

## 8. Kids-safe reminder

No violence, scary imagery, weapons, brand logos or real banknote and coin designs. Calm humour is welcome.

## 9. References

- Composition reference: `art/preview/<key>.svg` (code drafts: layout and content only, never to be traced).
- Style: the style bible (`00_style_bible_brief.md` deliverable) and `ai-memory/ART_DIRECTION.md`.

## 10. Acceptance (ART_DIRECTION §7, run on delivery)

1. Squint test at 48 dp and thumbnail. 2. Paper present, not #FFFFFF, no gradient. 3. Two or more stroke weights, open
corners. 4. ≤ 6 palette colours, one accent. 5. No forbidden effects. 6. Not mirrored or dead-centred without reason.
7. Culture check. 8. Kids-safe. 9. Motion (if any) ≤ 600 ms, eased, reduce-motion still pose. 10. Sources in `art/`,
exports within size limits, FILE_MAP updated.
