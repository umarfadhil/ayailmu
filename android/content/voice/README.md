# Voice scripts and pronunciation clips

Contract: `docs/content/INTERACTIONS_AUDIO.md` §3.1. Decision (Umar, 2026-10-18): pronunciation clips come from
**ElevenLabs**, generated ahead of time on Umar's machine and **bundled in the APK**. The app has no ElevenLabs SDK,
no network call and no key. A clip that is not bundled yet simply hides its listening item and speaker button, so
packs stay playable without audio.

## What is in this folder

| File | Who writes it | What |
|---|---|---|
| `<lang>.json` (`en`, `ko`, `ja`, `zh`, …) | pack authors | The voice script: every clip key a pack uses and the exact text to speak. |
| `voices.json` | Umar | The ElevenLabs model, output format, voice settings and **one voice id per language**. |
| `README.md` | — | This file. |

Voice script format (one file per language, the file name is the language):

```json
{"lang": "ko", "clips": [{"key": "ko/sagwa", "text": "사과", "note": "apple"}]}
```

- `key` = `<lang>/<slug>`, matching `^[a-z]{2}/[a-z0-9_]+$`: lower-case ASCII romanization, `_` between words
  (`zh/ni_hao`, `ja/konnichiwa`, `en/youre_welcome`). One key = one spoken text, reused by every item and both
  audiences. The same key twice with two different texts is refused.
- `text` = exactly what must be spoken, in the target script. Japanese: write kana where a kanji could be read two
  ways. Punctuation shapes the delivery ("Yes, please." sounds finished; "yes" may sound clipped).
- `note` = a short hint for the reviewer (meaning, register).

Output, written by the tool (commit both):

- `android/content/src/main/assets/audio/<lang>/<slug>.mp3` — mono, 22.05 kHz, 32 kbps (`mp3_22050_32`).
- `android/content/src/main/assets/audio/index.json` — `{"clips": {"ko/sagwa": "<fingerprint>"}}`. The app reads only
  the keys: a key listed here has its mp3 in the APK. Keep `.mp3` uncompressed in the APK (the default), the player
  opens it by file descriptor.

## 1. Pick the voices (once)

1. In ElevenLabs, open the **Voice Library** and filter by language and accent.
2. Choose **one natural adult voice per language**: friendly, clear, unhurried, standard accent (Seoul Korean, Tokyo
   Japanese, Putonghua Mandarin, neutral international English, standard Indonesian). **The same voice serves the kids
   and the adults packs.** No cartoon or "kid" voices, no whispery or dramatic ones.
3. Try 5 of our real words in that voice first (include a tricky one per language: a kanji-only Japanese word, a
   Mandarin word whose tones matter, a Korean word with a final consonant).
4. Add the voice to **My Voices**, copy its **Voice ID**, and put it in `voices.json` with the voice's name and a
   short note. Check the voice's sharing terms: a library voice its owner removes can no longer be used to make new
   clips (the clips already made stay in the app). Write the chosen voice ids down somewhere outside the repo too.

`voices.json` fields: `model_id`, `output_format`, `voice_settings` (sent with every request) and `voices.<lang>` with
`voice_id`, `name`, `note`. Optional per language: `voice_settings` (merged over the global ones), `model_id`,
`language_code` (default: the clip's language prefix). `send_language_code: false` turns language enforcement off.

## 2. Run it on Windows

Install Python 3 from python.org (tick "py launcher"); nothing else to install, the tool uses the standard library
only. Open **PowerShell** in the repository folder.

```powershell
py android\tools\voice_gen.py --dry-run          # what would be generated, per language, and the character total
$env:ELEVENLABS_API_KEY = "paste-your-key-here"  # this PowerShell window only; gone when you close it
py android\tools\voice_gen.py --only ko/sagwa,ja/ringo,zh/pingguo   # a small pilot first: listen to these
py android\tools\voice_gen.py --lang ko          # then one language at a time
py android\tools\voice_gen.py --check            # scripts vs files vs index; exit code 1 if anything is off
```

The key is read **only** from `ELEVENLABS_API_KEY`. The tool never prints, logs or writes it. Never paste it into a
file in this repository, a script or a chat. (`setx` would store it in your Windows user profile permanently; the
one-window `$env:` form above is safer.) On macOS/Linux use `python3` and `export ELEVENLABS_API_KEY=...`.

What a run does: for each clip it computes a fingerprint, `sha1(text + voice_id + model_id + json(voice_settings))`
(the settings as compact JSON with sorted keys). A clip whose mp3 exists and whose index entry equals that fingerprint
is skipped, so re-running costs nothing. Changing a clip's text, the language's voice, the model or the settings makes
exactly the affected clips regenerate. The index is rewritten (sorted, atomically) after **every** clip, so a run that
is interrupted (closed window, no credits, network gone) keeps everything it already paid for; just run it again.

| Flag | Meaning |
|---|---|
| `--dry-run` | List what would be generated, why (`new`, `changed`, `file missing`, `forced`), per-language counts and the total characters. No key needed, no request sent. |
| `--lang ko` / `--lang ko,ja` | Only these languages. |
| `--only ko/sagwa,ko/apa` | Only these clips. |
| `--force` | Generate the selected clips even if they are up to date (a new take). |
| `--check` | Report clips in scripts without files, files without scripts, index entries without files, files missing from the index, invalid keys, script problems; warn about stale clips and missing voice ids. Exit 1 on problems. |
| `--delay 0.5` | Seconds between requests (default 0.5). |
| `--retries 5`, `--backoff 2` | Retries on 429/5xx/network errors, waiting 2, 4, 8 … s (or the server's `Retry-After`). |
| `--timeout 60` | Seconds to wait for one answer. |
| `--root`, `--api-base` | For tests only: another repository root; a local fake server (`http://localhost…`; plain http is refused for any other host). |

Exit codes: 0 done; 1 some clips failed or have no voice id (or `--check` found problems); 2 voice scripts need
fixing or no key; 3 stopped because ElevenLabs refused the key (401), the plan or credits (402/403) or the voice or
model (404). A 400/422 for one clip (for example text it will not read) fails that clip only and the run goes on.

## 3. Review and fixing one clip

**Every clip must be listened to by a native speaker before release** (the `note` field tells them what the word
means). Wrong tone, wrong reading or an odd stress is a release blocker for a language course.

- A bad take (mumbled, clipped, odd intonation): `py android\tools\voice_gen.py --only ko/sagwa --force` — every
  request is a new take.
- The voice reads the text wrongly (a kanji read the Chinese way, a number spelled out): fix the `text` in the voice
  script (kana instead of kanji, the number in words, punctuation); the changed text regenerates that clip on the
  next run.
- The voice is wrong for the whole language: change its `voice_id` in `voices.json`; all clips of that language
  regenerate on the next run (check the character count with `--dry-run` first).
- Then `--check`, and commit the mp3 files together with `index.json`.

## 4. Licence and billing (Umar to confirm)

- **Clips used in a commercial app need a paid ElevenLabs plan whose terms cover commercial use of the output.**
  Check the current terms and the plan before the first real run, and keep a record (plan, date, account) with the
  release documents. Do not ship clips made on the free plan (it has not included a commercial licence).
- ElevenLabs bills by **characters of text**. Today's English script is 180 clips / 1,703 characters (`--dry-run`); the
  four languages together will be a few thousand characters. Check the per-model credit rate on the pricing page.
- `ai-memory/ART_DIRECTION.md` §6 says "no AI-generated video or voice"; the pronunciation clips are the explicit
  exception Umar decided on 2026-10-18 (INTERACTIONS_AUDIO.md). Narration and characters stay human.

## 5. API facts this tool relies on (checked 2026-10-18)

From the official documentation at elevenlabs.io/docs:

- **Endpoint**: `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}`; auth header **`xi-api-key`**;
  `Content-Type: application/json`; the answer is the audio file. Source: API reference "Create speech",
  <https://elevenlabs.io/docs/api-reference/text-to-speech/convert>.
- **Query `output_format`**: `codec_samplerate_bitrate`, default `mp3_44100_128`; `mp3_22050_32` is a listed value
  (22.05 kHz, 32 kbps — our contract). (192 kbps MP3 needs Creator+, 44.1 kHz PCM/WAV needs Pro+.)
- **Body**: `text` (required); `model_id` (default `eleven_multilingual_v2`); `language_code` (ISO 639-1, "enforces a
  language for the model and text normalization"; ignored by models that do not support it, and **"not supported for
  multilingual_v2 models"**); `voice_settings` overriding the voice's stored settings for this request:
  `stability` (default 0.5), `similarity_boost` (0.75), `style` (0), `use_speaker_boost` (true), `speed` (1.0). Also
  `seed`, `previous_text`/`next_text`, `apply_text_normalization`, and more we do not use.
- **Models** (<https://elevenlabs.io/docs/overview/models>): `eleven_v4` (newest, highest quality, 90+ languages
  including Indonesian, Korean, Japanese and Mandarin; the `language_code` note is given for the v4, v4 Turbo, v3
  and v3 Conversational families), `eleven_multilingual_v2` (29 languages, all five of ours; stable; no
  `language_code`), `eleven_flash_v2_5` (32 languages, fastest, about half the price per character; the docs do not
  mention `language_code` for it). The Eleven v4 page
  (<https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4>) says **Style and Speed are not
  available in Eleven v4**; the v4 product page (<https://elevenlabs.io/v4>) shows `eleven_v4` used with the
  text-to-speech convert call. v4 was announced in the changelog of 2026-09-28.
- **Errors** (<https://elevenlabs.io/docs/eleven-api/resources/errors>): JSON body `{"detail": {"type", "code",
  "message", …}}`; 401 `authentication_error` (`invalid_api_key`…), 402 `insufficient_credits`, 403
  (`model_access_denied`, `voice_access_denied`…), 404 (`voice_not_found`, `model_not_found`), 400/422 validation,
  429 `rate_limit_exceeded` / `concurrent_limit_exceeded` / `system_busy` (use exponential backoff), 500/503.

**Default chosen: `eleven_v4`** with `stability 0.5`, `similarity_boost 0.75` (the documented defaults, pinned so a
voice's own stored settings cannot drift the clips) and `language_code` = the clip's language. Why: best quality,
all five languages, and language enforcement matters for one-word clips — a kanji-only Japanese word or a short
hanzi word can otherwise be read in the wrong language. Caveats: v4 is weeks old, and nobody has heard our words in
it yet. **Run the pilot first.** If short words come out unstable or odd, set `"model_id": "eleven_multilingual_v2"`
(the tool then leaves `language_code` out automatically; you may add `"speed": 0.9` to `voice_settings` for slightly
slower words, which v4 does not support) and regenerate. The tool keeps every field configurable, so a model the
docs list later needs only a `voices.json` edit.
