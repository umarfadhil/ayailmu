import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { advance, currentStep, startSession, submitAnswer, type SessionState } from '@/engine/session';
import type { Outcome } from '@/engine/scoring';
import type { AnswerRecord, StepRole } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(activePack, 'developer-demo');
const zero = () => 0;
const A_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3'];
const B_SCREENS = ['DEMO-BS1', 'DEMO-BS2', 'DEMO-BS4', 'DEMO-BS3'];
const A_CORE = ['A3-M01', 'A3-F01', 'A3-P01', 'A3-M02', 'A3-F02', 'A3-P02', 'A3-P03'];
const B_CORE = ['B3-W1', 'B3-W2', 'B3-W3', 'B3-W4', 'B3-W5', 'B3-VN1', 'B3-VN2', 'B3-V1', 'B3-V2', 'B3-V3'];
let n = 0;

function ev(item_id: string, local_date: string, role: StepRole = 'practice', outcome: Outcome = 'correct'): AnswerRecord {
  n += 1;
  const item = content.items.find((i) => i.item_id === item_id)!;
  return {
    answer_id: `p${String(n).padStart(4, '0')}`,
    item_id,
    local_date,
    timestamp: `${local_date}T02:00:${String(n % 60).padStart(2, '0')}.000Z`,
    pool: role === 'review' ? 'REVIEW' : item.pool,
    unit: item.unit,
    skills: item.skills,
    outcome,
    role,
    lineage: item.lineage,
    first_attempt: role !== 'review',
    hint_used: false,
  } as AnswerRecord;
}
const at = (date: string) => new Date(`${date}T09:00:00+07:00`).getTime();
const plan = (history: AnswerRecord[], date: string, budget: number, seen: string[]) =>
  startSession({ content, rules, history, learnerId: 'l', now: at(date), budgetMinutes: budget, screensSeen: seen, appVersion: '0.2.0', rng: zero });
const roles = (s: SessionState) => s.queue.map((q) => (q.kind === 'item' ? q.role : 'screen'));
const ids = (s: SessionState, role?: StepRole) =>
  s.queue.filter((q) => q.kind === 'item' && (!role || q.role === role)).map((q) => (q as { item_id: string }).item_id);

const aCoreJan1 = () => A_CORE.map((id) => ev(id, '2027-01-01'));

describe('session order: due timed checks → due reviews → current lesson', () => {
  it('on Jan 8 (7 days after Unit A practice): Unit A D7 checks, then the 4 overdue reviews not exposed by today’s checks, then basic Unit B', () => {
    const s = plan(aCoreJan1(), '2027-01-08', 20, A_SCREENS);
    expect(ids(s, 'check')).toEqual(['A3-D7S1', 'A3-D7S2', 'A3-D7S3', 'A3-D7F1', 'A3-D7F2', 'A3-D7W1', 'A3-D7W3', 'A3-D7W5']);
    // ENG-03: A3-M01 (word:W-A3), A3-M02 (word:W-A5) and A3-P01 (lemma مُؤْمِنٌ → word:W-A1) are checked today
    // all due Jan 2 → tie broken by review key: هُوَ صَالِحٌ, هُوَ فَرِحٌ, هِيَ شَاكِرَةٌ, هِيَ نَادِمَةٌ
    expect(ids(s, 'review')).toEqual(['A3-P02', 'A3-F02', 'A3-P03', 'A3-F01']);
    // Unit B starts after Unit A core screens + practice (practice progression, not mastery)
    expect(roles(s)).toEqual([...Array(8).fill('check'), ...Array(4).fill('review'), 'screen', 'screen', 'screen', 'screen', ...Array(8).fill('practice')]);
    expect(s.queue.filter((q) => q.kind === 'screen').map((q) => (q as { screen_id: string }).screen_id)).toEqual(B_SCREENS);
    expect(ids(s, 'practice')).toEqual(['A3-Y01', 'B3-W1', 'B3-W2', 'B3-W3', 'B3-W4', 'B3-W5', 'B3-VN1', 'B3-VN2']); // Unit A READY first
  });

  it('reviews take at most floor(budget × 0.5) planned slots, oldest due first', () => {
    const s = plan(aCoreJan1(), '2027-01-03', 10, A_SCREENS); // D7 not due yet
    expect(ids(s, 'check')).toEqual([]);
    expect(ids(s, 'review')).toHaveLength(5);
    expect(ids(s, 'practice')).toHaveLength(5);
  });

  it('nothing is reviewed on the day of first exposure', () => {
    expect(ids(plan(aCoreJan1(), '2027-01-01', 15, A_SCREENS), 'review')).toEqual([]);
  });
});

describe('reviews and checks never move the practice anchor or count as fresh', () => {
  it('daily reviews do not postpone the D7 check', () => {
    const history = [...aCoreJan1(), ev('A3-M01', '2027-01-03', 'review'), ev('A3-P01', '2027-01-06', 'review')];
    expect(ids(plan(history, '2027-01-08', 20, A_SCREENS), 'check')).toContain('A3-D7S1');
  });

  it('answering D7 checks does not postpone the D30 check (still due Jan 31 = Jan 1 + 30)', () => {
    const history = [...aCoreJan1(), ...['A3-D7S1', 'A3-D7S2'].map((id) => ev(id, '2027-01-08', 'check'))];
    expect(ids(plan(history, '2027-01-30', 20, A_SCREENS), 'check').some((id) => id.startsWith('A3-D30'))).toBe(false);
    expect(ids(plan(history, '2027-01-31', 20, A_SCREENS), 'check').filter((id) => id.startsWith('A3-D30'))).toHaveLength(7);
  });

  it('a review answer is logged as REVIEW, never a first attempt or fresh evidence', () => {
    const s = plan(aCoreJan1(), '2027-01-03', 10, A_SCREENS);
    const r = submitAnswer(s, { kind: 'choice', option_id: 'k' }, { content, rules, history: aCoreJan1(), now: at('2027-01-03'), timeOnItemMs: 1, rng: zero });
    expect(r.record).toMatchObject({ role: 'review', pool: 'REVIEW', first_attempt: false, fresh_evidence: false });
  });

  it('a serious mistake in a review still gets the focused question and a fresh REMED item', () => {
    const s0 = plan(aCoreJan1(), '2027-01-03', 10, A_SCREENS);
    const idx = s0.queue.findIndex((q) => q.kind === 'item' && q.item_id === 'A3-P01');
    const s = { ...s0, index: idx };
    const r = submitAnswer(s, { kind: 'choice', option_id: 'r' }, { content, rules, history: aCoreJan1(), now: at('2027-01-03'), timeOnItemMs: 1, rng: zero });
    const next = advance(r.state, at('2027-01-03'));
    expect(currentStep(next)).toMatchObject({ item_id: 'A3-FQ-REF-F', role: 'focus' });
    expect(next.queue[idx + 2]).toMatchObject({ item_id: 'A3-R01', role: 'remed' });
  });
});

describe('review time is checked at item boundaries', () => {
  it('once reviews used their share of the session time, remaining review steps are skipped (the current item finishes)', () => {
    const s = plan(aCoreJan1(), '2027-01-03', 10, A_SCREENS); // 5 reviews then lesson
    expect(roles(s).slice(0, 5)).toEqual(Array(5).fill('review'));
    const half = 10 * 60_000 * 0.5;
    // ENG-04: the step's active time is measured by the clock (shown → Lanjut), not only the answer tap
    const r = submitAnswer(s, { kind: 'dont_know' }, { content, rules, history: aCoreJan1(), now: at('2027-01-03') + 1000, timeOnItemMs: 1000, rng: zero });
    const next = advance(r.state, at('2027-01-03') + half);
    // the 4 remaining reviews are skipped; the lesson continues (Unit B starts with its first screen)
    expect(currentStep(next)).toMatchObject({ kind: 'screen', screen_id: 'DEMO-BS1' });
    expect(next.index).toBe(5);
  });
});

describe('REV-3: unfinished serious-error follow-ups survive the session boundary', () => {
  const seriousP01 = (date: string) => {
    const r = ev('A3-P01', date, 'practice', 'wrong');
    return { ...r, serious_tag: 'wrong-referent', error_tags: ['wrong-referent'] } as AnswerRecord;
  };
  const focusOk = (date: string) => ({ ...ev('A3-FQ-REF-F', date, 'focus'), skills: ['NOM-01'], pool: 'FOCUS', fresh_evidence: false }) as AnswerRecord;
  const remedOk = (date: string) => ({ ...ev('A3-R01', date, 'remed'), fresh_evidence: true }) as AnswerRecord;
  const lessonIds = (s: SessionState) => s.queue.filter((q) => q.kind === 'item' && (q.role === 'focus' || q.role === 'remed')).map((q) => [(q as { item_id: string }).item_id, (q as { role: string }).role]);
  const firstThree = ['A3-M01', 'A3-F01'].map((id) => ev(id, '2027-01-01'));

  it('budget ran out right after the serious answer: the session closes at the boundary, without the follow-ups', () => {
    const s0 = plan([], '2027-01-01', 10, A_SCREENS);
    const idx = s0.queue.findIndex((q) => q.kind === 'item' && q.item_id === 'A3-P01');
    const late = at('2027-01-01') + 11 * 60_000;
    const r = submitAnswer({ ...s0, index: idx }, { kind: 'choice', option_id: 'r' }, { content, rules, history: [], now: late, timeOnItemMs: 1, rng: zero });
    expect(advance(r.state, late).phase).toBe('done');
  });

  it('before the focus question: the next session restores the focus question and a fresh REMED first in the lesson', () => {
    const s = plan([...firstThree, seriousP01('2027-01-01')], '2027-01-01', 10, A_SCREENS);
    expect(lessonIds(s)).toEqual([
      ['A3-FQ-REF-F', 'focus'],
      ['A3-R01', 'remed'],
    ]);
    const firstLesson = s.queue.findIndex((q) => q.kind === 'item' && q.role !== 'review' && q.role !== 'check');
    expect(s.queue[firstLesson]).toMatchObject({ item_id: 'A3-FQ-REF-F', role: 'focus' });
    expect(s.queue.find((q) => q.kind === 'item' && q.role === 'focus')).toMatchObject({ target_skill: 'NOM-01' }); // ENG-02: per step
  });

  it('between focus and REMED: only the fresh REMED is restored', () => {
    const s = plan([...firstThree, seriousP01('2027-01-01'), focusOk('2027-01-01')], '2027-01-01', 10, A_SCREENS);
    expect(lessonIds(s)).toEqual([['A3-R01', 'remed']]);
  });

  it('a later correct review of the same sentence does not resolve the obligation', () => {
    const history = [...firstThree, seriousP01('2027-01-01'), ev('A3-P01', '2027-01-02', 'review', 'correct')];
    expect(lessonIds(plan(history, '2027-01-03', 10, A_SCREENS))).toEqual([
      ['A3-FQ-REF-F', 'focus'],
      ['A3-R01', 'remed'],
    ]);
  });

  it('a resolved obligation (correct focus + correct fresh REMED) is not restored', () => {
    const history = [...firstThree, seriousP01('2027-01-01'), focusOk('2027-01-01'), remedOk('2027-01-01')];
    expect(lessonIds(plan(history, '2027-01-02', 10, A_SCREENS))).toEqual([]);
  });

  it('Unit B: the Unit B focus and a fresh Unit B REMED are restored (no Unit A padding)', () => {
    const bSerious = { ...ev('B3-V1', '2027-01-10', 'practice', 'wrong'), serious_tag: 'wrong-referent', error_tags: ['wrong-referent'] } as AnswerRecord;
    const s = plan([...aCoreJan1(), bSerious], '2027-01-10', 20, [...A_SCREENS, ...B_SCREENS]);
    expect(lessonIds(s)).toEqual([
      ['B3-FQ-REF-F', 'focus'], // خَرَجَتْ is perempuan
      ['B3-R1', 'remed'],
    ]);
    expect(s.flags).not.toContain('out-of-fresh:VRB-01');
  });
});

describe('readiness in an already-open unit (regression: A3-Y01 stranded once Unit B opened)', () => {
  it('Jan 2 after Unit A core on Jan 1: A3-Y01 (READY, 3 NOM-01 practice attempts) is planned while basic Unit B continues', () => {
    // Jan 2: 7 Unit A reviews due (cap floor(15 × 0.5) = 7); lesson slots 15 − 7 = 8
    const s = plan(aCoreJan1(), '2027-01-02', 15, A_SCREENS);
    expect(ids(s, 'review')).toHaveLength(7);
    const practice = ids(s, 'practice');
    expect(practice).toContain('A3-Y01');
    expect(practice[0]).toBe('A3-Y01'); // older readiness work first, then Unit B practice
    expect(practice.slice(1)).toEqual(['B3-W1', 'B3-W2', 'B3-W3', 'B3-W4', 'B3-W5', 'B3-VN1', 'B3-VN2']);
    expect(s.queue.filter((q) => q.kind === 'screen').map((q) => (q as { screen_id: string }).screen_id)).toEqual(B_SCREENS);
  });

  it('A3-Y01 is not planned before its 3 NOM-01 practice attempts exist', () => {
    const partial = ['A3-M01', 'A3-F01', 'A3-P01', 'A3-M02', 'A3-F02', 'A3-P02'].map((id) => ev(id, '2027-01-01'));
    expect(ids(plan(partial, '2027-01-02', 15, A_SCREENS))).not.toContain('A3-Y01');
  });
});

describe('Unit B timing and reserved forms', () => {
  const bCoreJan10 = () => B_CORE.map((id) => ev(id, '2027-01-10'));
  const seen = [...A_SCREENS, ...B_SCREENS];

  it('v0.3 has no Unit B READY or D7 holdout (taught lemmas retired those reservations); none is ever planned', () => {
    const history = [...aCoreJan1(), ...bCoreJan10()];
    for (const day of ['2027-01-11', '2027-01-17']) {
      expect(ids(plan(history, day, 20, seen)).filter((id) => /^B3-(Y|D7)/.test(id))).toEqual([]);
    }
  });

  it('the D30 holdout سَمِعَتْ is never planned before its check is due (Jan 10 + 30 = Feb 9)', () => {
    const history = [...aCoreJan1(), ...bCoreJan10()];
    expect(ids(plan(history, '2027-02-08', 20, seen))).not.toContain('B3-D30V1');
    expect(ids(plan(history, '2027-02-09', 20, seen), 'check')).toContain('B3-D30V1');
  });
});
