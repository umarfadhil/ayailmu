// U-C nominal definiteness: constructed, synthetic draft — not reviewer-approved, not shipped.
// One lesson contrasts الْـN الْـA (a phrase: "rumah besar itu") with الْـN A (a complete
// nominal sentence: "rumah itu besar"), restricted to supplied masculine singular nouns and
// regular adjectives. Six practice tasks, then four transfer tasks whose noun–adjective
// combinations are never shown earlier. validateNominalDefiniteness checks unknown input
// against this contract and the existing registries; it never throws or mutates.

import { activePack, historicalItem, legacyPack, lineageOf, v02Pack } from '../../load';
import { PILOT_CONTENT } from '../../../pilot/unitA/content';
import type { HelpLine } from '../../schema';
import type { Combination, IncrementContent, IncrementItem, PhraseShape } from './schema';

const LESSON_ID = 'uc-nd-lesson';

// Item glosses. The noun gloss carries the supplied gender, so it is never inferred.
const HOUSE: HelpLine = { word: 'الْبَيْتُ', meaning: 'rumah itu (kata benda maskulin, tunggal)' };
const PEN: HelpLine = { word: 'الْقَلَمُ', meaning: 'pena itu (kata benda maskulin, tunggal)' };
const BOOK: HelpLine = { word: 'الْكِتَابُ', meaning: 'buku itu (kata benda maskulin, tunggal)' };
const BIG: HelpLine = { word: 'كَبِيرٌ', meaning: 'besar (bentuk dasar)' };
const SMALL: HelpLine = { word: 'صَغِيرٌ', meaning: 'kecil (bentuk dasar)' };
const NEW: HelpLine = { word: 'جَدِيدٌ', meaning: 'baru (bentuk dasar)' };
const OLD: HelpLine = { word: 'قَدِيمٌ', meaning: 'lama (bentuk dasar)' };

const PROMPT_MEANING_GUIDED = 'Apa arti tulisan Arab ini? Lihat kata sifatnya: memakai الـ atau tidak.';
const PROMPT_ARABIC_GUIDED = 'Pilih tulisan Arab yang tepat untuk arti ini. Frasa atau kalimat lengkap?';
const PROMPT_MEANING = 'Apa arti tulisan Arab ini?';
const PROMPT_ARABIC = 'Pilih tulisan Arab yang tepat untuk arti ini.';

export const NOMINAL_DEFINITENESS: IncrementContent = {
  increment_id: 'nominal-definiteness',
  unit: 'U-C',
  content_version: 'u-c-nominal-definiteness-draft-0.1',
  language: 'id',
  synthetic: true,
  constructed: true,
  quran_attribution: false,
  review_status: 'draft',
  human_review: { arabic: 'pending', indonesian: 'pending', assessment: 'pending' },
  integration: { shipped: false, automatic_unlock: false },
  lessons: [
    {
      lesson_id: LESSON_ID,
      unit: 'U-C',
      title: 'Frasa atau kalimat? Kata sifat dengan dan tanpa الـ',
      vocabulary: {
        nouns: [
          { word: 'الْبَيْتُ', meaning: 'rumah itu', gender: 'masculine' },
          { word: 'الْقَلَمُ', meaning: 'pena itu', gender: 'masculine' },
          { word: 'الْكِتَابُ', meaning: 'buku itu', gender: 'masculine' },
        ],
        adjectives: [
          { word: 'كَبِيرٌ', meaning: 'besar' },
          { word: 'صَغِيرٌ', meaning: 'kecil' },
          { word: 'جَدِيدٌ', meaning: 'baru' },
          { word: 'قَدِيمٌ', meaning: 'lama' },
        ],
      },
      screens: [
        {
          screen_id: 'uc-nd-s1',
          unit: 'U-C',
          title: 'Kata-kata dalam pelajaran ini',
          body: [
            'Tiga kata benda maskulin tunggal (jenisnya selalu disebutkan, tidak ditebak dari bentuk kata): الْبَيْتُ = rumah itu, الْقَلَمُ = pena itu, الْكِتَابُ = buku itu.',
            'Empat kata sifat biasa dalam bentuk dasar: كَبِيرٌ = besar, صَغِيرٌ = kecil, جَدِيدٌ = baru, قَدِيمٌ = lama.',
            'Awalan الـ (al-) membuat kata benda menjadi tertentu, mirip kata "itu" dalam bahasa Indonesia: بَيْتٌ = sebuah rumah, sedangkan الْبَيْتُ = rumah itu.',
            'Kata yang memakai الـ tidak memakai tanwin (tanda ٌ, dibaca -un). Tanwinnya dilepas dan tinggal satu dammah: بَيْتٌ menjadi الْبَيْتُ, كَبِيرٌ menjadi الْكَبِيرُ, جَدِيدٌ menjadi الْجَدِيدُ, قَدِيمٌ menjadi الْقَدِيمُ.',
            'Di depan huruf ص, huruf ل pada الـ tidak dibaca dan huruf ص bertasydid: صَغِيرٌ menjadi الصَّغِيرُ, dibaca ash-shaghiiru.',
          ],
          examples: [],
          review_status: 'draft',
        },
        {
          screen_id: 'uc-nd-s2',
          unit: 'U-C',
          title: 'Frasa: kata sifat ikut memakai الـ',
          body: [
            'Jika kata benda memakai الـ dan kata sifat di belakangnya juga memakai الـ, keduanya membentuk satu frasa, belum kalimat lengkap.',
            'Terjemahkan sebagai frasa, dengan "itu" di akhir: Rumah besar itu.',
          ],
          examples: [
            {
              arabic: 'الْبَيْتُ الْكَبِيرُ',
              shape: 'definite-phrase',
              combination: { noun: 'الْبَيْتُ', adjective: 'كَبِيرٌ' },
              help_lines: [HOUSE, { word: 'الْكَبِيرُ', meaning: 'besar (kata sifat dengan الـ)' }],
              meaning: 'Rumah besar itu',
              explanation:
                'Kedua kata memakai الـ, dan كَبِيرٌ kehilangan tanwinnya menjadi الْكَبِيرُ. Kata sifat yang ikut memakai الـ hanya menunjukkan rumah mana yang dimaksud; belum ada pernyataan tentang rumah itu.',
            },
            {
              arabic: 'الْقَلَمُ الصَّغِيرُ',
              shape: 'definite-phrase',
              combination: { noun: 'الْقَلَمُ', adjective: 'صَغِيرٌ' },
              help_lines: [PEN, { word: 'الصَّغِيرُ', meaning: 'kecil (kata sifat dengan الـ)' }],
              meaning: 'Pena kecil itu',
              explanation:
                'الصَّغِيرُ memakai الـ seperti الْقَلَمُ, jadi ini frasa. Huruf ل pada الـ tidak dibaca di depan ص.',
            },
          ],
          review_status: 'draft',
        },
        {
          screen_id: 'uc-nd-s3',
          unit: 'U-C',
          title: 'Kalimat: kata sifat tanpa الـ',
          body: [
            'Jika kata benda memakai الـ tetapi kata sifat tetap bentuk dasar bertanwin (tanpa الـ), hasilnya kalimat nominal lengkap: kata benda yang dibicarakan, lalu keterangannya.',
            'Bahasa Arab tidak memerlukan kata "adalah" di sini. Terjemahkan sebagai kalimat: Rumah itu besar.',
          ],
          examples: [
            {
              arabic: 'الْبَيْتُ كَبِيرٌ',
              shape: 'nominal-sentence',
              combination: { noun: 'الْبَيْتُ', adjective: 'كَبِيرٌ' },
              help_lines: [HOUSE, { word: 'كَبِيرٌ', meaning: 'besar (bentuk dasar, bertanwin)' }],
              meaning: 'Rumah itu besar',
              explanation:
                'Kata-katanya sama dengan contoh frasa sebelumnya, tetapi كَبِيرٌ tidak memakai الـ dan tetap bertanwin. Karena itu كَبِيرٌ menjadi keterangan: pernyataan bahwa rumah itu besar.',
            },
            {
              arabic: 'الْكِتَابُ جَدِيدٌ',
              shape: 'nominal-sentence',
              combination: { noun: 'الْكِتَابُ', adjective: 'جَدِيدٌ' },
              help_lines: [BOOK, { word: 'جَدِيدٌ', meaning: 'baru (bentuk dasar, bertanwin)' }],
              meaning: 'Buku itu baru',
              explanation: 'الْكِتَابُ memakai الـ, sedangkan جَدِيدٌ tidak. Jadi ini kalimat lengkap yang menyatakan bahwa buku itu baru.',
            },
          ],
          review_status: 'draft',
        },
        {
          screen_id: 'uc-nd-s4',
          unit: 'U-C',
          title: 'Membedakan frasa dan kalimat',
          body: [
            'Bandingkan الْبَيْتُ الْكَبِيرُ (rumah besar itu) dengan الْبَيْتُ كَبِيرٌ (rumah itu besar). Kata-katanya sama; yang berbeda hanya الـ pada kata sifat.',
            'Cara membaca: lihat kata sifatnya. Ada الـ: frasa. Tidak ada الـ dan bertanwin: kalimat lengkap.',
            'Pegangan ini hanya untuk pola sempit di pelajaran ini: satu kata benda maskulin tunggal dengan الـ, diikuti satu kata sifat biasa. Pola lain dalam bahasa Arab punya aturan tambahan dan akan dipelajari tersendiri.',
          ],
          examples: [],
          review_status: 'draft',
        },
      ],
      review_status: 'draft',
    },
  ],
  items: [
    {
      item_id: 'uc-nd-p01',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'practice',
      family: 'uc-nd-fam-pen-big-sentence-meaning',
      format: 'arabic-to-meaning',
      stem: 'الْقَلَمُ كَبِيرٌ',
      prompt: PROMPT_MEANING_GUIDED,
      help_lines: [PEN, BIG],
      noun_gender: 'masculine',
      combination: { noun: 'الْقَلَمُ', adjective: 'كَبِيرٌ' },
      key_shape: 'nominal-sentence',
      solution: { arabic: 'الْقَلَمُ كَبِيرٌ', indonesian: 'Pena itu besar' },
      options: [
        {
          id: 'a',
          text: 'Pena besar itu',
          correct: false,
          distractor: 'other-structure',
          feedback:
            'Itu arti frasa الْقَلَمُ الْكَبِيرُ, yang kata sifatnya memakai الـ. Di sini كَبِيرٌ tanpa الـ dan bertanwin, jadi ini kalimat lengkap.',
        },
        {
          id: 'b',
          text: 'Pena itu besar',
          correct: true,
          feedback: 'Tepat. الْقَلَمُ memakai الـ (pena itu), sedangkan كَبِيرٌ tanpa الـ menjadi keterangannya. Hasilnya kalimat lengkap.',
        },
        {
          id: 'c',
          text: 'Sebuah pena besar',
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'Kata bendanya memakai الـ: الْقَلَمُ = pena itu, bukan sebuah pena. Sebuah pena tertulis قَلَمٌ, dengan tanwin.',
        },
        {
          id: 'd',
          text: 'Pena itu kecil',
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Susunannya benar, tetapi كَبِيرٌ berarti besar, bukan kecil.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-p02',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'practice',
      family: 'uc-nd-fam-book-old-phrase-arabic',
      format: 'meaning-to-arabic',
      stem: 'Buku lama itu',
      prompt: PROMPT_ARABIC_GUIDED,
      help_lines: [BOOK, OLD],
      noun_gender: 'masculine',
      combination: { noun: 'الْكِتَابُ', adjective: 'قَدِيمٌ' },
      key_shape: 'definite-phrase',
      solution: { arabic: 'الْكِتَابُ الْقَدِيمُ', indonesian: 'Buku lama itu' },
      options: [
        {
          id: 'a',
          text: 'الْكِتَابُ الْقَدِيمُ',
          arabic: true,
          correct: true,
          feedback: 'Tepat. Untuk frasa, kata sifat ikut memakai الـ: قَدِيمٌ menjadi الْقَدِيمُ, tanwinnya dilepas.',
        },
        {
          id: 'b',
          text: 'الْكِتَابُ قَدِيمٌ',
          arabic: true,
          correct: false,
          distractor: 'other-structure',
          feedback: 'Kata sifat tanpa الـ menjadikannya kalimat lengkap: buku itu lama. Yang diminta frasa, jadi kata sifatnya perlu الـ.',
        },
        {
          id: 'c',
          text: 'كِتَابٌ قَدِيمٌ',
          arabic: true,
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'Tanpa الـ dan dengan tanwin, ini berarti sebuah buku lama, belum tertentu. Kata "itu" menunjukkan kata benda yang memakai الـ.',
        },
        {
          id: 'd',
          text: 'الْكِتَابُ الْجَدِيدُ',
          arabic: true,
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Susunan frasanya benar, tetapi الْجَدِيدُ berarti baru, bukan lama.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-p03',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'practice',
      family: 'uc-nd-fam-book-new-phrase-meaning',
      format: 'arabic-to-meaning',
      stem: 'الْكِتَابُ الْجَدِيدُ',
      prompt: PROMPT_MEANING_GUIDED,
      help_lines: [BOOK, NEW],
      noun_gender: 'masculine',
      combination: { noun: 'الْكِتَابُ', adjective: 'جَدِيدٌ' },
      key_shape: 'definite-phrase',
      solution: { arabic: 'الْكِتَابُ الْجَدِيدُ', indonesian: 'Buku baru itu' },
      options: [
        {
          id: 'a',
          text: 'Buku itu baru',
          correct: false,
          distractor: 'other-structure',
          feedback:
            'Itu arti kalimat الْكِتَابُ جَدِيدٌ, dengan kata sifat tanpa الـ. Di sini الْجَدِيدُ memakai الـ seperti kata bendanya, jadi ini frasa, belum kalimat.',
        },
        {
          id: 'b',
          text: 'Buku lama itu',
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Susunannya benar, tetapi الْجَدِيدُ berarti baru, bukan lama.',
        },
        {
          id: 'c',
          text: 'Buku baru itu',
          correct: true,
          feedback: 'Tepat. Kata benda dan kata sifat sama-sama memakai الـ, jadi keduanya membentuk satu frasa.',
        },
        {
          id: 'd',
          text: 'Sebuah buku baru',
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'Kata bendanya memakai الـ, jadi bukunya tertentu. "Sebuah buku baru" ditulis كِتَابٌ جَدِيدٌ, dengan tanwin.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-p04',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'practice',
      family: 'uc-nd-fam-pen-small-sentence-arabic',
      format: 'meaning-to-arabic',
      stem: 'Pena itu kecil',
      prompt: PROMPT_ARABIC_GUIDED,
      help_lines: [PEN, SMALL],
      noun_gender: 'masculine',
      combination: { noun: 'الْقَلَمُ', adjective: 'صَغِيرٌ' },
      key_shape: 'nominal-sentence',
      solution: { arabic: 'الْقَلَمُ صَغِيرٌ', indonesian: 'Pena itu kecil' },
      options: [
        {
          id: 'a',
          text: 'الْقَلَمُ الصَّغِيرُ',
          arabic: true,
          correct: false,
          distractor: 'other-structure',
          feedback: 'Dengan الـ pada kata sifat, ini frasa: pena kecil itu. Untuk kalimat lengkap, kata sifat tetap bentuk dasar tanpa الـ.',
        },
        {
          id: 'b',
          text: 'قَلَمٌ صَغِيرٌ',
          arabic: true,
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'قَلَمٌ tanpa الـ berarti sebuah pena, belum tertentu. Untuk "pena itu", kata bendanya memakai الـ.',
        },
        {
          id: 'c',
          text: 'الْقَلَمُ كَبِيرٌ',
          arabic: true,
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Susunan kalimatnya benar, tetapi كَبِيرٌ berarti besar, bukan kecil.',
        },
        {
          id: 'd',
          text: 'الْقَلَمُ صَغِيرٌ',
          arabic: true,
          correct: true,
          feedback: 'Tepat. الْقَلَمُ memakai الـ (pena itu), dan صَغِيرٌ tetap bertanwin tanpa الـ sebagai keterangannya.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-p05',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'practice',
      family: 'uc-nd-fam-pen-big-phrase-arabic',
      format: 'meaning-to-arabic',
      stem: 'Pena besar itu',
      prompt: PROMPT_ARABIC_GUIDED,
      help_lines: [PEN, BIG],
      noun_gender: 'masculine',
      combination: { noun: 'الْقَلَمُ', adjective: 'كَبِيرٌ' },
      key_shape: 'definite-phrase',
      solution: { arabic: 'الْقَلَمُ الْكَبِيرُ', indonesian: 'Pena besar itu' },
      options: [
        {
          id: 'a',
          text: 'الْبَيْتُ الْكَبِيرُ',
          arabic: true,
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Kata sifatnya benar, tetapi الْبَيْتُ berarti rumah itu, bukan pena itu.',
        },
        {
          id: 'b',
          text: 'الْقَلَمُ الْكَبِيرُ',
          arabic: true,
          correct: true,
          feedback: 'Tepat. Kedua kata memakai الـ, dan كَبِيرٌ kehilangan tanwinnya menjadi الْكَبِيرُ. Ini frasa.',
        },
        {
          id: 'c',
          text: 'الْقَلَمُ كَبِيرٌ',
          arabic: true,
          correct: false,
          distractor: 'other-structure',
          feedback: 'Tanpa الـ pada kata sifat, ini kalimat lengkap: pena itu besar. Yang diminta hanya frasa.',
        },
        {
          id: 'd',
          text: 'قَلَمٌ كَبِيرٌ',
          arabic: true,
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'Kedua kata bertanwin tanpa الـ, jadi artinya sebuah pena besar, belum tertentu.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-p06',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'practice',
      family: 'uc-nd-fam-book-old-sentence-meaning',
      format: 'arabic-to-meaning',
      stem: 'الْكِتَابُ قَدِيمٌ',
      prompt: PROMPT_MEANING_GUIDED,
      help_lines: [BOOK, OLD],
      noun_gender: 'masculine',
      combination: { noun: 'الْكِتَابُ', adjective: 'قَدِيمٌ' },
      key_shape: 'nominal-sentence',
      solution: { arabic: 'الْكِتَابُ قَدِيمٌ', indonesian: 'Buku itu lama' },
      options: [
        {
          id: 'a',
          text: 'Buku itu lama',
          correct: true,
          feedback: 'Tepat. الْكِتَابُ memakai الـ, sedangkan قَدِيمٌ bertanwin tanpa الـ. Jadi ini kalimat lengkap.',
        },
        {
          id: 'b',
          text: 'Buku lama itu',
          correct: false,
          distractor: 'other-structure',
          feedback: 'Itu arti frasa الْكِتَابُ الْقَدِيمُ. Di sini kata sifatnya tidak memakai الـ, jadi ini kalimat yang menyatakan bahwa bukunya lama.',
        },
        {
          id: 'c',
          text: 'Buku itu baru',
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Susunannya benar, tetapi قَدِيمٌ berarti lama, bukan baru.',
        },
        {
          id: 'd',
          text: 'Sebuah buku lama',
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'الْكِتَابُ memakai الـ, jadi bukunya tertentu. Sebuah buku tertulis كِتَابٌ, dengan tanwin.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-t01',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'transfer',
      family: 'uc-nd-fam-house-small-phrase-meaning',
      format: 'arabic-to-meaning',
      stem: 'الْبَيْتُ الصَّغِيرُ',
      prompt: PROMPT_MEANING,
      help_lines: [HOUSE, SMALL],
      noun_gender: 'masculine',
      combination: { noun: 'الْبَيْتُ', adjective: 'صَغِيرٌ' },
      key_shape: 'definite-phrase',
      solution: { arabic: 'الْبَيْتُ الصَّغِيرُ', indonesian: 'Rumah kecil itu' },
      options: [
        {
          id: 'a',
          text: 'Rumah itu kecil',
          correct: false,
          distractor: 'other-structure',
          feedback: 'Arti ini memerlukan kata sifat tanpa الـ yang bertanwin. Di sini kata sifatnya memakai الـ, jadi ini frasa, belum kalimat.',
        },
        {
          id: 'b',
          text: 'Sebuah rumah kecil',
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'Kata bendanya memakai الـ, jadi rumahnya tertentu, bukan sebuah rumah.',
        },
        {
          id: 'c',
          text: 'Rumah kecil itu',
          correct: true,
          feedback: 'Tepat. Kata benda dan kata sifat sama-sama memakai الـ, jadi keduanya satu frasa. Huruf ل pada الـ tidak dibaca di depan ص.',
        },
        {
          id: 'd',
          text: 'Rumah besar itu',
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Susunan frasanya benar, tetapi الصَّغِيرُ berarti kecil, bukan besar.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-t02',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'transfer',
      family: 'uc-nd-fam-pen-old-sentence-arabic',
      format: 'meaning-to-arabic',
      stem: 'Pena itu lama',
      prompt: PROMPT_ARABIC,
      help_lines: [PEN, OLD],
      noun_gender: 'masculine',
      combination: { noun: 'الْقَلَمُ', adjective: 'قَدِيمٌ' },
      key_shape: 'nominal-sentence',
      solution: { arabic: 'الْقَلَمُ قَدِيمٌ', indonesian: 'Pena itu lama' },
      options: [
        {
          id: 'a',
          text: 'الْقَلَمُ الْقَدِيمُ',
          arabic: true,
          correct: false,
          distractor: 'other-structure',
          feedback: 'Kata sifat dengan الـ membentuk frasa, belum kalimat. Untuk kalimat lengkap, kata sifat tetap bentuk dasar tanpa الـ.',
        },
        {
          id: 'b',
          text: 'الْكِتَابُ قَدِيمٌ',
          arabic: true,
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Susunan kalimatnya benar, tetapi الْكِتَابُ berarti buku itu, bukan pena itu.',
        },
        {
          id: 'c',
          text: 'قَلَمٌ قَدِيمٌ',
          arabic: true,
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'قَلَمٌ bertanwin tanpa الـ berarti sebuah pena, belum tertentu. Kata bendanya perlu الـ.',
        },
        {
          id: 'd',
          text: 'الْقَلَمُ قَدِيمٌ',
          arabic: true,
          correct: true,
          feedback: 'Tepat. Kata benda memakai الـ, sedangkan kata sifat tetap bentuk dasar bertanwin: ini kalimat lengkap.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-t03',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'transfer',
      family: 'uc-nd-fam-pen-new-phrase-arabic',
      format: 'meaning-to-arabic',
      stem: 'Pena baru itu',
      prompt: PROMPT_ARABIC,
      help_lines: [PEN, NEW],
      noun_gender: 'masculine',
      combination: { noun: 'الْقَلَمُ', adjective: 'جَدِيدٌ' },
      key_shape: 'definite-phrase',
      solution: { arabic: 'الْقَلَمُ الْجَدِيدُ', indonesian: 'Pena baru itu' },
      options: [
        {
          id: 'a',
          text: 'الْقَلَمُ الْجَدِيدُ',
          arabic: true,
          correct: true,
          feedback: 'Tepat. Untuk frasa, kata sifat ikut memakai الـ dan tanwinnya dilepas: جَدِيدٌ menjadi الْجَدِيدُ.',
        },
        {
          id: 'b',
          text: 'الْقَلَمُ جَدِيدٌ',
          arabic: true,
          correct: false,
          distractor: 'other-structure',
          feedback: 'Kata sifat tanpa الـ menjadikan ini kalimat lengkap yang menyatakan bahwa penanya baru. Yang diminta frasa.',
        },
        {
          id: 'c',
          text: 'الْكِتَابُ الْجَدِيدُ',
          arabic: true,
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Susunan frasanya benar, tetapi الْكِتَابُ berarti buku itu, bukan pena itu.',
        },
        {
          id: 'd',
          text: 'قَلَمٌ جَدِيدٌ',
          arabic: true,
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'Tanpa الـ dan dengan tanwin, artinya sebuah pena baru, belum tertentu.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
    {
      item_id: 'uc-nd-t04',
      unit: 'U-C',
      lesson_id: LESSON_ID,
      phase: 'transfer',
      family: 'uc-nd-fam-book-small-sentence-meaning',
      format: 'arabic-to-meaning',
      stem: 'الْكِتَابُ صَغِيرٌ',
      prompt: PROMPT_MEANING,
      help_lines: [BOOK, SMALL],
      noun_gender: 'masculine',
      combination: { noun: 'الْكِتَابُ', adjective: 'صَغِيرٌ' },
      key_shape: 'nominal-sentence',
      solution: { arabic: 'الْكِتَابُ صَغِيرٌ', indonesian: 'Buku itu kecil' },
      options: [
        {
          id: 'a',
          text: 'Pena itu kecil',
          correct: false,
          distractor: 'wrong-word',
          feedback: 'Kata sifatnya benar, tetapi الْكِتَابُ berarti buku itu, bukan pena itu.',
        },
        {
          id: 'b',
          text: 'Buku itu kecil',
          correct: true,
          feedback: 'Tepat. صَغِيرٌ tanpa الـ menjadi keterangan bagi الْكِتَابُ, jadi ini kalimat lengkap.',
        },
        {
          id: 'c',
          text: 'Buku kecil itu',
          correct: false,
          distractor: 'other-structure',
          feedback: 'Arti ini memerlukan الـ juga pada kata sifat (frasa). Di sini kata sifatnya tanpa الـ dan bertanwin, jadi ini kalimat lengkap.',
        },
        {
          id: 'd',
          text: 'Sebuah buku kecil',
          correct: false,
          distractor: 'wrong-definiteness',
          feedback: 'الْكِتَابُ memakai الـ, jadi bukunya tertentu, bukan sebuah buku.',
        },
      ],
      constructed: true,
      review_status: 'draft',
    },
  ],
};

// ---------------------------------------------------------------------------------------
// Validator. First a structural pass over unknown input (exact keys, literal provenance,
// types); only a structurally sound value reaches the content rules below.

type Errors = string[];

const SHAPES: readonly PhraseShape[] = ['definite-phrase', 'nominal-sentence'];
const FORMATS: readonly string[] = ['arabic-to-meaning', 'meaning-to-arabic'];
const PHASES: readonly string[] = ['practice', 'transfer'];
const DISTRACTORS: readonly string[] = ['other-structure', 'wrong-definiteness', 'wrong-word'];
const OPPOSITE: Readonly<Record<PhraseShape, PhraseShape>> = {
  'definite-phrase': 'nominal-sentence',
  'nominal-sentence': 'definite-phrase',
};
const ID_PREFIX = 'uc-nd-';
const ITEM_COUNTS = { practice: 6, transfer: 4 } as const;

// Whole-text comparison ignores harakat (after NFC), decorative tatweel, invisible format
// characters (e.g. the right-to-left mark), punctuation, spacing and case.
const norm = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/[ـ\p{Cf}]/gu, '')
    .replace(/\p{Mn}/gu, '')
    .replace(/\p{P}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
const tokens = (text: string): string[] => norm(text).split(' ').filter((token) => token !== '');
const ARABIC_LETTER = /[ء-غف-ي]/;
const AL = 'ال';
const bare = (word: string): string => norm(word).replace(/^ال/, '');
const TANWIN = /[ً-ٍ]/; // fathatan, dammatan, kasratan
/** Taught rule: a word written with الـ drops its tanwin. Reads the raw marks, which norm strips. */
const definiteWithTanwin = (text: string): boolean =>
  text
    .normalize('NFC')
    .split(/\s+/)
    .some((word) => norm(word).startsWith(AL) && TANWIN.test(word));
const pairKey = (combo: Combination): string => `${norm(combo.noun)}|${bare(combo.adjective)}`;
const bothShapes = (combo: Combination): string[] => [
  `${norm(combo.noun)} ${bare(combo.adjective)}`,
  `${norm(combo.noun)} ${AL}${bare(combo.adjective)}`,
];

/** الْـN الْـA is the phrase, الْـN A the complete sentence; anything else is neither. */
const shapeOfArabic = (text: string, combo: Combination): PhraseShape | undefined => {
  const [first, second, ...rest] = tokens(text);
  if (rest.length > 0 || first !== norm(combo.noun)) return undefined;
  if (second === AL + bare(combo.adjective)) return 'definite-phrase';
  if (second === bare(combo.adjective)) return 'nominal-sentence';
  return undefined;
};

/** "rumah besar itu" is the phrase, "rumah itu besar" the sentence. */
const shapeOfIndonesian = (text: string): PhraseShape | undefined => {
  const words = tokens(text);
  const at = words.indexOf('itu');
  if (at < 1 || words.lastIndexOf('itu') !== at) return undefined;
  if (at === words.length - 1) return at >= 2 ? 'definite-phrase' : undefined;
  return 'nominal-sentence';
};

const stringsIn = (value: unknown, seen: WeakSet<object> = new WeakSet()): string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((child: unknown) => stringsIn(child, seen));
};

// Existing registries this increment must stay apart from.
const SHIPPED = [activePack, v02Pack, legacyPack];
const REGISTRY_TEXTS = [...SHIPPED, PILOT_CONTENT].flatMap((pack) => stringsIn(pack));
const REGISTRY_NORMS = REGISTRY_TEXTS.map(norm);
const KNOWN_VERSIONS: readonly string[] = [...SHIPPED.map((pack) => pack.content_version), PILOT_CONTENT.contentVersion];
const KNOWN_IDS = new Set<string>([
  ...SHIPPED.flatMap((pack) =>
    pack.items.flatMap((item) => [item.item_id, ...(item.legacy_item_ids ?? []), ...(item.lineage ? [item.lineage] : [])]),
  ),
  ...SHIPPED.flatMap((pack) => [
    ...pack.lesson_screens.map((screen) => screen.screen_id),
    ...Object.keys(pack.prompts),
    ...Object.keys(pack.feedback),
  ]),
  ...PILOT_CONTENT.lessons.map((lesson) => lesson.id),
  ...PILOT_CONTENT.items.flatMap((item) => [item.id, item.family]),
]);
const PILOT_HELD_OUT = PILOT_CONTENT.items.filter((item) => item.phase !== 'practice');
const PILOT_RESERVED = PILOT_HELD_OUT.flatMap((item) => [
  ...(tokens(item.arabic).length >= 2 ? [norm(item.arabic)] : []),
  ...item.options.filter((option) => option.correct).map((option) => norm(option.text)),
]);
const PILOT_PAIRS = new Set(
  PILOT_HELD_OUT.flatMap((item) =>
    item.options
      .filter((option) => option.correct)
      .map((option) => tokens(option.text))
      .filter((words) => words.length === 2 && words.every((word) => ARABIC_LETTER.test(word)))
      .map(([noun, adjective]) => `${noun ?? ''}|${(adjective ?? '').replace(/^ال/, '')}`),
  ),
);
const RESERVED_FORMS = new Set(
  SHIPPED.flatMap((pack) => pack.items)
    .filter((item) => item.reserve_forms === true)
    .flatMap((item) => item.forms ?? [])
    .map(norm),
);

const JARGON =
  /\b(transfer|practice|held[- ]?out|item|phase|family|construct|validator|schema|evidence|mastery|unlock\w*|xp|d7|d30|u-c|key|distractor|draft|synthetic|prerequisite)\b/i;
const ATTRIBUTION = /qur['’]?an|\bayat\b|\bsurah?\b|\bhadi[st]s?\b|hadith/i;
const BLANK = /_|\.\.\.|…/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const oneOf = (value: unknown, allowed: readonly string[]): boolean => typeof value === 'string' && allowed.includes(value);
const has = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  where: string,
  errors: Errors,
): void {
  for (const key of required) if (!has(value, key)) errors.push(`${where}: missing ${key}`);
  for (const key of Object.keys(value)) {
    if (!required.includes(key) && !optional.includes(key)) errors.push(`${where}: unknown key ${key}`);
  }
}

function checkHelpLinesShape(value: unknown, where: string, errors: Errors): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${where}: help_lines must be a non-empty list`);
    return;
  }
  value.forEach((line: unknown, index: number) => {
    const at = `${where}.help_lines[${index}]`;
    if (!isRecord(line)) {
      errors.push(`${at}: expected an object`);
      return;
    }
    exactKeys(line, ['word', 'meaning'], [], at, errors);
    if (!isText(line.word) || !isText(line.meaning)) errors.push(`${at}: word and meaning must be non-empty text`);
  });
}

function checkPairShape(value: unknown, keys: readonly [string, string], where: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${where}: expected an object`);
    return;
  }
  exactKeys(value, keys, [], where, errors);
  if (!keys.every((key) => isText(value[key]))) errors.push(`${where}: ${keys.join(' and ')} must be non-empty text`);
}

function checkLessonShape(value: unknown, where: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${where}: expected an object`);
    return;
  }
  exactKeys(value, ['lesson_id', 'unit', 'title', 'vocabulary', 'screens', 'review_status'], [], where, errors);
  if (!isText(value.lesson_id)) errors.push(`${where}: lesson_id must be non-empty text`);
  if (value.unit !== 'U-C') errors.push(`${where}: unit must be U-C`);
  if (!isText(value.title)) errors.push(`${where}: title must be non-empty text`);
  if (value.review_status !== 'draft') errors.push(`${where}: review_status must be draft`);

  const vocabulary = value.vocabulary;
  if (!isRecord(vocabulary)) {
    errors.push(`${where}.vocabulary: expected an object`);
  } else {
    exactKeys(vocabulary, ['nouns', 'adjectives'], [], `${where}.vocabulary`, errors);
    for (const [list, extra] of [['nouns', ['gender']], ['adjectives', []]] as const) {
      const entries = vocabulary[list];
      if (!Array.isArray(entries)) {
        errors.push(`${where}.vocabulary.${list}: expected a list`);
        continue;
      }
      entries.forEach((entry: unknown, index: number) => {
        const at = `${where}.vocabulary.${list}[${index}]`;
        if (!isRecord(entry)) {
          errors.push(`${at}: expected an object`);
          return;
        }
        exactKeys(entry, ['word', 'meaning', ...extra], [], at, errors);
        if (!isText(entry.word) || !isText(entry.meaning)) errors.push(`${at}: word and meaning must be non-empty text`);
        if (list === 'nouns' && entry.gender !== 'masculine') errors.push(`${at}: noun gender must be supplied as masculine`);
      });
    }
  }

  const screens = value.screens;
  if (!Array.isArray(screens) || screens.length === 0) {
    errors.push(`${where}.screens: expected a non-empty list`);
    return;
  }
  screens.forEach((screen: unknown, index: number) => {
    const at = `${where}.screens[${index}]`;
    if (!isRecord(screen)) {
      errors.push(`${at}: expected an object`);
      return;
    }
    exactKeys(screen, ['screen_id', 'unit', 'title', 'body', 'examples', 'review_status'], ['clue_paragraph'], at, errors);
    if (!isText(screen.screen_id)) errors.push(`${at}: screen_id must be non-empty text`);
    if (screen.unit !== 'U-C') errors.push(`${at}: unit must be U-C`);
    if (screen.review_status !== 'draft') errors.push(`${at}: review_status must be draft`);
    if (!isText(screen.title)) errors.push(`${at}: title must be non-empty text`);
    const body = screen.body;
    if (!Array.isArray(body) || body.length === 0 || !body.every(isText)) {
      errors.push(`${at}: body must be a non-empty list of non-empty paragraphs`);
    } else if (
      screen.clue_paragraph !== undefined &&
      !(Number.isInteger(screen.clue_paragraph) && Number(screen.clue_paragraph) >= 0 && Number(screen.clue_paragraph) < body.length)
    ) {
      errors.push(`${at}: clue_paragraph must index a body paragraph`);
    }
    if (!Array.isArray(screen.examples)) {
      errors.push(`${at}.examples: expected a list`);
      return;
    }
    screen.examples.forEach((example: unknown, exampleIndex: number) => {
      const ex = `${at}.examples[${exampleIndex}]`;
      if (!isRecord(example)) {
        errors.push(`${ex}: expected an object`);
        return;
      }
      exactKeys(example, ['arabic', 'shape', 'combination', 'help_lines', 'meaning', 'explanation'], [], ex, errors);
      if (!isText(example.arabic) || !isText(example.meaning) || !isText(example.explanation)) {
        errors.push(`${ex}: arabic, meaning and explanation must be non-empty text`);
      }
      if (!oneOf(example.shape, SHAPES)) errors.push(`${ex}: unknown shape`);
      checkPairShape(example.combination, ['noun', 'adjective'], `${ex}.combination`, errors);
      checkHelpLinesShape(example.help_lines, ex, errors);
    });
  });
}

const ITEM_KEYS = [
  'item_id',
  'unit',
  'lesson_id',
  'phase',
  'family',
  'format',
  'stem',
  'prompt',
  'help_lines',
  'noun_gender',
  'combination',
  'key_shape',
  'solution',
  'options',
  'constructed',
  'review_status',
] as const;

function checkItemShape(value: unknown, where: string, errors: Errors): void {
  if (!isRecord(value)) {
    errors.push(`${where}: expected an object`);
    return;
  }
  exactKeys(value, ITEM_KEYS, [], where, errors);
  for (const key of ['item_id', 'lesson_id', 'family', 'stem', 'prompt'] as const) {
    if (!isText(value[key])) errors.push(`${where}: ${key} must be non-empty text`);
  }
  if (value.unit !== 'U-C') errors.push(`${where}: unit must be U-C`);
  if (!oneOf(value.phase, PHASES)) errors.push(`${where}: phase must be practice or transfer`);
  if (!oneOf(value.format, FORMATS)) errors.push(`${where}: unknown format`);
  if (!oneOf(value.key_shape, SHAPES)) errors.push(`${where}: unknown key_shape`);
  if (value.noun_gender !== 'masculine') errors.push(`${where}: noun_gender must be masculine`);
  if (value.constructed !== true) errors.push(`${where}: constructed must be true`);
  if (value.review_status !== 'draft') errors.push(`${where}: review_status must be draft`);
  checkHelpLinesShape(value.help_lines, where, errors);
  checkPairShape(value.combination, ['noun', 'adjective'], `${where}.combination`, errors);
  checkPairShape(value.solution, ['arabic', 'indonesian'], `${where}.solution`, errors);

  const options = value.options;
  if (!Array.isArray(options) || options.length !== 4) {
    errors.push(`${where}: exactly four options are required`);
    return;
  }
  options.forEach((option: unknown, index: number) => {
    const at = `${where}.options[${index}]`;
    if (!isRecord(option)) {
      errors.push(`${at}: expected an object`);
      return;
    }
    exactKeys(option, ['id', 'text', 'correct', 'feedback'], ['arabic', 'distractor'], at, errors);
    if (!isText(option.id) || !isText(option.text)) errors.push(`${at}: id and text must be non-empty text`);
    if (typeof option.correct !== 'boolean') errors.push(`${at}: correct must be true or false`);
    if (!isText(option.feedback)) errors.push(`${at}: feedback must be non-empty text`);
    if (option.arabic !== undefined && typeof option.arabic !== 'boolean') errors.push(`${at}: arabic must be a flag`);
    if (option.distractor !== undefined && !oneOf(option.distractor, DISTRACTORS)) errors.push(`${at}: unknown distractor kind`);
  });
}

const CONTENT_LITERALS: readonly (readonly [string, unknown])[] = [
  ['increment_id', 'nominal-definiteness'],
  ['unit', 'U-C'],
  ['content_version', 'u-c-nominal-definiteness-draft-0.1'],
  ['language', 'id'],
  ['synthetic', true],
  ['constructed', true],
  ['quran_attribution', false],
  ['review_status', 'draft'],
];

function checkContentShape(value: unknown): Errors {
  if (!isRecord(value)) return ['content: expected an object'];
  const errors: Errors = [];
  exactKeys(value, [...CONTENT_LITERALS.map(([key]) => key), 'human_review', 'integration', 'lessons', 'items'], [], 'content', errors);
  for (const [key, expected] of CONTENT_LITERALS) {
    if (value[key] !== expected) errors.push(`content: ${key} must be ${String(expected)}`);
  }
  const review = value.human_review;
  if (!isRecord(review)) {
    errors.push('content.human_review: expected an object');
  } else {
    exactKeys(review, ['arabic', 'indonesian', 'assessment'], [], 'content.human_review', errors);
    if (review.arabic !== 'pending' || review.indonesian !== 'pending' || review.assessment !== 'pending') {
      errors.push('content.human_review: every review must still be pending');
    }
  }
  const integration = value.integration;
  if (!isRecord(integration)) {
    errors.push('content.integration: expected an object');
  } else {
    exactKeys(integration, ['shipped', 'automatic_unlock'], [], 'content.integration', errors);
    if (integration.shipped !== false || integration.automatic_unlock !== false) {
      errors.push('content.integration: must be unshipped and never unlock automatically');
    }
  }
  if (!Array.isArray(value.lessons) || value.lessons.length !== 1) {
    errors.push('content.lessons: exactly one lesson is required');
  } else {
    value.lessons.forEach((lesson: unknown, index: number) => checkLessonShape(lesson, `lessons[${index}]`, errors));
  }
  const expectedItems = ITEM_COUNTS.practice + ITEM_COUNTS.transfer;
  if (!Array.isArray(value.items) || value.items.length !== expectedItems) {
    errors.push(`content.items: exactly ${expectedItems} items are required`);
  } else {
    value.items.forEach((item: unknown, index: number) => checkItemShape(item, `items[${index}]`, errors));
  }
  return errors;
}

// ---------------------------------------------------------------------------------------
// Content rules over a structurally sound value.

function arabicFields(content: IncrementContent): string[] {
  const examples = content.lessons.flatMap((lesson) => lesson.screens).flatMap((screen) => screen.examples);
  return [
    ...content.lessons.flatMap((lesson) => [
      ...lesson.vocabulary.nouns.map((noun) => noun.word),
      ...lesson.vocabulary.adjectives.map((adjective) => adjective.word),
    ]),
    ...examples.flatMap((example) => [
      example.arabic,
      example.combination.noun,
      example.combination.adjective,
      ...example.help_lines.map((line) => line.word),
    ]),
    ...content.items.flatMap((item) => [
      item.solution.arabic,
      item.combination.noun,
      item.combination.adjective,
      ...item.help_lines.map((line) => line.word),
      ...(item.format === 'arabic-to-meaning' ? [item.stem] : []),
      ...item.options.filter((option) => option.arabic === true).map((option) => option.text),
    ]),
  ];
}

function learnerTexts(content: IncrementContent): string[] {
  const screens = content.lessons.flatMap((lesson) => lesson.screens);
  return [
    ...content.lessons.flatMap((lesson) => [
      lesson.title,
      ...lesson.vocabulary.nouns.map((noun) => noun.meaning),
      ...lesson.vocabulary.adjectives.map((adjective) => adjective.meaning),
    ]),
    ...screens.flatMap((screen) => [
      screen.title,
      ...screen.body,
      ...screen.examples.flatMap((example) => [example.meaning, example.explanation, ...example.help_lines.map((l) => l.meaning)]),
    ]),
    ...content.items.flatMap((item) => [
      item.prompt,
      item.stem,
      ...item.help_lines.map((line) => line.meaning),
      ...item.options.flatMap((option) => [option.text, option.feedback]),
    ]),
  ];
}

function checkItemRules(item: IncrementItem): Errors {
  const found: Errors = [];
  const keys = item.options.filter((option) => option.correct);
  const wrong = item.options.filter((option) => !option.correct);
  const texts = new Set(item.options.map((option) => norm(option.text)));
  if (texts.size !== 4 || texts.has('')) found.push('choices must be four distinct texts');
  if (new Set(item.options.map((option) => option.id)).size !== 4) found.push('choice ids must be distinct');
  if (keys.length !== 1) found.push('exactly one choice must be correct');
  if (keys.some((option) => option.distractor !== undefined)) found.push('the correct choice carries no distractor kind');
  if (wrong.some((option) => option.distractor === undefined)) found.push('every wrong choice needs a distractor kind');
  if (!wrong.some((option) => option.distractor === 'other-structure')) found.push('no other-structure distractor');
  if (new Set(item.options.map((option) => option.feedback.trim())).size !== 4) found.push('feedback must differ per choice');

  const arabicChoices = item.format === 'meaning-to-arabic';
  for (const option of item.options) {
    const isArabic = ARABIC_LETTER.test(option.text);
    if ((option.arabic === true) !== isArabic || isArabic !== arabicChoices) {
      found.push(`choice ${option.id} script does not match the task direction`);
    }
  }

  const { arabic, indonesian } = item.solution;
  if (shapeOfArabic(arabic, item.combination) !== item.key_shape) found.push('Arabic solution does not have the keyed shape');
  if (shapeOfIndonesian(indonesian) !== item.key_shape) found.push('Indonesian solution does not have the keyed shape');
  const [stemSide, keySide] = arabicChoices ? [indonesian, arabic] : [arabic, indonesian];
  if (norm(item.stem) !== norm(stemSide)) found.push('stem is not the solution side shown');
  const key = keys[0];
  if (key === undefined || norm(key.text) !== norm(keySide)) found.push('correct choice is not the solution');
  const shownArabic = arabicChoices ? (key?.text ?? '') : item.stem;
  if (definiteWithTanwin(arabic) || definiteWithTanwin(shownArabic)) {
    found.push('a word with al- keeps its tanwin');
  }

  const shapeOf = (text: string) => (arabicChoices ? shapeOfArabic(text, item.combination) : shapeOfIndonesian(text));
  for (const option of wrong) {
    if (option.distractor === 'other-structure' && shapeOf(option.text) !== OPPOSITE[item.key_shape]) {
      found.push(`choice ${option.id} is not the other structure`);
    }
    if (option.distractor === 'wrong-definiteness') {
      const lost = arabicChoices ? tokens(option.text)[0] === bare(item.combination.noun) : !tokens(option.text).includes('itu');
      if (!lost) found.push(`choice ${option.id} keeps the definite noun`);
    }
  }

  const giveaway = [item.prompt, ...item.help_lines.flatMap((line) => [line.word, line.meaning])].map(norm);
  if (giveaway.some((text) => text.includes(norm(arabic)) || text.includes(norm(indonesian)))) {
    found.push('prompt or help gives away the whole solution');
  }
  if (BLANK.test(item.stem) || BLANK.test(item.prompt)) found.push('fill-in blanks are not allowed');
  if (!item.help_lines.some((line) => norm(line.word) === norm(item.combination.noun))) found.push('noun is not glossed');
  if (!/maskulin/i.test([item.prompt, ...item.help_lines.map((line) => line.meaning)].join(' '))) {
    found.push('noun gender is not supplied to the learner');
  }
  return found.map((problem) => `${item.item_id}: ${problem}`);
}

function checkContentRules(content: IncrementContent): Errors {
  const errors: Errors = [];
  const lesson = content.lessons[0];
  if (lesson === undefined) return ['content.lessons: exactly one lesson is required'];
  const { screens } = lesson;
  const examples = screens.flatMap((screen) => screen.examples);
  const { items } = content;
  const practice = items.filter((item) => item.phase === 'practice');
  const transfer = items.filter((item) => item.phase === 'transfer');

  // Provenance: an own, unmentioned draft version.
  if (KNOWN_VERSIONS.includes(content.content_version) || REGISTRY_TEXTS.some((text) => text.includes(content.content_version))) {
    errors.push('content: content_version collides with existing material');
  }

  // Vocabulary: a few supplied masculine singular nouns and regular adjectives in base form.
  const { nouns, adjectives } = lesson.vocabulary;
  if (nouns.length < 2 || nouns.length > 5) errors.push('vocabulary: two to five nouns are required');
  if (adjectives.length < 2 || adjectives.length > 5) errors.push('vocabulary: two to five adjectives are required');
  for (const noun of nouns) {
    if (!norm(noun.word).startsWith(AL) || bare(noun.word).length < 2 || tokens(noun.word).length !== 1 || noun.word.includes('ة')) {
      errors.push(`vocabulary: ${noun.word} is not one definite masculine singular noun`);
    }
  }
  for (const adjective of adjectives) {
    if (
      norm(adjective.word).startsWith(AL) ||
      !adjective.word.includes('ٌ') ||
      tokens(adjective.word).length !== 1 ||
      adjective.word.includes('ة')
    ) {
      errors.push(`vocabulary: ${adjective.word} is not one indefinite masculine base adjective`);
    }
  }
  const words = [...nouns, ...adjectives].map((entry) => norm(entry.word));
  if (new Set(words).size !== words.length) errors.push('vocabulary: duplicate word');
  const taughtNouns = new Set(nouns.map((noun) => norm(noun.word)));
  const taughtAdjectives = new Set(adjectives.map((adjective) => bare(adjective.word)));
  const combos = [...examples.map((example) => example.combination), ...items.map((item) => item.combination)];
  for (const combo of combos) {
    if (!taughtNouns.has(norm(combo.noun)) || !taughtAdjectives.has(bare(combo.adjective))) {
      errors.push(`vocabulary: ${pairKey(combo)} uses an untaught word`);
    }
  }
  // Meanings follow the taught glosses: noun + "itu" + adjective is the sentence, noun + adjective + "itu" the phrase.
  const nounMeanings = new Map(nouns.map((noun) => [norm(noun.word), norm(noun.meaning).replace(/ itu$/, '')]));
  const adjectiveMeanings = new Map(adjectives.map((adjective) => [bare(adjective.word), norm(adjective.meaning)]));
  const taughtMeaning = (combo: Combination, shape: PhraseShape): string | undefined => {
    const noun = nounMeanings.get(norm(combo.noun));
    const adjective = adjectiveMeanings.get(bare(combo.adjective));
    if (noun === undefined || adjective === undefined) return undefined;
    return shape === 'definite-phrase' ? `${noun} ${adjective} itu` : `${noun} itu ${adjective}`;
  };
  for (const example of examples) {
    const expected = taughtMeaning(example.combination, example.shape);
    if (expected !== undefined && norm(example.meaning) !== expected) {
      errors.push(`lesson: example ${example.arabic} does not mean "${expected}"`);
    }
  }
  for (const item of items) {
    const expected = taughtMeaning(item.combination, item.key_shape);
    if (expected !== undefined && norm(item.solution.indonesian) !== expected) {
      errors.push(`${item.item_id}: Indonesian solution does not mean "${expected}"`);
    }
  }
  const allowed = new Set([
    ...taughtNouns,
    ...[...taughtNouns].map((noun) => noun.replace(/^ال/, '')),
    ...taughtAdjectives,
    ...[...taughtAdjectives].map((adjective) => AL + adjective),
  ]);
  const arabicTokens = arabicFields(content).flatMap(tokens).filter((token) => ARABIC_LETTER.test(token));
  for (const token of new Set(arabicTokens)) {
    if (!allowed.has(token)) errors.push(`vocabulary: Arabic form ${token} is not taught`);
    if (RESERVED_FORMS.has(token)) errors.push(`vocabulary: ${token} is a reserved form of shipped material`);
  }

  // Lesson: al- named, at least two coherent worked examples per shape, and a minimal pair.
  if (!screens.flatMap((screen) => screen.body).flatMap(tokens).some((token) => /^الـ?$/.test(token))) {
    errors.push('lesson: the explanation never names al- (الـ)');
  }
  if (examples.length < 4) errors.push('lesson: at least four worked examples are required');
  for (const shape of SHAPES) {
    if (examples.filter((example) => example.shape === shape).length < 2) errors.push(`lesson: fewer than two ${shape} examples`);
  }
  const shapesByPair = new Map<string, Set<PhraseShape>>();
  for (const example of examples) {
    if (shapeOfArabic(example.arabic, example.combination) !== example.shape || shapeOfIndonesian(example.meaning) !== example.shape) {
      errors.push(`lesson: example ${example.arabic} does not match its shape`);
    }
    if (definiteWithTanwin(example.arabic)) errors.push(`lesson: example ${example.arabic} keeps tanwin on a word with al-`);
    const shapes = shapesByPair.get(pairKey(example.combination)) ?? new Set<PhraseShape>();
    shapes.add(example.shape);
    shapesByPair.set(pairKey(example.combination), shapes);
  }
  if (![...shapesByPair.values()].some((shapes) => shapes.size === 2)) {
    errors.push('lesson: no minimal pair shows one noun and adjective both ways');
  }

  // IDs: own namespace, unique, unknown to every shipped and pilot registry.
  const ids = [lesson.lesson_id, ...screens.map((screen) => screen.screen_id), ...items.flatMap((item) => [item.item_id, item.family])];
  if (new Set(ids).size !== ids.length) errors.push('ids: duplicate lesson, screen, item or family id');
  for (const id of ids) {
    if (!id.startsWith(ID_PREFIX)) errors.push(`ids: ${id} is outside the ${ID_PREFIX} namespace`);
    if (KNOWN_IDS.has(id)) errors.push(`ids: ${id} collides with an existing registry`);
  }
  for (const item of items) {
    if (historicalItem(item.item_id) !== undefined || lineageOf(item.item_id) !== `id:${item.item_id}`) {
      errors.push(`ids: ${item.item_id} has existing history or lineage`);
    }
    if (item.lesson_id !== lesson.lesson_id) errors.push(`${item.item_id}: not tied to this lesson`);
  }

  // Tasks: six practice and four transfer, balanced by format and shape, keys spread out.
  if (practice.length !== ITEM_COUNTS.practice || transfer.length !== ITEM_COUNTS.transfer) {
    errors.push('items: six practice and four transfer tasks are required');
  }
  const count = (list: readonly IncrementItem[], test: (item: IncrementItem) => boolean) => list.filter(test).length;
  const coverage: Record<string, boolean> = {
    'practice arabic-to-meaning': count(practice, (i) => i.format === 'arabic-to-meaning') >= 2,
    'practice meaning-to-arabic': count(practice, (i) => i.format === 'meaning-to-arabic') >= 2,
    'practice phrase': count(practice, (i) => i.key_shape === 'definite-phrase') >= 2,
    'practice sentence': count(practice, (i) => i.key_shape === 'nominal-sentence') >= 2,
    'transfer arabic-to-meaning': count(transfer, (i) => i.format === 'arabic-to-meaning') >= 1,
    'transfer meaning-to-arabic': count(transfer, (i) => i.format === 'meaning-to-arabic') >= 1,
    'transfer phrase': count(transfer, (i) => i.key_shape === 'definite-phrase') === 2,
    'transfer sentence': count(transfer, (i) => i.key_shape === 'nominal-sentence') === 2,
  };
  for (const [name, ok] of Object.entries(coverage)) if (!ok) errors.push(`items: coverage of ${name} is off`);
  if (new Set(items.map((item) => item.family)).size !== items.length) errors.push('items: families must be distinct');
  const positions = items.map((item) => item.options.findIndex((option) => option.correct));
  if ([0, 1, 2, 3].some((p) => !positions.includes(p) || positions.filter((q) => q === p).length > 4)) {
    errors.push('items: correct choices must use every position, none more than four times');
  }
  if (new Set(items.map((item) => norm(item.stem))).size !== items.length) errors.push('items: stems must be distinct');
  errors.push(...items.flatMap(checkItemRules));

  // Transfer: new combinations of earlier words, whole solutions reserved.
  const earlier = [...examples.map((example) => example.combination), ...practice.map((item) => item.combination)];
  const earlierPairs = new Set(earlier.map(pairKey));
  const earlierNouns = new Set(earlier.map((combo) => norm(combo.noun)));
  const earlierAdjectives = new Set(earlier.map((combo) => bare(combo.adjective)));
  const lessonTexts = stringsIn(content.lessons).map(norm);
  const practiceTexts = stringsIn(practice).map(norm);
  const seenTexts = [...lessonTexts, ...practiceTexts, ...REGISTRY_NORMS];
  if (new Set(transfer.map((item) => pairKey(item.combination))).size !== transfer.length) {
    errors.push('transfer: combinations must be distinct');
  }
  for (const item of transfer) {
    const { combination } = item;
    if (earlierPairs.has(pairKey(combination))) errors.push(`${item.item_id}: combination already shown`);
    if (!earlierNouns.has(norm(combination.noun))) errors.push(`${item.item_id}: noun not used before`);
    if (!earlierAdjectives.has(bare(combination.adjective))) errors.push(`${item.item_id}: adjective not used before`);
    const forms = bothShapes(combination);
    if (seenTexts.some((text) => forms.some((form) => text.includes(form)))) {
      errors.push(`${item.item_id}: combination appears in lesson, practice or existing material`);
    }
    const reserved = [norm(item.solution.arabic), norm(item.solution.indonesian)];
    if (reserved.some((solution) => solution.split(' ').length < 2)) {
      errors.push(`${item.item_id}: solution too short to reserve`);
      continue;
    }
    const others = stringsIn(transfer.filter((other) => other !== item)).map(norm);
    const places: [string, string[]][] = [
      ['lesson', lessonTexts],
      ['practice', practiceTexts],
      ['another transfer task', others],
      ['existing material', REGISTRY_NORMS],
    ];
    for (const [place, texts] of places) {
      for (const solution of reserved) {
        if (texts.some((text) => text.includes(solution))) errors.push(`${item.item_id}: reserved "${solution}" appears in ${place}`);
      }
    }
  }

  // Existing Unit A held-out material stays unrevealed.
  const ours = stringsIn(content).map(norm);
  for (const solution of PILOT_RESERVED) {
    if (ours.some((text) => text.includes(solution))) errors.push(`content: reveals Unit A held-out solution "${solution}"`);
  }
  for (const combo of combos) {
    if (PILOT_PAIRS.has(pairKey(combo))) errors.push(`content: ${pairKey(combo)} is a Unit A held-out pair`);
  }

  // Learner text: no implementation jargon or source attribution.
  for (const text of learnerTexts(content)) {
    if (JARGON.test(text) || ATTRIBUTION.test(text)) errors.push(`learner text: jargon or attribution in "${text}"`);
  }
  return errors;
}

/** Returns non-empty messages for anything off-contract; an empty list means valid. */
export function validateNominalDefiniteness(value: unknown): string[] {
  try {
    const errors = checkContentShape(value);
    return errors.length > 0 ? errors : checkContentRules(value as IncrementContent);
  } catch {
    // Safety net for exotic inputs (e.g. throwing getters); plain malformed data never gets here.
    return ['content: input could not be read'];
  }
}
