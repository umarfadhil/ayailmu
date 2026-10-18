# Art Direction — AyaIlmu

Budget: ≤ 15 KB. The standard every illustration, animation, icon set, sticker and video must meet. Reference feel: the warm, hand-drawn editorial illustration seen in Anthropic's product and brand material — paper, pencil, print texture, calm colour, human imperfection. We borrow the *principles*, never the artwork.

## 1. Why this matters commercially

Learning apps are full of identical gradient blobs, 3-D clay people and AI-rendered scenes. A visibly human hand is the cheapest durable differentiator we have, it photographs well in store screenshots, and it reads as trustworthy to parents. It also ages slowly: hand-drawn work from decades ago still looks fine; last year's AI style already looks dated.

## 2. Style pillars (the "AyaIlmu hand")

1. **Paper first.** Backgrounds are warm off-white or a muted tinted paper, never pure white, never a gradient. Subtle grain or print texture is visible when you look closely.
2. **Drawn lines.** Linework is pencil, ink or charcoal-like: weight varies, corners are slightly open, curves wobble a little. No uniform 2 px vector stroke, no auto-smoothed paths.
3. **Few, muted colours.** A palette of about six: paper, ink, clay/terracotta, ochre, sage, slate-blue, with one accent per scene. Colour sits *inside or next to* the line like a print mis-registration, not perfectly filled. No neon, no saturated gradients, no glossy highlights.
4. **Honest shapes.** Figures and objects are simplified and a little off: proportions are charming, not anatomically correct, not symmetric. One idea per picture. Generous empty space.
5. **Texture over effects.** Depth comes from hatching, stippling, paper grain and overlapping flat shapes — never drop shadows, bevels, blur, lens flares or 3-D lighting.
6. **Warm, specific, local.** Scenes show Indonesian daily life where it fits (warung, angkot, sawah, pengajian, pasar) drawn with affection, not stock clichés. Humans of all ages, kids and adults learning side by side.
7. **Quiet motion.** Movement is small, slow-in/slow-out, often on "twos" (12 fps feel) for drawn pieces; nothing bounces like a rubber ball, nothing explodes into particles.

## 3. Anti-slop checklist (fail any → asset is rejected)

- Corporate-Memphis figures (noodle limbs, giant hands, flat purple people) · 3-D clay / Blender render look · glossy gradients, neon, "AI purple-teal" · perfectly symmetric faces or objects · uniform stroke weight everywhere · sticker-style white outlines · generic particle bursts or confetti · emoji or emoji-like icons · stock-photo compositions · lens flare / bokeh / glow · more than ~6 colours in one image · text baked into the image · anything produced by an image generator (see §6).

## 4. Where art appears (and what each needs)

| Surface | Form | Source |
|---|---|---|
| Aya (mascot/coach) | Rive rig: idle breathing, nod, think, celebrate (small), sleep. Reacts to session events via state machine inputs. | Drawn by illustrator; rigged in Rive by hand |
| Subject shelves & track covers | Static spot illustrations, 1:1 and 4:3 | Illustrator |
| Session feedback | 3 tiny drawn glyph sets (correct / not yet / let's look) + one short Aya reaction | Illustrator + Rive |
| Rewards | Collectible stickers (drawn, slightly different each), progress scenes that fill in as units complete | Illustrator |
| Empty/error/offline states | One drawn scene each, calm humour | Illustrator |
| Store screen | One illustration per pack; price UI is plain typography | Illustrator |
| App icon | Aya silhouette, paper-texture background, 2-colour | Illustrator |
| Onboarding video (optional) | ≤ 20 s, drawn frames or Rive capture, hand-written feel titles | Illustrator + Rive export |
| Marketing (Play screenshots, Meta ads) | Real screens with the illustrations; same palette; hand-lettered headline style allowed | Same assets, no new style |

## 5. Pipeline (recommended, OPEN until Umar picks an illustrator)

1. **Style bible first.** Commission one human illustrator for a 6–10 page bible: palette swatches with hex, 3 line-weight studies, 2 texture overlays (PNG), Aya turnaround + expression sheet, 6 sample spots covering the four subjects, do/don't page. Budget this as the single most valuable art spend.
2. **Core set.** Same illustrator produces the M3 set (≈ 30 spots, 20 stickers, 6 states, icon). Deliver as layered source (Procreate/PSD/Krita) + exports.
3. **Extension by rule.** Later assets are produced by the same illustrator or a second one working strictly from the bible; Claude writes briefs from `art/briefs/TEMPLATE.md` (subject, mood, must-show, must-avoid, size, palette pick) and runs the §7 checklist on delivery.
4. **Motion.** Rive files authored by hand from the illustrator's layers; state machines named per Aya event. Simple decorative loops may be Lottie. UI motion is Compose with `AyaMotion` curves (CR-VIS-2).
5. **Sources live in `art/`** (not shipped); exports go to `:core:design` (WebP ≤ 150 KB each at xxhdpi, VectorDrawable for flat glyphs, `.riv` ≤ 300 KB).

Where to find illustrators: Behance/Dribbble filtered for editorial + risograph + children's-book work, Indonesian illustrator communities and campus design programs; ask for a paid test spot before committing.

## 6. AI tools policy (DECIDED 2026-10-16)

- Image generators (any) may be used only for private mood boards or to sketch a composition idea for the brief. Their output is never traced, never shipped, never shown in marketing.
- Claude may draft **vector glyphs and layout diagrams** (SVG/Compose Canvas) that follow §2 — varied stroke widths, deliberate wobble, texture overlay slot, ≤ 6 colours — but they ship only after a human redraws or approves them against §7. Claude may also write Rive state-machine specs, animation timing sheets and illustrator briefs.
- Video: no AI-generated video or voice. Narration, if any, is a real person. Exception (Umar, 2026-10-18): pronunciation clips for the language tracks are generated with ElevenLabs, bundled, and heard by a native speaker before release (CR-SND-2).
- Status 2026-10-17: Claude's draft set (543 keys, `docs/ART_CATALOG.md`, sources in `art/`, briefs in `art/briefs/`) is in the app as placeholders. Nothing from it ships to production until each key passes §7 — redrawn by the illustrator or approved by Umar — under the same key (CR-VIS-4).

## 7. Acceptance checklist (attach to the PR, CR-VIS-3)

1. Squint test: silhouette reads at 48 dp and at thumbnail size.
2. Paper present: background is textured off-white/tinted, not #FFFFFF, not a gradient.
3. Line is alive: at least two visibly different stroke weights; corners not perfectly closed.
4. Palette: ≤ 6 colours from the bible; one accent.
5. No forbidden effects (§3).
6. Asymmetry: nothing mirrored or perfectly centred unless the subject demands it.
7. Culture check: props, clothing and settings are plausible for Indonesia and respectful.
8. Kids-safe: no violence, no scary imagery, no brand logos.
9. Motion (if any): ≤ 600 ms for UI, slow-in/slow-out, respects reduce-motion with a still pose.
10. Files: correct format/size per §5, source saved in `art/`, FILE_MAP updated.

## 8. Typography (companion to the art)

Headlines in a humanist sans or a soft serif with slight irregularity (shortlist at M0; must have Latin + good Indonesian diacritics); body in a highly legible sans; Arabic in Noto Naskh Arabic with harakat verified at every size. Hand-lettered words only as images from the illustrator, never a "handwriting" font.
