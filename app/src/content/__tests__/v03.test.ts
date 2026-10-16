// Repair 2026-10-16: content validity regressions (CONTENT-F01/F02/F03/F04/F07, SCOPE-01/02).
import { validatePack } from '@/content/gating';
import { activePack, lineageOf } from '@/content/load';
import type { ContentPack, Item } from '@/content/schema';
import interim from './fixtures/remed-interim-60483e.json';

const graded = activePack.items.filter((i) => i.pool !== 'FOCUS' && !i.practice_only);
const byId = (id: string) => activePack.items.find((i) => i.item_id === id)!;
const genderOf = (arabic: string) => (arabic.startsWith('هِيَ') ? 'perempuan' : arabic.startsWith('هُوَ') ? 'laki-laki' : null);

describe('v0.3 pack basics', () => {
  it('is the active, valid, synthetic draft pack', () => {
    expect(activePack.content_version).toBe('demo-synthetic-0.3');
    expect(validatePack(activePack)).toEqual([]);
    expect(activePack.synthetic).toBe(true);
    expect(activePack.items.every((i) => i.review_status === 'draft')).toBe(true);
  });
});

describe('F01: no gender + answer-style shortcut on unglossed sentence interpretations', () => {
  const unglossed = activePack.items.filter((i) => i.unit === 'A' && i.format === 'interpretation' && i.help_lines.length === 0);

  it('the reviewer heuristic (initial pronoun → sole «Dia (<gender>) orang yang …» option) never isolates the key', () => {
    expect(unglossed.length).toBeGreaterThanOrEqual(10);
    for (const it of unglossed) {
      const g = genderOf(it.arabic)!;
      const candidates = it.options!.filter((o) => o.text.startsWith(`Dia (${g}) orang yang`));
      expect({ id: it.item_id, n: candidates.length }).toEqual({ id: it.item_id, n: 2 });
    }
  });

  it('the predicate meaning distinguishes the key from the same-gender alternative', () => {
    for (const it of unglossed) {
      const g = genderOf(it.arabic)!;
      const same = it.options!.filter((o) => o.text.startsWith(`Dia (${g}) orang yang`));
      const wrong = same.find((o) => !o.correct)!;
      expect({ id: it.item_id, mis: wrong.misconceptions }).toEqual({ id: it.item_id, mis: ['lexical'] });
    }
  });

  it('no sentence or verb grid can be solved from gender alone (≥2 options carry the right gender)', () => {
    for (const it of activePack.items.filter((i) => ['interpretation', 'verb-interpretation'].includes(i.format!))) {
      const g = it.referent!;
      const n = it.options!.filter((o) => o.text.includes(`(${g})`)).length;
      expect({ id: it.item_id, enough: n >= 2 }).toEqual({ id: it.item_id, enough: true });
    }
  });
});

describe('F02: meanings are taught on a lesson screen before any scored use', () => {
  const taughtForms = (unit: 'A' | 'B') =>
    new Set(
      activePack.lesson_screens
        .filter((s) => (unit === 'A' ? s.unit === 'A' : true))
        .flatMap((s) => (s.examples ?? []).map((e) => e.arabic))
    );

  it('every scored item that needs a meaning lists it, and that form is taught on a screen of its unit (or earlier)', () => {
    for (const it of graded) {
      const needsMeaning = it.help_lines.length === 0 && it.format !== 'form-grid' && it.format !== 'verb-identify';
      if (needsMeaning) expect({ id: it.item_id, has: (it.requires_taught ?? []).length > 0 }).toEqual({ id: it.item_id, has: true });
      for (const form of it.requires_taught ?? []) {
        expect({ id: it.item_id, form, taught: taughtForms(it.unit as 'A' | 'B').has(form) }).toEqual({ id: it.item_id, form, taught: true });
      }
    }
  });

  it('the Unit A word table and the Unit B verb table come before the first practice item of each unit', () => {
    const aVocab = activePack.lesson_screens.find((s) => s.screen_id === 'DEMO-S4')!;
    expect(aVocab.examples!.map((e) => e.arabic)).toEqual(['مُؤْمِنٌ', 'صَالِحٌ', 'صَادِقٌ', 'صَابِرٌ', 'عَالِمٌ', 'كَرِيمٌ']);
    const bVocab = activePack.lesson_screens.find((s) => s.screen_id === 'DEMO-BS4')!;
    expect(bVocab.examples!.map((e) => e.arabic)).toEqual(['ذَهَبَ', 'خَرَجَ', 'دَخَلَتْ', 'رَجَعَ', 'سَمِعَ', 'شَكَرَ', 'سَجَدَ']);
    const order = activePack.lesson_screens.map((s) => s.screen_id);
    expect(order).toEqual(['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3', 'DEMO-BS1', 'DEMO-BS2', 'DEMO-BS4', 'DEMO-BS3']);
  });

  it('stale lesson copy is corrected (no separate gender question promise; no speech promise in Unit B)', () => {
    const text = activePack.lesson_screens.flatMap((s) => s.body).join(' ');
    expect(text).not.toMatch(/bertanya terpisah/);
    expect(activePack.lesson_screens.find((s) => s.screen_id === 'DEMO-BS1')!.body.join(' ')).not.toMatch(/berkata/);
  });
});

describe('F04: form grids do not print the answer form for copying', () => {
  it('every form-grid help line shows both the masculine and feminine form', () => {
    for (const it of activePack.items.filter((i) => i.format === 'form-grid')) {
      const key = it.options!.find((o) => o.correct)!.text.split(' ')[1];
      expect(it.help_lines[0].word).toContain(' / ');
      expect(it.help_lines[0].word.split(' / ')).toContain(key);
    }
  });
});

describe('keys and slash wording', () => {
  it.each([
    ['A3-P01', 'Dia (perempuan) orang yang beriman'],
    ['A3-P02', 'Dia (laki-laki) orang yang saleh'],
    ['A3-M02', 'orang yang berilmu'],
    ['A3-F01', 'هِيَ نَادِمَةٌ'],
    ['A3-P03', 'Dia (perempuan) orang yang bersyukur'],
    ['B3-W4', 'dia kembali'],
    ['B3-W5', 'dia mendengar'],
    ['B3-V3', 'Dia (perempuan) kembali'],
    ['B3-R1', 'Dia (perempuan) bersyukur'], // شَكَرَتْ
    ['B3-R2', 'Dia (perempuan) sujud'], // سَجَدَتْ
  ])('%s key is %s', (id, key) => {
    expect(byId(id).options!.find((o) => o.correct)!.text).toBe(key);
  });

  it('no key uses a slash alternative', () => {
    for (const it of activePack.items) expect({ id: it.item_id, key: it.options!.find((o) => o.correct)!.text.includes(' / ') }).toEqual({ id: it.item_id, key: false });
  });
});

/** Where an Arabic form is displayed in a pack: item stems, help lines, options, lesson body and examples. */
const tokens = (t: string) => t.split(/[\s.,:«»/]+/);
function surfacesOf(pack: ContentPack): { where: string; text: string }[] {
  return [
    ...pack.items.map((i: Item) => ({ where: i.item_id, text: [i.arabic, ...i.help_lines.map((h) => h.word), ...(i.options ?? []).map((o) => o.text)].join(' ') })),
    ...pack.lesson_screens.map((s) => ({ where: s.screen_id, text: [...s.body, ...(s.examples ?? []).map((e) => e.arabic)].join(' ') })),
  ];
}

/**
 * Prior-surface freshness (lessons §3.5): each fresh-required VRB-01 item (PRACT/REMED/READY/D7/D30)
 * must name exactly its own displayed form, and that form must be shown nowhere else in the pack.
 * Returns the violations (empty = pass).
 */
export function priorSurfaceProblems(pack: ContentPack): string[] {
  const problems: string[] = [];
  const surfaces = surfacesOf(pack);
  const fresh = pack.items.filter((i) => i.skills.includes('VRB-01') && ['PRACT', 'REMED', 'READY', 'D7', 'D30'].includes(i.pool));
  for (const it of fresh) {
    if (!it.arabic) problems.push(`${it.item_id}: no displayed target form`);
    if (JSON.stringify(it.forms ?? []) !== JSON.stringify(it.arabic ? [it.arabic] : ['<stem>'])) problems.push(`${it.item_id}: forms ${JSON.stringify(it.forms ?? [])} ≠ [stem]`);
    const shownElsewhere = surfaces.filter((s) => s.where !== it.item_id && it.arabic && tokens(s.text).includes(it.arabic)).map((s) => s.where);
    if (shownElsewhere.length) problems.push(`${it.item_id}: ${it.arabic} also shown in ${shownElsewhere.join(', ')}`);
    // Arabic answer choices are displayed forms too: each must be fresh to this item as well
    for (const o of (it.options ?? []).filter((x) => x.arabic)) {
      const elsewhere = surfaces.filter((s) => s.where !== it.item_id && tokens(s.text).includes(o.text)).map((s) => s.where);
      if (elsewhere.length) problems.push(`${it.item_id}: option ${o.text} already shown in ${elsewhere.join(', ')}`);
    }
  }
  return problems;
}

describe('reservations and Unit B coverage (handoff item 4, SCOPE-01)', () => {
  const surfaces = () => surfacesOf(activePack);
  const whereShown = (form: string) => surfaces().filter((s) => tokens(s.text).includes(form)).map((s) => s.where);

  it('the D30 holdout سَمِعَتْ is shown only in its check; fresh PRACT forms only in their item (and later REMED choices)', () => {
    expect(whereShown('سَمِعَتْ')).toEqual(['B3-D30V1']);
    expect(whereShown('رَجَعَتْ')).toEqual(['B3-V3']);
    expect(whereShown('دَخَلَ')).toEqual(['B3-V2']);
    expect(activePack.items.filter((i) => i.reserve_forms).map((i) => i.item_id)).toEqual(['B3-D30V1']);
  });

  it('retired reservations: taught lemmas رَجَعَ / سَمِعَ are no longer presented as fresh holdouts', () => {
    expect(activePack.items.some((i) => i.item_id.startsWith('B3-Y') || i.item_id.startsWith('B3-D7'))).toBe(false);
    expect(whereShown('هَرَبَ')).toEqual([]);
    expect(whereShown('ضَحِكَتْ')).toEqual([]);
  });

  it('prior-surface freshness: every fresh-required VRB-01 form appears ONLY in its own item (no lesson, stem, help or option elsewhere)', () => {
    const fresh = activePack.items.filter((i) => i.skills.includes('VRB-01') && ['PRACT', 'REMED', 'READY', 'D7', 'D30'].includes(i.pool));
    expect(fresh.map((i) => i.item_id).sort()).toEqual(['B3-D30V1', 'B3-R1', 'B3-R2', 'B3-V1', 'B3-V2', 'B3-V3']);
    for (const it of fresh) {
      expect(it.forms).toEqual([it.arabic]);
      expect({ id: it.item_id, shown: whereShown(it.arabic) }).toEqual({ id: it.item_id, shown: [it.item_id] });
    }
    expect(priorSurfaceProblems(activePack)).toEqual([]);
  });

  it('the same check REJECTS the previous (bad) Unit B REMED fixture: literal interim B3-R1/R2 (pack 60483e)', () => {
    // The pre-correction items (ledger C7): verb-form grids with an empty stem, forms [], and Arabic
    // choices خَرَجَ/خَرَجَتْ/ذَهَبَ/ذَهَبَتْ already shown on DEMO-BS2/DEMO-BS4 and in B3 practice.
    const old = interim.items as Item[];
    expect(old.map((i) => [i.item_id, i.arabic, i.forms])).toEqual([
      ['B3-R1', '', []],
      ['B3-R2', '', []],
    ]);
    const badPack: ContentPack = { ...activePack, items: activePack.items.map((i) => old.find((o) => o.item_id === i.item_id) ?? i) };
    const problems = priorSurfaceProblems(badPack);
    expect(problems).toEqual(
      expect.arrayContaining([
        'B3-R1: no displayed target form',
        'B3-R2: no displayed target form',
        expect.stringMatching(/^B3-R1: option خَرَجَ already shown in .*DEMO-BS4/),
        expect.stringMatching(/^B3-R2: option ذَهَبَتْ already shown in .*DEMO-BS2/),
        // the old choices also displayed B3-V1's fresh target خَرَجَتْ
        expect.stringMatching(/^B3-V1: خَرَجَتْ also shown in B3-R1, B3-R2/),
      ])
    );
    // nothing else fails: the violations come only from the replaced items
    expect(new Set(problems.map((p) => p.split(':')[0]))).toEqual(new Set(['B3-R1', 'B3-R2', 'B3-V1']));
  });

  it('Unit B REMED uses the source REMED verbs: unseen feminine targets, masculine meanings taught unscored first', () => {
    const remed = activePack.items.filter((i) => i.unit === 'B' && i.pool === 'REMED');
    expect(remed.map((i) => [i.item_id, i.arabic])).toEqual([
      ['B3-R1', 'شَكَرَتْ'],
      ['B3-R2', 'سَجَدَتْ'],
    ]);
    for (const r of remed) {
      expect(r.skills).toEqual(['VRB-01']);
      expect(r.requires_taught).toEqual(['شَكَرَ', 'سَجَدَ']);
      // Indonesian options only: neither holdout's Arabic form leaks through a choice
      expect(r.options!.every((o) => !o.arabic)).toBe(true);
    }
    // the taught masculine forms are lesson examples, never scored items
    expect(whereShown('شَكَرَ')).toEqual(['DEMO-BS4']);
    expect(whereShown('سَجَدَ')).toEqual(['DEMO-BS4']);
  });

  it('lineage is preserved across v0.1 → v0.2 → v0.3 IDs', () => {
    expect(lineageOf('DEMO-P01')).toBe('A:sentence:هِيَ مُؤْمِنَةٌ');
    expect(lineageOf('A2-P01')).toBe('A:sentence:هِيَ مُؤْمِنَةٌ');
    expect(lineageOf('A3-P01')).toBe('A:sentence:هِيَ مُؤْمِنَةٌ');
    expect(lineageOf('B2-V3')).toBe(lineageOf('B3-V3'));
  });
});
