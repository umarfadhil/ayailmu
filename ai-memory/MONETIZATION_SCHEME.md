# Monetization Scheme — AyaIlmu

Budget: ≤ 20 KB. Prices are **defaults until Umar confirms** (OPEN). Status stamps as elsewhere. Nothing here is marketed until the matching feature is RELEASED.

## Model (DECIDED 2026-10-16): freemium + one-time lifetime unlocks, no ads, no server

Why this model fits the constraints:
- **No backend.** Play Billing stores the purchase, verifies the account, restores on reinstall and across the user's devices. The app only asks Play "what does this account own?" (CR-BIL-2) and caches the answer for offline (CR-BIL-3).
- **Kids + adults.** No ads means no Families ad-SDK certification, no age-based ad personalisation logic, no interstitial rules to police. One-time purchases are the least manipulative monetisation Play allows for children; the store sits behind an adult gate on Anak profiles (CR-BIL-5).
- **Indonesian market.** "Bayar sekali, milik selamanya, bisa offline" is a strong, honest pitch where subscriptions churn and data plans are metered. Pending payments (Indomaret/Alfamart, bank transfer) are supported by Play and handled by CR-BIL-1.
- **Solo founder.** No entitlement server, no receipt-validation endpoint, no webhook, no subscription-state machine to maintain.

## Products (PLANNED 2026-10-16) — all `INAPP` non-consumable

| Product ID | Unlocks | Default price (IDR) | Notes |
|---|---|---|---|
| `pack_bahasa_lifetime` | All Bahasa tracks (Arab first; later tracks included) | 79.000 | Includes the full Arabic course as units are approved |
| `pack_matematika_lifetime` | All Matematika tracks | 59.000 | |
| `pack_sains_lifetime` | All Sains tracks | 59.000 | |
| `pack_sosial_seni_lifetime` | All Sosial & Seni tracks | 59.000 | |
| `all_access_lifetime` | Everything, current and future tracks | 149.000 | Anchor: cheaper than any three packs |
| `all_access_upgrade` (OPEN) | All-access for owners of ≥ 1 pack | 99.000 | Only if Play's one-time product offers make it clean; otherwise skip |

Rules: product IDs never change once live; a pack's scope only grows. Prices are set in Play Console in IDR with Play's local price templates for other countries; the app always shows Play's formatted price (CR-BIL-5). Consider a launch-window price (Play "one-time product offers") rather than permanent discounts.

## Free tier (PLANNED 2026-10-16)

- Every subject: first track's first unit(s) free, plus the daily session always works with free content, so a free learner never hits a dead screen.
- Arabic: entry check + Unit A free; Unit B onward in the pack. (Closed-test testers get everything via a tester flag, not a purchase.)
- Locked content is visible and previewable (one item), labelled plainly "Termasuk dalam Paket Bahasa", no countdowns, no lock-shaking animations.
- Free users keep all progress and stickers forever; nothing is taken away.

## What paying never buys (DECIDED 2026-10-16)

Streak repair, extra lives, hints, skipping review, cosmetic currency, or anything that changes learning rules. Money buys *more content*, nothing else. This keeps the Families review simple and the app honest.

## Revenue mechanics and obligations

- Play service fee: 15 % on the first USD 1M/year once enrolled in the reduced-fee tier (enrol before launch; confirm current terms in Play Console). 30 % otherwise.
- Taxes: Google collects and remits Indonesian PPN on Play purchases as merchant of record — confirm in Play Console → Payments profile → Tax; Petalytix still books the payout as revenue. Not tax advice; confirm with the accountant.
- Refunds: Play's 48-hour self-service refund revokes the purchase; `queryPurchasesAsync` will stop returning it, entitlement drops on next online start (CR-BIL-3). No manual handling.
- Payout account: Petalytix's existing Play merchant profile (same as AyaKasir).

## Store listing hooks (PLANNED)

"Belajar 10 menit sehari — bahasa, matematika, sains, sosial & seni. Untuk anak dan dewasa. Bayar sekali, tanpa iklan, tanpa akun, bisa offline, data tetap di HP kamu." Screenshots must show the hand-made illustrations (ART_DIRECTION.md), never UI-only mockups.

## Later options (not planned; listed so they are not re-debated from scratch)

- Subscription "AyaIlmu Plus" only if content cadence becomes monthly and users ask; still server-free with Play Billing subscriptions.
- School / TPA bundles via Play "managed Google Play" or offline licence codes — needs at least a static licence list, revisit after M6.
- Play Pass enrolment — free exposure, Google pays by engagement; apply after production release.
- Cross-promo inside AyaKasir (Aya character shared) — no cost, after M6.

## Metrics we can measure without analytics

Play Console gives installs, conversion to purchase per product, refunds, Android Vitals, and country split. In-app we store nothing about money beyond the entitlement cache. If a funnel question ever needs more, the answer is a short in-app survey exported with the learner's consent (CR-DAT-4), not a tracker.
