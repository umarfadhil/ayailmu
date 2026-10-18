# Illustration brief 00: AyaIlmu style bible (6 to 10 pages)

| Field | Value |
|---|---|
| Brief id | `00_style_bible_brief` |
| Client | Petalytix, for AyaIlmu (Android learning app for Indonesian kids and adults: languages, maths, science, social studies and arts) |
| Status | DRAFT, not sent. Illustrator not chosen yet (ART_DIRECTION §5 is OPEN) |
| Deadline | OPEN: first roughs about 2 weeks after the paid test spot is accepted; final bible 2 weeks after roughs |
| Fee and rights | OPEN (quote requested). Full commercial rights in the bible, its sources and textures transfer to Petalytix (confirm in the contract) |
| Before this | One paid test spot (ART_DIRECTION §5): `cover_matematika` from `01_core_set_brief.md`, so we can judge line, colour and charm |

## 1. Subject and single idea

The style bible is the one document every later picture is drawn from: the "AyaIlmu hand". It must let a second
illustrator, or the same one in a year, produce matching art without asking. Single idea: **ilmu that grows, drawn by a
warm human hand on paper.**

## 2. Mood

Calm, warm, curious.

## 3. Pages to deliver (6 to 10)

1. **Palette.** Swatches with hex for the seven roles we already use in code: paper, ink, clay (terracotta), ochre, sage,
   slate (blue-grey), and blush (cheeks only). Starting values: paper #F6F1E7, ink #2B2A28, clay #C4613A, ochre #D9A441,
   sage #8A9A77, slate #5B6B80, blush #E3A99A. You may adjust the hex; keep the roles. Show a night version on night
   paper #1F1D1A (ink becomes a warm light line; colours sit at mid tones so light lines stay visible on them), and one
   skin-tone recipe (sawo matang range) that reads in both.
2. **Line.** Three line-weight studies (contour, inner detail, hatching), drawn with your actual tool. Show open corners,
   slight wobble, and where weight changes inside one stroke.
3. **Texture.** Two texture overlays as tileable PNG (paper grain and print or riso texture), 1024 × 1024 px,
   greyscale with alpha, subtle enough to sit over every screen. Show them over a flat colour and over a drawing.
4. **Aya turnaround.** Front, three-quarter, side and back, with construction notes (proportions, sprout, stub arms).
5. **Aya expression sheet.** At least: idle, wave, happy, think, sleep, nod, a small celebration, and "not yet /
   let's look" (encouraging, never sad or scolding). Each must read at 48 dp.
6. **Sample spots.** Six spots covering the four subjects: Bahasa (open book with a speech curl), Matematika (counting
   beads and a ruler), Sains (sprout and magnifying glass), Sosial & Seni (angklung and brush), one family or kampung
   scene, one collectible sticker.
7. **People.** Two or three figures of different ages (child, mother in kerudung, grandfather in peci) showing face,
   hands, hair, clothes and how hatching replaces shading on a person.
8. **Do / don't.** One page of side-by-side examples, including the anti-slop list below.
9. and 10. (optional) Icon and glyph rules (tick, "let's look" loop, notebook), and a page on layering for animation.

## 4. Aya: what we know, what you design

Aya is the coach. Our code draft (`art/preview/aya_*.svg`, composition reference only) is a small round seedling:
a soft teardrop or pear body in sage with an ink line, a two-leaf sprout on top, dot eyes, a small mouth, a little
blush, and stub arms. You own the final design. Constraints:

- **Original.** Must not resemble any existing mascot: no owls, no birds, nothing close to well-known learning-app
  characters, no generic blob mascots.
- **Simple enough to rig in Rive by hand:** separate layers for body, each leaf, each arm, eyes, mouth, cheeks.
- **Reads at 48 dp** as a silhouette (app icon: Aya silhouette on paper, two colours).
- **Kind, not cute-sugary.** Encouraging when the learner is wrong; never mocking.

## 5. Must avoid (anti-slop list, ART_DIRECTION §3)

Corporate-Memphis figures (noodle limbs, giant hands, flat purple people) · 3-D clay or render look · glossy gradients,
neon, purple-teal "AI" palette · perfectly symmetric faces or objects · uniform stroke weight everywhere · sticker-style
white outlines · particle bursts or confetti · emoji or emoji-like icons · stock-photo compositions · glow, bokeh, lens
flare, drop shadows · more than about 6 colours in one image · text, letters or digits inside pictures · anything
produced by an image generator, or traced from one. Hand-lettering only if we ask for it, as an image.

## 6. Indonesian context and kids-safe

Daily life drawn with affection (warung, sawah, angkot, pasar, kampung houses, angklung, kendang, layangan). Mothers may
wear a kerudung, grandfathers a peci; no religious symbols beyond ordinary clothing. Skin tones sawo matang and varied.
No violence, scary imagery, brand logos, or real banknote or coin designs.

## 7. Formats

- Layered source (Procreate, PSD or Krita), one layer per colour role, named `paper`, `ink`, `clay`, `ochre`, `sage`,
  `slate`, `blush`, so we can build night variants and rig Aya.
- PDF of the bible, plus PNG exports of every page.
- Texture overlays as PNG (see page 3).
- Aya parts as separate layered files ready for Rive.

## 8. References (ours)

- `ai-memory/ART_DIRECTION.md`: the standard you are drawing to (we will share it).
- `art/preview/sheet_*.png`: code drafts of the full catalog. They show content and layout only; please do not copy
  their line or shapes. Your hand replaces them.
- `docs/ART_CATALOG.md`: the list of pictures the bible must be able to support.

## 9. Acceptance

We run ART_DIRECTION §7 on every page: squint test, paper present, two or more line weights with open corners, ≤ 6
colours with one accent, no forbidden effects, asymmetry, culture check, kids-safe, motion notes, sources in `art/`.
Up to two revision rounds on roughs, one on finals.
