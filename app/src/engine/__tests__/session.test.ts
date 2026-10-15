import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import {
  advance,
  currentStep,
  startSession,
  submitAnswer,
  summarize,
  unresolvedSerious,
  type SessionState,
} from '@/engine/session';
import type { Response } from '@/engine/scoring';
import type { AnswerRecord } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(activePack, 'developer-demo');
const T0 = new Date('2026-10-15T09:00:00+07:00').getTime();
const zero = () => 0;
const ENV = { content, rules, history: [] as AnswerRecord[], now: T0, timeOnItemMs: 1, rng: zero };

function begin(history: AnswerRecord[] = [], screensSeen: string[] = [], minutes = 15) {
  return startSession({ content, rules, history, learnerId: 'lrn-1', now: T0, budgetMinutes: minutes, screensSeen, appVersion: '0.2.0', rng: zero });
}
function skipScreens(s: SessionState): SessionState {
  let st = s;
  while (currentStep(st)?.kind === 'screen') st = advance(st, T0);
  return st;
}
const choose = (option_id: string): Response => ({ kind: 'choice', option_id });
const itemIds = (s: SessionState) => s.queue.filter((q) => q.kind === 'item').map((q) => (q as { item_id: string }).item_id);

describe('session flow (four-choice)', () => {
  it('starts with the Unit A lesson screens, then Unit A practice items in order', () => {
    const s = begin();
    expect(s.queue.slice(0, 3).map((q) => q.kind === 'screen' && q.screen_id)).toEqual(['DEMO-S1', 'DEMO-S2', 'DEMO-S3']);
    expect(itemIds(s)).toEqual(['A2-M01', 'A2-F01', 'A2-P01', 'A2-M02', 'A2-F02', 'A2-P02', 'A2-P03']);
    // READY needs prior practice; REMED/D7/D30/FOCUS are never planned as fresh lesson work; Unit B not open yet
    expect(s.queue.some((q) => q.kind === 'screen' && q.screen_id.startsWith('DEMO-BS'))).toBe(false);
  });

  it('skips lesson screens already seen', () => {
    expect(currentStep(begin([], ['DEMO-S1', 'DEMO-S2', 'DEMO-S3']))?.kind).toBe('item');
  });

  it('wrong form (non-serious): FA-FORM feedback, then a fresh REMED form item', () => {
    let s = skipScreens(begin());
    s = advance(submitAnswer(s, choose('k'), ENV).state, T0); // A2-M01 correct
    const r = submitAnswer(s, choose('e'), ENV); // A2-F01: هِيَ نَادِمٌ
    expect(r.state.feedback?.messages).toEqual([
      'Untuk perempuan, pakai bentuk dengan ـَةٌ. Untuk laki-laki, tanpa ـَةٌ. Jawaban yang tepat: هِيَ نَادِمَةٌ',
    ]);
    s = advance(r.state, T0);
    expect(currentStep(s)).toMatchObject({ kind: 'item', item_id: 'A2-F03', role: 'remed' });
  });

  it('serious he/she mistake: focused question (not evidence), then a fresh REMED; resolved only when both are correct', () => {
    let s = skipScreens(begin());
    const history: AnswerRecord[] = [];
    const answer = (resp: Response) => {
      const r = submitAnswer(s, resp, ENV);
      history.push(r.record!);
      s = advance(r.state, T0);
      return r;
    };
    answer(choose('k'));
    answer(choose('k'));
    const wrong = answer(choose('r')); // A2-P01: Dia (laki-laki) orang yang beriman
    expect(wrong.record!.serious_tag).toBe('wrong-referent');
    expect(wrong.state.feedback?.messages.join(' ')).toContain('هِيَ menunjuk perempuan');
    expect(unresolvedSerious(history)).toEqual([{ skill: 'NOM-01', tag: 'wrong-referent' }]);

    expect(currentStep(s)).toMatchObject({ kind: 'item', item_id: 'A2-FQ-REF-F', role: 'focus' });
    const focus = answer(choose('k'));
    expect(focus.record).toMatchObject({ fresh_evidence: false, pool: 'FOCUS', first_attempt: true });
    expect(unresolvedSerious(history)).toHaveLength(1);

    expect(currentStep(s)).toMatchObject({ kind: 'item', item_id: 'A2-R01', role: 'remed' });
    const remed = answer(choose('k'));
    expect(remed.record).toMatchObject({ outcome: 'correct', fresh_evidence: true });
    expect(unresolvedSerious(history)).toEqual([]);
  });

  it('flags a skill that runs out of fresh REMED items and lets the learner continue', () => {
    const seen = ['A2-R01', 'A2-R02'].map(
      (id, n) =>
        ({ item_id: id, lineage: content.lineage[id], pool: 'REMED', unit: 'A', skills: ['NOM-01'], local_date: '2026-10-15', timestamp: '2026-10-15T01:00:00.000Z', first_attempt: true, hint_used: false, answer_id: `h${n}`, role: 'remed' }) as unknown as AnswerRecord
    );
    let s = skipScreens(begin(seen));
    const env = { ...ENV, history: seen };
    s = advance(submitAnswer(s, choose('k'), env).state, T0);
    s = advance(submitAnswer(s, choose('k'), env).state, T0);
    const r = submitAnswer(s, choose('p'), env); // possession
    expect(r.state.flags).toContain('out-of-fresh:NOM-01');
    s = advance(r.state, T0);
    expect(currentStep(s)).toMatchObject({ item_id: 'A2-FQ-POS', role: 'focus' });
    s = advance(submitAnswer(s, choose('k'), env).state, T0);
    expect(currentStep(s)).toMatchObject({ item_id: 'A2-M02', role: 'practice' });
  });

  it('stops at the time budget, at the end of the current item', () => {
    let s = skipScreens(begin([], [], 10));
    const late = T0 + 11 * 60_000;
    s = submitAnswer(s, choose('k'), { ...ENV, now: late }).state;
    expect(advance(s, late).phase).toBe('done');
  });

  it('state is plain JSON; the saved option order survives a round trip', () => {
    let s = skipScreens(begin());
    s = submitAnswer(s, choose('k'), ENV).state;
    const restored = JSON.parse(JSON.stringify(s)) as SessionState;
    expect(restored).toEqual(s);
    expect(currentStep(advance(restored, T0))).toEqual(currentStep(advance(s, T0)));
  });

  it('a second session never repeats items as fresh', () => {
    let s = skipScreens(begin());
    const history: AnswerRecord[] = [];
    while (s.phase !== 'done') {
      const step = currentStep(s);
      if (!step || step.kind !== 'item') break;
      const r = submitAnswer(s, { kind: 'dont_know' }, ENV);
      history.push(r.record!);
      s = advance(r.state, T0);
    }
    const next = begin(history, ['DEMO-S1', 'DEMO-S2', 'DEMO-S3']);
    const seen = new Set(history.map((h) => h.item_id));
    expect(itemIds(next).filter((id) => seen.has(id))).toEqual([]);
  });

  it('summary reports counts only, with no mastery claim', () => {
    let s = skipScreens(begin());
    s = advance(submitAnswer(s, choose('k'), ENV).state, T0);
    s = advance(submitAnswer(s, choose('e'), ENV).state, T0); // wrong form → REMED A2-F03
    s = advance(submitAnswer(s, choose('k'), ENV).state, T0); // A2-F03 correct
    s = advance(submitAnswer(s, { kind: 'dont_know' }, ENV).state, T0); // A2-P01
    const sum = summarize(s);
    expect(sum).toMatchObject({ answered: 4, correct: 2, wrong: 1, pending: 0, dont_know: 1, follow_ups: 1, reviews: 0, checks: 0 });
    expect(JSON.stringify(sum).toLowerCase()).not.toMatch(/learned|dipelajari|menguasai|%/);
  });
});
