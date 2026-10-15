import { gateContent, validatePack } from '@/content/gating';
import { activePack, legacyPack, lineageOf } from '@/content/load';
import type { ContentPack, Item } from '@/content/schema';
import { normalize } from '@/engine/scoring';

const clone = (p: ContentPack): ContentPack => JSON.parse(JSON.stringify(p));
const byId = (id: string): Item => {
  const it = activePack.items.find((i) => i.item_id === id);
  if (!it) throw new Error(`missing ${id}`);
  return it;
};
const key = (id: string) => byId(id).options!.find((o) => o.correct)!.text;
const optionText = (id: string, optId: string) => byId(id).options!.find((o) => o.id === optId)!;

describe('active four-choice pack (v0.2)', () => {
  it('is valid, synthetic, draft and carries the mcq4 format', () => {
    expect(validatePack(activePack)).toEqual([]);
    expect(activePack.answer_format).toBe('mcq4');
    expect(activePack.synthetic).toBe(true);
    expect(activePack.items.every((i) => i.review_status === 'draft')).toBe(true);
  });

  it('every graded item has exactly four options: unique IDs, unique texts, one key, full wrong-option metadata', () => {
    for (const item of activePack.items) {
      expect(item.type).toBe('mcq4');
      const opts = item.options ?? [];
      expect(opts).toHaveLength(4);
      expect(new Set(opts.map((o) => o.id)).size).toBe(4);
      expect(new Set(opts.map((o) => normalize(o.text) + '|' + o.text)).size).toBe(4);
      expect(opts.filter((o) => o.correct)).toHaveLength(1);
      for (const o of opts.filter((x) => !x.correct)) {
        expect(o.misconceptions?.length).toBeGreaterThan(0);
        expect(typeof o.serious).toBe('boolean');
        expect(o.feedback_ids?.length).toBeGreaterThan(0);
        for (const f of o.feedback_ids!) expect(activePack.feedback[f]).toBeTruthy();
      }
    }
  });

  // Answer keys checked by hand against Lessons_Unit_A_B_Draft.md §2.1, §2.5, §3.1, §3.3.
  it.each([
    ['A2-M01', 'orang yang jujur'], // صَادِقٌ W-A3
    ['A2-M02', 'orang yang berilmu / mengetahui'], // عَالِمٌ W-A5
    ['A2-P01', 'Dia (perempuan) orang yang beriman'], // هِيَ مُؤْمِنَةٌ
    ['A2-P02', 'Dia (laki-laki) orang yang saleh'], // هُوَ صَالِحٌ
    ['A2-F01', 'هِيَ نَادِمَةٌ'], // for perempuan: -atun
    ['A2-F02', 'هُوَ فَرِحٌ'], // for laki-laki: no -atun
    ['A2-D7W1', 'orang yang beriman'], // مُؤْمِنٌ W-A1
    ['A2-D30W4', 'orang yang sabar'], // صَابِرَةٌ W-A4
    ['B2-W1', 'dia pergi'], // ذَهَبَ V-B1
    ['B2-W2', 'dia keluar'], // خَرَجَ V-B2
    ['B2-W3', 'dia masuk'], // دَخَلَتْ V-B3
    ['B2-V1', 'Dia (perempuan) keluar'], // خَرَجَتْ: ـَتْ → perempuan
    ['B2-V2', 'Dia (laki-laki) masuk'], // دَخَلَ: no ـَتْ → laki-laki
    ['B2-VN1', 'صَبَرَتْ'], // the verb, not the description صَابِرَةٌ
  ])('%s key is %s', (id, expected) => {
    expect(key(id)).toBe(expected);
  });

  it('compound distractors name each misconception', () => {
    expect(optionText('A2-F01', 'c')).toMatchObject({ text: 'هُوَ نَادِمَةٌ', misconceptions: ['wrong-referent', 'wrong-form'], serious: true });
    expect(optionText('B2-V1', 'c')).toMatchObject({ text: 'Dia (laki-laki) masuk', misconceptions: ['wrong-referent', 'lexical'], serious: true });
    expect(optionText('A2-P01', 'p')).toMatchObject({ misconceptions: ['possession'], serious: true });
    expect(optionText('A2-P01', 'a')).toMatchObject({ misconceptions: ['invented-action'], serious: true });
  });

  it('uses no out-of-unit grammar, no filler and no "orang yang keluar" style event distractors', () => {
    const texts = activePack.items.flatMap((i) => i.options!.map((o) => o.text));
    for (const t of texts) expect(t).not.toMatch(/ُونَ|هُمْ|أَنَا|أَنْتَ|نَحْنُ/); // plural / 1st / 2nd person
    // Unit B event readings never use a possibly-equivalent noun phrase as a "wrong" reading
    const unitB = activePack.items.filter((i) => i.unit === 'B').flatMap((i) => i.options!.map((o) => o.text));
    for (const t of unitB) expect(t).not.toMatch(/orang yang/);
  });

  it('shows reserved/READY verb forms only in their own item and never the unresolved transfer-clash forms', () => {
    const tokens = (t: string) => t.split(/[\s.,:«»]+/);
    const surfaces = [
      ...activePack.items.map((i) => ({
        where: i.item_id,
        text: [i.arabic, ...i.help_lines.map((h) => h.word), ...i.options!.map((o) => o.text)].join(' '),
      })),
      ...activePack.lesson_screens.map((s) => ({
        where: s.screen_id,
        text: [...s.body, ...(s.examples ?? []).map((e) => e.arabic)].join(' '),
      })),
    ];
    const whereShown = (form: string) => surfaces.filter((s) => tokens(s.text).includes(form)).map((s) => s.where);
    // lessons §3.5: D7 رَجَعَ and D30 سَمِعَتْ are reserved for their checks; سَمِعَ is READY
    expect(whereShown('رَجَعَ')).toEqual(['B2-D7V1']);
    expect(whereShown('سَمِعَتْ')).toEqual(['B2-D30V1']);
    expect(whereShown('سَمِعَ')).toEqual(['B2-Y1']);
    expect(whereShown('رَجَعَتْ')).toEqual(['B2-V3', 'B2-W4']);
    // MT-B2/VT1 هَرَبَ and MT-B3/VT2 ضَحِكَتْ remain unresolved: not used at all
    expect(whereShown('هَرَبَ')).toEqual([]);
    expect(whereShown('ضَحِكَتْ')).toEqual([]);
    expect(activePack.items.filter((i) => i.reserve_forms).map((i) => i.item_id)).toEqual(['B2-D7V1', 'B2-D30V1']);
    // the word card for رَجَعَتْ comes after its bare-form exercise
    const order = (id: string) => activePack.items.find((i) => i.item_id === id)!.order!;
    expect(order('B2-W4')).toBeGreaterThan(order('B2-V3'));
  });

  it('keeps lesson screen IDs and text from v0.1, and maps every legacy item to a lineage', () => {
    for (const s of legacyPack.lesson_screens) {
      expect(activePack.lesson_screens.find((x) => x.screen_id === s.screen_id)).toEqual(s);
    }
    expect(lineageOf('DEMO-M01')).toBe('A:word-form:صَادِقٌ');
    expect(lineageOf('DEMO-P01')).toBe('A:sentence:هِيَ مُؤْمِنَةٌ');
    expect(lineageOf('A2-P01')).toBe('A:sentence:هِيَ مُؤْمِنَةٌ');
    expect(lineageOf('DEMO-F01')).toBe(lineageOf('A2-F01'));
    const nonFocus = activePack.items.filter((i) => i.pool !== 'FOCUS');
    expect(new Set(nonFocus.map((i) => i.lineage)).size).toBe(nonFocus.length);
  });

  it('gated content carries the pack synthetic flag (not inferred from IDs)', () => {
    expect(gateContent(activePack, 'developer-demo').synthetic).toBe(true);
    expect(gateContent(activePack, 'tester').empty).toBe(true);
    const p = clone(activePack);
    p.synthetic = false;
    expect(gateContent(p, 'developer-demo').synthetic).toBe(false);
  });
});

describe('four-choice validator rejects malformed items', () => {
  const firstItem = (p: ContentPack) => p.items[0];
  it.each<[string, (p: ContentPack) => void, RegExp]>([
    ['three options', (p) => firstItem(p).options!.pop(), /exactly 4 options/],
    ['duplicate option text', (p) => (firstItem(p).options![2].text = firstItem(p).options![1].text), /duplicate option text/],
    ['duplicate option id', (p) => (firstItem(p).options![2].id = firstItem(p).options![1].id), /duplicate option id/],
    ['two keys', (p) => (firstItem(p).options![1].correct = true), /exactly one correct/],
    ['missing misconception', (p) => delete firstItem(p).options![1].misconceptions, /misconception/],
    ['missing feedback', (p) => (firstItem(p).options![1].feedback_ids = []), /feedback/],
    ['legacy typed item', (p) => (firstItem(p).type = 'q-mean'), /must be mcq4/],
    ['unvowelled Arabic option', (p) => (p.items.find((i) => i.format === 'form-grid')!.options![0].text = 'هي نادمة'), /harakat/],
  ])('%s', (_name, mutate, msg) => {
    const p = clone(activePack);
    mutate(p);
    expect(validatePack(p).join('\n')).toMatch(msg);
  });
});
