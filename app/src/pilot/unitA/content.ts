// Unit A pilot content: synthetic, constructed draft — not reviewer-approved.
// Per construct: four practice, two held-out transfer, two d7 and two d30
// delayed-check items (20 total). validatePilotContent checks provenance, shape
// and that reserved assessment solutions (stem and full keyed answer) stay out of
// lessons and earlier phases and are not shared between assessment items.

export type PilotConstruct = 'reference' | 'agreement';
export type PilotPhase = 'practice' | 'transfer' | 'd7' | 'd30';

export interface PilotGloss {
  readonly arabic: string;
  readonly meaning: string;
}

export interface PilotOption {
  readonly id: string;
  readonly text: string;
  readonly correct: boolean;
  readonly feedback: string;
}

export interface PilotExample {
  readonly arabic: string;
  readonly glosses: readonly PilotGloss[];
  readonly meaning: string;
  readonly explanation: string;
}

export interface PilotLesson {
  readonly id: string;
  readonly construct: PilotConstruct;
  readonly title: string;
  readonly body: readonly string[];
  readonly examples: readonly PilotExample[];
}

export interface PilotItem {
  readonly id: string;
  readonly construct: PilotConstruct;
  readonly family: string;
  readonly phase: PilotPhase;
  readonly lessonId: string;
  readonly arabic: string;
  readonly prompt: string;
  readonly glosses: readonly PilotGloss[];
  readonly options: readonly PilotOption[];
  readonly reviewStatus: 'draft';
  readonly constructed: true;
}

export interface PilotContent {
  readonly contentVersion: 'unit-a-pilot-draft-0.1';
  readonly policyVersion: 'unit-a-evidence-provisional-0.1';
  readonly synthetic: true;
  readonly constructed: true;
  readonly reviewStatus: 'draft';
  readonly lessons: readonly PilotLesson[];
  readonly items: readonly PilotItem[];
}

const REFERENCE_LESSON_ID = 'ua-d01-ref-lesson';
const AGREEMENT_LESSON_ID = 'ua-d01-agr-lesson';

export const PILOT_CONTENT: PilotContent = {
  contentVersion: 'unit-a-pilot-draft-0.1',
  policyVersion: 'unit-a-evidence-provisional-0.1',
  synthetic: true,
  constructed: true,
  reviewStatus: 'draft',
  lessons: [
    {
      id: REFERENCE_LESSON_ID,
      construct: 'reference',
      title: 'Kata ganti tunggal: siapa yang dimaksud?',
      body: [
        'Di unit ini kita mempelajari pola kalimat nominal sederhana masa kini: kata ganti + keterangan, tanpa kata khusus untuk "adalah". Ini bukan definisi semua kalimat nominal; subjeknya juga dapat berupa kata benda.',
        'أَنَا = aku (si pembicara). هُوَ = dia laki-laki. هِيَ = dia perempuan.',
        'أَنْتَ = kamu laki-laki, أَنْتِ = kamu perempuan. Bedanya hanya harakat huruf terakhir: fathah atau kasrah.',
        'Tentukan dulu siapa yang dimaksud kata ganti, lalu baca arti keterangannya dari glosa.',
      ],
      examples: [
        {
          arabic: 'أَنَا طَالِبٌ.',
          glosses: [{ arabic: 'طَالِبٌ', meaning: 'pelajar' }],
          meaning: 'Aku seorang pelajar.',
          explanation:
            'أَنَا menunjuk si pembicara sendiri, dan طَالِبٌ menerangkannya. Jadi yang pelajar adalah orang yang sedang berbicara, bukan orang lain.',
        },
      ],
    },
    {
      id: AGREEMENT_LESSON_ID,
      construct: 'agreement',
      title: 'Kata sifat mengikuti jenis yang diterangkan',
      body: [
        'Dalam pola kalimat di unit ini, kata sifat sebagai keterangan mengikuti jenis gramatikal (maskulin atau feminin) subjeknya. Untuk benda, jenis gramatikal bukan jenis kelamin biologis.',
        'Pada bentuk kata sifat tunggal beraturan yang dipakai di unit ini, bentuk feminin ditandai ـَةٌ, misalnya كَبِيرٌ → كَبِيرَةٌ. Pola ini tidak berlaku untuk semua kata sifat.',
        'Akhiran ـَة sering menandai kata benda feminin, tetapi bukan aturan pasti: ada kata benda feminin tanpa ـَة. Jadi, tidak adanya ـَة belum membuktikan maskulin. Di soal latihan ini jenisnya selalu disebutkan; pakailah keterangan itu.',
        'Dengan kata sifat beraturan di unit ini, هُوَ dan أَنْتَ memakai bentuk maskulin; هِيَ dan أَنْتِ memakai bentuk feminin dengan ـَةٌ.',
        'أَنَا tidak punya bentuk maskulin atau feminin. Sifatnya mengikuti jenis orang yang sebenarnya berbicara, jadi perhatikan konteksnya.',
      ],
      examples: [
        {
          arabic: 'الْحَدِيقَةُ جَمِيلَةٌ.',
          glosses: [
            { arabic: 'الْحَدِيقَةُ', meaning: 'taman itu' },
            { arabic: 'جَمِيلَةٌ', meaning: 'indah' },
          ],
          meaning: 'Taman itu indah.',
          explanation:
            'الْحَدِيقَةُ feminin (di sini ditandai akhiran ـَة). Karena itu sifatnya juga feminin: جَمِيلَةٌ, bukan bentuk dasar جَمِيلٌ.',
        },
        {
          arabic: 'أَنَا مُجْتَهِدَةٌ.',
          glosses: [
            { arabic: 'أَنَا', meaning: 'aku' },
            { arabic: 'مُجْتَهِدَةٌ', meaning: 'rajin (bentuk feminin)' },
          ],
          meaning: 'Aku (perempuan) rajin.',
          explanation:
            'Konteks: yang berbicara seorang perempuan. أَنَا sendiri tidak menunjukkan jenis, jadi sifatnya mengikuti si pembicara: مُجْتَهِدَةٌ. Jika yang berbicara laki-laki, kalimatnya أَنَا مُجْتَهِدٌ.',
        },
      ],
    },
  ],
  items: [
    {
      id: 'ua-d01-ref-p01',
      construct: 'reference',
      family: 'ua-ref-practice-third-person-meaning',
      phase: 'practice',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'هُوَ كَاتِبٌ.',
      prompt: 'Apa arti kalimat ini?',
      glosses: [{ arabic: 'كَاتِبٌ', meaning: 'penulis' }],
      options: [
        {
          id: 'a',
          text: 'Dia (perempuan) seorang penulis.',
          correct: false,
          feedback: 'هُوَ berarti dia laki-laki. Dia perempuan adalah هِيَ.',
        },
        {
          id: 'b',
          text: 'Dia (laki-laki) seorang penulis.',
          correct: true,
          feedback: 'Tepat. هُوَ = dia laki-laki, dan كَاتِبٌ = penulis.',
        },
        {
          id: 'c',
          text: 'Aku seorang penulis.',
          correct: false,
          feedback: 'Aku adalah أَنَا. هُوَ menunjuk orang ketiga, bukan si pembicara.',
        },
        {
          id: 'd',
          text: 'Dia (laki-laki) seorang pembaca.',
          correct: false,
          feedback: 'Kata gantinya benar, tetapi كَاتِبٌ berarti penulis, bukan pembaca.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-p02',
      construct: 'reference',
      family: 'ua-ref-practice-role-and-predicate',
      phase: 'practice',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'أَنْتَ تَاجِرٌ.',
      prompt: 'Siapa yang diterangkan kalimat ini, dan apa keterangannya?',
      glosses: [{ arabic: 'تَاجِرٌ', meaning: 'pedagang' }],
      options: [
        {
          id: 'a',
          text: 'Lawan bicara perempuan; ia seorang pedagang.',
          correct: false,
          feedback: 'Untuk perempuan tertulis أَنْتِ (kasrah). Di sini akhirnya fathah: أَنْتَ, lawan bicara laki-laki.',
        },
        {
          id: 'b',
          text: 'Si pembicara sendiri; ia seorang pedagang.',
          correct: false,
          feedback: 'Si pembicara memakai أَنَا. أَنْتَ menunjuk orang yang diajak bicara.',
        },
        {
          id: 'c',
          text: 'Lawan bicara laki-laki; ia seorang pedagang.',
          correct: true,
          feedback: 'Tepat. أَنْتَ (fathah) = kamu laki-laki, dan تَاجِرٌ = pedagang.',
        },
        {
          id: 'd',
          text: 'Lawan bicara laki-laki; ia seorang pembeli.',
          correct: false,
          feedback: 'Orangnya benar, tetapi تَاجِرٌ berarti pedagang, bukan pembeli.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-p03',
      construct: 'reference',
      family: 'ua-ref-practice-two-referents',
      phase: 'practice',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'أَنَا طَبِيبٌ، وَهِيَ مُمَرِّضَةٌ.',
      prompt: 'Menurut kalimat ini, siapa yang menjadi perawat?',
      glosses: [
        { arabic: 'طَبِيبٌ', meaning: 'dokter' },
        { arabic: 'وَ', meaning: 'dan' },
        { arabic: 'مُمَرِّضَةٌ', meaning: 'perawat' },
      ],
      options: [
        {
          id: 'a',
          text: 'Si pembicara.',
          correct: false,
          feedback: 'أَنَا (si pembicara) dipasangkan dengan طَبِيبٌ = dokter, bukan perawat.',
        },
        {
          id: 'b',
          text: 'Lawan bicara perempuan.',
          correct: false,
          feedback: 'Lawan bicara perempuan adalah أَنْتِ. Kalimat ini memakai هِيَ: orang ketiga yang dibicarakan.',
        },
        {
          id: 'c',
          text: 'Laki-laki yang dibicarakan.',
          correct: false,
          feedback: 'Dia laki-laki adalah هُوَ. Di sini tertulis هِيَ, yaitu dia perempuan.',
        },
        {
          id: 'd',
          text: 'Perempuan yang dibicarakan.',
          correct: true,
          feedback: 'Tepat. هِيَ (dia perempuan) dipasangkan dengan مُمَرِّضَةٌ = perawat.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-p04',
      construct: 'reference',
      family: 'ua-ref-practice-address-gender',
      phase: 'practice',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'أَنْتِ مُهَنْدِسَةٌ.',
      prompt: 'Apa arti kalimat ini?',
      glosses: [{ arabic: 'مُهَنْدِسَةٌ', meaning: 'insinyur' }],
      options: [
        {
          id: 'a',
          text: 'Kamu (perempuan) seorang insinyur.',
          correct: true,
          feedback: 'Tepat. أَنْتِ (kasrah) = kamu perempuan, dan مُهَنْدِسَةٌ = insinyur.',
        },
        {
          id: 'b',
          text: 'Kamu (laki-laki) seorang insinyur.',
          correct: false,
          feedback: 'Kamu laki-laki adalah أَنْتَ (fathah). Di sini huruf terakhirnya berkasrah: أَنْتِ, kamu perempuan.',
        },
        {
          id: 'c',
          text: 'Dia (perempuan) seorang insinyur.',
          correct: false,
          feedback: 'Dia perempuan adalah هِيَ. أَنْتِ menunjuk orang yang diajak bicara, bukan yang dibicarakan.',
        },
        {
          id: 'd',
          text: 'Kamu (perempuan) seorang guru.',
          correct: false,
          feedback: 'Kata gantinya benar, tetapi مُهَنْدِسَةٌ berarti insinyur, bukan guru.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-p01',
      construct: 'agreement',
      family: 'ua-agr-practice-feminine-inanimate-v1',
      phase: 'practice',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'الْمَدْرَسَةُ',
      prompt:
        'الْمَدْرَسَةُ feminin (berakhiran ـَة). Kalimat mana yang berarti "Sekolah itu besar" dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'الْمَدْرَسَةُ', meaning: 'sekolah itu' },
        { arabic: 'كَبِيرٌ', meaning: 'besar (bentuk dasar)' },
        { arabic: 'صَغِيرٌ', meaning: 'kecil (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'الْمَدْرَسَةُ كَبِيرٌ.',
          correct: false,
          feedback: 'كَبِيرٌ bentuk dasar untuk benda maskulin. الْمَدْرَسَةُ feminin, jadi sifatnya perlu ـَةٌ.',
        },
        {
          id: 'b',
          text: 'الْمَدْرَسَةُ صَغِيرَةٌ.',
          correct: false,
          feedback: 'Akhirannya cocok, tetapi صَغِيرَةٌ berarti kecil, bukan besar.',
        },
        {
          id: 'c',
          text: 'الْمَدْرَسَةُ كَبِيرَةٌ.',
          correct: true,
          feedback: 'Tepat. الْمَدْرَسَةُ feminin, maka sifatnya ditambah ـَةٌ: كَبِيرَةٌ.',
        },
        {
          id: 'd',
          text: 'الْمَدْرَسَةُ كَبِيرَتَانِ.',
          correct: false,
          feedback: 'ـَتَانِ menandai dua. Sekolahnya hanya satu, jadi sifatnya tunggal: كَبِيرَةٌ.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-p02',
      construct: 'agreement',
      family: 'ua-agr-practice-masculine-inanimate-v1',
      phase: 'practice',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'الْبَيْتُ',
      prompt:
        'الْبَيْتُ maskulin. Kalimat mana yang berarti "Rumah itu baru" dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'الْبَيْتُ', meaning: 'rumah itu' },
        { arabic: 'جَدِيدٌ', meaning: 'baru (bentuk dasar)' },
        { arabic: 'قَدِيمٌ', meaning: 'lama (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'الْبَيْتُ جَدِيدٌ.',
          correct: true,
          feedback: 'Tepat. الْبَيْتُ maskulin, maka sifatnya tetap bentuk dasar: جَدِيدٌ.',
        },
        {
          id: 'b',
          text: 'الْبَيْتُ جَدِيدَةٌ.',
          correct: false,
          feedback: 'ـَةٌ pada sifat dipakai untuk benda feminin. الْبَيْتُ maskulin (seperti disebut di soal), jadi sifatnya tetap bentuk dasar tanpa ـَةٌ.',
        },
        {
          id: 'c',
          text: 'الْبَيْتُ قَدِيمٌ.',
          correct: false,
          feedback: 'Akhirannya cocok, tetapi قَدِيمٌ berarti lama, bukan baru.',
        },
        {
          id: 'd',
          text: 'الْبَيْتُ جَدِيدَانِ.',
          correct: false,
          feedback: 'ـَانِ menandai dua. Rumahnya hanya satu, jadi sifatnya tunggal: جَدِيدٌ.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-p03',
      construct: 'agreement',
      family: 'ua-agr-practice-feminine-person-v1',
      phase: 'practice',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'الطَّالِبَةُ',
      prompt:
        'الطَّالِبَةُ = satu pelajar perempuan. Kalimat mana yang berarti "Pelajar (perempuan) itu rajin" dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'الطَّالِبَةُ', meaning: 'pelajar (perempuan) itu' },
        { arabic: 'مُجْتَهِدٌ', meaning: 'rajin (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'الطَّالِبُ مُجْتَهِدٌ.',
          correct: false,
          feedback: 'Kalimat ini cocok, tetapi الطَّالِبُ berarti pelajar laki-laki. Yang diminta pelajar perempuan: الطَّالِبَةُ.',
        },
        {
          id: 'b',
          text: 'الطَّالِبَةُ مُجْتَهِدٌ.',
          correct: false,
          feedback: 'Kata bendanya feminin, tetapi sifatnya masih bentuk dasar. Untuk الطَّالِبَةُ, sifatnya perlu ـَةٌ.',
        },
        {
          id: 'c',
          text: 'الطَّالِبَةُ مُجْتَهِدَاتٌ.',
          correct: false,
          feedback: 'ـَاتٌ menandai banyak (jamak). Pelajarnya hanya satu, jadi sifatnya tunggal: مُجْتَهِدَةٌ.',
        },
        {
          id: 'd',
          text: 'الطَّالِبَةُ مُجْتَهِدَةٌ.',
          correct: true,
          feedback: 'Tepat. الطَّالِبَةُ feminin dan tunggal, maka sifatnya مُجْتَهِدَةٌ.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-p04',
      construct: 'agreement',
      family: 'ua-agr-practice-two-nouns-mixed-gender-v1',
      phase: 'practice',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'الْبَابُ وَالنَّافِذَةُ',
      prompt:
        'الْبَابُ maskulin, النَّافِذَةُ feminin. Kalimat mana yang berarti "Pintu itu terbuka dan jendela itu tertutup" dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'الْبَابُ', meaning: 'pintu itu' },
        { arabic: 'وَ', meaning: 'dan' },
        { arabic: 'النَّافِذَةُ', meaning: 'jendela itu' },
        { arabic: 'مَفْتُوحٌ', meaning: 'terbuka (bentuk dasar)' },
        { arabic: 'مُغْلَقٌ', meaning: 'tertutup (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'الْبَابُ مَفْتُوحَةٌ وَالنَّافِذَةُ مُغْلَقٌ.',
          correct: false,
          feedback: 'Akhirannya tertukar. ـَةٌ milik sifat untuk النَّافِذَةُ (feminin), bukan untuk الْبَابُ (maskulin).',
        },
        {
          id: 'b',
          text: 'الْبَابُ مَفْتُوحٌ وَالنَّافِذَةُ مُغْلَقَةٌ.',
          correct: true,
          feedback: 'Tepat. الْبَابُ maskulin → مَفْتُوحٌ; النَّافِذَةُ feminin → مُغْلَقَةٌ.',
        },
        {
          id: 'c',
          text: 'الْبَابُ مَفْتُوحٌ وَالنَّافِذَةُ مُغْلَقٌ.',
          correct: false,
          feedback: 'Setiap sifat mengikuti kata bendanya sendiri. النَّافِذَةُ feminin, jadi sifatnya perlu ـَةٌ: مُغْلَقَةٌ.',
        },
        {
          id: 'd',
          text: 'الْبَابُ مُغْلَقٌ وَالنَّافِذَةُ مَفْتُوحَةٌ.',
          correct: false,
          feedback: 'Akhirannya cocok, tetapi artinya terbalik: pintu itu tertutup dan jendela itu terbuka.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-t01',
      construct: 'reference',
      family: 'ua-ref-transfer-addressee-and-third-statement-v1',
      phase: 'transfer',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'هِيَ خَيَّاطَةٌ، وَأَنْتَ فَلَّاحٌ.',
      prompt: 'Pernyataan mana yang benar menurut kalimat ini?',
      glosses: [
        { arabic: 'خَيَّاطَةٌ', meaning: 'penjahit' },
        { arabic: 'وَ', meaning: 'dan' },
        { arabic: 'فَلَّاحٌ', meaning: 'petani' },
      ],
      options: [
        {
          id: 'a',
          text: 'Lawan bicara perempuan itu seorang petani.',
          correct: false,
          feedback: 'Lawan bicara perempuan adalah أَنْتِ (kasrah). Di sini tertulis أَنْتَ (fathah): lawan bicara laki-laki.',
        },
        {
          id: 'b',
          text: 'Lawan bicara laki-laki itu seorang petani.',
          correct: true,
          feedback: 'Tepat. أَنْتَ (fathah) = kamu laki-laki, dan ia dipasangkan dengan فَلَّاحٌ = petani.',
        },
        {
          id: 'c',
          text: 'Lawan bicara laki-laki itu seorang penjahit.',
          correct: false,
          feedback: 'خَيَّاطَةٌ (penjahit) dipasangkan dengan هِيَ, perempuan yang dibicarakan. أَنْتَ dipasangkan dengan فَلَّاحٌ.',
        },
        {
          id: 'd',
          text: 'Si pembicara seorang petani.',
          correct: false,
          feedback: 'Si pembicara memakai أَنَا, dan kata itu tidak ada di kalimat ini. فَلَّاحٌ menerangkan أَنْتَ, yang diajak bicara.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-t02',
      construct: 'reference',
      family: 'ua-ref-transfer-scenario-to-sentence-v1',
      phase: 'transfer',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'طَبَّاخٌ',
      prompt:
        'Seorang perempuan berbicara langsung kepada temannya yang laki-laki: "Kamu seorang juru masak." Kalimat Arab mana yang tepat?',
      glosses: [
        { arabic: 'طَبَّاخٌ', meaning: 'juru masak (laki-laki)' },
        { arabic: 'طَبَّاخَةٌ', meaning: 'juru masak (perempuan)' },
        { arabic: 'صَيَّادٌ', meaning: 'nelayan' },
      ],
      options: [
        {
          id: 'a',
          text: 'أَنْتِ طَبَّاخَةٌ.',
          correct: false,
          feedback: 'أَنْتِ (kasrah) untuk lawan bicara perempuan. Kata ganti "kamu" mengikuti orang yang diajak bicara (laki-laki), bukan si pembicara.',
        },
        {
          id: 'b',
          text: 'هُوَ طَبَّاخٌ.',
          correct: false,
          feedback: 'هُوَ = dia laki-laki yang dibicarakan. Temannya diajak bicara langsung, jadi kata gantinya "kamu".',
        },
        {
          id: 'c',
          text: 'أَنْتَ صَيَّادٌ.',
          correct: false,
          feedback: 'Kata gantinya benar, tetapi صَيَّادٌ berarti nelayan, bukan juru masak.',
        },
        {
          id: 'd',
          text: 'أَنْتَ طَبَّاخٌ.',
          correct: true,
          feedback: 'Tepat. أَنْتَ (fathah) = kamu laki-laki, dan طَبَّاخٌ = juru masak.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-t01',
      construct: 'agreement',
      family: 'ua-agr-transfer-addressee-pronoun-v1',
      phase: 'transfer',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'ذَكِيٌّ',
      prompt:
        'Seorang guru memuji langsung satu murid perempuan: "Kamu cerdas." Kalimat mana yang tepat, dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'ذَكِيٌّ', meaning: 'cerdas (bentuk dasar)' },
        { arabic: 'بَطِيءٌ', meaning: 'lambat (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'أَنْتِ ذَكِيٌّ.',
          correct: false,
          feedback: 'Kata gantinya benar, tetapi sifatnya masih bentuk dasar. Yang dipuji perempuan, jadi sifatnya perlu ـَةٌ: ذَكِيَّةٌ.',
        },
        {
          id: 'b',
          text: 'أَنْتَ ذَكِيٌّ.',
          correct: false,
          feedback: 'Kalimat ini cocok untuk lawan bicara laki-laki (أَنْتَ, fathah). Muridnya perempuan, jadi pakai أَنْتِ dan ذَكِيَّةٌ.',
        },
        {
          id: 'c',
          text: 'أَنْتِ ذَكِيَّةٌ.',
          correct: true,
          feedback: 'Tepat. أَنْتِ = kamu perempuan, maka sifatnya ditambah ـَةٌ: ذَكِيَّةٌ.',
        },
        {
          id: 'd',
          text: 'أَنْتِ بَطِيئَةٌ.',
          correct: false,
          feedback: 'Kata ganti dan akhirannya cocok, tetapi بَطِيئَةٌ berarti lambat, bukan cerdas.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-t02',
      construct: 'agreement',
      family: 'ua-agr-transfer-speaker-pronoun-v1',
      phase: 'transfer',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'مُتْعَبٌ',
      prompt:
        'Seorang perempuan berkata tentang dirinya sendiri: "Aku lelah." Kalimat mana yang tepat, dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'مُتْعَبٌ', meaning: 'lelah (bentuk dasar)' },
        { arabic: 'مُرْتَاحٌ', meaning: 'segar, cukup istirahat (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'أَنَا مُتْعَبَةٌ.',
          correct: true,
          feedback: 'Tepat. أَنَا menunjuk si pembicara, yang perempuan, maka sifatnya ditambah ـَةٌ: مُتْعَبَةٌ.',
        },
        {
          id: 'b',
          text: 'أَنَا مُتْعَبٌ.',
          correct: false,
          feedback: 'أَنَا sendiri tidak menunjukkan jenis; sifatnya mengikuti si pembicara. Pembicaranya perempuan, jadi sifatnya perlu ـَةٌ: مُتْعَبَةٌ.',
        },
        {
          id: 'c',
          text: 'أَنْتِ مُتْعَبَةٌ.',
          correct: false,
          feedback: 'Akhirannya cocok, tetapi أَنْتِ berarti kamu (perempuan). Ia berbicara tentang dirinya sendiri, jadi kata gantinya أَنَا.',
        },
        {
          id: 'd',
          text: 'أَنَا مُرْتَاحَةٌ.',
          correct: false,
          feedback: 'Kata ganti dan akhirannya cocok, tetapi مُرْتَاحَةٌ berarti segar, bukan lelah.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-d7-01',
      construct: 'reference',
      family: 'ua-ref-d7-speaker-and-third-statement-v1',
      phase: 'd7',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'هُوَ سَائِقٌ، وَأَنَا حَارِسٌ.',
      prompt: 'Pernyataan mana yang benar menurut kalimat ini?',
      glosses: [
        { arabic: 'سَائِقٌ', meaning: 'sopir' },
        { arabic: 'وَ', meaning: 'dan' },
        { arabic: 'حَارِسٌ', meaning: 'penjaga' },
      ],
      options: [
        {
          id: 'a',
          text: 'Laki-laki yang dibicarakan itu seorang penjaga.',
          correct: false,
          feedback: 'هُوَ (dia laki-laki) dipasangkan dengan سَائِقٌ = sopir, bukan penjaga.',
        },
        {
          id: 'b',
          text: 'Si pembicara seorang sopir.',
          correct: false,
          feedback: 'أَنَا (si pembicara) dipasangkan dengan حَارِسٌ = penjaga. Yang sopir adalah هُوَ.',
        },
        {
          id: 'c',
          text: 'Si pembicara seorang penjaga.',
          correct: true,
          feedback: 'Tepat. أَنَا = si pembicara, dan ia dipasangkan dengan حَارِسٌ = penjaga.',
        },
        {
          id: 'd',
          text: 'Lawan bicara laki-laki itu seorang penjaga.',
          correct: false,
          feedback: 'Lawan bicara laki-laki memakai أَنْتَ, dan kata itu tidak ada di kalimat ini. حَارِسٌ menerangkan أَنَا.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-d7-02',
      construct: 'reference',
      family: 'ua-ref-d7-sentence-to-situation-v1',
      phase: 'd7',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'أَنْتِ مُحَامِيَةٌ.',
      prompt: 'Dalam situasi mana kalimat ini tepat diucapkan?',
      glosses: [{ arabic: 'مُحَامِيَةٌ', meaning: 'pengacara' }],
      options: [
        {
          id: 'a',
          text: 'Kepada teman perempuan: "Kamu seorang pengacara."',
          correct: true,
          feedback: 'Tepat. أَنْتِ (kasrah) = kamu perempuan, dan مُحَامِيَةٌ = pengacara.',
        },
        {
          id: 'b',
          text: 'Kepada teman laki-laki: "Kamu seorang pengacara."',
          correct: false,
          feedback: 'Kamu laki-laki adalah أَنْتَ (fathah). Di sini huruf terakhirnya berkasrah: أَنْتِ, kamu perempuan.',
        },
        {
          id: 'c',
          text: 'Tentang perempuan lain: "Dia seorang pengacara."',
          correct: false,
          feedback: 'Dia perempuan adalah هِيَ. أَنْتِ dipakai saat berbicara langsung kepada orangnya.',
        },
        {
          id: 'd',
          text: 'Kepada teman perempuan: "Kamu seorang hakim."',
          correct: false,
          feedback: 'Kata gantinya benar, tetapi مُحَامِيَةٌ berarti pengacara, bukan hakim.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-d30-01',
      construct: 'reference',
      family: 'ua-ref-d30-speaker-and-addressee-statement-v1',
      phase: 'd30',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'أَنَا خَبَّازٌ، وَأَنْتِ بَائِعَةٌ.',
      prompt: 'Pernyataan mana yang benar menurut kalimat ini?',
      glosses: [
        { arabic: 'خَبَّازٌ', meaning: 'tukang roti' },
        { arabic: 'وَ', meaning: 'dan' },
        { arabic: 'بَائِعَةٌ', meaning: 'penjual' },
      ],
      options: [
        {
          id: 'a',
          text: 'Lawan bicara laki-laki itu seorang penjual.',
          correct: false,
          feedback: 'Lawan bicara laki-laki adalah أَنْتَ (fathah). Di sini tertulis أَنْتِ (kasrah): lawan bicara perempuan.',
        },
        {
          id: 'b',
          text: 'Si pembicara seorang penjual.',
          correct: false,
          feedback: 'أَنَا (si pembicara) dipasangkan dengan خَبَّازٌ = tukang roti, bukan penjual.',
        },
        {
          id: 'c',
          text: 'Lawan bicara perempuan itu seorang tukang roti.',
          correct: false,
          feedback: 'خَبَّازٌ (tukang roti) dipasangkan dengan أَنَا. أَنْتِ dipasangkan dengan بَائِعَةٌ.',
        },
        {
          id: 'd',
          text: 'Lawan bicara perempuan itu seorang penjual.',
          correct: true,
          feedback: 'Tepat. أَنْتِ (kasrah) = kamu perempuan, dan ia dipasangkan dengan بَائِعَةٌ = penjual.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-ref-d30-02',
      construct: 'reference',
      family: 'ua-ref-d30-third-person-scenario-v1',
      phase: 'd30',
      lessonId: REFERENCE_LESSON_ID,
      arabic: 'نَجَّارٌ',
      prompt:
        'Kamu bercerita kepada temanmu tentang seorang laki-laki yang tidak ada di situ: "Dia seorang tukang kayu." Kalimat Arab mana yang tepat?',
      glosses: [
        { arabic: 'نَجَّارٌ', meaning: 'tukang kayu (laki-laki)' },
        { arabic: 'نَجَّارَةٌ', meaning: 'tukang kayu (perempuan)' },
        { arabic: 'حَدَّادٌ', meaning: 'pandai besi' },
      ],
      options: [
        {
          id: 'a',
          text: 'أَنْتَ نَجَّارٌ.',
          correct: false,
          feedback: 'أَنْتَ = kamu laki-laki, untuk orang yang diajak bicara. Laki-laki itu hanya dibicarakan, jadi kata gantinya "dia".',
        },
        {
          id: 'b',
          text: 'هُوَ نَجَّارٌ.',
          correct: true,
          feedback: 'Tepat. هُوَ = dia laki-laki yang dibicarakan, dan نَجَّارٌ = tukang kayu.',
        },
        {
          id: 'c',
          text: 'هِيَ نَجَّارَةٌ.',
          correct: false,
          feedback: 'هِيَ = dia perempuan. Yang dibicarakan laki-laki, jadi kata gantinya هُوَ.',
        },
        {
          id: 'd',
          text: 'هُوَ حَدَّادٌ.',
          correct: false,
          feedback: 'Kata gantinya benar, tetapi حَدَّادٌ berarti pandai besi, bukan tukang kayu.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-d7-01',
      construct: 'agreement',
      family: 'ua-agr-d7-feminine-room-size-v1',
      phase: 'd7',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'الْغُرْفَةُ',
      prompt:
        'الْغُرْفَةُ feminin (berakhiran ـَة). Kalimat mana yang berarti "Kamar itu luas" dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'الْغُرْفَةُ', meaning: 'kamar itu' },
        { arabic: 'وَاسِعٌ', meaning: 'luas (bentuk dasar)' },
        { arabic: 'ضَيِّقٌ', meaning: 'sempit (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'الْغُرْفَةُ وَاسِعٌ.',
          correct: false,
          feedback: 'وَاسِعٌ bentuk dasar untuk benda maskulin. الْغُرْفَةُ feminin, jadi sifatnya perlu ـَةٌ.',
        },
        {
          id: 'b',
          text: 'الْغُرْفَةُ ضَيِّقَةٌ.',
          correct: false,
          feedback: 'Akhirannya cocok, tetapi ضَيِّقَةٌ berarti sempit, bukan luas.',
        },
        {
          id: 'c',
          text: 'الْغُرْفَةُ وَاسِعَاتٌ.',
          correct: false,
          feedback: 'ـَاتٌ menandai banyak (jamak). Kamarnya hanya satu, jadi sifatnya tunggal: وَاسِعَةٌ.',
        },
        {
          id: 'd',
          text: 'الْغُرْفَةُ وَاسِعَةٌ.',
          correct: true,
          feedback: 'Tepat. الْغُرْفَةُ feminin dan tunggal, maka sifatnya ditambah ـَةٌ: وَاسِعَةٌ.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-d7-02',
      construct: 'agreement',
      family: 'ua-agr-d7-masculine-person-v1',
      phase: 'd7',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'الْوَلَدُ',
      prompt:
        'الْوَلَدُ = satu anak laki-laki (maskulin). Kalimat mana yang berarti "Anak laki-laki itu gembira" dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'الْوَلَدُ', meaning: 'anak laki-laki itu' },
        { arabic: 'سَعِيدٌ', meaning: 'gembira (bentuk dasar)' },
        { arabic: 'حَزِينٌ', meaning: 'sedih (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'الْوَلَدُ سَعِيدٌ.',
          correct: true,
          feedback: 'Tepat. الْوَلَدُ maskulin dan tunggal, maka sifatnya tetap bentuk dasar: سَعِيدٌ.',
        },
        {
          id: 'b',
          text: 'الْوَلَدُ سَعِيدَةٌ.',
          correct: false,
          feedback: 'ـَةٌ hanya ditambahkan untuk kata benda feminin. الْوَلَدُ maskulin, jadi sifatnya tanpa ـَةٌ.',
        },
        {
          id: 'c',
          text: 'الْوَلَدُ حَزِينٌ.',
          correct: false,
          feedback: 'Akhirannya cocok, tetapi حَزِينٌ berarti sedih, bukan gembira.',
        },
        {
          id: 'd',
          text: 'الْوَلَدُ سَعِيدَانِ.',
          correct: false,
          feedback: 'ـَانِ menandai dua. Anaknya hanya satu, jadi sifatnya tunggal: سَعِيدٌ.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-d30-01',
      construct: 'agreement',
      family: 'ua-agr-d30-two-nouns-feminine-first-v1',
      phase: 'd30',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'الشَّجَرَةُ وَالنَّهْرُ',
      prompt:
        'الشَّجَرَةُ feminin, النَّهْرُ maskulin. Kalimat mana yang berarti "Pohon itu tinggi dan sungai itu dalam" dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'الشَّجَرَةُ', meaning: 'pohon itu' },
        { arabic: 'وَ', meaning: 'dan' },
        { arabic: 'النَّهْرُ', meaning: 'sungai itu' },
        { arabic: 'طَوِيلٌ', meaning: 'tinggi (bentuk dasar)' },
        { arabic: 'عَمِيقٌ', meaning: 'dalam (bentuk dasar)' },
        { arabic: 'قَصِيرٌ', meaning: 'pendek (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'الشَّجَرَةُ طَوِيلٌ وَالنَّهْرُ عَمِيقَةٌ.',
          correct: false,
          feedback: 'Akhirannya tertukar. ـَةٌ milik sifat untuk الشَّجَرَةُ (feminin), bukan untuk النَّهْرُ (maskulin).',
        },
        {
          id: 'b',
          text: 'الشَّجَرَةُ طَوِيلَةٌ وَالنَّهْرُ عَمِيقٌ.',
          correct: true,
          feedback: 'Tepat. الشَّجَرَةُ feminin → طَوِيلَةٌ; النَّهْرُ maskulin → عَمِيقٌ.',
        },
        {
          id: 'c',
          text: 'الشَّجَرَةُ طَوِيلَةٌ وَالنَّهْرُ عَمِيقَةٌ.',
          correct: false,
          feedback: 'Setiap sifat mengikuti kata bendanya sendiri. النَّهْرُ maskulin, jadi sifatnya tanpa ـَةٌ: عَمِيقٌ.',
        },
        {
          id: 'd',
          text: 'الشَّجَرَةُ قَصِيرَةٌ وَالنَّهْرُ عَمِيقٌ.',
          correct: false,
          feedback: 'Akhirannya cocok, tetapi قَصِيرَةٌ berarti pendek, bukan tinggi.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
    {
      id: 'ua-d01-agr-d30-02',
      construct: 'agreement',
      family: 'ua-agr-d30-feminine-person-v1',
      phase: 'd30',
      lessonId: AGREEMENT_LESSON_ID,
      arabic: 'الْجَارَةُ',
      prompt:
        'الْجَارَةُ = satu tetangga perempuan. Kalimat mana yang berarti "Tetangga (perempuan) itu ramah" dengan akhiran sifat yang cocok?',
      glosses: [
        { arabic: 'الْجَارَةُ', meaning: 'tetangga (perempuan) itu' },
        { arabic: 'لَطِيفٌ', meaning: 'ramah (bentuk dasar)' },
        { arabic: 'غَاضِبٌ', meaning: 'marah (bentuk dasar)' },
      ],
      options: [
        {
          id: 'a',
          text: 'الْجَارَةُ لَطِيفٌ.',
          correct: false,
          feedback: 'Kata bendanya feminin, tetapi sifatnya masih bentuk dasar. Untuk الْجَارَةُ, sifatnya perlu ـَةٌ.',
        },
        {
          id: 'b',
          text: 'الْجَارُ لَطِيفٌ.',
          correct: false,
          feedback: 'Kalimat ini cocok, tetapi الْجَارُ berarti tetangga laki-laki. Yang diminta tetangga perempuan: الْجَارَةُ.',
        },
        {
          id: 'c',
          text: 'الْجَارَةُ لَطِيفَةٌ.',
          correct: true,
          feedback: 'Tepat. الْجَارَةُ feminin dan tunggal, maka sifatnya ditambah ـَةٌ: لَطِيفَةٌ.',
        },
        {
          id: 'd',
          text: 'الْجَارَةُ غَاضِبَةٌ.',
          correct: false,
          feedback: 'Akhirannya cocok, tetapi غَاضِبَةٌ berarti marah, bukan ramah.',
        },
      ],
      reviewStatus: 'draft',
      constructed: true,
    },
  ],
};

const CONTENT_VERSION: PilotContent['contentVersion'] = 'unit-a-pilot-draft-0.1';
const POLICY_VERSION: PilotContent['policyVersion'] = 'unit-a-evidence-provisional-0.1';
const CONSTRUCTS: readonly PilotConstruct[] = ['reference', 'agreement'];
const PHASES: readonly PilotPhase[] = ['practice', 'transfer', 'd7', 'd30'];
const MIN_FAMILIES: Readonly<Record<PilotPhase, number>> = { practice: 4, transfer: 2, d7: 2, d30: 2 };
const OPTION_COUNT = 4;

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

// Solution comparison ignores harakat (nonspacing marks, after NFC so hamza letters
// survive), punctuation, spacing and letter case.
const normalizeStem = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/\p{Mn}/gu, '')
    .replace(/\p{P}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const collectStrings = (value: unknown, seen: WeakSet<object> = new WeakSet()): string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((child: unknown) => collectStrings(child, seen));
};

const itemLabel = (item: unknown, index: number): string =>
  isRecord(item) && isText(item.id) ? `items[${index}] (${item.id})` : `items[${index}]`;

const requireText = (record: UnknownRecord, key: string, path: string, errors: string[]): void => {
  if (!isText(record[key])) errors.push(`${path}.${key} must be a non-empty string`);
};

const checkTextList = (list: unknown, path: string, errors: string[]): boolean => {
  if (!Array.isArray(list) || list.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return false;
  }
  const start = errors.length;
  Array.from(list).forEach((entry: unknown, index: number) => {
    if (!isText(entry)) errors.push(`${path}[${index}] must be a non-empty string`);
  });
  return errors.length === start;
};

const checkGlosses = (glosses: unknown, path: string, errors: string[]): void => {
  if (!Array.isArray(glosses) || glosses.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }
  Array.from(glosses).forEach((gloss: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isRecord(gloss)) {
      errors.push(`${at} must be an object`);
      return;
    }
    requireText(gloss, 'arabic', at, errors);
    requireText(gloss, 'meaning', at, errors);
  });
};

const checkExamples = (examples: unknown, path: string, errors: string[]): boolean => {
  if (!Array.isArray(examples) || examples.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return false;
  }
  const start = errors.length;
  Array.from(examples).forEach((example: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isRecord(example)) {
      errors.push(`${at} must be an object`);
      return;
    }
    requireText(example, 'arabic', at, errors);
    requireText(example, 'meaning', at, errors);
    requireText(example, 'explanation', at, errors);
    checkGlosses(example.glosses, `${at}.glosses`, errors);
  });
  return errors.length === start;
};

const checkOptions = (options: unknown, path: string, errors: string[]): void => {
  if (!Array.isArray(options) || options.length !== OPTION_COUNT) {
    errors.push(`${path} must be an array of exactly ${OPTION_COUNT} choices`);
    return;
  }
  const ids = new Set<string>();
  const texts = new Set<string>();
  let keys = 0;
  Array.from(options).forEach((option: unknown, index: number) => {
    const at = `${path}[${index}]`;
    if (!isRecord(option)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (!isText(option.id)) errors.push(`${at}.id must be a non-empty string`);
    else if (ids.has(option.id)) errors.push(`${at}.id "${option.id}" is duplicated within the item`);
    else ids.add(option.id);
    if (!isText(option.text)) errors.push(`${at}.text must be a non-empty string`);
    else if (texts.has(option.text.trim())) errors.push(`${at}.text duplicates another choice`);
    else texts.add(option.text.trim());
    if (typeof option.correct !== 'boolean') errors.push(`${at}.correct must be a boolean`);
    else if (option.correct) keys += 1;
    requireText(option, 'feedback', at, errors);
  });
  if (keys !== 1) errors.push(`${path} must have exactly one correct choice (found ${keys})`);
};

const checkLessons = (lessons: unknown, errors: string[]): ReadonlyMap<string, PilotConstruct> => {
  const owners = new Map<string, PilotConstruct>();
  if (!Array.isArray(lessons) || lessons.length === 0) {
    errors.push('lessons must be a non-empty array');
    return owners;
  }
  const ids = new Set<string>();
  const taught = new Set<PilotConstruct>();
  Array.from(lessons).forEach((lesson: unknown, index: number) => {
    const at = `lessons[${index}]`;
    if (!isRecord(lesson)) {
      errors.push(`${at} must be an object`);
      return;
    }
    const construct = isOneOf(CONSTRUCTS, lesson.construct) ? lesson.construct : undefined;
    if (construct === undefined) errors.push(`${at}.construct must be one of ${CONSTRUCTS.join(', ')}`);
    if (!isText(lesson.id)) errors.push(`${at}.id must be a non-empty string`);
    else if (ids.has(lesson.id)) errors.push(`${at}.id "${lesson.id}" is duplicated`);
    else {
      ids.add(lesson.id);
      if (construct !== undefined) owners.set(lesson.id, construct);
    }
    requireText(lesson, 'title', at, errors);
    const instructed = checkTextList(lesson.body, `${at}.body`, errors);
    const exemplified = checkExamples(lesson.examples, `${at}.examples`, errors);
    if (construct !== undefined && instructed && exemplified) taught.add(construct);
  });
  for (const construct of CONSTRUCTS) {
    if (!taught.has(construct)) errors.push(`no complete lesson teaches the ${construct} construct`);
  }
  return owners;
};

const checkItems = (items: unknown, lessonOwners: ReadonlyMap<string, PilotConstruct>, errors: string[]): void => {
  if (!Array.isArray(items) || items.length === 0) {
    errors.push('items must be a non-empty array');
    return;
  }
  const ids = new Set<string>();
  const familyRoles = new Map<string, string>();
  const familiesByRole = new Map<string, Set<string>>();
  Array.from(items).forEach((item: unknown, index: number) => {
    const at = itemLabel(item, index);
    if (!isRecord(item)) {
      errors.push(`${at} must be an object`);
      return;
    }
    if (!isText(item.id)) errors.push(`${at}.id must be a non-empty string`);
    else if (ids.has(item.id)) errors.push(`${at}.id is duplicated`);
    else ids.add(item.id);

    const construct = isOneOf(CONSTRUCTS, item.construct) ? item.construct : undefined;
    const phase = isOneOf(PHASES, item.phase) ? item.phase : undefined;
    if (construct === undefined) errors.push(`${at}.construct must be one of ${CONSTRUCTS.join(', ')}`);
    if (phase === undefined) errors.push(`${at}.phase must be one of ${PHASES.join(', ')}`);

    if (!isText(item.family)) errors.push(`${at}.family must be a non-empty string`);
    else if (construct !== undefined && phase !== undefined) {
      const role = `${construct}/${phase}`;
      const known = familyRoles.get(item.family);
      if (known !== undefined && known !== role) {
        errors.push(`${at}.family "${item.family}" is already used for ${known}, not ${role}`);
      } else {
        familyRoles.set(item.family, role);
        const families = familiesByRole.get(role) ?? new Set<string>();
        families.add(item.family);
        familiesByRole.set(role, families);
      }
    }

    if (!isText(item.lessonId)) errors.push(`${at}.lessonId must be a non-empty string`);
    else {
      const owner = lessonOwners.get(item.lessonId);
      if (owner === undefined) errors.push(`${at}.lessonId "${item.lessonId}" does not match a valid lesson`);
      else if (construct !== undefined && owner !== construct) {
        errors.push(`${at}.lessonId "${item.lessonId}" teaches ${owner}, not ${construct}`);
      }
    }

    requireText(item, 'arabic', at, errors);
    requireText(item, 'prompt', at, errors);
    checkGlosses(item.glosses, `${at}.glosses`, errors);
    checkOptions(item.options, `${at}.options`, errors);
    if (item.reviewStatus !== 'draft') errors.push(`${at}.reviewStatus must be "draft"`);
    if (item.constructed !== true) errors.push(`${at}.constructed must be true`);
  });
  for (const construct of CONSTRUCTS) {
    for (const phase of PHASES) {
      const count = familiesByRole.get(`${construct}/${phase}`)?.size ?? 0;
      if (count < MIN_FAMILIES[phase]) {
        errors.push(`${construct} ${phase} needs at least ${MIN_FAMILIES[phase]} families (found ${count})`);
      }
    }
  }
};

interface ReservedSolution {
  readonly field: string;
  readonly solution: string;
}

// An assessment item reserves its Arabic stem and the full text of every keyed option,
// deduplicated within the item so a key that equals its own stem is counted once.
const reservedSolutions = (item: UnknownRecord): ReservedSolution[] => {
  const candidates: { field: string; text: unknown }[] = [{ field: '.arabic stem', text: item.arabic }];
  if (Array.isArray(item.options)) {
    Array.from(item.options).forEach((option: unknown, index: number) => {
      if (isRecord(option) && option.correct === true) {
        candidates.push({ field: `.options[${index}].text keyed answer`, text: option.text });
      }
    });
  }
  const seen = new Set<string>();
  const reserved: ReservedSolution[] = [];
  for (const { field, text } of candidates) {
    if (typeof text !== 'string') continue;
    const solution = normalizeStem(text);
    if (solution === '' || seen.has(solution)) continue;
    seen.add(solution);
    reserved.push({ field, solution });
  }
  return reserved;
};

const checkStemSeparation = (lessons: unknown, items: unknown, errors: string[]): void => {
  if (!Array.isArray(items)) return;
  const lessonTexts = collectStrings(lessons).map(normalizeStem);
  const phaseTexts: Record<PilotPhase, string[]> = { practice: [], transfer: [], d7: [], d30: [] };
  const assessed: { at: string; phase: PilotPhase; field: string; solution: string }[] = [];
  Array.from(items).forEach((item: unknown, index: number) => {
    if (!isRecord(item) || !isOneOf(PHASES, item.phase)) return;
    const phase = item.phase;
    phaseTexts[phase] = phaseTexts[phase].concat(collectStrings(item).map(normalizeStem));
    if (phase === 'practice') return;
    const at = itemLabel(item, index);
    reservedSolutions(item).forEach(({ field, solution }) => assessed.push({ at, phase, field, solution }));
  });
  const firstSeen = new Map<string, string>();
  for (const { at, phase, field, solution } of assessed) {
    const other = firstSeen.get(solution);
    if (other !== undefined) errors.push(`${at}${field} repeats the whole assessment solution of ${other}`);
    else firstSeen.set(solution, `${at}${field}`);
    if (lessonTexts.some((text) => text.includes(solution))) errors.push(`${at}${field} appears in lesson material`);
    const earlier = PHASES.slice(0, PHASES.indexOf(phase)).flatMap((prior) => phaseTexts[prior]);
    if (earlier.some((text) => text.includes(solution))) {
      errors.push(`${at}${field} appears in earlier-phase item material`);
    }
  }
};

export function validatePilotContent(value: unknown): string[] {
  if (!isRecord(value)) return ['pilot content must be an object'];
  const errors: string[] = [];
  if (value.contentVersion !== CONTENT_VERSION) errors.push(`contentVersion must be "${CONTENT_VERSION}"`);
  if (value.policyVersion !== POLICY_VERSION) errors.push(`policyVersion must be "${POLICY_VERSION}"`);
  if (value.synthetic !== true) errors.push('synthetic must be true');
  if (value.constructed !== true) errors.push('constructed must be true');
  if (value.reviewStatus !== 'draft') errors.push('reviewStatus must be "draft" (not reviewer-approved)');
  const lessonOwners = checkLessons(value.lessons, errors);
  checkItems(value.items, lessonOwners, errors);
  checkStemSeparation(value.lessons, value.items, errors);
  return errors;
}
