// Repair 2026-10-16, whole-branch review: timed-check outcomes stay hidden until their collection
// (unit × D7/D30) has no unanswered item left, across routes, session splits, restarts and days.
import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { progress } from '@/engine/progress';
import type { Outcome } from '@/engine/scoring';
import { advance, currentStep, startSession, submitAnswer, type ItemStep, type SessionState } from '@/engine/session';
import type { AnswerRecord, StepRole } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(activePack, 'developer-demo');
const zero = () => 0;
const at = (date: string, h = 9) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+07:00`).getTime();
const A_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3'];
const A_CORE = ['A3-M01', 'A3-F01', 'A3-P01', 'A3-M02', 'A3-F02', 'A3-P02', 'A3-P03'];
let n = 0;
function ev(item_id: string, local_date: string, role: StepRole = 'practice', outcome: Outcome = 'correct'): AnswerRecord {
  n += 1;
  const item = content.items.find((i) => i.item_id === item_id)!;
  return {
    answer_id: `m${n}`,
    item_id,
    local_date,
    timestamp: `${local_date}T02:00:00.000Z`,
    pool: item.pool,
    unit: item.unit,
    skills: item.skills,
    outcome,
    role,
    lineage: item.lineage,
    first_attempt: true,
    fresh_evidence: true,
    hint_used: false,
    serious_tag: null,
    error_tags: [],
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    content_version: item.content_version,
  } as unknown as AnswerRecord;
}
const history = A_CORE.map((id) => ev(id, '2027-01-01'));
const d7 = content.items.filter((i) => i.unit === 'A' && i.pool === 'D7').map((i) => i.item_id);
const env = (log: AnswerRecord[], now: number) => ({ content, rules, history: log, now, timeOnItemMs: 1000, rng: zero });
const plan = (log: AnswerRecord[], date: string, budget: number) =>
  startSession({ content, rules, history: log, learnerId: 'l', now: at(date), budgetMinutes: budget, screensSeen: A_SCREENS, appVersion: '0.3.0', rng: zero });
const ids = (s: SessionState, role: StepRole) => s.queue.filter((q): q is ItemStep => q.kind === 'item' && q.role === role).map((q) => q.item_id);

describe('Progress never reveals check outcomes while their collection is open', () => {
  it('after A3-D7S2 only, the Unit A D7 line hides its correct count; it appears once every D7 item is answered', () => {
    const one = [...history, ev('A3-D7S2', '2027-01-08', 'check', 'wrong')];
    const open = progress(one, content, rules, '2027-01-08', A_SCREENS).units[0].retention_d7;
    expect(open.attempted).toBe(1);
    expect(open.correct).toBeNull();
    const all = [...history, ...d7.map((id) => ev(id, '2027-01-08', 'check', id === 'A3-D7S2' ? 'wrong' : 'correct'))];
    const closed = progress(all, content, rules, '2027-01-08', A_SCREENS).units[0].retention_d7;
    expect(closed.correct).toBe(d7.length - 1);
  });

  it('the word list hides a word meaning while a due, unanswered check relies on that word (عَالِمٌ → A3-D7W5)', () => {
    const log = [...history, ev('A3-D7S2', '2027-01-08', 'check')];
    const words = progress(log, content, rules, '2027-01-08', A_SCREENS).words;
    const alim = words.find((w) => w.word_id === 'W-A5')!;
    expect(alim.meaning_hidden).toBe(true);
    // once the checks that need it are answered, the meaning is shown again
    const done = [...history, ...d7.map((id) => ev(id, '2027-01-08', 'check'))];
    const after = progress(done, content, rules, '2027-01-08', A_SCREENS).words.find((w) => w.word_id === 'W-A5')!;
    expect(after.meaning_hidden).toBe(false);
    // before the checks are due (day 3) nothing is hidden
    expect(progress(history, content, rules, '2027-01-03', A_SCREENS).words.every((w) => !w.meaning_hidden)).toBe(true);
  });
});

describe('the serious-mistake marker on Kemajuan does not reveal a check answer while its check is open', () => {
  const serious = (id: string, date: string, role: StepRole) => ({ ...ev(id, date, role, 'wrong'), serious_tag: 'wrong-referent' }) as AnswerRecord;
  const marker = (log: AnswerRecord[]) => progress(log, content, rules, '2027-01-08', A_SCREENS).skills.find((x) => x.skill === 'NOM-01')!.unresolved_serious;

  it('D7S1 answered with the wrong person (r) shows the same as answered correctly (k): no marker until the check is complete', () => {
    expect(marker([...history, serious('A3-D7S1', '2027-01-08', 'check')])).toBeNull();
    expect(marker([...history, ev('A3-D7S1', '2027-01-08', 'check')])).toBeNull();
    // once every D7 item is answered, the open check-derived mistake is shown
    const all = [...history, serious('A3-D7S1', '2027-01-08', 'check'), ...d7.filter((id) => id !== 'A3-D7S1').map((id) => ev(id, '2027-01-08', 'check'))];
    expect(marker(all)).toBe('wrong-referent');
  });

  it('an earlier practice mistake keeps its marker (only check-derived markers are masked)', () => {
    const log = [...history, serious('A3-P01', '2027-01-01', 'practice'), serious('A3-D7S1', '2027-01-08', 'check')];
    expect(marker(log)).toBe('wrong-referent');
  });
});

describe('a check block split by the time budget keeps its outcomes and follow-ups closed', () => {
  it('session ends after a serious D7S2 error: no follow-up reveals it; the next day the remaining checks come first, then the follow-up', () => {
    // 2-minute budget: the session stops at the first item boundary after 2 min of active time
    let s = plan(history, '2027-01-08', 2);
    expect(currentStep(s)).toMatchObject({ role: 'check' });
    const log = [...history];
    const i = s.queue.findIndex((q) => q.kind === 'item' && q.item_id === 'A3-D7S2');
    s = { ...s, index: i };
    const r = submitAnswer(s, { kind: 'choice', option_id: 'r' }, env(log, at('2027-01-08')));
    expect(r.record).toMatchObject({ serious_tag: 'wrong-referent', feedback_deferred: true });
    log.push(r.record!);
    // the collection stays open beyond this session's block, so no focus/REMED is queued now
    expect(r.state.queue.slice(i + 1).some((q) => q.kind === 'item' && (q.role === 'focus' || q.role === 'remed'))).toBe(false);
    const ended = advance(r.state, at('2027-01-08') + 3 * 60_000);
    expect(ended.phase).toBe('done');
    // Progress after the split: still hidden
    expect(progress(log, content, rules, '2027-01-08', A_SCREENS).units[0].retention_d7.correct).toBeNull();
    // next day: the remaining D7 items are planned first and the follow-up only after all of them
    const next = plan(log, '2027-01-09', 20);
    const remaining = d7.filter((id) => id !== 'A3-D7S2');
    expect(ids(next, 'check')).toEqual(expect.arrayContaining(remaining));
    const lastCheck = Math.max(...remaining.map((id) => next.queue.findIndex((q) => q.kind === 'item' && q.item_id === id)));
    const focusAt = next.queue.findIndex((q) => q.kind === 'item' && q.role === 'focus');
    expect(focusAt).toBeGreaterThan(lastCheck);
  });

  it('while part of the collection cannot be planned today, the planner holds the check-derived follow-up back', () => {
    const log = [...history, { ...ev('A3-D7S2', '2027-01-08', 'check', 'wrong'), serious_tag: 'wrong-referent' } as AnswerRecord];
    // the Guide word table was opened this morning: the D7 items that rely on it are postponed to another day
    const s = startSession({
      content,
      rules,
      history: log,
      learnerId: 'l',
      now: at('2027-01-09'),
      budgetMinutes: 20,
      screensSeen: A_SCREENS,
      appVersion: '0.3.0',
      rng: zero,
      screenViews: [{ screen_id: 'DEMO-S4', local_date: '2027-01-09', source: 'guide', at: new Date(at('2027-01-09', 8)).toISOString() }],
    });
    expect(s.flags).toContain('check-postponed:A3-D7W5');
    expect(ids(s, 'focus')).toEqual([]);
    expect(ids(s, 'remed')).toEqual([]);
    // without that postponement the whole collection fits today, and the follow-up comes after it
    const t = plan(log, '2027-01-09', 20);
    expect(ids(t, 'focus')).toEqual(['A3-FQ-REF-F']);
  });
});
