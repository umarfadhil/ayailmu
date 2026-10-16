// Repair 2026-10-16: regressions for ENG-01..05, SCOPE-01/02 and CONTENT-F03 (review reproductions).
import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { classifySnapshot, prepareSession, SessionController } from '@/engine/controller';
import { progress } from '@/engine/progress';
import type { Outcome, Response } from '@/engine/scoring';
import {
  advance,
  currentStep,
  openObligations,
  startSession,
  submitAnswer,
  summarize,
  type ItemStep,
  type SessionState,
} from '@/engine/session';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { AnswerRecord, Learner, StepRole } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(activePack, 'developer-demo');
const zero = () => 0;
const A_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3'];
const B_SCREENS = ['DEMO-BS1', 'DEMO-BS2', 'DEMO-BS4', 'DEMO-BS3'];
const A_CORE = ['A3-M01', 'A3-F01', 'A3-P01', 'A3-M02', 'A3-F02', 'A3-P02', 'A3-P03'];
const at = (date: string, h = 9) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+07:00`).getTime();
let n = 0;
function ev(item_id: string, local_date: string, role: StepRole = 'practice', outcome: Outcome = 'correct', extra: Partial<AnswerRecord> = {}): AnswerRecord {
  n += 1;
  const item = content.items.find((i) => i.item_id === item_id);
  return {
    answer_id: `r${String(n).padStart(4, '0')}`,
    item_id,
    local_date,
    timestamp: `${local_date}T02:00:${String(n % 60).padStart(2, '0')}.000Z`,
    pool: role === 'review' ? 'REVIEW' : (item?.pool ?? 'PRACT'),
    unit: item?.unit ?? 'A',
    skills: item?.skills ?? [],
    outcome,
    role,
    lineage: item?.lineage,
    first_attempt: role !== 'review',
    fresh_evidence: role === 'practice' || role === 'remed' || role === 'check',
    hint_used: false,
    serious_tag: null,
    error_tags: [],
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    ...extra,
  } as AnswerRecord;
}
const plan = (history: AnswerRecord[], date: string, budget: number, seen: string[], h = 9) =>
  startSession({ content, rules, history, learnerId: 'l', now: at(date, h), budgetMinutes: budget, screensSeen: seen, appVersion: '0.3.0', rng: zero });
const steps = (s: SessionState, role?: StepRole) => s.queue.filter((q): q is ItemStep => q.kind === 'item' && (!role || q.role === role));
const ids = (s: SessionState, role?: StepRole) => steps(s, role).map((q) => q.item_id);
const env = (history: AnswerRecord[], now: number, t = 1000) => ({ content, rules, history, now, timeOnItemMs: t, rng: zero });

/** Answers every remaining item step with `pick(step)` and advances, returning the log. */
function play(s0: SessionState, history: AnswerRecord[], now: number, pick: (q: ItemStep) => Response) {
  let s = s0;
  const log = [...history];
  for (let guard = 0; guard < 60 && s.phase !== 'done'; guard++) {
    const step = currentStep(s)!;
    if (step.kind === 'item') {
      const r = submitAnswer(s, pick(step), env(log, now));
      log.push(r.record!);
      s = r.state;
    }
    s = advance(s, now);
  }
  return { state: s, log };
}

describe('ENG-01: a legacy serious he/she error gets its gender-specific focus and a fresh REMED', () => {
  it('legacy DEMO-P01 (هِيَ مُؤْمِنَةٌ, wrong-referent) → A3-FQ-REF-F focus + A3-R01 remed; the old event is untouched', () => {
    const legacy = {
      ...ev('X', '2027-01-01', 'practice', 'wrong'),
      item_id: 'DEMO-P01',
      unit: 'A',
      pool: 'PRACT',
      role: undefined,
      lineage: undefined,
      skills: ['NOM-01', 'LEX-P3'],
      serious_tag: 'wrong-referent',
      error_tags: ['wrong-referent'],
      raw_response: JSON.stringify({ kind: 'typed', text: 'dia beriman', ref: 'laki-laki' }),
    } as AnswerRecord;
    const frozen = JSON.stringify(legacy);
    expect(openObligations([legacy], content)).toMatchObject([{ skill: 'NOM-01', referent: 'perempuan', needs_focus: true, needs_remed: true }]);
    const s = plan([legacy], '2027-01-01', 15, A_SCREENS);
    expect(steps(s).filter((q) => q.role === 'focus' || q.role === 'remed').map((q) => [q.item_id, q.role])).toEqual([
      ['A3-FQ-REF-F', 'focus'],
      ['A3-R01', 'remed'],
    ]);
    expect(JSON.stringify(legacy)).toBe(frozen);
  });
});

describe('ENG-02: simultaneous obligations keep their own skill per queued focus step', () => {
  const seriousP01 = ev('A3-P01', '2027-01-01', 'practice', 'wrong', { serious_tag: 'wrong-referent', error_tags: ['wrong-referent'] });
  const seriousF01 = ev('A3-F01', '2027-01-01', 'practice', 'wrong', { serious_tag: 'wrong-referent', error_tags: ['wrong-referent'] });

  it('two female wrong-referent obligations (NOM-01, NOM-02) queue two focus steps with distinct target skills', () => {
    const s = plan([seriousP01, seriousF01], '2027-01-01', 15, A_SCREENS);
    const follow = steps(s).filter((q) => q.role === 'focus' || q.role === 'remed');
    expect(follow.map((q) => [q.item_id, q.role, q.target_skill ?? null])).toEqual([
      ['A3-FQ-REF-F', 'focus', 'NOM-01'],
      ['A3-R01', 'remed', null],
      ['A3-FQ-REF-F', 'focus', 'NOM-02'],
      ['A3-F03', 'remed', null],
    ]);
  });

  it('answering all four correctly (with a restart in the middle) resolves both obligations', () => {
    const history = [seriousP01, seriousF01];
    let s = plan(history, '2027-01-01', 15, A_SCREENS);
    const log = [...history];
    let done = 0;
    while (done < 4) {
      const step = currentStep(s)!;
      if (step.kind === 'item' && (step.role === 'focus' || step.role === 'remed')) {
        const r = submitAnswer(s, { kind: 'choice', option_id: 'k' }, env(log, at('2027-01-01')));
        log.push(r.record!);
        s = r.state;
        done += 1;
        if (done === 2) s = JSON.parse(JSON.stringify(s)); // restart from the saved snapshot
      }
      s = advance(s, at('2027-01-01'));
    }
    const focusRecords = log.filter((r) => r.role === 'focus');
    expect(focusRecords.map((r) => r.skills)).toEqual([['NOM-01'], ['NOM-02']]);
    expect(openObligations(log, content)).toEqual([]);
  });
});

describe('ENG-03: no same-day review of a key exposed by a check (planned or completed), including sentence→word', () => {
  const aCore = () => A_CORE.map((id) => ev(id, '2027-01-01'));

  it('Jan 8: D7 checks on W-A1/W-A3/W-A5 suppress reviews of A3-M01, A3-M02 and the A3-P01 sentence (lemma مُؤْمِنٌ)', () => {
    const s = plan(aCore(), '2027-01-08', 20, A_SCREENS);
    expect(ids(s, 'check')).toContain('A3-D7W3');
    expect(ids(s, 'review').sort()).toEqual(['A3-F01', 'A3-F02', 'A3-P02', 'A3-P03']);
  });

  it('a check completed earlier today suppresses that key in a second session the same day', () => {
    const history = [...aCore(), ev('A3-D7W3', '2027-01-08', 'check'), ev('A3-D7W5', '2027-01-08', 'check')];
    const s = plan(history, '2027-01-08', 20, A_SCREENS, 15);
    expect(ids(s, 'review')).not.toContain('A3-M01');
    expect(ids(s, 'review')).not.toContain('A3-M02');
    // …and is reviewable again the next day (checks never turn into review items themselves)
    const next = plan(history, '2027-01-09', 20, A_SCREENS);
    expect(ids(next, 'review')).toContain('A3-M01');
    expect(ids(next).some((id) => id.includes('D7') && steps(next).find((q) => q.item_id === id)!.role === 'review')).toBe(false);
  });
});

describe('ENG-04: active review time includes feedback reading, charged at the item boundary', () => {
  it('10-minute session: 1 s answer + 6 min feedback on the first review → no further reviews (5 min allowance)', () => {
    const history = A_CORE.map((id) => ev(id, '2027-01-01'));
    const t0 = at('2027-01-03');
    const s0 = plan(history, '2027-01-03', 10, A_SCREENS);
    expect(steps(s0, 'review')).toHaveLength(5);
    const r = submitAnswer(s0, { kind: 'choice', option_id: 'k' }, env(history, t0 + 1000, 1000));
    const after = advance(r.state, t0 + 1000 + 6 * 60_000);
    expect(after.review_ms).toBe(361_000);
    expect(currentStep(after)).toMatchObject({ kind: 'screen' }); // remaining reviews skipped; Unit B lesson continues
    expect(after.phase).toBe('step');
  });

  it('the review time survives a restart (saved in the snapshot) and is not double-counted', () => {
    const history = A_CORE.map((id) => ev(id, '2027-01-01'));
    const t0 = at('2027-01-03');
    const s0 = plan(history, '2027-01-03', 10, A_SCREENS);
    const r = submitAnswer(s0, { kind: 'choice', option_id: 'k' }, env(history, t0 + 30_000, 30_000));
    const restored = JSON.parse(JSON.stringify(r.state)) as SessionState;
    const after = advance(restored, t0 + 90_000);
    expect(after.review_ms).toBe(90_000);
  });
});

describe('ENG-05: a completed session keeps its duration; interrupted sessions roll over by day', () => {
  it('summary minutes are frozen at completion (not 1440 the next day)', () => {
    const t0 = at('2027-01-01');
    let s = plan([], '2027-01-01', 10, A_SCREENS);
    const log: AnswerRecord[] = [];
    let t = t0;
    while (s.phase !== 'done') {
      const step = currentStep(s)!;
      t += 60_000;
      if (step.kind === 'item') {
        const r = submitAnswer(s, { kind: 'choice', option_id: 'k' }, env(log, t));
        log.push(r.record!);
        s = r.state;
        t += 30_000;
      }
      s = advance(s, t);
    }
    const minutes = summarize(s, t).minutes;
    expect(summarize(s, t + 24 * 60 * 60_000).minutes).toBe(minutes);
    expect(minutes).toBeLessThanOrEqual(11);
    expect(s.completed_at).toBeGreaterThan(t0);
  });

  it('an unfinished session from yesterday is archived and today’s session restores its open follow-ups', async () => {
    const kv = memoryKv();
    const store = new KvStore(kv);
    await store.init();
    const learner: Learner = {
      learner_id: 'l',
      created_at: '2027-01-01T00:00:00.000Z',
      consent_version: 'c',
      consent_at: '2027-01-01T00:00:00.000Z',
      age_confirmed: true,
      session_minutes: 15,
      arabic_scale: 1,
      screens_seen: A_SCREENS,
    };
    await store.saveLearner(learner);
    // yesterday: serious he/she error on A3-P01; the session ended (app closed) before the follow-ups
    const y0 = plan([], '2027-01-01', 15, A_SCREENS);
    const y = { ...y0, index: y0.queue.findIndex((q) => q.kind === 'item' && q.item_id === 'A3-P01') };
    expect(currentStep(y)).toMatchObject({ item_id: 'A3-P01' });
    const r = submitAnswer(y, { kind: 'choice', option_id: 'r' }, env([], at('2027-01-01')));
    expect(r.record).toMatchObject({ item_id: 'A3-P01', serious_tag: 'wrong-referent' });
    await store.recordAnswer(r.record!, r.state);
    const prep = await prepareSession({ store, content, rules, now: at('2027-01-02'), appVersion: '0.3.0', rng: zero });
    expect(prep.kind).toBe('new');
    if (prep.kind !== 'new') return;
    expect(prep.notice).toBe('day-rollover');
    expect(prep.state.local_date).toBe('2027-01-02');
    expect(steps(prep.state).filter((q) => q.role === 'focus' || q.role === 'remed').map((q) => q.item_id)).toEqual(['A3-FQ-REF-F', 'A3-R01']);
    const archive = JSON.parse((await store.getMeta('snapshot_archive'))!);
    expect(archive[0].reason).toBe('day-rollover');
    expect(JSON.parse(archive[0].raw).session_id).toBe(r.state.session_id);
    expect((await store.listAnswers()).map((a) => a.answer_id)).toEqual([r.record!.answer_id]);
  });

  it('same-day offline resume: the gap while the app was closed during feedback is not charged', async () => {
    const store = new KvStore(memoryKv());
    await store.init();
    await store.saveLearner({ learner_id: 'l', created_at: 'x', consent_version: 'c', consent_at: 'x', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: A_SCREENS });
    const t0 = at('2027-01-01', 9);
    const first = await prepareSession({ store, content, rules, now: t0, appVersion: '0.3.0', rng: zero });
    if (first.kind !== 'new') throw new Error('expected a new session');
    // answer after 20 s, then the app is closed while the feedback is on screen
    const r = submitAnswer(first.state, { kind: 'choice', option_id: 'k' }, env([], t0 + 20_000, 20_000));
    await store.recordAnswer(r.record!, r.state);
    // reopened 3 hours later the same day: resume, read feedback for 30 s, continue
    const back = t0 + 3 * 60 * 60_000;
    const again = await prepareSession({ store, content, rules, now: back, appVersion: '0.3.0', rng: zero });
    expect(again.kind).toBe('resume');
    if (again.kind !== 'resume') return;
    const after = advance(again.state, back + 30_000);
    expect(after.active_ms).toBe(50_000);
  });

  it('a same-day reopened session resumes (no rollover)', async () => {
    const store = new KvStore(memoryKv());
    await store.init();
    await store.saveLearner({ learner_id: 'l', created_at: 'x', consent_version: 'c', consent_at: 'x', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: A_SCREENS });
    const first = await prepareSession({ store, content, rules, now: at('2027-01-01', 9), appVersion: '0.3.0', rng: zero });
    const again = await prepareSession({ store, content, rules, now: at('2027-01-01', 20), appVersion: '0.3.0', rng: zero });
    expect(again.kind).toBe('resume');
    if (first.kind === 'new' && again.kind === 'resume') expect(again.state.session_id).toBe(first.state.session_id);
  });

  it('a pre-repair snapshot without timing fields is still readable (no crash, no archive)', () => {
    const s = plan([], '2027-01-01', 15, A_SCREENS) as unknown as Record<string, unknown>;
    delete s.active_ms;
    delete s.step_started_at;
    delete s.completed_at;
    expect(classifySnapshot(JSON.stringify(s), content).kind).toBe('ok');
  });
});

describe('SCOPE-01: a Unit B serious error can be resolved with fresh Unit B REMED', () => {
  const aCore = () => A_CORE.map((id) => ev(id, '2027-01-01'));
  const seen = [...A_SCREENS, ...B_SCREENS];

  it('wrong B3-V1 → correct focus → correct fresh B3-R1 → resolved (with restart between focus and REMED)', () => {
    const history = aCore();
    const s0 = plan(history, '2027-01-02', 30, seen);
    const v1 = s0.queue.findIndex((q) => q.kind === 'item' && q.item_id === 'B3-V1');
    let s: SessionState = { ...s0, index: v1 };
    const log = [...history];
    let r = submitAnswer(s, { kind: 'choice', option_id: 'r' }, env(log, at('2027-01-02')));
    log.push(r.record!);
    s = advance(r.state, at('2027-01-02'));
    expect(currentStep(s)).toMatchObject({ item_id: 'B3-FQ-REF-F', role: 'focus' });
    r = submitAnswer(s, { kind: 'choice', option_id: 'k' }, env(log, at('2027-01-02')));
    log.push(r.record!);
    s = JSON.parse(JSON.stringify(advance(r.state, at('2027-01-02'))));
    expect(currentStep(s)).toMatchObject({ item_id: 'B3-R1', role: 'remed' });
    r = submitAnswer(s, { kind: 'choice', option_id: 'k' }, env(log, at('2027-01-02')));
    log.push(r.record!);
    expect(r.record).toMatchObject({ pool: 'REMED', fresh_evidence: true, skills: ['VRB-01'] });
    expect(openObligations(log, content)).toEqual([]);
  });

  it('a correct review never resolves the obligation; when both REMED items are used up it stays open and is flagged', () => {
    const serious = ev('B3-V1', '2027-01-02', 'practice', 'wrong', { serious_tag: 'wrong-referent', error_tags: ['wrong-referent'] });
    const log = [...aCore(), serious, ev('B3-FQ-REF-F', '2027-01-02', 'focus', 'correct', { skills: ['VRB-01'], pool: 'FOCUS', fresh_evidence: false }), ev('B3-V1', '2027-01-03', 'review')];
    expect(openObligations(log, content)).toMatchObject([{ skill: 'VRB-01', needs_focus: false, needs_remed: true }]);
    const exhausted = [...log, ev('B3-R1', '2027-01-03', 'remed', 'wrong'), ev('B3-R2', '2027-01-03', 'remed', 'dont_know')];
    const s = plan(exhausted, '2027-01-04', 20, seen);
    expect(s.flags).toContain('out-of-fresh:VRB-01');
    expect(ids(s, 'remed')).toEqual([]);
  });
});

describe('SCOPE-02: sparse timed checks stay partial and are not re-presented', () => {
  it('Unit B D30 (one available item) remains partial after its single answer and is not planned again', () => {
    const b = ['B3-W1', 'B3-W2', 'B3-W3', 'B3-W4', 'B3-W5', 'B3-VN1', 'B3-VN2', 'B3-V1', 'B3-V2', 'B3-V3'].map((id) => ev(id, '2027-01-10'));
    const log = [...A_CORE.map((id) => ev(id, '2027-01-01')), ...b, ev('B3-D30V1', '2027-02-09', 'check')];
    const d30 = progress(log, content, rules, '2027-02-09', [...A_SCREENS, ...B_SCREENS]).units[1].retention_d30;
    expect(d30).toMatchObject({ status: 'partial', attempted: 1, available: 1, missing_content: true });
    expect(d30.sparse_skills).toContain('VRB-01');
    expect(ids(plan(log, '2027-02-10', 20, [...A_SCREENS, ...B_SCREENS]))).not.toContain('B3-D30V1');
  });
});

describe('CONTENT-F03: timed-check feedback is deferred so later checks stay independent', () => {
  it('a D7 sentence answer does not reveal the key; follow-ups for a serious check error wait until after the check block', () => {
    const history = A_CORE.map((id) => ev(id, '2027-01-01'));
    const s0 = plan(history, '2027-01-08', 20, A_SCREENS);
    const checks = steps(s0, 'check').map((q) => q.item_id);
    const iS2 = s0.queue.findIndex((q) => q.kind === 'item' && q.item_id === 'A3-D7S2');
    // the checks before D7S2 in this block were answered earlier in the session
    const before = s0.queue.slice(0, iS2).filter((q): q is ItemStep => q.kind === 'item' && q.role === 'check').map((q) => ev(q.item_id, '2027-01-08', 'check'));
    const r = submitAnswer({ ...s0, index: iS2 }, { kind: 'choice', option_id: 'r' }, env([...history, ...before], at('2027-01-08')));
    expect(r.state.feedback).toMatchObject({ deferred: true, correct_option_id: null });
    expect(r.state.feedback!.messages.join(' ')).not.toMatch(/berilmu|perempuan/);
    expect(r.record).toMatchObject({ role: 'check', feedback_deferred: true, outcome: 'wrong' });
    const lastCheck = r.state.queue.findIndex((q) => q.kind === 'item' && q.item_id === checks[checks.length - 1]);
    const focusAt = r.state.queue.findIndex((q) => q.kind === 'item' && q.role === 'focus');
    expect(focusAt).toBe(lastCheck + 1);
  });

  it('play-through: the session summary reports raw check counts', () => {
    const history = A_CORE.map((id) => ev(id, '2027-01-01'));
    const { state } = play(plan(history, '2027-01-08', 20, A_SCREENS), history, at('2027-01-08'), () => ({ kind: 'dont_know' }));
    expect(summarize(state, at('2027-01-08')).checks).toBe(8);
  });
});

describe('migration: a v0.2 learner already in Unit B is taught the new tables; checks that need them wait', () => {
  // Superseded ruling (acceptance feedback): checks answered right after first teaching are NOT
  // retention evidence. They wait for their interval from the first introduction (exposure.test.ts).
  it('Jan 8: DEMO-S4 is taught; no Unit A check that relies on it is planned for that day', () => {
    const v02SeenScreens = ['DEMO-S1', 'DEMO-S2', 'DEMO-S3', 'DEMO-BS1', 'DEMO-BS2', 'DEMO-BS3']; // no DEMO-S4 / DEMO-BS4
    const history = [
      ...A_CORE.map((id) => ev(id, '2027-01-01')),
      ...['B3-W1', 'B3-W2', 'B3-W3', 'B3-VN1', 'B3-VN2', 'B3-V1', 'B3-V2', 'B3-V3'].map((id) => ev(id, '2027-01-01')),
    ];
    const s = plan(history, '2027-01-08', 20, v02SeenScreens);
    expect(s.queue.some((q) => q.kind === 'screen' && q.screen_id === 'DEMO-S4')).toBe(true);
    const needsTable = content.items.filter((i) => i.pool === 'D7' && i.unit === 'A' && i.requires_taught?.length).map((i) => i.item_id);
    expect(needsTable.length).toBeGreaterThan(0);
    for (const id of needsTable) expect(ids(s, 'check')).not.toContain(id);
    // the Unit B verb table is shown before any Unit B work that needs it, too
    const bVocab = s.queue.findIndex((q) => q.kind === 'screen' && q.screen_id === 'DEMO-BS4');
    const firstB = s.queue.findIndex((q) => q.kind === 'item' && q.item_id.startsWith('B3-'));
    if (firstB > -1) expect(bVocab).toBeGreaterThan(-1);
    if (firstB > -1) expect(bVocab).toBeLessThan(firstB);
  });
});

describe('ENG-04 follow-up: active feedback time read before a close is checkpointed, not lost', () => {
  const learner: Learner = { learner_id: 'l', created_at: 'x', consent_version: 'c', consent_at: 'x', age_confirmed: true, session_minutes: 10, arabic_scale: 1, screens_seen: A_SCREENS };
  /** Jan 2, 10-minute session (review allowance 0.5 × 10 min = 5 min), positioned on its first review step. */
  async function onReview(t0: number) {
    const store = new KvStore(memoryKv());
    await store.init();
    await store.saveLearner(learner);
    const history = A_CORE.map((id) => ev(id, '2027-01-01'));
    for (const h of history) await store.recordAnswer(h, null);
    const prep = await prepareSession({ store, content, rules, now: t0, appVersion: '0.3.0', rng: zero });
    if (prep.kind !== 'new') throw new Error('expected a new session');
    const index = prep.state.queue.findIndex((q) => q.kind === 'item' && q.role === 'review');
    expect(steps(prep.state, 'review').length).toBeGreaterThanOrEqual(2);
    const state = { ...prep.state, index, step_started_at: t0 };
    await store.saveSnapshot(state);
    return { store, history, state };
  }
  const ctrl = (store: KvStore, state: SessionState, history: AnswerRecord[], clock: { t: number }) =>
    new SessionController({ store, content, rules, learner, history, state, clock: () => clock.t, rng: zero });

  it('1 s answer + 4 min feedback, close, reopen 3 h later, 2 min more feedback → 361 s charged; the review allowance is used up', async () => {
    const t0 = at('2027-01-02', 9);
    const { store, history, state } = await onReview(t0);
    const clock = { t: t0 + 1_000 };
    const c1 = ctrl(store, state, history, clock);
    expect(await c1.submit({ kind: 'choice', option_id: 'k' }, 1_000)).toBe('saved');
    clock.t = t0 + 241_000;
    expect(await c1.pause()).toBe('saved'); // page hidden / app backgrounded / route left
    expect(await c1.pause()).toBe('ignored'); // a second lifecycle event charges nothing more
    const back = t0 + 3 * 60 * 60_000;
    const again = await prepareSession({ store, content, rules, now: back, appVersion: '0.3.0', rng: zero });
    if (again.kind !== 'resume') throw new Error('expected resume');
    clock.t = back + 120_000;
    const c2 = ctrl(store, again.state, [...history, ...(await store.listAnswers()).slice(history.length)], clock);
    expect(await c2.next()).toBe('saved');
    expect(c2.state.active_ms).toBe(361_000);
    expect(c2.state.review_ms).toBe(361_000);
    // the remaining reviews were skipped at the boundary: the 5-minute allowance is used up
    const skipped = c2.state.queue.slice(again.state.index + 1, c2.state.index);
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((q) => q.kind === 'item' && q.role === 'review')).toBe(true);
    const cur = currentStep(c2.state);
    expect(cur && cur.kind === 'item' ? cur.role : cur?.kind).not.toBe('review');
  });

  it('hidden time inside one run is not charged, and pause → resume → pause never double-counts', async () => {
    const t0 = at('2027-01-02', 9);
    const { store, history, state } = await onReview(t0);
    const clock = { t: t0 + 1_000 };
    const c = ctrl(store, state, history, clock);
    await c.submit({ kind: 'choice', option_id: 'k' }, 1_000);
    clock.t = t0 + 61_000;
    await c.pause();
    clock.t = t0 + 2 * 60 * 60_000; // tab hidden for two hours
    c.resume();
    clock.t += 30_000;
    await c.pause();
    c.resume();
    clock.t += 10_000;
    await c.next();
    expect(c.state.active_ms).toBe(101_000); // 1 + 60 + 30 + 10 s
  });

  it('the per-step cap applies to the whole step, across checkpoints', async () => {
    const t0 = at('2027-01-02', 9);
    const { store, history, state } = await onReview(t0);
    const clock = { t: t0 + 1_000 };
    const c = ctrl(store, state, history, clock);
    await c.submit({ kind: 'choice', option_id: 'k' }, 1_000);
    clock.t += 9 * 60_000;
    await c.pause();
    c.resume();
    clock.t += 9 * 60_000;
    await c.next();
    expect(c.state.active_ms).toBe(10 * 60_000);
  });
});

describe('controller persistence follow-ups (whole-branch review probes)', () => {
  const learner: Learner = { learner_id: 'l', created_at: 'x', consent_version: 'c', consent_at: 'x', age_confirmed: true, session_minutes: 10, arabic_scale: 1, screens_seen: A_SCREENS };
  /** A KvStore whose next answer write is held until `release()`. */
  function heldStore() {
    const store = new KvStore(memoryKv());
    let release: () => void = () => undefined;
    const real = store.recordAnswer.bind(store);
    store.recordAnswer = (rec, snap) =>
      new Promise<void>((res, rej) => {
        release = () => real(rec, snap).then(res, rej);
      });
    return { store, release: () => release() };
  }

  it('pause while the answer is still saving is kept: the hidden 3 h are not charged (1 s answer + 1 s feedback + 10 s after resume)', async () => {
    const { store, release } = heldStore();
    await store.init();
    await store.saveLearner(learner);
    const history = A_CORE.map((id) => ev(id, '2027-01-01'));
    const t0 = at('2027-01-02', 9);
    const s0 = plan(history, '2027-01-02', 10, A_SCREENS);
    const state = { ...s0, index: s0.queue.findIndex((q) => q.kind === 'item' && q.role === 'review'), step_started_at: t0 };
    const clock = { t: t0 + 1_000 };
    const c = new SessionController({ store, content, rules, learner, history, state, clock: () => clock.t, rng: zero });
    const submitting = c.submit({ kind: 'choice', option_id: 'k' }, 1_000);
    clock.t = t0 + 2_000;
    const pausing = c.pause(); // tab hidden while the write is pending
    release();
    expect(await submitting).toBe('saved');
    expect(await pausing).toBe('saved');
    expect(c.state.step_started_at).toBeNull();
    expect((await store.loadSnapshot()) as SessionState).toMatchObject({ phase: 'feedback', step_started_at: null, pending_step_ms: 2_000 });
    clock.t += 3 * 60 * 60_000;
    c.resume();
    clock.t += 10_000;
    await c.next();
    expect(c.state.active_ms).toBe(12_000);
    expect(c.state.review_ms).toBe(12_000);
  });

  it('hidden and shown again while the write is pending: only visible time is charged', async () => {
    const { store, release } = heldStore();
    await store.init();
    await store.saveLearner(learner);
    const history = A_CORE.map((id) => ev(id, '2027-01-01'));
    const t0 = at('2027-01-02', 9);
    const s0 = plan(history, '2027-01-02', 10, A_SCREENS);
    const state = { ...s0, index: s0.queue.findIndex((q) => q.kind === 'item' && q.role === 'review'), step_started_at: t0 };
    const clock = { t: t0 + 1_000 };
    const c = new SessionController({ store, content, rules, learner, history, state, clock: () => clock.t, rng: zero });
    const submitting = c.submit({ kind: 'choice', option_id: 'k' }, 1_000);
    clock.t = t0 + 2_000;
    const pausing = c.pause();
    clock.t = t0 + 60 * 60_000; // an hour hidden, then visible again before the write finishes
    c.resume();
    release();
    await submitting;
    expect(await pausing).toBe('ignored');
    clock.t += 5_000;
    await c.next();
    expect(c.state.active_ms).toBe(7_000); // 1 s answer + 1 s before hiding + 5 s after
  });

  it('advancing a lesson screen keeps Settings saved meanwhile (scale 1.3, 20 min) and the learner identity', async () => {
    const store = new KvStore(memoryKv());
    await store.init();
    const fresh: Learner = { ...learner, screens_seen: [] };
    await store.saveLearner(fresh);
    const prep = await prepareSession({ store, content, rules, now: at('2027-01-01'), appVersion: '0.3.0', rng: zero });
    if (prep.kind !== 'new') throw new Error('expected a new session');
    const c = new SessionController({ store, content, rules, learner: prep.learner, history: [], state: prep.state, clock: () => at('2027-01-01', 10), rng: zero });
    // Settings (another retained route) saves new preferences
    await store.saveLearner({ ...fresh, arabic_scale: 1.3, session_minutes: 20 });
    expect(await c.next()).toBe('saved');
    expect(await store.getLearner()).toMatchObject({ learner_id: 'l', arabic_scale: 1.3, session_minutes: 20, screens_seen: ['DEMO-S1'] });
    expect(c.learner).toMatchObject({ arabic_scale: 1.3, session_minutes: 20 });
  });
});
