# Bahasa Jepang / Japanese — Menengah, Mahir, Master starters (kids + adults)

**Status:** DRAFT 2026-10-18 (follow-up 12), written for review. Not reviewed by a native speaker yet. Six starter
packs of **2 units each** (~15 items per unit incl. REMED, 1 gem, 1 daily puzzle, 30 items per pack):

| Track | Pack | Level | Audience | Prefix | Content version |
|---|---|---|---|---|---|
| `jpn-k-m` | `packs/bahasa/jpn-k-m/v1.json` | Menengah | kids | `JPN-K-M-<unit>-<nnn>` | `jpn-k-m-0.1` |
| `jpn-a-m` | `packs/bahasa/jpn-a-m/v1.json` | Menengah | adults | `JPN-A-M-…` | `jpn-a-m-0.1` |
| `jpn-k-h` | `packs/bahasa/jpn-k-h/v1.json` | Mahir | kids | `JPN-K-H-…` | `jpn-k-h-0.1` |
| `jpn-a-h` | `packs/bahasa/jpn-a-h/v1.json` | Mahir | adults | `JPN-A-H-…` | `jpn-a-h-0.1` |
| `jpn-k-x` | `packs/bahasa/jpn-k-x/v1.json` | Master | kids | `JPN-K-X-…` | `jpn-k-x-0.1` |
| `jpn-a-x` | `packs/bahasa/jpn-a-x/v1.json` | Master | adults | `JPN-A-X-…` | `jpn-a-x-0.1` |

Every item `review_status: draft`, `level` = the pack level, pack meta `"level"`. Rules
`config/rules.<track>.json` (copies of `rules.jpn-k` / `rules.jpn-a`; Mahir and Master `items_per_minute` 1.3
instead of 1.2). Voice script for the new clips: `android/content/voice/ja.levels.json` (keys already in `ja.json`
are reused, never repeated). Generator (deterministic) and checker: session scratchpad `fu12/ja/pack_levels.py`,
`jbuilder12.py`, `check.py`. Contracts: `docs/content/MODULES_LEVELS_STORIES.md` (levels, tracks, art keys §6,
picture rule §8), `docs/content/INTERACTIONS_AUDIO.md` (picture-first, gestures, clips, romanization, answer
leaks). Builds on `ja_pemula.md` (46 hiragana, ~80 words, これは〜です, 〜が すき, 〜を ください, 〜で いきます).

Catalog lines (to register; unit 01 free):

```json
{"track": "jpn-k-m", "pack": "packs/bahasa/jpn-k-m/v1.json", "rules": "config/rules.jpn-k-m.json", "free_units": ["01"]},
{"track": "jpn-a-m", "pack": "packs/bahasa/jpn-a-m/v1.json", "rules": "config/rules.jpn-a-m.json", "free_units": ["01"]},
{"track": "jpn-k-h", "pack": "packs/bahasa/jpn-k-h/v1.json", "rules": "config/rules.jpn-k-h.json", "free_units": ["01"]},
{"track": "jpn-a-h", "pack": "packs/bahasa/jpn-a-h/v1.json", "rules": "config/rules.jpn-a-h.json", "free_units": ["01"]},
{"track": "jpn-k-x", "pack": "packs/bahasa/jpn-k-x/v1.json", "rules": "config/rules.jpn-k-x.json", "free_units": ["01"]},
{"track": "jpn-a-x", "pack": "packs/bahasa/jpn-a-x/v1.json", "rules": "config/rules.jpn-a-x.json", "free_units": ["01"]}
```

## 1. Level ladder

| Level | Kids (7–12) | Adults (16+) |
|---|---|---|
| Pemula (written) | 46 hiragana (traced), greetings, numbers, family, food, animals & things | 46 hiragana, self-introduction, numbers, family, ordering food, asking the way |
| **Menengah** | 01 Time & my day (〜じ, 〜じはん, daily 〜ます verbs) · 02 Shopping & counting (〜つ 1–5, 〜えん, 〜を ください, katakana loanwords) | 01 Time & daily routine (〜時, 〜時半, 〜に + verb, question か) · 02 Shopping & counters (〜つ 1–10, prices to 万, 〜枚/〜本, clothes, この) |
| **Mahir** | 01 Directions & getting around (〜で いきます, あるいて, みぎ/ひだり/まっすぐ, まがります) · 02 Weather, seasons & yesterday (〜ました, でした) | 01 Directions & transport (曲がります, 乗ります/降ります, まで, どうやって) · 02 Weather, seasons & the past (〜ました, 〜ませんでした, でした) |
| **Master** | 01 Hobbies & likes (〜が すきです, だいすき, すきじゃない, a 3-line chat) · 02 Feelings & describing (い-adjectives, casual feelings, 〜は 〜です) | 01 Polite requests (て-form + ください, 〜ても いいですか, 少々 お待ち ください) · 02 Opinions & conversations (〜と 思います, だと, polite disagreement) |

Kids levels follow SD phases (Menengah ≈ kelas 3–4: everyday independence; Mahir ≈ kelas 5–6: reasoning, sorting
by a rule, past tense; Master: nuance — register, negation, choosing replies). Adult levels follow real-life use
(routine and shopping → getting around and small talk about the weekend → requests, permission and opinions at
work, in shops and at the station). Script work continues inside the themes: dakuten ゛ (くじ, まっすぐ, へび),
small っ (みっつ, まっすぐ, 切符), small ゃゅょ inside words (ひゃく, じゅう, ちょうちょ); trace data exists only for
the 46 hiragana, so these levels have **no trace items**.

## 2. Conventions (same as Pemula unless stated)

| | Kids | Adults |
|---|---|---|
| Script | Hiragana; **katakana from Menengah for loanwords** (テレビ, バナナ, サッカー), always with romaji, never traced or tested as reading; **no kanji anywhere** (also not in sources) | Kanji always with its reading in full-width brackets: `七時（しちじ）`, `朝（あさ）ご飯（はん）`; katakana loanwords freely |
| Romaji | On every Japanese card and question (except reading tests) | Only on what is **new at this level**: a display text already shown in `jpn-a` Pemula or a lower adult level loses its romaji (e.g. バス, 駅（えき）, いらっしゃいませ。); the word cards of one item are all-or-none, so a lone review card never stands out |
| Instruction | `id`, `en`; "kamu", "aku" | `id`, `en`; "Anda", "saya" |

- **Romanization:** modified Hepburn with macrons (gakkō, kūkō, sakkā, ōkii, chōcho); long i stays `ii`
  (chiisai, ii desu ne); particles は `wa`, を `o`, へ `e`; ん before a vowel is not needed here; counters written
  apart: `shichiji han`, `sanbyaku en`, `-mai`, `-hon`. Sentences start with a capital and end with `.`/`?`/`!`.
- **Clip keys:** `ja/` + slug (macron vowels doubled): `ja/shichiji`, `ja/kuukoo_made_ikura_desu_ka`. Clip text
  = the kana actually spoken, no spaces; questions end in ？. The particle cards reuse the Pemula clips (を → `ja/o`
  "お", は → `ja/wa` "わ", に, で, か, と). One exception to "kana only": **`ja/ame` is written 雨** so the voice
  does not read あめ "candy" (README: write kana unless the kana could be read two ways). The adult display and the
  kids' kana of the same word share one key (七時（しちじ） and しちじ → `ja/shichiji`).
- **Answer leaks:** `audio_match` options are pictures (clocks, arrows, scenes) or instruction-language text
  (meanings, prices), never Japanese cards; picture cards never carry a speaker; reading tests (kana-tile spelling:
  くじ, みっつ, まっすぐ, へび) carry no romaji or speaker on the tiles, and show the picture plus the romaji in a help line.
- **Grammar-trap puzzle:** the adult Master puzzle shows two wrong て-forms (行いて, 行きて); none of its three
  cards has a speaker, so a wrong form is never recorded.
- **Picture first** (INTERACTIONS §1): 83–100 % of PRACT items show a picture or are listening items (table §6);
  every other PRACT item is a drag/connect gesture. Text-only cards remain only for numbers/prices, grammar forms
  (ます↔ました, ます↔て, opposites, request/permission and agree/disagree sorts) and dialogue lines (MODULES §8).
- **Prompts** (≤ 6 words): Pemula set + `P-LISTEN-CLOCK` «Dengar, lalu ketuk jamnya.», `P-LISTEN-ARROW`
  «Dengar, lalu ketuk arahnya.», `P-LISTEN-PRICE` «Dengar, lalu pilih harganya.», `P-MATCH-PIC` «Cocok dengan
  gambarnya?» (true_false), `P-POLITE` «Pilih yang paling sopan.» (adults).

## 3. Skills

Every skill has 1–2 REMED items that need no audio and count as evidence (pick_image, fill_blank, match_pairs,
choose — never audio_match, memory_flip or trace), at least one scored PRACT item visible without clips, and each
unit keeps ≥ 8 PRACT items when every listening item is hidden.

| Pack | Unit | Skill | "Bisa / Got it" means |
|---|---|---|---|
| k-m | 01 | `JPN-TIME` | Reads and hears 〜じ, 〜じはん; よじ, しちじ, くじ; answers いま なんじですか |
| k-m | 01 | `JPN-ROUTINE` | おきます, ねます, はを みがきます, あさごはんを たべます, がっこうに いきます, シャワーを あびます, テレビを みます, べんきょうします, うちに かえります; orders a day |
| k-m | 02 | `JPN-COUNT` | ひとつ–いつつ (reads みっつ with small っ); ひゃく/にひゃく/さんびゃく/ごひゃく えん |
| k-m | 02 | `JPN-SHOP` | 〜を ください, いくらですか (vs いくつ), くだもの / のみもの, katakana food words |
| a-m | 01 | `JPN-TIME` | 〜時, 〜時半 (四時 よじ, 七時 しちじ, 九時 くじ), 今 何時ですか, 何時に 〜ますか |
| a-m | 01 | `JPN-ROUTINE` | Daily verbs in kanji with readings, time + に + verb, a workday in order |
| a-m | 02 | `JPN-COUNT` | ひとつ–とお; 百・千・万 and the sound changes さんびゃく, ろっぴゃく, はっぴゃく, さんぜん; 〜枚 vs 〜本 |
| a-m | 02 | `JPN-SHOP` | Clothes (ズボン, スカート, ジャケット, 靴下, シャツ, めがね), この 〜を ください, 全部で いくらですか, a shop dialogue |
| k-h | 01 | `JPN-GO` | Vehicles, places, 〜で いきます vs あるいて いきます, のりもの / ばしょ |
| k-h | 01 | `JPN-DIR` | みぎ, ひだり, まっすぐ (reads it), しんごう, みぎに まがります, asking the way |
| k-h | 02 | `JPN-WEATHER` | はれ, あめ, くもり, ゆき, かぜ; four seasons; あつい / さむい |
| k-h | 02 | `JPN-PAST` | ます → ました, です → でした with きのう; picks the past answer |
| a-h | 01 | `JPN-DIR` | 右/左に 曲がります, まっすぐ 行きます, 信号を 左です, a 4-line directions exchange |
| a-h | 01 | `JPN-TRAVEL` | 銀行, 郵便局, 図書館, ホテル, 空港, 切符, 地図; 〜に 乗ります / 〜を 降ります, まで, どうやって |
| a-h | 02 | `JPN-WEATHER` | 晴れ, 曇り, 雨, 雪, 風, 台風; 春夏秋冬; 暑い / 寒い; 天気は どうでしたか |
| a-h | 02 | `JPN-PAST` | 〜ました, 〜ませんでした, でした; a weekend small-talk exchange |
| k-x | 01 | `JPN-HOBBY` | サッカー, ギター, ダンス, バドミントン, つり, しゃしん, おえかき, すいえい, うた |
| k-x | 01 | `JPN-LIKE` | 〜が すきです (が, not を), だいすき, すきじゃないです, なにが すきですか, わたしも + いっしょに しましょう |
| k-x | 02 | `JPN-FEEL` | うれしい, かなしい, つかれた, おなかが すいた (casual; polite forms on the screen), どうしたの？ |
| k-x | 02 | `JPN-DESCRIBE` | とら, かえる, かめ, ちょうちょ, へび; おおきい / ちいさい; 〜は 〜いです |
| a-x | 01 | `JPN-TE` | て-forms 待って, 書いて, 見て, 話して, 言って; 〜て ください |
| a-x | 01 | `JPN-REQUEST` | Requests vs permission (〜ても いいですか), replies (はい、どうぞ), register (少々 お待ち ください vs 待って) |
| a-x | 02 | `JPN-OPINION` | 〜と 思います: い-adjective + と, noun / な-adjective + だと; opposites 高い/安い … |
| a-x | 02 | `JPN-AGREE` | 私も そう 思います, どう 思いますか, polite disagreement (そうですね。でも、…), soft no (それは ちょっと…) |

## 4. Units and items

Item order in each unit: step 1 then step 2; REMED last; the gem closes unit 02. ★ = audio_match (hidden until
its clip exists).

### jpn-k-m — Menengah (kids)

**01 Jam & kegiatanku / Time & my day** (`sticker_leaf`). Screen: angka + じ; よじ/しちじ/くじ; ます verbs.
Items: drag routine pictures → phrases · ★ listen → tap the clock (しちじ vs 1:00, 4:00) · connect clocks ↔ よじ,
しちじ, くじ, じゅうじ · pick ねます · ★ listen → tap はを みがきます · build くじ from kana (じ vs し) · tiles
しちじ / に / おきます (+ねます) · fill ＿＿に ねます with an 8:30 clock (はちじはん) · memory 4 routine pictures ·
choose いま なんじですか → さんじです (3:00 clock) · ★ listen → tap 12:30 (vs 2:30, 12:00) · order Aya's day
(しちじ → はちじ → さんじ → くじ); REMED pick よじ, pick うちに かえります.

**02 Belanja & menghitung / Shopping & counting** (`sticker_mango`). Items: drag mangoes 1–4 → ひとつ–よっつ · ★
listen いつつ → 5 eggs · build みっつ (small っ vs ち) · pick バナナ · ★ listen ケーキ · sort pictures into くだもの /
のみもの · fill たまごを ＿＿ ください (2 eggs) · tiles バナナ / を / ください (+です) · connect ¥100–¥500 ↔
ひゃくえん, にひゃくえん, さんびゃくえん, ごひゃくえん · ★ listen いくらですか → meaning (vs "how many?") · order a
fruit-shop exchange · ★ listen ごひゃくえん → ¥500; REMED pick みっつ, fill ＿＿を ください (juice); gem: the 1-yen coin.

Puzzle: しちじ + 2 hours = くじ.

### jpn-a-m — Menengah (adults)

**01 Jam & rutinitas harian / Time & daily routine** (`sticker_drum`). Items: drag 起きます, シャワーを 浴びます,
朝ご飯を 食べます, 家に 帰ります · ★ listen 七時半 → clock · connect 四時, 七時, 九時, 十時半 ↔ clocks · ★ listen
歯を 磨きます · tiles 七時 / に / 起きます (+を) · pick 勉強します · fill 十一時に ＿＿ (寝ます) · choose 今 何時ですか →
三時半です · memory テレビを 見ます, 部屋を 片付けます, 服を 着ます, 学校に 行きます · ★ listen 何時に 寝ますか →
meaning · tiles 何時 / に / 帰ります / か · order Ms Sari's workday (6:30 → 7:00 → 8:00 会社 → 11:00); REMED fill
＿＿に 起きます (6:30 clock), pick 服を 着ます.

**02 Belanja & kata bilangan / Shopping & counters** (`sticker_shell`). Items: drag ズボン, スカート, ジャケット,
靴下 · ★ listen シャツ · connect eggs 4/5/6/8 ↔ よっつ, いつつ, むっつ, やっつ · connect ¥100/300/600/800 ↔ 百円,
三百円, 六百円, 八百円 · pick めがね · tiles この / シャツ / を / ください · fill 卵を ＿＿ ください (7 eggs) · ★
listen 全部で いくらですか → meaning · order a clothes-shop exchange (いらっしゃいませ → この ジャケットは
いくらですか → 五千円です → じゃあ、これを ください) · choose いくらですか with "¥3.000" → 三千円です (vs 三百円,
三万円) · ★ listen はっぴゃくえん → ¥800 (vs ¥600, ¥8.000) · sort pictures into 〜枚 / 〜本; REMED drag mangoes
2/3/9/10 → ふたつ, みっつ, ここのつ, とお, fill この ジャケットは ＿＿ですか (いくら); gem: tax-inclusive prices.

Puzzle: 三百円 + 五百円 = 800 (number pad).

### jpn-k-h — Mahir (kids)

**01 Arah & kendaraan / Directions & getting around** (`sticker_bicycle`). Items: drag でんしゃ, バス, じてんしゃ,
ひこうき · connect arrows ↔ ひだり, みぎ, まっすぐ · ★ listen みぎに まがります → arrow · tiles じてんしゃ / で /
いきます (+を) · pick としょかん · ★ listen ふね · fill ＿＿で がっこうに いきます (bus) · pick あるいて いきます ·
build まっすぐ (っ, ぐ vs く) · order すみません、えきは どこですか → まっすぐ いって、みぎです → ありがとうございます
· ★ listen しんごう · sort pictures into のりもの / ばしょ; REMED pick ひだり, fill ＿＿で いきます (train).

**02 Cuaca, musim & kemarin / Weather, seasons & yesterday** (`sticker_umbrella`). Items: drag はれ, あめ, くもり,
ゆき · connect はる (blossom), なつ (beach), あき (leaves), ふゆ (snowman) · ★ listen かぜ · sort pictures into
あつい / さむい (jacket goes to cold) · true/false きょうは はれです with a rain picture · tiles きのう / こうえん / に
/ いきました (+いきます) · fill きのう ゆきだるまを ＿＿ (つくりました vs つくります) · ★ listen きのうは あめでした →
meaning · connect いきます/たべます/みます ↔ ました forms · ★ listen うみで およぎました · pick さむい · choose
きのう なにを しましたか → テレビを みました (vs みます); REMED pick くもり, fill きのう ほんを ＿＿ (よみました);
gem: how the sakura opening is declared.

Puzzle: the season after なつ (あき).

### jpn-a-h — Mahir (adults)

**01 Arah & transportasi / Directions & transport** (`sticker_compass`). Items: drag 銀行, 郵便局, 図書館, ホテル ·
connect arrows ↔ 右に/左に 曲がります, まっすぐ 行きます · ★ listen 左に 曲がります → arrow · pick 切符 · tiles
空港 / まで / バス / で / 行きます (+を) · ★ listen 空港 · fill 次の 駅で 電車を ＿＿ (降ります; 乗ります takes に) ·
choose 駅まで どうやって 行きますか with a bicycle → 自転車で 行きます · order a post-office directions exchange
(4 lines, …信号を 左です, 遠いですか, 歩いて 五分ぐらいです) · memory スーツケース, 地図, レストラン, 信号 · ★ listen
空港まで いくらですか → meaning · ★ listen 銀行; REMED fill 信号を ＿＿に 曲がります (left arrow), fill ＿＿に
乗ります (bus).

**02 Cuaca, musim & masa lalu / Weather, seasons & the past** (`sticker_kite`). Items: drag 晴れ, 雨, 曇り, 雪 ·
connect 春夏秋冬 · ★ listen 台風 · sort pictures into 暑い / 寒い · tiles 昨日 / は / 雨 / でした (+です) · choose
天気は どうでしたか (cloud) → 曇りでした · fill 先週 京都で 紅葉を ＿＿ (見ました) · ★ listen 雪は 降りませんでした
→ meaning · connect 行きます, 見ます, 降ります, です ↔ past · ★ listen 海で 泳ぎました · order a Monday-morning
exchange (週末は 何を しましたか → 山に 登りました → 天気は どうでしたか → とても いい 天気でした) · ★ listen
風が 強いです; REMED pick 秋, fill 昨日 テレビを ＿＿; gem: typhoon numbers and names.

Puzzle: facing north, turn right twice → south.

### jpn-k-x — Master (kids)

**01 Hobi & kesukaan / Hobbies & likes** (`sticker_cat`). Items: drag サッカー, ギター, ダンス, バドミントン · ★
listen つり · tiles サッカー / が / すきです (+を) · memory しゃしん, おえかき, すいえい, うた · fill わたしは ＿＿が
すきです (guitar) · ★ listen バドミントン · choose なにが すきですか (drawing) → おえかきが すきです · ★ listen
サッカーは すきじゃないです → meaning · sort hobbies into いえの なか / そと · order a 3-line chat ending
わたしも すきです。いっしょに しましょう！ · pick うたを うたいます · ★ listen ギターが だいすきです; REMED fill
ダンス＿＿ すきです (が vs を, に), pick おえかき.

**02 Perasaan & menggambarkan / Feelings & describing** (`sticker_star_fruit`). Items: drag うれしい, かなしい,
つかれた, おなかが すいた · connect とら, かえる, かめ, ちょうちょ · ★ listen へび · sort animals into おおきい /
ちいさい · tiles ぞう / は / おおきいです (+ちいさいです) · pick かなしい · ★ listen おなかが すいた → meaning ·
choose どうしたの？ (tired) → ちょっと つかれた。 · fill ちょうちょは ＿＿です · ★ listen さむい · true/false
ぞうは ちいさいです (elephant) · build へび (び vs ひ); REMED pick うれしい, fill とらは ＿＿です; gem: Japanese
sound-and-feeling words.

Puzzle: riddle → かえる (frog; also "go home").

### jpn-a-x — Master (adults)

**01 Permintaan sopan / Polite requests** (`sticker_teapot`). Items: drag door/sit/write/window ↔ ドアを 閉めて,
座って, ここに 書いて, 窓を 開けて ください · connect 待ちます, 書きます, 見ます, 話します ↔ て-forms · ★ listen
もう 一度 言って ください → meaning · ★ listen 写真を 撮っても いいですか → camera · tiles ゆっくり / 話して /
ください (+話します), phone picture · fill 名前を ＿＿ ください (pen: 書いて) · pick あとで 電話して ください ·
order a shop exchange (この シャツを 見せて ください → はい、どうぞ → 試着しても いいですか → はい、こちらへ
どうぞ) · choose ここに 座っても いいですか → はい、どうぞ · ★ listen 窓を 開けて ください · sort phrases into
request / permission · most polite at reception: 少々 お待ち ください (vs 待って。, 待ちます。); REMED fill もう 一度
＿＿ ください (言って), pick 写真を 撮っても いいですか.

**02 Pendapat & percakapan / Opinions & conversations** (`sticker_lantern`). Items: connect opposites 高い/安い,
難しい/簡単, 便利/不便, 楽しい/つまらない · tiles 明日 / は / 雨 / だと / 思います (+です) · ★ listen 明日は 雪だと
思います → snow · pick 運動は 体に いいと 思います (exercise) · fill 電車は 便利＿＿ 思います (だと) · ★ listen
私も そう 思います → meaning · ★ listen どう 思いますか → meaning · most polite disagreement in a meeting (そうですね。
でも、ちょっと 難しいと 思います vs いいえ、だめです, わかりません) · order 明日の 会議は 何時からですか →
十時からだと 思います → わかりました。ありがとうございます。 · ★ listen タブレットは 便利だと 思います → tablet · sort
agree / disagree phrases · tiles 私も / そう / 思います; REMED fill おもしろい＿＿ 思います (と, not だと), choose the
reply that agrees; gem: Ueda's "sixteen ways to avoid saying no".

Puzzle: the て-form of 行きます is 行って (the exception to 〜きます → 〜いて).

## 5. Mistakes Indonesian speakers make at these levels

1. **Time readings:** よじ (not よんじ), しちじ (ななじ is heard but しちじ is standard), くじ (never きゅうじ);
   はん after the hour (しちじはん). Connect, listening and REMED items use exactly these.
2. **Sound changes in hundreds:** さんびゃく, ろっぴゃく, はっぴゃく, さんぜん, はっせん — the price connects and the
   ¥800 vs ¥8.000 listening item.
3. **いくら vs いくつ** (price vs how many): kids listening distractor; adults REMED (いくら vs どこ, なん).
4. **Small っ** (みっつ, まっすぐ, 切符 kip-pu) and **dakuten** (じ/し, ぐ/く, び/ひ): the four kana-tile items.
5. **で vs あるいて:** a vehicle takes で, on foot is あるいて (no で).
6. **乗ります に / 降ります を:** 電車に 乗ります, 電車を 降ります; and 降（お）ります "get off" vs 降（ふ）ります "(rain)
   falls" — same kanji, the adult screen warns about it.
7. **すき takes が:** サッカーが すきです, not を (tiles extra card and REMED particle item).
8. **Past needs ました with きのう:** fill items keep the present form as the distractor.
9. **と 思います:** い-adjective + と (おもしろいと), noun / な-adjective + だと (雨だと, 便利だと).
10. **Directness:** Indonesian *tidak* is softer than a Japanese いいえ、だめです; the polite-choice items and the gem
    show そうですね。でも、… and それは ちょっと….
11. **Register:** casual つかれた / どうしたの？ among kids vs polite つかれました; 待って vs 少々 お待ち ください.

## 6. Pack counts (generated 2026-10-18)

| Pack | Items | PRACT | REMED | GEM | SPARE | audio_match | Picture/listening share of PRACT | Unit 01 · 02 |
|---|---|---|---|---|---|---|---|---|
| `jpn-k-m` | 30 | 24 | 4 | 1 | 1 | 7 | 92 % (22/24) | 14 · 15 |
| `jpn-a-m` | 30 | 24 | 4 | 1 | 1 | 6 | 92 % (22/24) | 14 · 15 |
| `jpn-k-h` | 30 | 24 | 4 | 1 | 1 | 6 | 96 % (23/24) | 14 · 15 |
| `jpn-a-h` | 30 | 24 | 4 | 1 | 1 | 8 | 96 % (23/24) | 14 · 15 |
| `jpn-k-x` | 30 | 24 | 4 | 1 | 1 | 7 | 100 % (24/24) | 14 · 15 |
| `jpn-a-x` | 30 | 24 | 4 | 1 | 1 | 7 | 83 % (20/24) | 14 · 15 |

By type — k-m: audio_match 7, pick_image 5, match_pairs 4, tiles 4, fill_blank 3, order 2, memory_flip 1, choose
1, sort_buckets 1. a-m: match_pairs 6, audio_match 6, fill_blank 4, tiles 3, pick_image 3, choose 2, order 2,
memory_flip 1, sort_buckets 1. k-h: audio_match 6, match_pairs 5, pick_image 5, fill_blank 4, tiles 3,
sort_buckets 2, order 1, true_false 1, choose 1. a-h: audio_match 8, match_pairs 5, fill_blank 5, pick_image 2,
tiles 2, choose 2, order 2, memory_flip 1, sort_buckets 1. k-x: audio_match 7, fill_blank 4, pick_image 4,
match_pairs 3, tiles 3, choose 2, sort_buckets 2, memory_flip 1, order 1, true_false 1. a-x: audio_match 7,
fill_blank 4, choose 4, match_pairs 3, tiles 3, pick_image 3, order 2, sort_buckets 2. (+ 1 info_card gem and 1
daily_puzzle each.)

Voice: `ja.levels.json` 234 new clips, 1,546 characters; 35 keys reused from `ja.json` (particles, いらっしゃいませ,
ありがとうございます, はい、どうぞ, でんしゃ, バス, ケーキ …). With `ja.json` the Japanese voice tool now sees 392
clips, 2,022 characters.

Art: 56 keys from MODULES_LEVELS_STORIES §6.4 (routine, clothes, town & travel, arrows, weather & seasons,
hobbies, technology, health, animals) are not in `art/index.json` yet, so `validatePacks` reports "unknown art key"
for them until the drawings land; everything else validates.

## 7. Gems (pool GEM)

| Pack | Unit | Gem | Source |
|---|---|---|---|
| k-m | 02 | The 1-yen coin is aluminium, weighs exactly 1 g, 2 cm across | Japan Mint (mint.go.jp), current coins |
| a-m | 02 | Since April 2021 displayed prices must include consumption tax (10 %, 8 % for take-away food and non-alcoholic drinks) | National Tax Agency of Japan (nta.go.jp): tax-inclusive price display; reduced tax rate |
| k-h | 02 | The weather agency declares the sakura open when 5–6 blossoms are open on each city's sample tree | Japan Meteorological Agency (jma.go.jp), seasonal plant observations |
| a-h | 02 | Typhoons are numbered each year; since 2000 they also get names from a list of 140 proposed by the 14 members of the ESCAP/WMO Typhoon Committee | Japan Meteorological Agency, typhoon numbers and names |
| k-x | 02 | ドキドキ, ワクワク: one dictionary lists about 4,500 sound-and-feeling words | Ono Masahiro (ed.), *Nihongo Onomatope Jiten: Giongo, Gitaigo 4500* (Shogakukan, 2007) |
| a-x | 02 | Keiko Ueda (1974) listed 16 ways to avoid a direct "no"; それは ちょっと… is a common soft one | K. Ueda, "Sixteen ways to avoid saying 'no' in Japan", in Condon & Saito (eds.), *Intercultural Encounters with Japan* (Simul Press, 1974) |

Reserve (verify before use): いただきます from いただく "put on top of one's head" and ありがとう from ありがたい
(Daijisen; carried over from `ja_pemula.md`); しちじ vs ななじ in announcements (NHK pronunciation guidance).

## 8. Reviewer checklist

Native Japanese reviewer (standard Tokyo Japanese):
- [ ] Every kana/kanji string, reading in （）, romaji (Hepburn, macrons) and meaning, in items, options, screens,
      examples and model answers.
- [ ] Times: しちじ (not ななじ) as the taught form; よじ, くじ; じゅうにじはん; 十時半 written with 半.
- [ ] Prices and counters: はっぴゃくえん, ろっぴゃくえん, さんぜんえん, はっせん; ななつ, ここのつ, とお; シャツ as
      〜枚 and pens/pencils as 〜本; 卵を ななつ ください sounds natural (vs 七個).
- [ ] Naturalness: うちに かえります (kids) vs 家（いえ）に 帰ります (adults); まっすぐ いって、みぎです / 信号を
      左です as given directions; 遠いですか → 歩いて 五分ぐらいです; 次の 駅で 電車を 降ります; 先週 京都で 紅葉
      （こうよう）を 見ました; サッカーは すきじゃないです (vs すきじゃありません); わたしも すきです。いっしょに
      しましょう！; どうしたの？ → ちょっと つかれた。; はい、こちらへ どうぞ after 試着しても いいですか; 十時からだと
      思います; ちょっと 違うと 思います as a soft disagreement.
- [ ] Tile splits: しちじ / に / おきます; 何時 / に / 帰ります / か; 空港 / まで / バス / で / 行きます; 昨日 / は /
      雨 / でした; 明日 / は / 雨 / だと / 思います; distractor cards (を, です, ねます, いきます, 話します, ちいさいです)
      are clearly wrong in place.
- [ ] Voice script `ja.levels.json`: each text says what the note says; `ja/ame` is written 雨 on purpose (rain,
      not candy); しゃしんをとってもいいですか must not sound like とっても "very"; かえる (frog) and かえります
      (go home) in the kids puzzle; questions with ？ rise. Listen to every generated clip.
- [ ] Kids never see kanji; katakana only for loanwords and always with romaji; adults' kanji always with reading.
- [ ] Gems: the 1-yen facts, the 2021 price-display date and 8 %/10 % wording, the 5–6 blossom rule, the 140/14
      typhoon names, the onomatopoeia dictionary title, the Ueda 1974 reference.

Indonesian and English reviewers: EYD V; "kamu/aku" (kids) and "Anda/saya" (adults); "setengah sembilan" = 8.30;
"Cocok / Tidak cocok" for the picture true/false; prompts ≤ 6 words.

Art (MODULES_LEVELS_STORIES §6.4 drafts): these appear side by side as options and must be told apart —
`pic_wake_up` / `pic_sleep` / `pic_get_dressed` / `pic_shower` / `pic_brush_teeth`; `pic_go_school` /
`pic_go_home`; `pic_study` / `pic_read` / `pic_write`; `pic_pants` / `pic_skirt` / `pic_dress` / `pic_jacket`;
`pic_bank` / `pic_post_office` / `pic_hotel` / `pic_library`; `pic_wind` / `pic_storm` / `pic_rain`;
`pic_swim` / `pic_fishing` / `pic_beach`; `pic_hot` / `pic_cold`; `pic_radio` / `pic_headphones` / `pic_tablet`;
the three `glyph_arrow_*`. `pic_beach` stands for summer (なつ) in the season items. Clocks used:
`clock_1_00 1_30 2_30 3_00 3_30 4_00 6_30 7_00 7_30 8_00 8_30 9_00 10_00 10_30 12_00 12_30` — 8:30 vs 9:30 and
12:30 vs 2:30 must be readable from the hands alone.

## 9. Open questions (for Umar)

1. **しちじ vs ななじ:** textbooks teach しちじ; announcements often say ななじ to avoid confusion with いちじ. Teach
   both from Mahir?
2. **Kids casual forms** (つかれた, おなかが すいた, どうしたの？) are taught with the polite form on the screen. Keep
   casual as the main form for kids Master?
3. **Clip text in kanji:** only `ja/ame` (雨) so far. Allow kanji in clip texts generally where a kana homophone
   could take the wrong pitch (e.g. かえる frog vs かえる go home), or keep kana and rely on the reviewer?
4. **Adults' romaji:** dropped only on display texts already shown in lower adult levels. A learner who starts at
   Mahir without Pemula/Menengah sees バス or 駅（えき） without romaji. Show romaji on everything at the starter
   units instead?
5. **Next units:** Menengah 03+ katakana as a script (reading tests, no tracing until stroke data exists) and ~40
   first kanji for adults (numbers, 日 月 人 山 水 …) with readings faded out, as proposed in `ja_pemula.md` Q4?
6. **Prices:** yen only (¥) for now; add rupiah ↔ yen comparison items for adult travellers?
