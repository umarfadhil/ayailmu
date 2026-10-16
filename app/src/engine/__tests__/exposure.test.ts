// Repair 2026-10-16, acceptance follow-ups: timed checks must stay independent retention evidence.
// - Teaching shown the same day (session lesson screen or Guide) is durable provenance: checks that
//   rely on it are postponed, or, if the exposure happens after planning, recorded as not counted.
// - Historical exposures are reconstructed from the immutable pack the learner actually saw.
import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack, buildLineageMap, v02Pack } from '@/content/load';
import { prepareSession, SessionController } from '@/engine/controller';
import { loadScreenViews, recordScreenView, type ScreenView } from '@/engine/exposure';
import { isEligibleFresh } from '@/engine/freshness';
import { progress } from '@/engine/progress';
import type { Outcome } from '@/engine/scoring';
import { advance, currentStep, startSession, submitAnswer, summarize, toAttempt, type ItemStep, type SessionState } from '@/engine/session';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { AnswerRecord, Learner, StepRole } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(activePack, 'developer-demo');
const zero = () => 0;
const at = (date: string, h = 9) => new Date(`${date}T${String(h).padStart(2, '0')}:00:00+07:00`).getTime();
const A_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S4', 'DEMO-S3'];
const B_SCREENS = ['DEMO-BS1', 'DEMO-BS2', 'DEMO-BS4', 'DEMO-BS3'];
const A_CORE = ['A3-M01', 'A3-F01', 'A3-P01', 'A3-M02', 'A3-F02', 'A3-P02', 'A3-P03'];
/** Screens a v0.2 learner saw: the v0.3 word table (DEMO-S4) and verb table (DEMO-BS4) did not exist. */
const V02_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S3', 'DEMO-BS1', 'DEMO-BS2', 'DEMO-BS3'];

let n = 0;
/** A logged answer as the app version that showed `item_id` wrote it (v0.2 IDs come from the v0.2 pack). */
function ev(item_id: string, local_date: string, role: StepRole = 'practice', outcome: Outcome = 'correct'): AnswerRecord {
  n += 1;
  const item = [...content.items, ...v02Pack.items].find((i) => i.item_id === item_id)!;
  return {
    answer_id: `x${String(n).padStart(4, '0')}`,
    learner_id: 'l',
    item_id,
    content_version: item.content_version,
    rules_version: 'r',
    app_version: 'a',
    timestamp: `${local_date}T02:00:${String(n % 60).padStart(2, '0')}.000Z`,
    local_date,
    session_id: 's',
    pool: role === 'review' ? 'REVIEW' : item.pool,
    unit: item.unit,
    skills: item.skills,
    raw_response: '{}',
    auto_score: {},
    outcome,
    error_tags: [],
    serious_tag: null,
    hint_used: false,
    help_lines_shown: [],
    first_attempt: true,
    fresh_evidence: true,
    time_on_item_ms: 1000,
    audio_status: null,
    report_flag: false,
    review_status: 'draft',
    synthetic: true,
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    lineage: item.lineage,
    role,
    // v0.2 records carry no `forms`: exposure must come from the pack that displayed them
  };
}
const plan = (history: AnswerRecord[], date: string, seen: string[], screenViews: ScreenView[] = [], budget = 20) =>
  startSession({ content, rules, history, learnerId: 'l', now: at(date), budgetMinutes: budget, screensSeen: seen, appVersion: '0.3.0', rng: zero, screenViews });
const items = (s: SessionState, role?: StepRole) => s.queue.filter((q): q is ItemStep => q.kind === 'item' && (!role || q.role === role)).map((q) => q.item_id);
const screens = (s: SessionState) => s.queue.filter((q) => q.kind === 'screen').map((q) => (q as { screen_id: string }).screen_id);
const env = (history: AnswerRecord[], now: number, screenViews: ScreenView[] = []) => ({ content, rules, history, now, timeOnItemMs: 1000, rng: zero, screenViews });
const view = (screen_id: string, local_date: string, source: ScreenView['source'], h = 8): ScreenView => ({
  screen_id,
  local_date,
  source,
  at: new Date(at(local_date, h)).toISOString(),
});

describe('legacy registry: retired v0.2 material keeps its ID and lineage', () => {
  it('buildLineageMap(activePack) resolves retired B2-Y1, B2-D7V1 and B2-W4 to their v0.2 lineages', () => {
    const map = buildLineageMap(activePack);
    expect(map['B2-Y1']).toBe('B:verb-form:سَمِعَ');
    expect(map['B2-D7V1']).toBe('B:verb-form:رَجَعَ');
    expect(map['B2-W4']).toBe('B:word-form:رَجَعَتْ');
    expect(content.lineage['B2-Y1']).toBe('B:verb-form:سَمِعَ');
    // active wording still wins for IDs that exist in v0.3
    expect(map['B3-W4']).toBe('B:word-form:رَجَعَ');
  });
});

describe('legacy exposure: forms are reconstructed from the pack that displayed them', () => {
  it('old B2-W4 (displayed رَجَعَتْ) makes B3-V3 (رَجَعَتْ) NOT fresh; the history is unchanged', () => {
    const old = ev('B2-W4', '2027-01-01');
    const before = JSON.stringify(old);
    const attempt = toAttempt(old, content);
    expect(attempt.forms).toContain('رَجَعَتْ');
    // never from the revised active wording (B3-W4 now shows masculine رَجَعَ)
    expect(attempt.forms).not.toContain('رَجَعَ');
    const v3 = content.items.find((i) => i.item_id === 'B3-V3')!;
    expect(isEligibleFresh(v3, { today: '2027-01-02', history: [attempt], rules }, content.items)).toBe(false);
    expect(JSON.stringify(old)).toBe(before);
  });

  it('a recorded presented Arabic option counts as displayed even when the item is unknown to every pack', () => {
    const rec = { ...ev('A3-M01', '2027-01-01'), item_id: 'ZZ-UNKNOWN', content_version: 'other', presented_options: [{ id: 'k', text: 'رَجَعَتْ', position: 0 }] };
    expect(toAttempt(rec, content).forms).toContain('رَجَعَتْ');
  });
});

describe('migrated learner: checks are never answered right after first teaching the table they rely on', () => {
  // v0.2 learner: Unit A and Unit B core practice on Jan 1 with v0.2 IDs; never saw DEMO-S4 / DEMO-BS4.
  const history = [
    ...['A2-M01', 'A2-F01', 'A2-P01', 'A2-M02', 'A2-F02', 'A2-P02', 'A2-P03'].map((id) => ev(id, '2027-01-01')),
    ...['B2-W1', 'B2-W2', 'B2-W3', 'B2-VN1', 'B2-VN2', 'B2-V1', 'B2-V2'].map((id) => ev(id, '2027-01-01')),
  ];

  it('day of first teaching (Jan 8): DEMO-S4 is shown, the Unit A D7 checks that need it are postponed (not consumed)', () => {
    const s = plan(history, '2027-01-08', V02_SCREENS);
    expect(screens(s)).toContain('DEMO-S4');
    const checks = items(s, 'check');
    for (const id of ['A3-D7S1', 'A3-D7S2', 'A3-D7W1', 'A3-D7W3', 'A3-D7W5']) expect(checks).not.toContain(id);
    expect(s.flags).toContain('check-postponed:A3-D7W1');
    // the D7 line stays honestly due, nothing was counted
    const d7 = progress(history, content, rules, '2027-01-08', V02_SCREENS).units[0].retention_d7;
    expect(d7).toMatchObject({ status: 'due', attempted: 0, assisted: 0 });
  });

  // The v0.3 word table is first introduced on Jan 8. One day later the learner has known that
  // vocabulary for one day, so a "D7" answer would not be 7-day retention: the interval for the items
  // that rely on it runs from the first introduction (Jan 8 → due Jan 15; D30 → Feb 7).
  const seen = [...V02_SCREENS, 'DEMO-S4', 'DEMO-BS4'];
  const views = [view('DEMO-S4', '2027-01-08', 'session'), view('DEMO-BS4', '2027-01-08', 'session')];

  it('Jan 9: the checks that rely on the newly introduced table are still waiting (one-day knowledge is not D7 retention)', () => {
    const s = plan(history, '2027-01-09', seen, views);
    for (const id of ['A3-D7S1', 'A3-D7S2', 'A3-D7W1', 'A3-D7W3', 'A3-D7W5']) expect(items(s, 'check')).not.toContain(id);
    expect(s.flags).toContain('check-postponed:A3-D7W1');
    const d7 = progress(history, content, rules, '2027-01-09', seen, views).units[0].retention_d7;
    expect(d7).toMatchObject({ attempted: 0, assisted: 0, waiting_new_teaching: 5, waiting_until: '2027-01-15' });
    expect(d7.status).not.toBe('answered');
  });

  it('Jan 15 (7 days after the first introduction): they are planned and count; the old practice anchor is unchanged', () => {
    const s = plan(history, '2027-01-15', seen, views);
    expect(items(s, 'check')).toEqual(expect.arrayContaining(['A3-D7W1', 'A3-D7S1']));
    expect(items(s, 'check')).not.toContain('A3-D30W2'); // D30 for the same table: from Jan 8 → Feb 7
    const i = s.queue.findIndex((q) => q.kind === 'item' && q.item_id === 'A3-D7W1');
    const r = submitAnswer({ ...s, index: i }, { kind: 'choice', option_id: 'k' }, env(history, at('2027-01-15'), views));
    expect(r.record!.retention_valid).toBeUndefined();
    const p = progress([...history, r.record!], content, rules, '2027-01-15', seen, views).units[0];
    expect(p.retention_d7).toMatchObject({ attempted: 1, assisted: 0, due_date: '2027-01-08' }); // anchor Jan 1 + 7
    expect(p.retention_d30.waiting_until).toBe('2027-02-07');
  });

  it('a fresh learner taught on day 1 takes the day-8 checks normally', () => {
    const fresh = A_CORE.map((id) => ev(id, '2027-01-01'));
    const s = plan(fresh, '2027-01-08', A_SCREENS, [view('DEMO-S4', '2027-01-01', 'session')]);
    expect(items(s, 'check')).toEqual(expect.arrayContaining(['A3-D7W1', 'A3-D7S1', 'A3-D7F1']));
    expect(s.flags.filter((f) => f.startsWith('check-postponed'))).toEqual([]);
  });
});

describe('Guide exposure: opening the vocabulary guide on the check day is durable provenance', () => {
  const learner: Learner = {
    learner_id: 'l',
    created_at: 'x',
    consent_version: 'c',
    consent_at: 'x',
    age_confirmed: true,
    session_minutes: 20,
    arabic_scale: 1,
    screens_seen: A_SCREENS, // seen on day 1: not enough to judge today's Guide view
  };
  async function setup() {
    const store = new KvStore(memoryKv());
    await store.init();
    await store.saveLearner(learner);
    const history = A_CORE.map((id) => ev(id, '2027-01-01'));
    for (const h of history) await store.recordAnswer(h, null);
    await recordScreenView(store, view('DEMO-S4', '2027-01-01', 'session'));
    return { store, history };
  }

  it('Guide viewed before the session today → the Unit A checks it primes are postponed to a later day', async () => {
    const { store } = await setup();
    await recordScreenView(store, view('DEMO-S4', '2027-01-08', 'guide', 8));
    const prep = await prepareSession({ store, content, rules, now: at('2027-01-08', 9), appVersion: '0.3.0', rng: zero });
    if (prep.kind !== 'new') throw new Error('expected a new session');
    expect(items(prep.state, 'check')).not.toContain('A3-D7W1');
    expect(prep.state.flags).toContain('check-postponed:A3-D7W1');
    // tomorrow, with no new view, they are planned again
    const tomorrow = startSession({
      content,
      rules,
      history: await store.listAnswers(),
      learnerId: 'l',
      now: at('2027-01-09'),
      budgetMinutes: 20,
      screensSeen: A_SCREENS,
      appVersion: '0.3.0',
      rng: zero,
      screenViews: await loadScreenViews(store),
    });
    expect(items(tomorrow, 'check')).toContain('A3-D7W1');
  });

  it('Guide opened mid-session after the checks were planned → those answers are recorded as not counted, honestly', async () => {
    const { store, history } = await setup();
    const prep = await prepareSession({ store, content, rules, now: at('2027-01-08', 9), appVersion: '0.3.0', rng: zero });
    if (prep.kind !== 'new') throw new Error('expected a new session');
    expect(items(prep.state, 'check')).toContain('A3-D7W1');
    const clock = { t: at('2027-01-08', 9) };
    const ctrl = new SessionController({ store, content, rules, learner, history, state: prep.state, clock: () => clock.t, rng: zero });
    // first check answered before any Guide view: independent
    expect(currentStep(ctrl.state)).toMatchObject({ role: 'check' });
    clock.t += 30_000;
    await ctrl.submit({ kind: 'choice', option_id: 'k' }, 1000);
    const firstId = ctrl.history[ctrl.history.length - 1].item_id;
    expect(ctrl.history[ctrl.history.length - 1].retention_valid).not.toBe(false);
    clock.t += 10_000;
    await ctrl.next();
    // learner leaves the session, opens the Guide (word table), comes back
    clock.t += 60_000;
    await recordScreenView(store, { screen_id: 'DEMO-S4', local_date: '2027-01-08', source: 'guide', at: new Date(clock.t).toISOString() });
    clock.t += 60_000;
    const step = currentStep(ctrl.state) as ItemStep;
    expect(step.role).toBe('check');
    await ctrl.submit({ kind: 'choice', option_id: 'k' }, 1000);
    const rec = ctrl.history[ctrl.history.length - 1];
    expect(rec).toMatchObject({ item_id: step.item_id, role: 'check', retention_valid: false, exposure: ['guide:DEMO-S4'] });
    expect(ctrl.state.feedback).toMatchObject({ deferred: true, correct_option_id: null });
    // progress: the exposed answer is not counted as retention, the line cannot be complete
    const log = await store.listAnswers();
    const d7 = progress(log, content, rules, '2027-01-08', A_SCREENS).units[0].retention_d7;
    expect(d7.attempted).toBe(1);
    expect(d7.assisted).toBe(1);
    expect(d7.status).toBe('partial');
    // the session summary says so too
    expect(summarize(ctrl.state).checks).toBe(2);
    expect(summarize(ctrl.state).checks_not_counted).toBe(1);
    // the answered material is never re-presented as fresh, and the history is unchanged
    const next = startSession({ content, rules, history: log, learnerId: 'l', now: at('2027-01-09'), budgetMinutes: 20, screensSeen: A_SCREENS, appVersion: '0.3.0', rng: zero, screenViews: await loadScreenViews(store) });
    expect(items(next)).not.toContain(step.item_id);
    expect(items(next)).not.toContain(firstId);
    expect((await store.listAnswers()).find((a) => a.item_id === firstId)!.retention_valid).not.toBe(false);
  });

  it('session lesson screens are recorded as dated views when the learner moves past them', async () => {
    const store = new KvStore(memoryKv());
    await store.init();
    const fresh: Learner = { ...learner, screens_seen: [] };
    await store.saveLearner(fresh);
    const prep = await prepareSession({ store, content, rules, now: at('2027-01-01'), appVersion: '0.3.0', rng: zero });
    if (prep.kind !== 'new') throw new Error('expected a new session');
    const ctrl = new SessionController({ store, content, rules, learner: fresh, history: [], state: prep.state, clock: () => at('2027-01-01', 10), rng: zero });
    expect(currentStep(ctrl.state)).toMatchObject({ kind: 'screen', screen_id: 'DEMO-S1' });
    await ctrl.next();
    expect(await loadScreenViews(store)).toEqual([{ screen_id: 'DEMO-S1', local_date: '2027-01-01', source: 'session', at: new Date(at('2027-01-01', 10)).toISOString() }]);
    // advancing a pure state never writes (only the controller records views)
    expect(advance(ctrl.state, at('2027-01-01', 10)).seen_screens).toContain('DEMO-S2');
  });
});

describe('B_SCREENS fixture sanity', () => {
  it('lists the Unit B screens in content order', () => {
    expect(content.screens.filter((s) => s.unit === 'B').map((s) => s.screen_id)).toEqual(B_SCREENS);
  });
});
