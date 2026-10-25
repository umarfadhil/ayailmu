import { activePack, legacyPack, v02Pack } from '@/content/load';
import { PILOT_CONTENT, validatePilotContent } from '../content';

type Item = (typeof PILOT_CONTENT)['items'][number];

const { items, lessons } = PILOT_CONTENT;
const CONSTRUCTS: readonly Item['construct'][] = ['reference', 'agreement'];
const PHASES: readonly Item['phase'][] = ['practice', 'transfer', 'd7', 'd30'];
const MIN_FAMILIES = { practice: 4, transfer: 2, d7: 2, d30: 2 };

// Whole-stem checks ignore harakat (nonspacing marks), punctuation and spacing; single words may recur.
const norm = (text: string) => text.replace(/\p{Mn}/gu, '').replace(/\p{P}/gu, ' ').replace(/\s+/g, ' ').trim();

const strings = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(strings);
};

const nth = (phase: Item['phase'], index = 0): Item => {
  const item = items.filter((candidate) => candidate.phase === phase)[index];
  if (item === undefined) throw new Error(`pilot pack lacks ${phase} item ${index}`);
  return item;
};

const withItem = (id: string, patch: object): unknown => ({
  ...PILOT_CONTENT,
  items: items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
});

describe('Unit A pilot content (synthetic draft, not reviewer-approved)', () => {
  it('is valid, truthfully labelled and covers both constructs', () => {
    expect(validatePilotContent(PILOT_CONTENT)).toEqual([]);
    expect(PILOT_CONTENT).toMatchObject({ contentVersion: 'unit-a-pilot-draft-0.1', reviewStatus: 'draft' });
    expect(PILOT_CONTENT).toMatchObject({ policyVersion: 'unit-a-evidence-provisional-0.1' });
    expect(PILOT_CONTENT).toMatchObject({ synthetic: true, constructed: true });
    expect(items.length).toBeGreaterThanOrEqual(20);
    for (const construct of CONSTRUCTS) {
      const own = items.filter((item) => item.construct === construct);
      const families = (phase: string) => new Set(own.filter((i) => i.phase === phase).map((i) => i.family)).size;
      const thin = Object.entries(MIN_FAMILIES).filter(([phase, min]) => families(phase) < min);
      const taught = lessons.some((l) => l.construct === construct && l.body.length > 0 && l.examples.length > 0);
      expect({ construct, taught, thin }).toEqual({ construct, taught: true, thin: [] });
    }
    const orphans = items.filter((i) => lessons.find((l) => l.id === i.lessonId)?.construct !== i.construct);
    expect(orphans.map((item) => item.id)).toEqual([]);
  });

  it('gives every item a complete draft shape, unique ID and single-role family (structural only)', () => {
    const broken = items.filter((item) => {
      const texts = new Set(item.options.map((option) => option.text.trim()));
      return !(
        item.options.length === 4 && texts.size === 4 && !texts.has('') &&
        new Set(item.options.map((option) => option.id)).size === 4 &&
        item.options.filter((option) => option.correct).length === 1 &&
        item.options.every((option) => option.feedback.trim() !== '') &&
        item.arabic.trim() !== '' && item.prompt.trim() !== '' &&
        item.reviewStatus === 'draft' && item.constructed === true
      );
    });
    expect(broken.map((item) => item.id)).toEqual([]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    const familyRoles = new Set(items.map((item) => `${item.family}|${item.construct}|${item.phase}`));
    expect(familyRoles.size).toBe(new Set(items.map((item) => item.family)).size);
  });

  it('keeps whole assessment stems out of earlier pilot material and every shipped pack', () => {
    const assessment = items.filter((item) => item.phase !== 'practice');
    const stems = assessment.map((item) => norm(item.arabic));
    expect(new Set(stems).size).toBe(stems.length);
    const shipped = [activePack, v02Pack, legacyPack].flatMap(strings).map(norm);
    const leaks = assessment.filter((item) => {
      const earlier = items.filter((other) => PHASES.indexOf(other.phase) < PHASES.indexOf(item.phase));
      const seen = [...strings(lessons), ...strings(earlier)].map(norm).concat(shipped);
      return seen.some((text) => text.includes(norm(item.arabic)));
    });
    expect(leaks.map((item) => item.id)).toEqual([]);
  });

  it('rejects broken, leaking or falsely labelled variants without mutating the real pack', () => {
    const before = JSON.stringify(PILOT_CONTENT);
    const [practice, transfer, otherTransfer] = [nth('practice'), nth('transfer'), nth('transfer', 1)];
    const variants: Record<string, unknown> = {
      threeOptions: withItem(practice.id, { options: practice.options.slice(0, 3) }),
      twoKeys: withItem(practice.id, { options: practice.options.map((o, k) => ({ ...o, correct: k < 2 })) }),
      duplicateStem: withItem(otherTransfer.id, { arabic: transfer.arabic }),
      duplicateId: withItem(otherTransfer.id, { id: transfer.id }),
      practiceStemInTransfer: withItem(transfer.id, { arabic: practice.arabic }),
      approvedItem: withItem(practice.id, { reviewStatus: 'approved' }),
      approvedPack: { ...PILOT_CONTENT, reviewStatus: 'approved' },
      nonSynthetic: { ...PILOT_CONTENT, synthetic: false },
      notConstructed: { ...PILOT_CONTENT, constructed: false },
      notAPack: null,
    };
    const accepted = Object.entries(variants).filter(([, value]) => validatePilotContent(value).length === 0);
    expect(accepted.map(([name]) => name)).toEqual([]);
    expect(JSON.stringify(PILOT_CONTENT)).toBe(before);
  });
});
