# Bahasa Korea / Korean — Menengah, Mahir, Master (starter units)

**Status:** DRAFT 2026-10-18 (follow-up 12), written for review. Builds on `ko_pemula.md` (Pemula units 01–05). Contract:
`docs/content/MODULES_LEVELS_STORIES.md` (levels, tracks, art §6, picture rule §8) and `docs/content/INTERACTIONS_AUDIO.md`
(picture-first, gestures, clips, romanization); pack format `docs/content/AUTHORING.md`. Six packs
`android/content/src/main/assets/packs/bahasa/kor-{k,a}-{m,h,x}/v1.json`, two starter units each, every item and screen
`review_status: draft`. Voice: new clips in `android/content/voice/ko.levels.json` (252 clips,
1469 characters, 1147 hangul syllables); 18 keys are reused from `ko.json` where the text is identical.
Packs, voice script and the tables below come from one generator (`lex12.py`, `kbuild.py`, `pack_m.py`, `pack_h.py`,
`pack_x.py`, `gen.py`, `syllabus.py`; checked by `check.py`, which recomputes every romanization from the hangul), in the
session scratchpad `fu12/ko/`.

## Menengah–Master starter

### 0. How these levels work

- **What Pemula gave:** hangul (24 basic jamo traced), greetings, both number systems 1–10, family, food and 주세요,
  animals/things (kids) or places and 어디예요? (adults), 이에요/예요. The new levels start from there and assume it.
- **Level meaning:** Menengah = everyday independence (telling the time, routines, shopping); Mahir = getting around and
  talking about yesterday (particles of place and direction, the past tense); Master = nuance and creating (kids:
  feelings, describing friends, hobbies, wishes; adults: polite requests, wishes, opinions, invitations and refusals).
- **Target `ko`, standard Seoul Korean; instruction `id` and `en`.** Polite 해요체 everywhere, as in Pemula. Casual speech
  appears only where a child talks to a friend (괜찮아?, 같이 놀자!), and the screen says so. The café uses the
  honorific forms a learner will *hear* (주문하시겠어요?, 드시고 가세요?) and polite forms to *say*.
- **Picture-led:** at least 70 % of PRACT items are picture, gesture or listening items (actual shares below);
  prompts ≤ 6 words; model answers one line. Sentences are built with drag tiles; pictures and words are joined with
  drag or connect lines; every unit has a sort and a sequence (dialogue or time order).
- **No new trace items:** stroke data exists only for the 24 basic jamo (Pemula). Tense consonants and compound vowels
  appear inside words with romanization.
- **Reading aid = Revised Romanization**, computed from the hangul (liaison, nasalisation, palatalisation 같이 *gachi*,
  aspiration 어떻게 *eotteoke*). Kids: on every hangul card and target. Adults: only on what is new — a text shown in a
  lower adult level or an earlier unit, or made only of words shown there, has none; decided per item for the cards so a
  lone romanized card never marks the answer.
- **Answer-leak rules:** listening items (`audio_match`) show no romanization and no speaker on any card; reading items
  ("Baca, lalu pilih gambarnya", one per Mahir/Master pack, on words taught earlier in the same unit) show the hangul
  bare; picture cards never carry a speaker. Wrong forms used as distractors (`x_` cards: 육 시, 이십오천 원, 두천 원)
  are never recorded, and an item that has one shows no speakers at all (a silent card would mark itself).
  Grammar pieces (`p_`: particles, endings, numbers before a counter, verb stems) carry romanization but no clip.
- **Audio:** 6 `audio_match` per pack (3 per unit), hidden until the clips exist; every skill has a REMED item that is not
  a listening item, so each pack works fully without audio.

### 1. Skills

| Skill | Packs | "Got it" means |
|---|---|---|
| `KOR-TIME` | k-m, a-m | reads and says clock times: native hours (한/두/세/네 … 열두 시), Sino minutes, 반, 오전/오후 |
| `KOR-ROUTINE` | k-m, a-m | names daily actions and says when: 일곱 시에 일어나요 |
| `KOR-MONEY` | k-m, a-m | reads and says won amounts with Sino numbers; 만 as the unit (adults) |
| `KOR-SHOP` | k-m, a-m | asks the price, understands it, buys with N + number + counter + 주세요; clothes words |
| `KOR-TOWN` | k-h | places in town; 에 (going to) vs 에서 (doing at) |
| `KOR-ROUTE` | a-h | -에서 … -까지, 타요/갈아타요, 얼마나 걸려요?, tickets and luggage |
| `KOR-WAY` | k-h, a-h | left/right/straight, asking where something is and understanding the answer |
| `KOR-WEATHER` | k-h, a-h | weather and the four seasons |
| `KOR-PAST` | k-h, a-h | past tense -았/었어요 and 했어요; answers a past question in the past |
| `KOR-FEEL` | k-x | feelings, asking how a friend is and why, giving a reason (그래서) |
| `KOR-DESCRIBE` | k-x | describing a friend; wearing verbs 써요/입어요/신어요 |
| `KOR-HOBBY` | k-x | hobbies with their own verbs (해요, 쳐요, 춰요, 그려요, 찍어요) |
| `KOR-WANT` | k-x, a-x | V-고 싶어요; kids: likes vs wants; adults: wants vs requests |
| `KOR-REQUEST` | a-x | V-아/어 주세요 (with 좀), café and office requests |
| `KOR-OPINION` | a-x | asks and gives opinions; N보다 더; 제 생각에는 |
| `KOR-DIALOGUE` | a-x | agrees (저도요, 맞아요), hesitates (글쎄요), invites (-(으)ㄹ까요?) and refuses gently (오늘은 좀…) |

### 2. The six packs

### Kids Menengah (`kor-k-m`, items `KOR-K-M-<unit>-<nnn>`)

30 items (PRACT 24, REMED 4, GEM 1, SPARE 1); picture/gesture/listening share of PRACT 21/24 = 88% (with a picture on screen 19/24 = 79%); audio_match 6. Rules `config/rules.kor-k-m.json`; content version `kor-k-m-0.1`.

**01 Jam & hari-hariku / Time & my day** — sticker `sticker_star_fruit`

- Skills: `KOR-TIME`, `KOR-ROUTINE`
- Focus: o'clock with native numbers (한/두/세/네 시, 열두 시), 반, minutes with Sino numbers (십 분); routine verbs (일어나요, 이를 닦아요, 아침을 먹어요, 학교에 가요, 자요)
- Patterns: time + 에 (일곱 시에 일어나요)
- Item mix: PRACT 12 (audio_match 3, match_pairs 2, choose 1, fill_blank 1, memory_flip 1, order 1, pick_image 1, sort_buckets 1, tiles 1) · REMED (KOR-TIME → pick_image; KOR-ROUTINE → pick_image) · GEM 1
- New words: 한 시 *han si* = jam satu · 두 시 *du si* = jam dua · 세 시 *se si* = jam tiga · 네 시 *ne si* = jam empat · 일곱 시 반 *ilgop si ban* = setengah delapan (7.30) · 일어나요 *ireonayo* = bangun · 이를 닦아요 *ireul dakkayo* = menyikat gigi · 아침을 먹어요 *achimeul meogeoyo* = sarapan · 학교에 가요 *hakgyoe gayo* = pergi ke sekolah · 샤워해요 *syawohaeyo* = mandi (pancuran) · 옷을 입어요 *oseul ibeoyo* = berpakaian · 공부해요 *gongbuhaeyo* = belajar · 자요 *jayo* = tidur · 가요 *gayo* = pergi · 여덟 시에 *yeodeol sie* = jam delapan · 학교에 *hakgyoe* = ke sekolah · 열 시 *yeol si* = jam sepuluh · 텔레비전을 봐요 *tellebijeoneul bwayo* = menonton televisi (+ grammar pieces 시, 분, 이십, 열두, 세, 삼십; 7 new sentences)

**02 Belanja & uang / Shopping & money** — sticker `sticker_mango`

- Skills: `KOR-MONEY`, `KOR-SHOP`
- Focus: Sino numbers for won (백, 천, 만), clothes words, 이거 얼마예요? → 삼천 원이에요
- Patterns: N + 한/두/세 개 주세요 (native numbers shorten before a counter)
- Item mix: PRACT 12 (audio_match 3, choose 2, fill_blank 1, match_pairs 1, memory_flip 1, order 1, pick_image 1, sort_buckets 1, tiles 1) · REMED (KOR-MONEY → choose; KOR-SHOP → fill_blank)
- New words: 백 원 *baek won* = 100 won · 오백 원 *obaek won* = 500 won · 천 원 *cheon won* = 1.000 won · 만 원 *man won* = 10.000 won · 계란 네 개 *gyeran ne gae* = empat butir telur · 양말 *yangmal* = kaus kaki · 신발 *sinbal* = sepatu · 바지 *baji* = celana · 치마 *chima* = rok · 이거 *igeo* = ini (benda ini) · 빵 이천 원 *ppang icheon won* = roti 2.000 won · 오천 원 *ocheon won* = 5.000 won (+ grammar pieces 두, 개, 원, 이천, 삼백, 한, 오천; 5 new sentences)

Gem (unit 01): When it is 7 a.m. in Jakarta, it is already 9 in Seoul. Clocks in Jayapura (WIT) show exactly the same time as Seoul! — *Source:* Korea Research Institute of Standards and Science (KRISS), which keeps Korea Standard Time: KST = UTC+9 with no daylight saving; Keputusan Presiden RI No. 41 Tahun 1987 tentang Pembagian Wilayah Republik Indonesia menjadi 3 (tiga) Wilayah Waktu: WIB = UTC+7, WITA = UTC+8, WIT = UTC+9.

Daily puzzle `KOR-K-M-DP-01`: 천 원 (cheon won) + 천 원 (cheon won) = 이천 원 (icheon won). Money takes Sino numbers.

### Adults Menengah (`kor-a-m`, items `KOR-A-M-…`)

30 items (PRACT 24, REMED 4, GEM 1, SPARE 1); picture/gesture/listening share of PRACT 20/24 = 83% (with a picture on screen 17/24 = 71%); audio_match 6. Rules `config/rules.kor-a-m.json`; content version `kor-a-m-0.1`.

**01 Rutinitas & waktu / Routine & time** — sticker `sticker_leaf`

- Skills: `KOR-TIME`, `KOR-ROUTINE`
- Focus: native hours + Sino minutes (세 시 이십 분), 반, 오전/오후; workday verbs (출근해요, 퇴근해요, 운동해요, 요리해요, 청소해요)
- Patterns: time + 에; 몇 시에 …?
- Item mix: PRACT 12 (audio_match 3, choose 2, match_pairs 2, fill_blank 1, memory_flip 1, order 1, sort_buckets 1, tiles 1) · REMED (KOR-TIME → pick_image; KOR-ROUTINE → pick_image)
- New words: 아홉 시 *ahop si* = jam sembilan · 세 시 반 *se si ban* = setengah empat (3.30) · 열두 시 *yeoldu si* = jam dua belas · 여섯 시 반 *yeoseot si ban* = setengah tujuh (6.30) · 세 시 이십 분 *se si isip bun* = jam tiga lewat dua puluh (3.20) · 일어나요 *ireonayo* = bangun · 샤워해요 *syawohaeyo* = mandi (pancuran) · 옷을 입어요 *oseul ibeoyo* = berpakaian · 아침을 먹어요 *achimeul meogeoyo* = sarapan · 공부해요 *gongbuhaeyo* = belajar · 요리해요 *yorihaeyo* = memasak · 텔레비전을 봐요 *tellebijeoneul bwayo* = menonton televisi · 청소해요 *cheongsohaeyo* = bersih-bersih · 자요 *jayo* = tidur · 저는 *jeoneun* = saya (sebagai topik) · 일곱 시에 *ilgop sie* = jam tujuh · 두 시 반 *du si ban* = setengah tiga (2.30) (+ grammar pieces 마흔다섯, 사십, 사십오, 시, 분, 오십, 열한, 십오, 삼십, 두; 7 new sentences)

**02 Belanja & harga / Shopping & prices** — sticker `sticker_shell`

- Skills: `KOR-MONEY`, `KOR-SHOP`
- Focus: 만 as the unit (만오천 원, 이만오천 원, not 이십오천), clothes, counters 개/병/잔, 카드 돼요?, 좀 깎아 주세요 (markets only)
- Patterns: N + number + counter + 주세요; a shop dialogue
- Item mix: PRACT 12 (audio_match 3, choose 2, match_pairs 2, fill_blank 1, memory_flip 1, order 1, pick_image 1, tiles 1) · REMED (KOR-MONEY → choose; KOR-SHOP → pick_image) · GEM 1
- New words: 천 원 *cheon won* = 1.000 won · 만 원 *man won* = 10.000 won · 만오천 원 *manocheon won* = 15.000 won · 오만 원 *oman won* = 50.000 won · 이만오천 원 *imanocheon won* = 25.000 won · 이천오백 원 *icheonobaek won* = 2.500 won · 바지 *baji* = celana · 치마 *chima* = rok · 양말 *yangmal* = kaus kaki · 신발 *sinbal* = sepatu · 티셔츠 *tisyeocheu* = kaus · 원피스 *wonpiseu* = gaun terusan · 안경 *angyeong* = kacamata · 모자 *moja* = topi · 망고 *manggo* = mangga · 재킷 *jaekit* = jaket · 만이천 원 *manicheon won* = 12.000 won · 천이백 원 *cheonibaek won* = 1.200 won (+ grammar pieces 병, 잔, 명, 세, 개; 6 new sentences)

Gem (unit 02): The 50,000-won note (since 2009) shows Shin Saimdang, a 16th-century artist: the first woman on a Korean banknote. The 10,000-won note shows King Sejong, who created hangul. — *Source:* Bank of Korea, 'Banknotes and Coins' (bok.or.kr): the 50,000-won note, first issued on 23 June 2009, shows Shin Saimdang (1504-1551), painter and calligrapher, the first woman on a Korean banknote; the 10,000-won note shows King Sejong the Great; Encyclopaedia Britannica, 'Sin Saimdang'.

Daily puzzle `KOR-A-M-DP-01`: 만 원 (man won) − 삼천 원 (samcheon won) = 칠천 원 (chilcheon won): 10,000 − 3,000 = 7,000.

### Kids Mahir (`kor-k-h`, items `KOR-K-H-…`)

30 items (PRACT 24, REMED 4, GEM 1, SPARE 1); picture/gesture/listening share of PRACT 22/24 = 92% (with a picture on screen 22/24 = 92%); audio_match 6. Rules `config/rules.kor-k-h.json`; content version `kor-k-h-0.1`.

**01 Di kota & arah / Around town & directions** — sticker `sticker_compass`

- Skills: `KOR-TOWN`, `KOR-WAY`
- Focus: places (도서관, 은행, 식당, 우체국), 왼쪽/오른쪽/쭉 가세요, transport (버스, 배), 버스를 타요
- Patterns: place + 에 (going) vs place + 에서 (doing); N이 어디에 있어요? → 오른쪽에 있어요
- Item mix: PRACT 12 (audio_match 3, fill_blank 2, match_pairs 2, choose 1, memory_flip 1, pick_image 1, sort_buckets 1, tiles 1) · REMED (KOR-TOWN → fill_blank; KOR-WAY → pick_image)
- New words: 도서관 *doseogwan* = perpustakaan · 은행 *eunhaeng* = bank · 식당 *sikdang* = rumah makan · 우체국 *ucheguk* = kantor pos · 왼쪽 *oenjjok* = kiri · 오른쪽 *oreunjjok* = kanan · 쭉 가세요 *jjuk gaseyo* = lurus terus · 버스 *beoseu* = bus · 배 *bae* = kapal · 자전거 *jajeongeo* = sepeda · 비행기 *bihaenggi* = pesawat · 타요 *tayo* = naik · 기차를 *gichareul* = kereta (objek) · 버스를 *beoseureul* = bus (objek) (+ grammar pieces 에서, 를, 에; 5 new sentences)

**02 Cuaca, musim & kemarin / Weather, seasons & yesterday** — sticker `sticker_umbrella`

- Skills: `KOR-WEATHER`, `KOR-PAST`
- Focus: weather (맑아요, 비가 와요, 눈이 와요, 바람이 불어요, 더워요, 추워요), four seasons vs Indonesia's two
- Patterns: past -았/었어요 with 어제 (갔어요, 먹었어요, 했어요, 만들었어요)
- Item mix: PRACT 12 (audio_match 3, match_pairs 3, sort_buckets 2, choose 1, fill_blank 1, pick_image 1, tiles 1) · REMED (KOR-WEATHER → pick_image; KOR-PAST → fill_blank) · GEM 1
- New words: 맑아요 *malgayo* = cerah · 비가 와요 *biga wayo* = hujan · 눈이 와요 *nuni wayo* = turun salju · 바람이 불어요 *barami bureoyo* = berangin · 봄 *bom* = musim semi · 여름 *yeoreum* = musim panas · 가을 *gaeul* = musim gugur · 겨울 *gyeoul* = musim dingin · 가세요 *gaseyo* = silakan pergi · 갔어요 *gasseoyo* = (sudah) pergi · 오늘 *oneul* = hari ini · 어제 *eoje* = kemarin · 먹었어요 *meogeosseoyo* = (sudah) makan · 해요 *haeyo* = melakukan · 했어요 *haesseoyo* = (sudah) melakukan · 만들었어요 *mandeureosseoyo* = (sudah) membuat · 눈사람을 *nunsarameul* = boneka salju (objek) · 만들어요 *mandeureoyo* = membuat · 더워요 *deowoyo* = panas · 하세요 *haseyo* = silakan lakukan (+ 5 new sentences)

Gem (unit 02): In 1441, under King Sejong, Korea made a metal rain gauge, 측우기 (cheugugi). A year later gauges were set up all over the country to record the rain. — *Source:* Annals of the Joseon Dynasty (Sejong sillok), 1441 (23rd year of King Sejong) and 1442: a standard metal rain gauge made (1441) and set up in the capital and the provinces (1442); Encyclopedia of Korean Culture (Academy of Korean Studies, encykorea.aks.ac.kr), '측우기 (Cheugugi)'; Korea Meteorological Administration, history of Korean meteorology.

Daily puzzle `KOR-K-H-DP-01`: After 가을 (gaeul) comes 겨울 (gyeoul): spring, summer, autumn, winter.

### Adults Mahir (`kor-a-h`, items `KOR-A-H-…`)

30 items (PRACT 24, REMED 4, GEM 1, SPARE 1); picture/gesture/listening share of PRACT 22/24 = 92% (with a picture on screen 22/24 = 92%); audio_match 6. Rules `config/rules.kor-a-h.json`; content version `kor-a-h-0.1`.

**01 Arah & transportasi / Directions & transport** — sticker `sticker_boat`

- Skills: `KOR-ROUTE`, `KOR-WAY`
- Focus: 공항, 호텔, 은행, 우체국; 표, 짐, 지도, 신호등; 다리를 건너세요
- Patterns: -에서 … -까지; 얼마나 걸려요? → 삼십 분 걸려요; vehicles take 타요, places take 가요; asking the way (저기요 → … 어디에 있어요? → 감사합니다)
- Item mix: PRACT 12 (audio_match 3, match_pairs 2, choose 1, fill_blank 1, memory_flip 1, order 1, pick_image 1, sort_buckets 1, tiles 1) · REMED (KOR-ROUTE → fill_blank; KOR-WAY → pick_image)
- New words: 공항 *gonghang* = bandara · 호텔 *hotel* = hotel · 은행 *eunhaeng* = bank · 우체국 *ucheguk* = kantor pos · 쭉 가세요 *jjuk gaseyo* = lurus terus · 표 *pyo* = tiket · 짐 *jim* = barang bawaan · 신호등 *sinhodeung* = lampu lalu lintas · 타요 *tayo* = naik · 가요 *gayo* = pergi · 타세요 *taseyo* = silakan naik · 기차를 *gichareul* = kereta (objek) · 역에서 *yeogeseo* = di stasiun · 버스를 *beoseureul* = bus (objek) (+ grammar pieces 까지, 에서, 에; 8 new sentences)

**02 Cuaca & cerita kemarin / Weather & last weekend** — sticker `sticker_rice_field`

- Skills: `KOR-WEATHER`, `KOR-PAST`
- Focus: weather incl. 흐려요, seasons; weekend talk (주말에 뭐 했어요?)
- Patterns: -았어요 after ㅏ/ㅗ, -었어요 otherwise, 했어요; a day told in the past
- Item mix: PRACT 12 (audio_match 3, match_pairs 2, sort_buckets 2, choose 1, fill_blank 1, order 1, pick_image 1, tiles 1) · REMED (KOR-WEATHER → pick_image; KOR-PAST → fill_blank) · GEM 1
- New words: 맑아요 *malgayo* = cerah · 흐려요 *heuryeoyo* = mendung · 비가 와요 *biga wayo* = hujan · 눈이 와요 *nuni wayo* = turun salju · 봄 *bom* = musim semi · 여름 *yeoreum* = musim panas · 가을 *gaeul* = musim gugur · 겨울 *gyeoul* = musim dingin · 갔어요 *gasseoyo* = (sudah) pergi · 가세요 *gaseyo* = silakan pergi · 먹어요 *meogeoyo* = makan · 읽어요 *ilgeoyo* = membaca · 만나요 *mannayo* = bertemu · 마셔요 *masyeoyo* = minum · 와요 *wayo* = datang · 먹었어요 *meogeosseoyo* = (sudah) makan · 식당에서 *sikdangeseo* = di rumah makan · 어제 *eoje* = kemarin · 더워요 *deowoyo* = panas · 추워요 *chuwoyo* = dingin · 마시세요 *masiseyo* = silakan minum · 마셨어요 *masyeosseoyo* = (sudah) minum (+ grammar pieces 았어요, 었어요; 8 new sentences)

Gem (unit 02): Why 갔어요 (gasseoyo) but 먹었어요 (meogeosseoyo)? Hunminjeongeum (1446) already split the vowels: ㅏ ㅗ 'bright', ㅓ ㅜ 'dark'. Today's choice of 았/었 still follows that split. — *Source:* Hunminjeongeum Haerye (1446), chapter Jejahae: ㆍ ㅗ ㅏ ㅛ ㅑ are 'yang' vowels, ㅡ ㅜ ㅓ ㅠ ㅕ 'yin' vowels, ㅣ neutral; Ho-min Sohn, The Korean Language (Cambridge University Press, 1999), on vowel harmony in verb endings (-아/-어); National Institute of Korean Language (korean.go.kr), Standard Korean grammar of -았/-었-.

Daily puzzle `KOR-A-H-DP-01`: After 오늘 (oneul) comes 내일 (naeil), tomorrow.

### Kids Master (`kor-k-x`, items `KOR-K-X-…`)

30 items (PRACT 24, REMED 4, GEM 1, SPARE 1); picture/gesture/listening share of PRACT 21/24 = 88% (with a picture on screen 24/24 = 100%); audio_match 6. Rules `config/rules.kor-k-x.json`; content version `kor-k-x-0.1`.

**01 Teman & perasaan / Friends & feelings** — sticker `sticker_kite`

- Skills: `KOR-FEEL`, `KOR-DESCRIBE`
- Focus: 기뻐요, 슬퍼요, 화가 나요, 피곤해요; comforting a friend (괜찮아?, casual); 왜요? and a reason; describing a friend (친절해요)
- Patterns: wearing verbs by body part: 써요 (glasses, cap) / 입어요 (T-shirt, dress) / 신어요 (socks, shoes); 그래서
- Item mix: PRACT 12 (audio_match 3, choose 2, match_pairs 2, fill_blank 1, memory_flip 1, order 1, sort_buckets 1, tiles 1) · REMED (KOR-FEEL → pick_image; KOR-DESCRIBE → fill_blank)
- New words: 기뻐요 *gippeoyo* = senang · 슬퍼요 *seulpeoyo* = sedih · 화가 나요 *hwaga nayo* = marah · 피곤해요 *pigonhaeyo* = capek · 안녕히 가세요 *annyeonghi gaseyo* = selamat jalan · 안경을 써요 *angyeongeul sseoyo* = memakai kacamata · 모자를 써요 *mojareul sseoyo* = memakai topi · 티셔츠를 입어요 *tisyeocheureul ibeoyo* = memakai kaus · 신발을 신어요 *sinbareul sineoyo* = memakai sepatu · 뛰어요 *ttwieoyo* = berlari · 써요 *sseoyo* = memakai (kepala, wajah) · 입어요 *ibeoyo* = memakai (badan) · 신어요 *sineoyo* = memakai (kaki) · 추워요 *chuwoyo* = dingin · 친절해요 *chinjeolhaeyo* = baik hati · 저는 *jeoneun* = saya (sebagai topik) · 제 친구는 *je chinguneun* = temanku (+ 7 new sentences)

**02 Hobi & waktu luang / Hobbies & free time** — sticker `sticker_drum`

- Skills: `KOR-HOBBY`, `KOR-WANT`
- Focus: hobbies with their verbs: 축구를 해요, 배드민턴/기타를 쳐요, 춤을 춰요, 그림을 그려요, 사진을 찍어요
- Patterns: N을/를 좋아해요; V-고 싶어요; 같이 해요
- Item mix: PRACT 12 (audio_match 3, fill_blank 2, choose 1, match_pairs 1, memory_flip 1, order 1, pick_image 1, sort_buckets 1, tiles 1) · REMED (KOR-HOBBY → pick_image; KOR-WANT → fill_blank) · GEM 1
- New words: 축구를 해요 *chukgureul haeyo* = main sepak bola · 배드민턴을 쳐요 *baedeuminteoneul chyeoyo* = main bulu tangkis · 기타를 쳐요 *gitareul chyeoyo* = main gitar · 춤을 춰요 *chumeul chwoyo* = menari · 그려요 *geuryeoyo* = menggambar · 쳐요 *chyeoyo* = memukul / memainkan · 사진 *sajin* = foto · 낚시 *naksi* = memancing · 노래 *norae* = lagu, menyanyi · 수영 *suyeong* = renang · 싶어요 *sipeoyo* = ingin · 기타를 *gitareul* = gitar (objek) · 좋아해요 *joahaeyo* = suka · 배우고 *baeugo* = belajar (dan …) (+ 7 new sentences)

Gem (unit 02): 태권도 (taegwondo), a martial art from Korea, has been a full Olympic sport since Sydney 2000. Many Indonesian children train in taekwondo too! — *Source:* International Olympic Committee, 'Taekwondo' (olympics.com): demonstration sport at Seoul 1988 and Barcelona 1992, on the full Olympic programme since Sydney 2000; World Taekwondo (worldtaekwondo.org).

Daily puzzle `KOR-K-X-DP-01`: 축구를 해요 (chukgureul haeyo) is a hobby, not a feeling.

### Adults Master (`kor-a-x`, items `KOR-A-X-…`)

30 items (PRACT 24, REMED 4, GEM 1, SPARE 1); picture/gesture/listening share of PRACT 20/24 = 83% (with a picture on screen 20/24 = 83%); audio_match 6. Rules `config/rules.kor-a-x.json`; content version `kor-a-x-0.1`.

**01 Permintaan sopan: kantor & kafe / Polite requests: work & café** — sticker `sticker_teapot`

- Skills: `KOR-REQUEST`, `KOR-WANT`
- Focus: office things; 천천히/다시 한번 말해 주세요; café: 주문하시겠어요? → … 한 잔 주세요 → 드시고 가세요? → 포장해 주세요
- Patterns: V-아/어 주세요 (vowel harmony: 닫아, 앉아, 받아 / 열어, 찍어, 읽어), 좀 as a softener; V-고 싶어요 vs V-아/어 주세요
- Item mix: PRACT 12 (audio_match 3, choose 2, fill_blank 1, match_pairs 1, memory_flip 1, order 1, pick_image 1, sort_buckets 1, tiles 1) · REMED (KOR-REQUEST → fill_blank; KOR-WANT → choose)
- New words: 컴퓨터 *keompyuteo* = komputer · 휴대폰 *hyudaepon* = ponsel · 헤드폰 *hedeupon* = headphone · 펜 *pen* = pulpen · 싶어요 *sipeoyo* = ingin · 마시고 *masigo* = minum (dan …) · 차를 *chareul* = teh (objek) (+ grammar pieces 열고, 열어요, 열어, 아 주세요, 어 주세요, 열-, 닫-, 찍-, 앉-, 읽-, 받-, 닫고, 닫아, 닫아요; 15 new sentences)

**02 Pendapat & percakapan / Opinions & conversation** — sticker `sticker_lantern`

- Skills: `KOR-OPINION`, `KOR-DIALOGUE`
- Focus: 어때요? → 맛있어요 / 재미있어요 / 별로예요; 저도요, 맞아요, 글쎄요; an invitation and a gentle refusal
- Patterns: N보다 (더); 제 생각에는 …; V-(으)ㄹ까요?; 오늘은 좀… as a polite no
- Item mix: PRACT 12 (audio_match 3, choose 2, match_pairs 2, fill_blank 1, order 1, pick_image 1, sort_buckets 1, tiles 1) · REMED (KOR-OPINION → choose; KOR-DIALOGUE → choose) · GEM 1
- New words: 맛있어요 *masisseoyo* = enak · 비싸요 *bissayo* = mahal · 커요 *keoyo* = besar · 작아요 *jagayo* = kecil · 재미있어요 *jaemiisseoyo* = seru, menarik · 재미없어요 *jaemieopseoyo* = tidak seru · 맞아요 *majayo* = betul · 제 생각에는 *je saenggageneun* = menurut saya · 케이크가 *keikeuga* = kuenya · 케이크예요 *keikeuyeyo* = ini kue (+ grammar pieces 보다; 16 new sentences)

Gem (unit 02): Since 2021 the Oxford English Dictionary has 26 words of Korean origin, among them 대박 (daebak) = 'awesome!', 한복 (hanbok) and 오빠 (oppa). — *Source:* Oxford English Dictionary, September 2021 update: Danica Salazar, 'Daebak! The OED gets a K-update' (public.oed.com), 26 new words of Korean origin, among them daebak, hanbok and oppa.

Daily puzzle `KOR-A-X-DP-01`: 사과 (sagwa) = apple, and also an apology: 사과해요 (sagwahaeyo) = I apologise.

### 3. Common mistakes of Indonesian speakers at these levels

1. **Hours with Sino numbers** (육 시 for 6 o'clock) and **minutes with native ones** (스무 분). Hours are native
   (and 하나/둘/셋/넷/스물 shorten: 한 시, 두 시, 세 시, 네 시), minutes are Sino. A sort item per Menengah pack.
2. **Counting money in thousands.** Indonesian groups by 1.000 (dua puluh lima ribu), Korean by 10.000 (만):
   25.000 = 이만오천, not 이십오천; 12.000 = 만이천 (no 일 before 만).
3. **Native numbers before a counter** keep their long form (둘 개, 셋 개): they shorten to 두 개, 세 개.
4. **에 vs 에서.** Indonesian "di" and "ke" both map onto them unevenly: 에 = going to / being at, 에서 = doing at.
5. **Past tense chosen by meaning, not by 어제.** Learners keep 가요 after 어제; the fill items pair 어제 with the past.
   The 았/었 choice follows the last stem vowel (ㅏ/ㅗ → 았).
6. **One verb for all clothes.** Indonesian "memakai" covers everything; Korean splits 쓰다 (head, face), 입다 (body),
   신다 (feet). Instruments and racket games are "hit" (치다), not "played".
7. **Requests vs wishes.** 쉬어 주세요 (please rest) vs 쉬고 싶어요 (I want to rest); -아/어 주세요 asks someone else.
8. **Refusing too directly.** 싫어요 / 안 가요 sound blunt; 오늘은 좀… with a reason is the polite no.
9. **Hearing 드시고 가세요? as goodbye** (가세요): it asks "for here?".

### 4. Reviewer checklist

**Native Korean reviewer (blocking):**
- Every hangul string, every clip text in `ko.levels.json`, and the RR (`check.py` guarantees RR = the hangul, not that
  the hangul is the best choice).
- Time: 일곱 시 반 vs 일곱 시 삼십 분 both accepted in speech; 오후 세 시 as "3 p.m."; 여섯 시 반에 일어나요.
- Money: 만오천 원, 이만오천 원, 만이천 원 readings; 좀 깎아 주세요 presented as "at a market only"; 카드 돼요? → 네, 돼요.
- Counters: 계란 네 개, 망고 두 개, 구슬 다섯 개, 커피 두 잔, 표 두 장 (장 for tickets).
- Kids casual lines 괜찮아? and 같이 놀자! next to the polite dialogue 괜찮아요? → 아니요, 슬퍼요 → 왜요? → 강아지가 아파요.
- Hobby verbs: 배드민턴을 쳐요 / 기타를 쳐요 / 춤을 춰요; 축구하고 싶어요 (in the dialogue) next to 축구를 해요 (elsewhere).
- Wearing verbs: 모자를 써요 (a cap), 티셔츠를 입어요, 신발을 신어요; 안경을 써요.
- Café: 주문하시겠어요?, 드시고 가세요?, 아니요, 포장해 주세요, 아이스 아메리카노 한 잔 주세요.
- Requests: 앉아 주세요 / 받아 주세요 in the 아/어 sort (stems shown as 닫-, 열-, 앉-, 읽-, with RR of the bare stem,
  e.g. 읽- *ik-*: confirm this is acceptable for learners or prefer listing the 아/어 forms).
- Opinions: 별로예요 as "not great" (polite), 글쎄요, 오늘은 좀… as a complete gentle refusal, 제 생각에는 케이크가 맛있어요.
- Clip notes: `ko/se` style bare short numbers are not recorded (p_ cards); `ko/sagwa`, `ko/eolmayeyo`, `ko/juseyo`,
  `ko/eoseo_oseyo`, `ko/jeogiyo`, `ko/gamsahamnida`, `ko/gyesanhae_juseyo` and others are reused from `ko.json`.

**Indonesian and English reviewers:** EYD V, "kamu" (kids) / "Anda" (adults), prompts ≤ 6 words, natural time
glosses (setengah delapan = 7.30), Indonesian number formats (1.000 / 1,000 in English).

**Subject/content:** the six gems and their sources (time zones, banknotes, the 1441 rain gauge, vowel harmony in
Hunminjeongeum, taekwondo at the Olympics, the 2021 OED update).

### 5. Open questions

1. **Art:** 51 keys from contract §6 are used and still being drawn (validator: "unknown art key" until they land).
   `pic_beach` stands for summer, `pic_snowman` for winter, `pic_big`/`pic_small` (a ball beside a cat) for 커요/작아요,
   `math_money_notes` for 비싸요, `val_help_friend` for 친절해요, `pic_tired` for 쉬고 싶어요.
2. **No subway or taxi picture** (지하철, 택시 are on the screen only); 기차 + `pic_station` carries the transport tiles.
3. **Clock art has only :00 and :30**, so minutes are tested with text times ("3:20", "14.45").
4. **Stems with a hyphen** (닫-, 열-) in one adult sort item; alternative: sort the 아/어 주세요 forms themselves.
5. **Kids' reasons** use 그래서 between two sentences; -아서/어서 is left for later levels.
6. Units 03+ of each level are not written yet (starter = 2 units, contract §1).
