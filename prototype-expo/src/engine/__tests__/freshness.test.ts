import { loadRules } from '@/config/rules';
import { demoPack } from '@/content/load';
import type { Item } from '@/content/schema';
import {
  findFormClashes,
  isEligibleFresh,
  pickFocusItem,
  pickFreshItem,
  type AttemptLog,
} from '@/engine/freshness';

const rules = loadRules('developer-demo');
const items = demoPack.items;
const byId = (id: string) => items.find((i) => i.item_id === id)!;

function attempt(item_id: string, local_date: string, extra: Partial<AttemptLog> = {}): AttemptLog {
  const it = byId(item_id);
  return {
    item_id,
    local_date,
    pool: it?.pool ?? 'PRACT',
    skills: it?.skills ?? [],
    unit: it?.unit ?? 'A',
    first_attempt: true,
    hint_used: false,
    ...extra,
  };
}

describe('fresh item selection', () => {
  it('serves PRACT items in order and never reuses a seen item as fresh', () => {
    const ctx = { today: '2026-10-15', history: [] as AttemptLog[], rules };
    expect(pickFreshItem(items, ctx, { pools: ['PRACT'] })?.item_id).toBe('DEMO-M01');

    const history = [attempt('DEMO-M01', '2026-10-15')];
    const next = pickFreshItem(items, { ...ctx, history }, { pools: ['PRACT'] });
    expect(next?.item_id).toBe('DEMO-F01');
    expect(isEligibleFresh(byId('DEMO-M01'), { ...ctx, history })).toBe(false);
  });

  it('never serves READY items before enough practice on the skill', () => {
    const ctx = { today: '2026-10-15', history: [] as AttemptLog[], rules };
    expect(isEligibleFresh(byId('DEMO-Y01'), ctx)).toBe(false);
    const history = ['DEMO-P01', 'DEMO-P02', 'DEMO-P03'].map((id) => attempt(id, '2026-10-15'));
    expect(isEligibleFresh(byId('DEMO-Y01'), { ...ctx, history })).toBe(true);
  });

  it('never serves D7/D30 items before the check is due', () => {
    const history = [attempt('DEMO-P01', '2026-10-15')];
    expect(isEligibleFresh(byId('DEMO-D701'), { today: '2026-10-15', history, rules })).toBe(false);
    expect(isEligibleFresh(byId('DEMO-D701'), { today: '2026-10-21', history, rules })).toBe(false);
    expect(isEligibleFresh(byId('DEMO-D701'), { today: '2026-10-22', history, rules })).toBe(true);
    expect(isEligibleFresh(byId('DEMO-D3001'), { today: '2026-10-22', history, rules })).toBe(false);
    expect(isEligibleFresh(byId('DEMO-D3001'), { today: '2026-11-14', history, rules })).toBe(true);
    // No practice at all: no check is ever due
    expect(isEligibleFresh(byId('DEMO-D701'), { today: '2027-01-01', history: [], rules })).toBe(false);
  });

  it('a REMED item after a mistake is unseen and from the same skill', () => {
    const history = [attempt('DEMO-P01', '2026-10-15'), attempt('DEMO-R01', '2026-10-15')];
    const remed = pickFreshItem(items, { today: '2026-10-15', history, rules }, { pools: ['REMED'], skill: 'NOM-01' });
    expect(remed?.item_id).toBe('DEMO-R02');
  });

  it('returns null when a skill is out of fresh questions', () => {
    const history = ['DEMO-R01', 'DEMO-R02'].map((id) => attempt(id, '2026-10-15'));
    expect(
      pickFreshItem(items, { today: '2026-10-15', history, rules }, { pools: ['REMED'], skill: 'NOM-01' })
    ).toBeNull();
  });

  it('can exclude items already queued in this session', () => {
    const ctx = { today: '2026-10-15', history: [] as AttemptLog[], rules };
    const r = pickFreshItem(items, ctx, { pools: ['REMED'], skill: 'NOM-01', exclude: new Set(['DEMO-R01']) });
    expect(r?.item_id).toBe('DEMO-R02');
  });

  it('later_day items need an earlier-day attempt on the skill', () => {
    const later: Item = { ...byId('DEMO-P02'), item_id: 'T-LATER', pool: 'PRACT', later_day: true };
    const sameDay = [attempt('DEMO-P01', '2026-10-15')];
    expect(isEligibleFresh(later, { today: '2026-10-15', history: sameDay, rules })).toBe(false);
    expect(isEligibleFresh(later, { today: '2026-10-16', history: sameDay, rules })).toBe(true);
  });

  it('FOCUS questions are never served as fresh evidence', () => {
    expect(isEligibleFresh(byId('DEMO-FQ-POS'), { today: '2026-10-15', history: [], rules })).toBe(false);
    expect(pickFocusItem(items, 'wrong-referent', 'perempuan')?.item_id).toBe('DEMO-FQ-REF-F');
    expect(pickFocusItem(items, 'possession')?.item_id).toBe('DEMO-FQ-POS');
  });
});

describe('reserved forms (lessons §3.5)', () => {
  const base = byId('DEMO-P02');
  const reservedCheck: Item = {
    ...base,
    item_id: 'T-D7',
    pool: 'D7',
    arabic: 'ضَحِكَ',
    forms: ['ضَحِكَ'],
    reserve_forms: true,
  };
  const leaky: Item = { ...base, item_id: 'T-LEAK', pool: 'PRACT', arabic: 'ضَحِكَ', forms: ['ضَحِكَ'], order: 0 };
  const pool = [reservedCheck, leaky, ...items];

  it('never shows a reserved check form before its check', () => {
    const ctx = { today: '2026-10-15', history: [] as AttemptLog[], rules };
    expect(isEligibleFresh(leaky, ctx, pool)).toBe(false);
    expect(pickFreshItem(pool, ctx, { pools: ['PRACT'] })?.item_id).not.toBe('T-LEAK');
  });

  it('releases the form once the check item has been seen', () => {
    const history = [attempt('DEMO-P01', '2026-10-15'), { ...attempt('DEMO-P01', '2026-10-22'), item_id: 'T-D7', pool: 'D7' as const }];
    expect(isEligibleFresh(leaky, { today: '2026-10-22', history, rules }, pool)).toBe(true);
  });
});

describe('content clash detector (spec §9)', () => {
  it('reports a TRANS item that reuses a form from another item (like MT-B3/VT2)', () => {
    const base = byId('DEMO-P02');
    const mt: Item = { ...base, item_id: 'T-MT', pool: 'MT', forms: ['ضَحِكَتْ', 'شَكَرَ'] };
    const vt: Item = { ...base, item_id: 'T-VT', pool: 'TRANS', forms: ['ضَحِكَتْ'] };
    expect(findFormClashes([mt, vt])).toEqual([{ trans_item: 'T-VT', other_item: 'T-MT', form: 'ضَحِكَتْ' }]);
  });

  it('finds no clashes in the demo fixture', () => {
    expect(findFormClashes(items)).toEqual([]);
  });
});
