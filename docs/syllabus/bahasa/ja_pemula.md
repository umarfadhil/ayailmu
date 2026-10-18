# Bahasa Jepang / Japanese — Pemula (kids + adults), units 01–05

**Status:** DRAFT 2026-10-18 (follow-up 11), written for review. Not reviewed by a native speaker yet. Packs:
`android/content/src/main/assets/packs/bahasa/jpn-k/v1.json` (kids) and `.../jpn-a/v1.json` (adults), content
versions `jpn-k-pemula-0.1` / `jpn-a-pemula-0.1`, every item `review_status: draft`. Voice script:
`android/content/voice/ja.json`. Generator (deterministic) and checker live in the session scratchpad
(`fu11/ja/pack_jpn.py`, `check.py`). Contract: `docs/content/INTERACTIONS_AUDIO.md`; pack format:
`docs/content/AUTHORING.md`; framework: `docs/syllabus/00_FRAMEWORK.md`. This file replaces "Jepang: PLANNED" in
`01_BAHASA.md` section E for the Pemula level only.

**QA pass 2026-10-18:** units 04–05 grew from 5 PRACT + 1 REMED to 11–12 PRACT + 2 REMED in both packs (new items
continue each unit's numbering, e.g. `JPN-K-P-04-007`…`-013`; existing ids unchanged; `order` renumbered so it still
increases through the pack); the two unit-03 REMED `memory_flip` items became `match_pairs` (connect), because a
`memory_flip` is never evidence and cannot close a REMED loop; picture cards got spoken (TalkBack) labels; adult
romaji in units 04–05 is now decided per item (see §1).

## 1. Shape and conventions

| | Kids (`jpn-k`, 7–12) | Adults (`jpn-a`, 16+) |
|---|---|---|
| Outcome | Reads and traces all 46 hiragana; ~60 picture words; says hello, thank you, sorry; counts 1–10; "これは〜です", "これは なんですか", "〜が すき", "〜を たべます / のみます" | Same 46 hiragana; ~80 words; polite greetings and self-introduction; numbers; family (own vs others'); ordering (〜を ください, ひとつ/ふたつ/みっつ, いくらですか); asking the way (〜は どこですか, 〜で いきます) |
| Script shown | Hiragana only (no kanji, no katakana anywhere) | Hiragana; kanji only with its reading in the text, e.g. `水（みず）`; katakana only for loanwords in units 04–05 (コーヒー), always with romaji, never traced or tested |
| Romaji | On every Japanese word, every unit | Every Japanese word in units 01–03; in 04–05 a card loses its romaji only when **every** word card of that item was already shown in 01–03 (e.g. いただきます in `JPN-A-P-04-014`); a lone card without romaji would stand out, so one new card keeps romaji on all |
| Instruction | `id`, `en` (kamu) | `id`, `en` (Anda) |

- **Romanization = modified Hepburn** with macrons for long vowels: okāsan, otōsan, arigatō, gyūnyū, onēsan; long i
  stays `ii` (ojiisan, oniisan); えい stays `ei` (eiga); particles は `wa`, を `o`, へ `e`; ん is `n` everywhere
  (shinbunshi, enpitsu, konbanwa). Sentences start with a capital (`Kore wa neko desu.`).
- **Clip keys** (contract §3.1): `ja/` + the romaji with each macron vowel doubled (ō → `oo`) and `_` between
  words: `ja/okaasan`, `ja/otoosan`, `ja/arigatoo_gozaimasu`, `ja/zoo` (ぞう). Single kana: `ja/a`, `ja/shi`,
  `ja/tsu`, `ja/fu`, `ja/n`. を shares `ja/o` (spoken /o/, same as お); the particle は shares `ja/wa`. Clip text is
  kana without spaces (katakana for the loanwords); the two questions end in ？ for intonation.
- **Spacing:** kana sentences use the spaces of Japanese children's books (between phrases):
  `これは ねこです。`, `コーヒーを ください。`, `えきは どこですか。`. Tiles split a phrase into its words
  (`これは` / `ねこ` / `です`).
- **Reading tests:** where the learner must read kana (kana ↔ romaji connect or memory, "listen, then tap the
  letter", building a word from kana tiles — also in unit 05, `JPN-K-P-05-012` いぬ), the kana cards carry **no
  romaji and no speaker**: they would give the answer away. The item shows the picture and the target word's romaji
  instead (help line `inu = anjing`); its clip key is stored, but today's renderer shows a speaker only beside
  `target_text`, so the item is answered from picture + romaji. Everywhere else, Japanese cards carry romaji and a
  speaker (`audio`).
- **Picture cards** carry a bilingual `text` that is only their spoken TalkBack label (never shown on screen).
- **Picture first** (contract §1): 99 % of PRACT items are trace, picture, gesture or listening items (kids 80 of 81,
  adults 81 of 82; 97 % without the traces). The exceptions are the two picture-led `choose` items ("これは
  なんですか。" with a book; "えきは どこですか。" with a station). Prompts are ≤ 6 words from a small set (`P-TRACE`,
  `P-CONNECT`, `P-DRAG`, `P-PICK`, `P-LISTEN-PIC`, `P-LISTEN-KANA`, `P-LISTEN-MEAN`, `P-BUILD`, `P-SENTENCE`,
  `P-ORDER`, `P-DIALOG`, `P-REPLY`, `P-ANSWER` (kids), `P-SORT`, `P-FILL`, `P-MEMORY`).
- **Trace:** every hiragana is traced once when first taught (46 trace items per pack, keys `hira_*` from contract
  §4: あ–そ in unit 01, た–ほ in 02, ま–ん in 03). Each trace shows the kana, its romaji, plays its sound, and its
  model answer gives one word that uses it (kids and adults get different words).

## 2. Skills

| Skill | Unit | What "Bisa / Got it" means |
|---|---|---|
| `JPN-HIRA-A` | 01 | Reads (and has traced) あ い う え お, か–こ, さ–そ; builds short words from them |
| `JPN-GREET` | 01 | Kids: こんにちは, ありがとう, さようなら, ごめんなさい. Adults: はじめまして, 〜です, よろしく おねがいします, ありがとうございます, どういたしまして |
| `JPN-HIRA-T` | 02 | Reads た–と, な–の, は–ほ (incl. ち chi, つ tsu, ふ fu) |
| `JPN-NUM` | 02 | いち–じゅう by ear and by sight; よん/し and なな/しち known as pairs |
| `JPN-HIRA-M` | 03 | Reads ま–も, や ゆ よ, ら–ろ, わ を ん; tells る/ろ, め/ぬ, ね/れ/わ apart |
| `JPN-FAMILY` | 03 | Family words; adults: はは/ちち (own family, to outsiders) vs おかあさん/おとうさん |
| `JPN-FOOD` | 04 | Food and drink words; 〜を たべます / のみます; いただきます; kids 〜が すき; adults 〜を ください, ひとつ/ふたつ/みっつ, いくらですか, a café exchange |
| `JPN-THINGS` (kids) | 05 | Animals and things; これは 〜です; これは なんですか → 〜です |
| `JPN-PLACE` (adults) | 05 | Places and transport; 〜は どこですか → あそこです, 〜で いきます, すみません |

Every skill has at least one REMED item that works without audio and is evidence (no `memory_flip`, `trace` or
`audio_match` in REMED; units 04–05 have two each), at least one scored PRACT item that works without audio, and at
least one `audio_match` (hidden until its clip exists). With every `audio_match` hidden, units 04–05 still have
9–10 PRACT items each.

## 3. Units

### Unit 01 — Hiragana あ–そ + greetings (free unit)

Kana: あ い う え お · か き く け こ · さ し す せ そ (15 traces). Screen: one letter, one sound; the vowels are
Indonesian a i u e o (え always é, as in *sate*); a line over a romaji vowel means "say it long".

| Kana | Romaji | Meaning (id / en) | Picture | Pack |
|---|---|---|---|---|
| こんにちは | konnichiwa | halo / hello | `pic_wave_hello` | K, A (screen) |
| ありがとう | arigatō | terima kasih / thank you | `pic_thanks` | K |
| さようなら | sayōnara | sampai jumpa / goodbye | `pic_wave_bye` | K |
| ごめんなさい | gomen nasai | maaf / sorry | `pic_sorry` | K |
| うし | ushi | sapi / cow | `pic_cow` | K (spell) |
| ありがとうございます | arigatō gozaimasu | terima kasih (sopan) / thank you (polite) | `pic_thanks` | A |
| はじめまして。たなかです。 | Hajimemashite. Tanaka desu. | salam kenal, saya Tanaka / nice to meet you, I'm Tanaka | — | A |
| よろしく おねがいします | yoroshiku onegai shimasu | mohon kerja samanya / pleased to meet you | — | A |
| どういたしまして | dō itashimashite | sama-sama / you're welcome | — | A |
| えき | eki | stasiun / station | `pic_station` | A (spell) |

Pattern (adults): **〜です** (たなかです). Items — kids: connect あ–お ↔ romaji, listen → tap the picture
(ありがとう), pick the picture (こんにちは), listen → tap し; REMED build うし, drag greetings onto pictures. Adults:
build えき (き vs さ), listen → tap the picture (ありがとうございます), order a self-introduction, listen → tap す;
REMED connect か–こ, pick the reply to ありがとうございます.

### Unit 02 — Hiragana た–ほ + numbers

Kana: た ち つ て と · な に ぬ ね の · は ひ ふ へ ほ (15 traces). Numbers: いち ichi, に ni, さん san, よん yon
(し shi), ご go, ろく roku, なな nana (しち shichi), はち hachi, きゅう kyū (く ku), じゅう jū — taught as whole
words with romaji and sound (さん, よん, ご, きゅう, じゅう use kana from later units, ゛ and small ゅ). Counting
uses `count_mango_N` / `count_egg_N`.

| Kana | Romaji | Meaning | Picture | Pack |
|---|---|---|---|---|
| ねこ | neko | kucing / cat | `pic_cat` | K (spell, ね vs ぬ) |
| さかな | sakana | ikan / fish | `pic_fish` | A (spell) |
| いち … じゅう | ichi … jū | 1–10 | `count_mango_*`, `count_egg_*` | K, A |

Items — kids: listen → tap つ (vs す, し), order いち–ご, build ねこ, listen → tap the 8 mangoes; REMED connect
は–ほ, drag 2/6/9/10 eggs onto the number words. Adults: listen → tap ち (vs し, つ), build さかな, order ろく–じゅう,
listen → tap 7 mangoes; REMED connect な–の, drag 2–5 eggs onto the words.

### Unit 03 — Hiragana ま–ん + family

Kana: ま み む め も · や ゆ よ · ら り る れ ろ · わ を ん (16 traces; を is read o and is only a particle).

| Kana | Romaji | Meaning | Picture | Pack |
|---|---|---|---|---|
| おかあさん | okāsan | ibu / mother | `fam_mother` | K, A |
| おとうさん | otōsan | ayah / father | `fam_father` | K, A |
| おばあさん | obāsan | nenek / grandmother | `fam_grandmother` | K, A |
| おじいさん | ojiisan | kakek / grandfather | `fam_grandfather` | K |
| おねえさん | onēsan | kakak perempuan / older sister | `fam_sister` | K, A |
| おにいさん | oniisan | kakak laki-laki / older brother | `fam_brother` | A (K screen) |
| はは · ちち | haha · chichi | ibu saya · ayah saya / my mother · my father | — | A |
| くるま | kuruma | mobil / car | `pic_car` | K (spell, る vs ろ) |
| よる | yoru | malam / night | `sleep_moon` | A (spell, る vs ろ) |

Family rule (adults, kept simple): talking *about your own* parents to other people → はは, ちち; someone else's
parents, and calling your own mother/father → おかあさん, おとうさん. Kids learn only おかあさん/おとうさん. Long vowels
change meaning: おばあさん grandmother / おばさん aunt; おじいさん grandfather / おじさん uncle.

Items — kids: drag family pictures onto words, listen → tap the father, build くるま, listen → tap ろ; REMED connect
る/れ/わ/め ↔ romaji, pick おねえさん. Adults: drag family pictures, listen → tap the grandmother, build よる, listen
→ tap る; REMED connect め/ぬ/ね/れ ↔ romaji, sort はは/ちち/おかあさん/おとうさん into "my family / someone else's".

### Unit 04 — Food & drink

| Kana (adults' display) | Romaji | Meaning | Picture | Pack |
|---|---|---|---|---|
| ごはん (ご飯（ごはん）) | gohan | nasi / rice, meal | `pic_rice_bowl` | K, A |
| おにぎり | onigiri | nasi kepal / rice ball | `pic_onigiri` | K |
| おちゃ (お茶（おちゃ）) | ocha | teh / tea | `pic_tea_cup` | K, A |
| ぎゅうにゅう | gyūnyū | susu / milk | `pic_milk_glass` | K |
| みず (水（みず）) | mizu | air / water | `drink_water` | K, A |
| りんご · みかん · すいか · やさい | ringo · mikan · suika · yasai | apel · jeruk · semangka · sayur | `pic_apple`, `pic_orange_fruit`, `pic_watermelon`, `pic_vegetables` | K (やさい also A as 野菜（やさい）) |
| さかな · たまご | sakana · tamago | ikan · telur | `pic_fish_dish`, `pic_egg_fried` | K (A: 魚（さかな）, 卵（たまご）) |
| はし | hashi | sumpit / chopsticks | `pic_chopsticks` | K, A |
| たべます · のみます | tabemasu · nomimasu | makan · minum | (sentences) | K (A: 食（た）べます, 飲（の）みます) |
| いただきます | itadakimasu | before a meal | `pic_eat` | K, A |
| たべもの · のみもの | tabemono · nomimono | makanan · minuman | sort baskets | K, A |
| コーヒー · パン · ジュース · ケーキ | kōhī · pan · jūsu · kēki | kopi · roti · jus · kue | `pic_coffee_cup`, `pic_bread`, `pic_juice`, `pic_cake` | A |
| ラーメン · ぎょうざ | rāmen · gyōza | ramen · pangsit | `pic_noodle_bowl`, `pic_dumplings` | A |
| マンゴー · ひとつ · ふたつ · みっつ | mangō · hitotsu · futatsu · mittsu | mangga · 1 · 2 · 3 (benda) | `count_mango_2` | A |
| いらっしゃいませ · はい、どうぞ | irasshaimase · hai, dōzo | selamat datang · silakan | — | A |

Patterns: kids **〜が すき！** (すいかが すき！ I like watermelon); adults **〜を ください** (コーヒーを ください),
**いくらですか**, counting things **ひとつ, ふたつ, みっつ** (screen only: コーヒーを ふたつ ください). Culture line:
いただきます before a meal, ごちそうさま(でした) after. Pattern added in the QA pass: **〜を たべます / のみます**.
Items (new ones marked +) — kids: drag food pictures onto words, + pick たまご, listen → tap water, + drag
fruit/vegetable pictures, sort word cards into たべもの / のみもの, + memory さかな/はし/おにぎり/おちゃ, fill 〜が すき
with a picture, + build みずを のみます, listen → tap the apple, + fill ＿＿を たべます (apple; water and milk as
distractors), + pick the picture for いただきます; REMED pick さかな, + pick やさい. Adults: drag pictures onto
水・お茶・コーヒー・ご飯, + pick ケーキ, listen → tap bread, + drag パン・卵・魚・野菜, build コーヒーを ください, + sort
pictures into たべもの / のみもの, order a café exchange (いらっしゃいませ → おちゃを ください → はい、どうぞ), + fill
マンゴーを ＿＿ ください with two mangoes (ふたつ), listen → pick the meaning of いくらですか, + memory
ラーメン/おにぎり/ぎょうざ/はし, + build 水（みず）を 飲（の）みます, + pick the picture for いただきます; REMED fill
〜を ください (ジュース), + pick 野菜（やさい）; gem: three scripts in one sentence.

### Unit 05 — kids: Animals & things · adults: Places & getting around

Kids: いぬ inu `pic_dog`, ねこ neko `pic_cat`, とり tori `pic_bird`, うさぎ usagi `pic_rabbit`, ぞう zō
`pic_elephant`, さる saru `pic_monkey`, + うま uma `pic_horse`, うし ushi `pic_cow`, あひる ahiru `pic_duck`, にわとり
niwatori `pic_chicken`, やぎ yagi `pic_goat`; ほん hon `pic_book`, かばん kaban `pic_bag`, くつ kutsu `pic_shoes`,
ぼうし bōshi `pic_hat`, えんぴつ enpitsu `pic_pencil`, + いえ ie `pic_house`, まど mado `pic_window`, いす isu
`pic_chair`, はな hana `pic_flower`; baskets どうぶつ dōbutsu / もの mono. Patterns **これは 〜です。** and **これは
なんですか。 → 〜です。** Items: drag animal pictures onto words, listen → tap the elephant, + connect farm animals,
memory pictures ↔ things, + pick やぎ, + sort pictures into どうぶつ / もの, build これは ねこです, + fill これは ＿＿です
(bag), listen → tap the book, + drag いえ/まど/いす/はな, + build いぬ from kana tiles (ぬ vs め), + answer これは
なんですか with a book picture (ほんです); REMED fill これは ＿＿です with a monkey, + pick いす (chair vs bed, table).

Adults: 駅（えき） eki `pic_station`, 病院（びょういん） byōin `pic_hospital`, 公園（こうえん） kōen `pic_park`,
学校（がっこう） gakkō `pic_school`, でんしゃ / 電車（でんしゃ） densha `pic_train`, バス basu `pic_bus`,
自転車（じてんしゃ） jitensha `pic_bicycle`, ひこうき hikōki `pic_plane`, + 車（くるま） kuruma `pic_car`, 船（ふね）
fune `pic_ship`, バイク baiku `pic_motorbike`, 市場（いちば） ichiba `pic_market`, 家（いえ） ie `pic_house`, 山（やま）
yama `pic_mountain`, 海（うみ） umi `pic_sea`; baskets のりもの norimono / ばしょ basho. Patterns **〜は どこですか**
(は read wa), **〜で いきます**, すみません · あそこです. Items: drag places, + pick 市場, listen → tap the train, + drag
vehicles, build えきは どこですか, + fill ＿＿で いきます (ship), order a 4-line exchange (すみません → びょういんは
どこですか → あそこです → ありがとうございます), + pick the reply to えきは どこですか (あそこです), listen → tap the
plane, + sort pictures into のりもの / ばしょ, + build 電車（でんしゃ）で いきます, + drag 家・山・海・公園; REMED fill
＿＿で いきます (バス), + pick 車（くるま）. Trap to mention: びょういん hospital vs びよういん beauty salon.

### Daily puzzles (pool SPARE)

Kids: しんぶんし is a kana palindrome (pick it among さようなら, ありがとう); さん + に = ? (5). Adults: 46 − 15 − 15
hiragana left to learn (16); たけやぶやけた ("the bamboo grove burned") is a palindrome.

## 4. Mistakes Indonesian speakers make (and where the packs address them)

1. **Long vowels.** Indonesian has no vowel length, so おばあさん/おばさん, おじいさん/おじさん, びょういん/びよういん,
   ここ/こうこう merge. Macrons in romaji, audio, the unit 03 screen line and the grandmother listening item.
2. **Small っ (double consonants).** Indonesian has none: きって (stamp) vs きて (come). Appears only inside whole
   words here (がっこう, いらっしゃいませ, みっつ); taught as a kana in Menengah.
3. **つ ≠ す.** "tsu" is said "su" or "tu": くつ, つくえ. Trace lines, the つ listening item (kids), screens.
4. **し and ち.** し is "shi" (like *sy* in *syukur*), not "si"; ち is close to Indonesian *ci* (an advantage).
   Adults: listen → tap ち among し, つ.
5. **ふ** is breathed with both lips, not "pu", "hu" or an English f.
6. **r** is one light tap between r and l; Indonesian rolled r is too strong (adult ら trace line).
7. **e is always é.** Readers of romaji say the pepet e of *emas* in "desu", "neko"; え is always the é of *sate*.
8. **Silent u/i.** です ≈ "dess", すき ≈ "ski", ます ≈ "mass"; Indonesians pronounce the full vowel (adult す trace).
9. **Particles.** は → wa, を → o, へ → e (こんにちは gem, adult は/へ/を traces, えきは どこですか).
10. **ん** sounds m before b/m/p (shinbun ≈ shimbun) and like *ng* before k/g; Indonesian *ng* helps.
11. **Look-alike kana:** き/さ, ね/ぬ, め/ぬ, る/ろ, ね/れ/わ, は/ほ, い/り. Spelling distractors and memory cards use
    exactly these pairs.
12. **Pitch accent** (はし chopsticks/bridge, あめ rain/candy) is awareness only at Pemula, never tested.

## 5. Gems (pool GEM, `gem: true`)

In the packs:

| Pack | Unit | Gem | Source |
|---|---|---|---|
| kids | 01 | こんにちは ends in は read *wa*: it began as "konnichi wa…" ("as for today…") with the rest dropped | Digital Daijisen (Shogakukan), entry こんにちは, via kotobank.jp |
| kids | 02 | Hiragana grew from kanji written fast and curvy; あ was once a kanji (no kanji shown to kids) | Encyclopaedia Britannica, "kana"; C. Seeley, *A History of Writing in Japan* (Brill, 1991) |
| adults | 01 | Hiragana grew from cursive man'yōgana: 安（あん）→ あ, 加（か）→ か, 世（せ）→ せ | Britannica, "kana"; Seeley 1991 (kana source-character tables) |
| adults | 04 | One sentence, three scripts: 私（わたし）は コーヒーを 飲（の）みます | Britannica, "Japanese language" (writing system) and "kana" |

Reserve for later packs (verify the source before use): いただきます comes from いただく, first "to put on top of
one's head" (Daijisen, いただく); ありがとう comes from ありがたい "rare, hard to have", already in *Makura no Sōshi*
("ありがたきもの", c. 1000) — centuries before the Portuguese arrived in 1543, so it is not from *obrigado*
(Daijisen, ありがとう); *karaoke* = kara "empty" + ōkesutora "orchestra" (Britannica, "karaoke"); しんぶんし and
たけやぶやけた as kana palindromes (already used as puzzles).

## 6. Pack counts (generated 2026-10-18)

| Pack | Items | PRACT | REMED | GEM | SPARE | trace | audio_match | Other types |
|---|---|---|---|---|---|---|---|---|
| `jpn-k` | 95 | 81 | 10 | 2 | 2 | 46 | 10 | match_pairs 11, pick_image 8, tiles 6, fill_blank 4, sort_buckets 2, memory_flip 2, order 1, choose 1, info_card 2, daily_puzzle 2 |
| `jpn-a` | 96 | 82 | 10 | 2 | 2 | 46 | 10 | match_pairs 10, tiles 7, pick_image 5, order 4, fill_blank 4, sort_buckets 3, choose 2, memory_flip 1, info_card 2, daily_puzzle 2 |

Per unit: kids 22 · 22 · 22 · 13 · 14 (+2 puzzles); adults 22 · 21 · 22 · 15 · 14 (+2 puzzles). Units 04–05 have
11–12 PRACT + 2 REMED each (QA pass 2026-10-18); with the two listening items per unit hidden, 9–10 PRACT remain.

Voice script: 158 clips (45 single kana + 113 words/phrases), 476 characters in total.

## 7. Reviewer checklist

Native Japanese reviewer (standard Tokyo Japanese):
- [ ] Every kana string, every romaji (modified Hepburn, macrons), every meaning, in items, options, screens,
      examples, model answers and the 46 trace lines (each names an example word).
- [ ] Naturalness of the phrases and dialogues: self-introduction order, café exchange, asking the way,
      どういたしまして as the textbook reply to ありがとうございます, たなか written in hiragana.
- [ ] Family rule as stated (はは/ちち vs おかあさん/おとうさん) is simple but not wrong.
- [ ] Spacing style (`これは ねこです。`) and the tile splits (`これは` / `ねこ` / `です`; `えき` / `は` / `どこ` /
      `ですか`).
- [ ] Voice script `ja.json`: each text says what the note says; lone kana clips (は must be *ha*, へ *he*, ん a
      clean n); を uses the お clip; the particle は uses the わ clip; これは must be read *kore wa*; vowel length
      audible in every long-vowel word. Listen to every generated clip.
- [ ] Kids never see kanji or katakana; adults see kanji only with （reading） and katakana only in units 04–05.
- [ ] Trace glyphs follow the school (教科書体) forms: き 4 strokes, さ 3, そ 1, り 2, ふ 4, ゆ 2 (check
      `strokes/index.json` against these).
- [ ] Gems: sources checked; the こんにちは and man'yōgana claims as worded.
- [ ] Items added in the QA pass (units 04–05): ぎょうざ in hiragana (menus also write 餃子 / ギョーザ), バイク for a
      scooter-style motorbike, 市場（いちば） for a market stall, マンゴーを ふたつ ください, これは なんですか → ほんです
      (vs それは ほんです), 船（ふね）で いきます; the はし clip must be *chopsticks* (HA-shi), not *bridge*.

Indonesian and English reviewers: EYD V, "kamu" (kids) / "Anda" (adults); "Tebalkan hurufnya" (kids) and
"Telusuri hurufnya" (adults) for tracing; "nasi kepal" for onigiri; prompts ≤ 6 words.

Art: `pic_wave_hello` and `pic_wave_bye` must be distinguishable (both appear as options in the same items), as
must `pic_thanks` / `pic_sorry`, `pic_fish_dish` / `pic_chicken_dish`, `count_mango_6/7/8/9`.

## 8. Open questions (for Umar)

1. **Size.** Resolved in the QA pass of 2026-10-18: units 04–05 were filled up (+7–8 items each), so the packs are
   95 (kids) and 96 (adults) items, above the ~75 of the contract because of the 46 traces. Confirm the larger size.
2. **Romaji style for kids:** macrons (okāsan, arigatō — standard Hepburn, used now) or doubled vowels as in kana
   (okaasan, arigatou), which match the tiles but invite "o-u" mispronunciation?
3. **を audio:** reuse the お clip (correct modern pronunciation) or record a separate "wo" for kana recitation?
4. **Next level (Menengah):** proposed order — dakuten/handakuten (が, ぱ…), small っ, yōon (きゃ, しゅ…), then
   katakana (kids too), then ~40 first kanji for adults (numbers, 日 月 人 山 水…). Confirm.
5. **Names:** example name たなか (Tanaka) in hiragana; switch to the learner's own name once profiles can feed it?
6. **Numbers 4 and 9:** say why よん/きゅう are preferred over し/く (homophones of 死 "death" and 苦 "suffering")
   to adults only, with a source — or leave it out?
7. **Voice:** one adult Tokyo-standard ElevenLabs voice for both packs, or a younger-sounding voice for kids?
