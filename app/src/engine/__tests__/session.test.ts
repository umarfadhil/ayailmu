import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { demoPack } from '@/content/load';
import {
  advance,
  currentStep,
  startSession,
  submitAnswer,
  summarize,
  unresolvedSerious,
  type SessionState,
} from '@/engine/session';
import type { AnswerRecord } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(demoPack, 'developer-demo');
const ENV = { content, rules, history: [] as AnswerRecord[] };
const T0 = new Date('2026-10-15T09:00:00+07:00').getTime();

function begin(history: AnswerRecord[] = [], screensSeen: string[] = [], minutes = 15) {
  return startSession({
    content,
    rules,
    history,
    learnerId: 'lrn-1',
    now: T0,
    budgetMinutes: minutes,
    screensSeen,
    appVersion: '0.1.0',
  });
}

/** Skip lesson screens. */
function skipScreens(s: SessionState): SessionState {
  let st = s;
  while (currentStep(st)?.kind === 'screen') st = advance(st, T0);
  return st;
}

describe('session flow', () => {
  it('starts with the guided lesson screens, then practice items in order', () => {
    const s = begin();
    expect(s.queue.slice(0, 3).map((q) => q.kind === 'screen' && q.screen_id)).toEqual(['DEMO-S1', 'DEMO-S2', 'DEMO-S3']);
    const items = s.queue.filter((q) => q.kind === 'item').map((q) => q.kind === 'item' && q.item_id);
    expect(items).toEqual(['DEMO-M01', 'DEMO-F01', 'DEMO-P01', 'DEMO-M02', 'DEMO-F02', 'DEMO-P02', 'DEMO-P03']);
    // Reserved and check pools are never queued in a first session
    expect(items.some((id) => /Y01|D7|D30|R0|F03/.test(String(id)))).toBe(false);
  });

  it('skips lesson screens already seen', () => {
    const s = begin([], ['DEMO-S1', 'DEMO-S2', 'DEMO-S3']);
    expect(currentStep(s)?.kind).toBe('item');
  });

  it('records a correct answer with spec §10 fields and shows specific feedback', () => {
    let s = skipScreens(begin());
    const r = submitAnswer(s, { kind: 'typed', text: 'orang yang jujur' }, { ...ENV, now: T0 + 5000, timeOnItemMs: 5000 });
    s = r.state;
    expect(r.record).toMatchObject({
      item_id: 'DEMO-M01',
      learner_id: 'lrn-1',
      content_version: 'demo-synthetic-0.1',
      rules_version: rules.rules_version,
      outcome: 'correct',
      first_attempt: true,
      fresh_evidence: true,
      hint_used: false,
      time_on_item_ms: 5000,
      review_status: 'draft',
      synthetic: true,
      raw_response: JSON.stringify({ kind: 'typed', text: 'orang yang jujur' }),
    });
    expect(s.phase).toBe('feedback');
    expect(s.feedback?.messages[0]).toContain('jujur');
  });

  it('a second submit on the same item (double tap) yields no second answer event', () => {
    const s = skipScreens(begin());
    const first = submitAnswer(s, { kind: 'typed', text: 'jujur' }, { ...ENV, now: T0, timeOnItemMs: 1 });
    expect(first.record).not.toBeNull();
    const again = submitAnswer(first.state, { kind: 'typed', text: 'jujur' }, { ...ENV, now: T0, timeOnItemMs: 1 });
    expect(again.record).toBeNull();
    expect(again.state).toBe(first.state);
    // and a screen cannot be "answered"
    const fresh = begin();
    expect(submitAnswer(fresh, { kind: 'dont_know' }, { ...ENV, now: T0, timeOnItemMs: 1 }).record).toBeNull();
  });

  it('after a wrong form choice: FA-FORM, then a fresh REMED item for the same skill', () => {
    let s = skipScreens(begin());
    s = advance(submitAnswer(s, { kind: 'typed', text: 'jujur' }, { ...ENV, now: T0, timeOnItemMs: 1 }).state, T0);
    const r = submitAnswer(s, { kind: 'choice', option_id: 'a' }, { ...ENV, now: T0, timeOnItemMs: 1 });
    expect(r.state.feedback?.messages).toEqual([content.feedback['FA-FORM']]);
    s = advance(r.state, T0);
    expect(currentStep(s)).toEqual({ kind: 'item', item_id: 'DEMO-F03', role: 'remed' });
  });

  it('after a serious he/she mistake: FA-REF, a focused question (not evidence), then a fresh REMED sentence', () => {
    let s = skipScreens(begin());
    const history: AnswerRecord[] = [];
    const answerWith = (resp: Parameters<typeof submitAnswer>[1]) => {
      const r = submitAnswer(s, resp, { ...ENV, now: T0, timeOnItemMs: 1 });
      history.push(r.record!);
      s = advance(r.state, T0);
      return r;
    };
    answerWith({ kind: 'typed', text: 'jujur' });
    answerWith({ kind: 'choice', option_id: 'b' });
    const wrong = answerWith({ kind: 'typed', text: 'dia beriman', ref: 'laki-laki' });
    expect(wrong.record!.serious_tag).toBe('wrong-referent');
    expect(wrong.state.feedback?.messages.join(' ')).toContain('هِيَ menunjuk perempuan');
    expect(unresolvedSerious(history)).toEqual([{ skill: 'NOM-01', tag: 'wrong-referent' }]);

    expect(currentStep(s)).toEqual({ kind: 'item', item_id: 'DEMO-FQ-REF-F', role: 'focus' });
    const focus = answerWith({ kind: 'choice', option_id: 'f' });
    expect(focus.record!.fresh_evidence).toBe(false);
    expect(focus.record!.pool).toBe('FOCUS');
    expect(unresolvedSerious(history)).toHaveLength(1); // still needs the fresh REMED sentence

    expect(currentStep(s)).toEqual({ kind: 'item', item_id: 'DEMO-R01', role: 'remed' });
    const remed = answerWith({ kind: 'typed', text: 'dia orang yang beribadah', ref: 'perempuan' });
    expect(remed.record!.outcome).toBe('correct');
    expect(remed.record!.fresh_evidence).toBe(true);
    expect(unresolvedSerious(history)).toEqual([]);
  });

  it('flags a skill that runs out of fresh REMED items and lets the learner continue', () => {
    let s = skipScreens(begin());
    // Mark both REMED sentences as already seen in history
    const seen = ['DEMO-R01', 'DEMO-R02'].map(
      (id, n) => ({ item_id: id, pool: 'REMED', unit: 'A', skills: ['NOM-01'], local_date: '2026-10-14', first_attempt: true, hint_used: false, answer_id: `h${n}` }) as unknown as AnswerRecord
    );
    s = skipScreens(begin(seen));
    s = advance(submitAnswer(s, { kind: 'typed', text: 'jujur' }, { ...ENV, history: seen, now: T0, timeOnItemMs: 1 }).state, T0);
    s = advance(submitAnswer(s, { kind: 'choice', option_id: 'b' }, { ...ENV, history: seen, now: T0, timeOnItemMs: 1 }).state, T0);
    const r = submitAnswer(s, { kind: 'typed', text: 'keimanannya', ref: 'perempuan' }, { ...ENV, history: seen, now: T0, timeOnItemMs: 1 });
    expect(r.state.flags).toContain('out-of-fresh:NOM-01');
    s = advance(r.state, T0);
    expect(currentStep(s)).toEqual({ kind: 'item', item_id: 'DEMO-FQ-POS', role: 'focus' });
    s = advance(submitAnswer(s, { kind: 'choice', option_id: 'desc' }, { ...ENV, history: seen, now: T0, timeOnItemMs: 1 }).state, T0);
    expect(currentStep(s)).toEqual({ kind: 'item', item_id: 'DEMO-M02', role: 'practice' });
  });

  it('stops at the time budget, at the end of the current item', () => {
    let s = skipScreens(begin([], [], 10));
    const late = T0 + 11 * 60_000;
    s = submitAnswer(s, { kind: 'typed', text: 'jujur' }, { ...ENV, now: late, timeOnItemMs: 1 }).state;
    s = advance(s, late);
    expect(s.phase).toBe('done');
  });

  it('state is plain JSON, so it survives a save/restore round trip', () => {
    let s = skipScreens(begin());
    s = submitAnswer(s, { kind: 'typed', text: 'jujur' }, { ...ENV, now: T0, timeOnItemMs: 1 }).state;
    const restored = JSON.parse(JSON.stringify(s)) as SessionState;
    expect(restored).toEqual(s);
    expect(currentStep(advance(restored, T0))).toEqual({ kind: 'item', item_id: 'DEMO-F01', role: 'practice' });
  });

  it('a second session never repeats items as fresh', () => {
    let s = skipScreens(begin());
    const history: AnswerRecord[] = [];
    while (s.phase !== 'done') {
      const step = currentStep(s);
      if (!step || step.kind !== 'item') break;
      const r = submitAnswer(s, { kind: 'dont_know' }, { ...ENV, now: T0, timeOnItemMs: 1 });
      history.push(r.record!);
      s = advance(r.state, T0);
    }
    const next = begin(history, ['DEMO-S1', 'DEMO-S2', 'DEMO-S3']);
    const seen = new Set(history.map((h) => h.item_id));
    expect(next.queue.filter((q) => q.kind === 'item' && seen.has(q.item_id))).toEqual([]);
  });

  it('summary reports counts and next due day, with no mastery claim', () => {
    let s = skipScreens(begin());
    s = advance(submitAnswer(s, { kind: 'typed', text: 'jujur' }, { ...ENV, now: T0, timeOnItemMs: 1 }).state, T0);
    s = advance(submitAnswer(s, { kind: 'choice', option_id: 'a' }, { ...ENV, now: T0, timeOnItemMs: 1 }).state, T0);
    // the wrong form choice inserted the fresh REMED item DEMO-F03
    s = advance(submitAnswer(s, { kind: 'choice', option_id: 'a' }, { ...ENV, now: T0, timeOnItemMs: 1 }).state, T0);
    s = advance(submitAnswer(s, { kind: 'typed', text: 'hmm', ref: 'perempuan' }, { ...ENV, now: T0, timeOnItemMs: 1 }).state, T0);
    const sum = summarize(s, rules);
    expect(sum).toMatchObject({ answered: 4, correct: 2, wrong: 1, pending: 1, dont_know: 0, follow_ups: 1 });
    expect(sum.next_review_date).toBe('2026-10-16');
    const text = JSON.stringify(sum).toLowerCase();
    expect(text).not.toMatch(/learned|dipelajari|menguasai|%/);
  });
});
