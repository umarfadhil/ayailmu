# Premium-Feel Audit — Arabic Trial app

Date: 2026-10-16. Reviewer: Claude Code (claude-opus-5-5, max effort), read-only. Source: HEAD ef28606, content demo-synthetic-0.3.

**Evidence.** Four inputs:
- current source
- Sottaku references image1, image3, image19 and image23 (image3's four buttons are self-ratings, not answer choices)
- local browser evidence captured by Codex on an isolated loopback preview (:8084, verified v0.3) at 390×844, 320×844 and 1440×1000: 30 screenshots plus DOM and animation readings, with zero page or console errors
- a follow-up packet on scroll and font loading

The browser evidence is local and git-ignored, in `.design-reference/premium-audit-20261016/browser/`. The Guide and Settings screens were not captured. This audit says nothing about native devices, frame rate, haptics, screen readers or real font-load time.

Tags: **[M]** measured in the browser · **[S]** visible in a screenshot · **[C]** source only · **[J]** my judgment · **[N]** native behaviour, untested.

Operational note: the long-running :8081 preview served the stale demo-synthetic-0.2 pack. That is a preview-hygiene problem, not evidence of defects in the current source.

## Verdict
[J] The app is calm, coherent and honest, but it reads as a careful prototype rather than a premium product. The visual system isn't the problem: the palette and layout follow the references closely. Three things break the feel:
- After a wrong answer on a phone, the explanation lands off-screen.
- Progress reads like an audit log and contradicts itself.
- Leftover implementation text sits on the most-visited screens.

All three are bounded fixes. None needs a new feature or animation.

## Strengths to keep
- [S] It matches the references: cream background, white study card, navy gradient primary button, lavender active row and a S23-style drawer (04-home-desktop.png, 07-question-mobile.png, 22-reduced-motion-menu.png).
- [S][M] The Arabic stands out: a measured 44 px Naskh headword and, per source, 30 px option text, with clear harakat. Arabic inside Indonesian lines renders right-to-left and stays in place (03-home-mobile.png, 10-next-form-mobile.png, 28-next-after-scrolled-feedback.png).
- [S][M] Feedback uses an icon as well as colour, and focus moves to the result heading (09-correct-feedback-mobile.png, 13-wrong-feedback-mobile.png). A failed save puts focus on an alert and marks no tile (24-save-error-mobile.png).
- [M] No animation runs on answering or Lanjut. There are no streaks, badges or percentages.
- [M] Nothing overflows horizontally at 320, 390 or 1440 px. The option order survives leaving and resuming a session (e, k, c, x).
- [S] The draft strip, the constructed-sentence label and the recognition-only notes are legible without crowding the study card. Keep all of them.

## Ranked findings
1. **After a wrong answer, the explanation and Lanjut are off-screen on phones.**
   - [M] At 390×844 the result card starts at y767 and Lanjut at y991 (13-wrong-feedback-mobile.png). Only the title and part of one line are visible, and reaching Lanjut takes about 195 px of scrolling (14-wrong-feedback-bottom-mobile.png).
   - Correct feedback on a short item fits: Lanjut is at y773 (09-correct-feedback-mobile.png).
   - [C] On native, focus moves with `setAccessibilityFocus`, which does not scroll the view for sighted users (`app/src/ui/a11y.ts:12-15`). [N] Untested on devices; could be the same or worse.
   - [J] This is the app's key teaching moment (`app/src/app/session.tsx:239-245`).
2. **Progress contradicts itself and is hard to scan.**
   - [S] Unit B shows “7 hari: Belum dimulai.” and then says the status stays «sebagian» “meskipun semua soal yang ada sudah dijawab”. Unit A pairs “Belum waktunya” with the same claim (17-progress-mobile.png, 18-progress-desktop.png).
   - [C] Cause: the missing-content note is added whatever the status (`app/src/app/progress.tsx:52`).
   - [M] The page is 2211 px tall at 390 px wide, mostly 14 px muted text. The same caveat repeats for every unit and every window.
   - It also shows an English “(recognition)” and a developer footer (`progress.tsx:164`).
   - Trial_App_Spec §8 requires the three status lines. It does not require the repetition or the contradiction.
3. **Implementation notes on Home.**
   - [S] Home always shows “Cek Awal (bacaan dengan audio): audio tidak tersedia (opsional, dinonaktifkan).” (03-home-mobile.png, 04-home-desktop.png). The entry check isn't built (`app/README.md:134`; `app/src/app/index.tsx:134-136`).
   - [S] The “Unit A” eyebrow repeats the start of the title “Unit A — Siapa yang dijelaskan?” (`index.tsx:70-73`).
4. **The summary repeats some numbers and shows one that is always zero.**
   - [S] It shows a “Diperiksa” stat and the phrase “0 disimpan untuk diperiksa” (15-summary-mobile.png, 16-summary-desktop.png). [C] Four-choice scoring never returns “pending”, so both are always zero (`app/src/engine/scoring.ts:143-157`).
   - The stats are then restated as a sentence (`summary.tsx:88-91`).
5. **English technical errors on Indonesian screens.**
   - [S] The unreadable-data screen shows “Stored data is malformed (answer 0: item_id); it was not modified.” (25-malformed-data-error.png).
   - [C] The session and Guide errors are built the same way (`components.tsx:749-754`, `session.tsx:133`, `guide.tsx:115`).
   - These screens are rare, but they appear exactly when the learner's trust is at stake.
6. **Blank white launch screen.**
   - [S] With both font requests deliberately held, the whole page is blank white rather than the app's cream background (29-font-request-held.png vs 30-font-request-released.png). This shows what users see while fonts load; it is not a measured load time.
   - [C] The root renders `null` until fonts load (`app/src/app/_layout.tsx:58-59`), and there is no splash configuration.
   - [N] Untested on devices.
7. **Reduced motion is ignored.**
   - [M] With prefers-reduced-motion on, the drawer still ran 250 ms opacity fades (22-reduced-motion-menu.png). [C] The report modal uses the same fade (`Nav.tsx:135`, `components.tsx:511`).
   - Fix: turn the fade off under reduced motion. No motion needs adding.
8. **Uneven line spacing around inline Arabic.**
   - [M] A three-line prompt containing one Arabic phrase is 87 px tall: 24 + 39 + 24 (28-next-after-scrolled-feedback.png). [C] Inline Arabic gets 1.35× the font size and 1.7× the line height (`components.tsx:257-262`).
   - Harakat need the extra height, so give the whole paragraph a single taller line height. A person should check the result on devices.
9. **Tiles shift when marked.**
   - [M] Marked tiles grow from 80 to 82 px and push the tiles below down 2 px (10-next-form-mobile.png vs 13-wrong-feedback-mobile.png). Cause: the border goes from 1 to 2 px on selection (`session.tsx:427-429`; same in `components.tsx:660`).
10. **Small inconsistencies.**
    - [S] On the nothing-due screen, “Lihat kemajuan” opens Ringkasan instead of Kemajuan (19-nothing-due-mobile.png; `session.tsx:144`).
    - [S] On desktop, the 760 px content column doesn't line up with the 980 px banner (16-summary-desktop.png, 18-progress-desktop.png vs 04-home-desktop.png).
    - [S] Consent shows “Arabic Trial” twice (30-font-request-released.png), and the setup tiles wrap to “10 / menit” (02-setup-mobile.png).
    - [S] Correct feedback says “Benar” and then “Benar. …” (09-correct-feedback-mobile.png).
    - [S] Icon styles are mixed, and the brand uses the same icon as Home (04-home-desktop.png).
    - [J] The session screen has no exit of its own; leaving means opening the menu (07-question-mobile.png).

**Found in source only (not captured; verify first):**
- The Progress word list ignores the Arabic size setting (`progress.tsx:150`).
- On phones, the Guide shows up to 8 contents rows above the lesson, and the lesson panel briefly becomes a spinner on every page change (`guide.tsx:110-121`).
- Settings shows no message when a save fails (`settings.tsx:39,48`).
- The consent checkboxes may not toggle with Space (`consent.tsx:12-17`).
- `monospace` on iOS is untested [N] (`settings.tsx:84`).

Not a defect: the next question keeps part of the previous scroll position (264 → 37 px), but its heading stays visible at y105 (28-next-after-scrolled-feedback.png).

## Top 3 changes
1. **Bring the result into view after an answer** (finding 1). Scroll the session view so the result card and Lanjut are both visible, on web and native, for example through a ScrollView ref in `Page` (`components.tsx:87-101`). Keep the current focus and screen-reader announcement, and add no animation. A 2×2 grid for short Arabic options would also help, but it depends on the open question-format decision.
2. **Make Progress consistent** (finding 2). Show the missing-content note only for checks that are due, partial or answered. State each caveat once per unit, and move the rules and content versions to Data pengembang. Keep all three status lines and every honesty statement.
3. **Clean up learner-facing text** (findings 3, 4, 5 and 10):
   - remove the Cek Awal notice from Home, since that check isn't built
   - de-duplicate “Unit A”
   - hide “Diperiksa” when nothing can be pending
   - drop the restated stats sentence
   - write errors in Indonesian, with technical detail only in developer mode

   The Indonesian reviewer must approve all wording. The draft strip, constructed-sentence label and recognition-only notes stay unchanged.

Not recommended: new screens, decorative or celebratory motion, gamification, or softening or hiding the draft and prototype warnings.