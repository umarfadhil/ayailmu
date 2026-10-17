import { demoPack } from '@/content/load';
import { gateContent, validatePack } from '@/content/gating';
import type { ContentPack } from '@/content/schema';

const clone = (p: ContentPack): ContentPack => JSON.parse(JSON.stringify(p));

describe('approved-for-trial gating', () => {
  it('developer-demo mode shows the draft synthetic fixture, labelled as unreviewed', () => {
    const g = gateContent(demoPack, 'developer-demo');
    expect(g.items.length).toBe(demoPack.items.length);
    expect(g.screens.length).toBe(demoPack.lesson_screens.length);
    expect(g.unreviewed).toBe(true);
    expect(g.empty).toBe(false);
  });

  it('tester mode hides all draft content and reports an explicit empty state', () => {
    const g = gateContent(demoPack, 'tester');
    expect(g.items).toEqual([]);
    expect(g.screens).toEqual([]);
    expect(g.empty).toBe(true);
  });

  it('tester mode never shows synthetic content, even if an item claims approval', () => {
    const p = clone(demoPack);
    p.items.forEach((i) => (i.review_status = 'approved-for-trial'));
    p.lesson_screens.forEach((s) => (s.review_status = 'approved-for-trial'));
    expect(gateContent(p, 'tester').empty).toBe(true);
  });

  it('tester mode shows only approved-for-trial items of a non-synthetic pack', () => {
    const p = clone(demoPack);
    p.synthetic = false;
    p.items[0].review_status = 'approved-for-trial';
    p.items[1].review_status = 'reviewed-arabic';
    p.lesson_screens[0].review_status = 'approved-for-trial';
    const g = gateContent(p, 'tester');
    expect(g.items.map((i) => i.item_id)).toEqual([p.items[0].item_id]);
    expect(g.screens.map((s) => s.screen_id)).toEqual([p.lesson_screens[0].screen_id]);
    expect(g.unreviewed).toBe(false);
  });

  it('gating never changes review_status', () => {
    const before = JSON.stringify(demoPack);
    gateContent(demoPack, 'tester');
    gateContent(demoPack, 'developer-demo');
    expect(JSON.stringify(demoPack)).toBe(before);
  });
});

describe('content validation', () => {
  it('the demo fixture is valid', () => {
    expect(validatePack(demoPack)).toEqual([]);
  });

  it('every demo item is draft and synthetic (nothing auto-approved)', () => {
    expect(demoPack.synthetic).toBe(true);
    expect(demoPack.items.every((i) => i.review_status === 'draft')).toBe(true);
    expect(demoPack.items.every((i) => i.item_id.startsWith('DEMO-'))).toBe(true);
  });

  it('rejects Arabic stripped of vowel marks', () => {
    const p = clone(demoPack);
    p.items[0].arabic = 'صادق';
    expect(validatePack(p).join('\n')).toMatch(/harakat/);
  });

  it('rejects duplicate IDs and choice items without exactly one correct option', () => {
    const p = clone(demoPack);
    p.items[1].item_id = p.items[0].item_id;
    p.items[2] = { ...p.items[4], item_id: 'DEMO-X', options: p.items[4].options!.map((o) => ({ ...o, correct: false })) };
    const errors = validatePack(p).join('\n');
    expect(errors).toMatch(/duplicate/);
    expect(errors).toMatch(/exactly one correct/);
  });

  it('rejects unknown prompt and feedback IDs', () => {
    const p = clone(demoPack);
    p.items[0].prompt_id = 'NOPE';
    p.items[0].feedback_ids.correct = 'NOPE-FB';
    const errors = validatePack(p).join('\n');
    expect(errors).toMatch(/prompt_id NOPE/);
    expect(errors).toMatch(/NOPE-FB/);
  });
});
