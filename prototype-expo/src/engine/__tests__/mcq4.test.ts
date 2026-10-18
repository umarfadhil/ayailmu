import { loadRules } from '@/config/rules';
import { v02Pack as activePack } from '@/content/load';
import type { Item } from '@/content/schema';
import { scoreItem } from '@/engine/scoring';
import { isPermutation, optionOrder } from '@/engine/shuffle';

const rules = loadRules('developer-demo');
const byId = (id: string): Item => activePack.items.find((i) => i.item_id === id)!;

describe('optionOrder (Fisher–Yates with injectable RNG)', () => {
  it('rng always 0 → hand-computed order', () => {
    // i=3 j=0: [a,r,p,k] → i=2 j=0: [p,r,a,k] → i=1 j=0: [r,p,a,k]
    expect(optionOrder(['k', 'r', 'p', 'a'], () => 0)).toEqual(['r', 'p', 'a', 'k']);
  });
  it('rng near 1 → identity', () => {
    expect(optionOrder(['k', 'r', 'p', 'a'], () => 0.999)).toEqual(['k', 'r', 'p', 'a']);
  });
  it('never mutates its input and always returns a permutation', () => {
    const ids = ['k', 'd1', 'd2', 'd3'] as const;
    for (let n = 0; n < 50; n++) {
      const out = optionOrder(ids);
      expect(isPermutation(out, ids)).toBe(true);
    }
    expect(ids).toEqual(['k', 'd1', 'd2', 'd3']);
  });
  it('isPermutation rejects missing, extra and duplicate IDs', () => {
    expect(isPermutation(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'])).toBe(true);
    expect(isPermutation(['a', 'b', 'c'], ['a', 'b', 'c', 'd'])).toBe(false);
    expect(isPermutation(['a', 'b', 'c', 'c'], ['a', 'b', 'c', 'd'])).toBe(false);
    expect(isPermutation(['a', 'b', 'c', 'x'], ['a', 'b', 'c', 'd'])).toBe(false);
    expect(isPermutation(undefined, ['a'])).toBe(false);
  });
});

describe('four-choice scoring', () => {
  const p01 = byId('A2-P01'); // هِيَ مُؤْمِنَةٌ
  it('key → correct', () => {
    const s = scoreItem(p01, { kind: 'choice', option_id: 'k' }, rules);
    expect(s).toMatchObject({ outcome: 'correct', serious: null, error_tags: [], feedback_ids: ['FA-OK-OPT'] });
  });
  it.each([
    ['r', 'wrong-referent', ['FA-REF-HIYA']],
    ['p', 'possession', ['FA-POS-OPT']],
    ['a', 'invented-action', ['FA-ACT']],
  ])('option %s → serious %s with its own feedback', (opt, tag, fb) => {
    const s = scoreItem(p01, { kind: 'choice', option_id: opt }, rules);
    expect(s).toMatchObject({ outcome: 'wrong', serious: tag, error_tags: [tag], feedback_ids: fb });
  });
  it('compound distractor reports every misconception and both feedback messages', () => {
    const s = scoreItem(byId('A2-F01'), { kind: 'choice', option_id: 'c' }, rules);
    expect(s.error_tags).toEqual(['wrong-referent', 'wrong-form']);
    expect(s.serious).toBe('wrong-referent');
    expect(s.feedback_ids).toEqual(['FA-REF-FORM', 'FA-FORM-OPT']);
  });
  it('non-serious wrong form', () => {
    const s = scoreItem(byId('A2-F01'), { kind: 'choice', option_id: 'e' }, rules);
    expect(s).toMatchObject({ outcome: 'wrong', serious: null, error_tags: ['wrong-form'] });
  });
  it('«Saya belum tahu» is dont_know, not wrong, with no misconception', () => {
    const s = scoreItem(p01, { kind: 'dont_know' }, rules);
    expect(s).toMatchObject({ outcome: 'dont_know', serious: null, error_tags: [] });
  });
  it('a typed response or unknown option is refused for mcq4 (no typing path)', () => {
    expect(() => scoreItem(p01, { kind: 'typed', text: 'dia beriman', ref: 'perempuan' }, rules)).toThrow(/choice/);
    expect(() => scoreItem(p01, { kind: 'choice', option_id: 'zz' }, rules)).toThrow(/unknown option/);
  });
});
