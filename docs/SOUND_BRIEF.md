# Sound-effects brief (AyaIlmu)

Status: **the 11 files in the app are Claude-made DRAFTS (2026-10-18).** They were synthesised from code by
`art/sound/make_sfx.py` (numpy + ffmpeg: small models of a marimba bar, a kalimba tine, a wood block, a pencil on
paper and a page, in one small room; no AI generator, no samples). They work and they are clean, but nobody has
listened to them on a phone with children yet. This brief is for the human sound designer who replaces them, under
the same file names. Contract: `docs/content/INTERACTIONS_AUDIO.md` §3.2. Visual standard whose spirit applies here:
`ai-memory/ART_DIRECTION.md` (hand-made, calm, warm, never "app-slop").

| Field | Value |
|---|---|
| Client | Petalytix (PT Petalytix Teknologi Indonesia), for the AyaIlmu Android app |
| Audience | Indonesian kids 7–12 and adults, learning side by side; a quiet room, a bus, a classroom |
| Deliverable | 11 Ogg Vorbis files (names below) + 24-bit WAV masters + your project/session files |
| Fee and rights | agreed fee; full commercial rights in the delivered sounds and sources transfer to Petalytix (confirm in the contract) |
| Contact | Umar (umar@petalytix.id) |

## 1. The idea in one line

**One small set of real, warm, wooden things on a desk**: a marimba, a kalimba, a wood block, paper and a soft
pencil. Every sound could have been played by a person sitting next to the learner. Quiet enough to be used all
day; never the loudest thing on the phone.

Mood words for the whole set: **calm, warm, kind, tactile, small**.

## 2. The sounds

Durations are maximums for the whole file. "Draft" is what is in the app now (measured on the decoded Ogg).

| File (`res/raw/`) | Plays when | Max | Mood | What the draft is | Draft: length / size / peak / loudness |
|---|---|---|---|---|---|
| `sfx_tap.ogg` | a card is selected (tap, then tap) | 80 ms | light, precise | a tiny dry wood tick (D6) | 76 ms / 4.8 KB / −6.2 dBFS / −30.9 LUFS |
| `sfx_pick.ogg` | a card is lifted to drag | 80 ms | light, airy | a softer tick (G6) + a breath of paper leaving the table | 78 ms / 5.1 KB / −8.4 / −32.1 |
| `sfx_drop.ogg` | a card is dropped outside any target and slides back | 600 ms | soft, no blame | a short paper slide, then a muted low wood thud (A4) | 312 ms / 7.2 KB / −6.3 / −27.5 |
| `sfx_snap.ogg` | a card settles into a slot or basket | 600 ms | satisfying, settled | a soft wooden knock (C5) and a tiny second settle | 212 ms / 6.1 KB / −3.5 / −26.9 |
| `sfx_connect.ogg` | a pencil line joins two cards | 600 ms | gentle, deliberate | a soft pencil stroke (~220 ms) ending on a quiet wood tick (E6) | 312 ms / 7.4 KB / −12.9 / −29.3 |
| `sfx_correct.ogg` | an answer is correct | 600 ms | bright but soft, warm | marimba C5 → G5 (rising fifth), medium mallets | 572 ms / 8.8 KB / −8.2 / −22.0 |
| `sfx_not_yet.ogg` | an answer is not right yet | 600 ms | kind, "hmm, try again" | marimba C5 → A4 (falling minor third), yarn mallets, short ring — the mirror of `sfx_correct` | 582 ms / 9.0 KB / −13.3 / −24.9 |
| `sfx_stroke.ogg` | one trace stroke is done | 600 ms | light, encouraging | a short, light pencil stroke | 202 ms / 6.2 KB / −14.2 / −30.2 |
| `sfx_sticker.ogg` | a sticker is earned | 600 ms | small delight | kalimba G5–C6–E6 going up, then two tiny high tines (C7, G7) | 597 ms / 9.3 KB / −10.9 / −22.9 |
| `sfx_session_done.ogg` | the session summary appears | **900 ms** | warm, "well done, rest now" | marimba G4–C5–D5–E5 (slight ritardando), a soft low C under the last note, a faint kalimba glint | 897 ms / 11.3 KB / −8.5 / −21.9 |
| `sfx_page.ogg` | a lesson screen turns | 600 ms | papery, unhurried | a book page: small crinkle as it lifts, the swish, a soft landing | 462 ms / 9.6 KB / −10.2 / −26.3 |

Pitch family: **C major pentatonic** (C D E G A) for everything with a pitch, so any two sounds that overlap
(up to 4 play at once) never clash. Keep one key family in your set too; you may move it (for example to D), but move
all of it.

## 3. Loudness and technical targets

The app plays every effect at full sample volume through `SoundPool` on the media stream (`USAGE_GAME`), so **the
file's level is the level the learner hears**, scaled only by the phone's media volume. Voice clips (ElevenLabs
pronunciation words) play on the same stream; the effects must sit *under* them.

| Group | Sounds | Loudness target (momentary max, BS.1770 K-weighted, 400 ms) |
|---|---|---|
| Feedback | `sfx_correct`, `sfx_sticker`, `sfx_session_done` | −22 LUFS ±1 |
| Not yet | `sfx_not_yet` | −25 LUFS ±1 (a little under `sfx_correct`, never louder) |
| Objects | `sfx_snap`, `sfx_drop`, `sfx_page` | −26 to −28 LUFS |
| Pencil | `sfx_connect`, `sfx_stroke` | −29 to −30 LUFS |
| Ticks | `sfx_tap`, `sfx_pick` | −31 to −32 LUFS (the quietest; they happen most) |

Measure the momentary maximum with the file padded by silence to at least 400 ms (any BS.1770 meter does this when
the clip is in an empty session). Then check by ear **on a phone speaker** at half media volume: nothing below about
400 Hz survives there, so each sound's identity must live in roughly 500 Hz–5 kHz. The drafts' `sfx_drop` and
`sfx_not_yet` are about 6 dB quieter on a phone than on headphones; that is acceptable, but no quieter.

Every file:

- **Ogg Vorbis, mono, 44.1 kHz** (22.05 kHz is fine for the ticks and the wooden sounds), **≤ 25 KB**.
- **≤ 600 ms** (ticks ≤ 80 ms, `sfx_session_done` ≤ 900 ms). Shorter is better.
- **Sample peak ≤ −3 dBFS after encoding** (decode the Ogg and measure; Vorbis can overshoot the WAV by a few tenths
  of a dB).
- **Starts at once**: at most ~5 ms before the attack (the drafts have 2 ms of silence, then a 3 ms fade-in). A 2–5 ms
  fade-in on the first sound, no click.
- **Ends on silence**: a smooth fade to zero, then ~10 ms of digital silence so the codec's block smear lands on
  silence, not on a cut. No click at either end.
- **No DC offset** (high-pass at ~35 Hz), **no clipping**, no dithering noise floor you can hear, no reverb tail
  cut off.
- Ogg pages: encode so the file has several pages (ffmpeg `-page_duration 20000`) — with a single page, some
  decoders trim the start instead of the end and eat the fade-in. Standard `oggenc` output is fine too.

## 4. Must avoid (the anti-slop list for sound)

- Casino / slot-machine jingles, coin sounds, "level up" fanfares, cash registers.
- Laser, sci-fi zaps, synth risers, whooshes with pitch sweeps, glitch effects.
- Cartoon "boing", slide-whistles, kazoos, squeaks, rubber-ball bounces.
- Buzzers, error beeps, game-show "wrong" sounds, anything that says *you failed*. `sfx_not_yet` is an invitation.
- Applause, crowds, cheering kids, laughter, any voice or vocal sound (no "yay", no "oops", no humming).
- Generic "magic sparkle" chimes, wind chimes, harp glissandi, reversed cymbals.
- Pure sine beeps, square-wave chiptune, phone-UI clones (no sound that resembles a well-known OS or app sound).
- Heavy reverb, stereo width tricks, sub-bass thumps, compression pumping.
- Anything made with an AI audio generator, and any sample whose licence you cannot show (§5).

## 5. Families-safe and rights

The app follows the Google Play Families policy (mixed audience: children and adults) and is used by children:

- Nothing startling: no sudden loud transients, nothing scary, no alarms, nothing that imitates a siren, a phone
  ring or a notification.
- Your own recordings or synthesis, or samples whose licence allows redistribution inside a commercial app
  (state the source and licence for each in your delivery note). No AI audio generators.
- No recognisable melodies, jingles or brands. Nothing with words in any language.
- The learner can switch all effects off: Settings → «Efek suara / Sound effects» (on by default, per phone). The
  app must still make sense with sound off, so no sound may carry meaning that is not also on screen.

## 6. Deliverables and naming

1. The 11 Ogg files, named **exactly** as in §2 (lower case, underscores; Android resource names). They replace the
   drafts in `android/core/design/src/main/res/raw/` one for one. Do not add or rename files: the app's code
   (`Sfx` enum, `SoundPoolSoundFx`) maps each key to `R.raw.<key>`.
2. 24-bit WAV masters (48 or 44.1 kHz, mono) of the same 11 sounds, same names, for `art/sound/masters/`.
3. Your session/project files and a short delivery note: per file, the measured length, size, peak and loudness
   (the table in §2 is the format), and the source/licence of any sample used.
4. Optional, later: 2–3 variations of `sfx_tap`, `sfx_snap` and `sfx_correct` (they play most often). The app plays
   one file per key today; variations need a small code change, so deliver them as `sfx_correct_2.ogg` etc. in a
   separate folder and say so.

The drafts stay reproducible as a reference: `python3 art/sound/make_sfx.py` (Python 3 + numpy + ffmpeg with
libvorbis) rebuilds them, prints the table above, and `--wav DIR` keeps the WAVs to compare against.

## 7. How to test in the app

1. Build a debug APK with your files in `android/core/design/src/main/res/raw/` (or send the files to Umar).
2. On a phone, Settings → **«Efek suara»** on (the default). Media volume at about half.
3. Open a lesson: page turns (`sfx_page`). In practice, a `match_pairs` item: tap a card (`sfx_tap`), draw a line to its
   partner (`sfx_connect`); in drag mode, lift (`sfx_pick`), drop outside (`sfx_drop`), drop into a slot (`sfx_snap`).
   Answer right (`sfx_correct`) and wrong (`sfx_not_yet`). A `trace` item gives `sfx_stroke` per stroke. Finishing a
   unit earns a sticker (`sfx_sticker`); the end of every session shows the summary (`sfx_session_done`).
4. Listen on the phone speaker **and** on cheap earphones, with a pronunciation clip playing right after an effect:
   the word must stay clearly on top.
5. Play one session of 15 answers in a row. If any sound is tiring by the end, it is too loud, too bright or too long.
6. Switch «Efek suara» off and check that the session is silent except for the pronunciation clips.

## 8. What to redo first

1. **`sfx_connect`, `sfx_stroke` and `sfx_page`.** Filtered-noise models of pencil and paper are the weakest part of the
   drafts: they read as "paper" but a close-miked real pencil (soft 2B on drawing paper) and a real book page will
   be far warmer and more specific. Record these as foley.
2. **`sfx_not_yet`.** The most emotionally sensitive sound in the app. It must feel like a kind teacher's "hmm, try
   again". Test it with a few children; if anyone flinches or frowns, it is wrong.
3. **`sfx_correct` and `sfx_session_done`.** Heard most often and most remembered; a real marimba (soft rubber or
   yarn mallets, close mic, small room) will beat the model. Keep the rising-fifth / landing-on-the-third shapes or
   propose better ones within the same key.
4. The ticks (`sfx_tap`, `sfx_pick`, `sfx_snap`, `sfx_drop`) are serviceable; replace them last, ideally from the same
   wood block recording session so the set stays one instrument family.
