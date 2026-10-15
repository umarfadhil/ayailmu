import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { classifySnapshot, prepareSession } from '@/engine/controller';
import { makeItemStep, startSession } from '@/engine/session';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner, ReportRecord } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(activePack, 'developer-demo');
const NOW = new Date('2026-10-16T09:00:00+07:00').getTime();
const zero = () => 0;

const learner: Learner = {
  learner_id: 'lrn-v1',
  created_at: '2026-10-14T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-14T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 20,
  arabic_scale: 1.3,
  screens_seen: ['DEMO-S1', 'DEMO-S2', 'DEMO-S3'],
};
const typedAnswer = {
  answer_id: 'ans-v1-1',
  learner_id: 'lrn-v1',
  item_id: 'DEMO-P01',
  content_version: 'demo-synthetic-0.1',
  rules_version: 'pilot-0.1-local',
  app_version: '0.1.0',
  timestamp: '2026-10-14T02:00:00.000Z',
  local_date: '2026-10-14',
  session_id: 'ses-v1',
  pool: 'PRACT',
  unit: 'A',
  skills: ['NOM-01', 'LEX-P3'],
  raw_response: JSON.stringify({ kind: 'typed', text: 'dia beriman', ref: 'laki-laki' }),
  auto_score: { who: 'wrong', description: 'correct', describes: 'correct' },
  outcome: 'wrong',
  error_tags: ['wrong-referent'],
  serious_tag: 'wrong-referent',
  hint_used: false,
  help_lines_shown: [],
  first_attempt: true,
  fresh_evidence: true,
  time_on_item_ms: 3000,
  audio_status: null,
  report_flag: false,
  review_status: 'draft',
  synthetic: true,
} as AnswerRecord;
const pendingAnswer = { ...typedAnswer, answer_id: 'ans-v1-2', item_id: 'DEMO-M02', skills: ['LEX-A:W-A5'], raw_response: JSON.stringify({ kind: 'typed', text: 'alim' }), auto_score: { meaning: 'pending' }, outcome: 'pending', error_tags: [], serious_tag: null } as AnswerRecord;
const report: ReportRecord = { report_id: 'rep-1', learner_id: 'lrn-v1', item_id: 'DEMO-P01', content_version: 'demo-synthetic-0.1', timestamp: '2026-10-14T02:01:00.000Z', reason: 'Lainnya', text: '' };
const v1Snapshot = {
  version: 1,
  session_id: 'ses-v1',
  learner_id: 'lrn-v1',
  content_version: 'demo-synthetic-0.1',
  index: 4,
  phase: 'step',
  queue: [{ kind: 'item', item_id: 'DEMO-M02', role: 'practice' }],
};

function seedV1(kv: KvBackend, snapshot: unknown = v1Snapshot) {
  kv.setItem(
    KvStore.KEY,
    JSON.stringify({
      learner,
      answers: [typedAnswer, pendingAnswer],
      snapshot: typeof snapshot === 'string' ? snapshot : JSON.stringify(snapshot),
      reports: [report],
    })
  );
}
async function open(kv: KvBackend) {
  const s = new KvStore(kv);
  await s.init();
  return s;
}
const prep = (store: KvStore) => prepareSession({ store, content, rules, now: NOW, rng: zero, appVersion: '0.2.0' });

describe('classifySnapshot', () => {
  const fresh = startSession({ content, rules, history: [], learnerId: 'x', now: NOW, budgetMinutes: 15, screensSeen: [], appVersion: '0.2.0', rng: zero });
  it.each<[string, string | null, string]>([
    ['none', null, 'none'],
    ['v2 current', JSON.stringify(fresh), 'ok'],
    ['v1 typed session', JSON.stringify(v1Snapshot), 'legacy'],
    ['unreadable', '{not json', 'unreadable'],
    ['future version', JSON.stringify({ ...fresh, version: 3 }), 'future'],
    ['other content version', JSON.stringify({ ...fresh, content_version: 'demo-synthetic-0.1' }), 'content-changed'],
  ])('%s', (_n, raw, kind) => {
    expect(classifySnapshot(raw, content).kind).toBe(kind);
  });

  // REV-1: malformed-but-parseable current snapshots must never resume (they are archived and replaced)
  it.each<[string, (s: Record<string, unknown>) => void]>([
    ['index out of range', (s) => (s.index = 999)],
    ['negative / fractional index', (s) => (s.index = 1.5)],
    ['index at the end while a step is shown', (s) => (s.index = (s.queue as unknown[]).length)],
    ['missing attempts', (s) => delete s.attempts],
    ['null queue entry', (s) => ((s.queue as unknown[])[0] = null)],
    ['unknown phase', (s) => (s.phase = 'paused')],
    ['unknown step role', (s) => (((s.queue as Record<string, unknown>[]).find((q) => q.kind === 'item') as Record<string, unknown>).role = 'bonus')],
    ['feedback phase without feedback', (s) => (s.phase = 'feedback')],
    ['feedback for a different item', (s) => {
      s.phase = 'feedback';
      s.feedback = { item_id: 'A2-P02', outcome: 'correct', messages: [], selected_option_id: 'k', correct_option_id: 'k' };
    }],
    ['non-numeric budget', (s) => (s.budget_minutes = 'ten')],
    ['missing review time fields', (s) => delete s.review_ms],
    ['results not a list', (s) => (s.results = {})],
    ['focus_skill not a map', (s) => (s.focus_skill = ['x'])],
    ['bad local date', (s) => (s.local_date = 'yesterday')],
  ])('malformed snapshot (%s) classifies as unreadable without throwing', (_n, mutate) => {
    const s = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>;
    s.index = (s.queue as { kind: string }[]).findIndex((q) => q.kind === 'item');
    mutate(s);
    expect(() => classifySnapshot(JSON.stringify(s), content)).not.toThrow();
    expect(classifySnapshot(JSON.stringify(s), content).kind).toBe('unreadable');
  });

  it('a well-formed snapshot at an item step still classifies ok', () => {
    const s = JSON.parse(JSON.stringify(fresh));
    s.index = s.queue.findIndex((q: { kind: string }) => q.kind === 'item');
    expect(classifySnapshot(JSON.stringify(s), content).kind).toBe('ok');
  });

  it('a saved option order that is not an exact permutation is set aside, never re-graded', () => {
    const step = makeItemStep(content, 'A2-P01', 'practice', zero);
    const bad = { ...fresh, queue: [{ ...step, option_order: ['k', 'r', 'p', 'p'] }], index: 0, phase: 'step' };
    expect(classifySnapshot(JSON.stringify(bad), content).kind).toBe('invalid-order');
    const missing = { ...fresh, queue: [{ ...step, option_order: undefined }], index: 0, phase: 'step' };
    expect(classifySnapshot(JSON.stringify(missing), content).kind).toBe('invalid-order');
  });
});

describe('prepareSession: safe migration of a realistic v1 save', () => {
  it('archives the v1 snapshot atomically, persists the new session before display, keeps every old record', async () => {
    const kv = memoryKv();
    seedV1(kv);
    const store = await open(kv);
    const r = await prep(store);
    expect(r.kind).toBe('new');
    if (r.kind !== 'new') return;
    expect(r.notice).toBe('format-change');
    // persisted before display
    expect(await store.loadSnapshot()).toEqual(r.state);
    // the old snapshot is preserved byte-for-byte in the archive
    const archive = JSON.parse((await store.getMeta('snapshot_archive'))!);
    expect(archive).toHaveLength(1);
    expect(archive[0].reason).toBe('format-change-v1');
    expect(JSON.parse(archive[0].raw)).toEqual(v1Snapshot);
    // history, learner (consent/settings/seen screens) and reports untouched
    const reopened = await open(kv);
    expect(await reopened.listAnswers()).toEqual([typedAnswer, pendingAnswer]);
    expect(await reopened.getLearner()).toEqual(learner);
    expect(await reopened.listReports()).toEqual([report]);
    expect(await reopened.getMeta('pending_notice')).toBe('format-change');
    // lesson screens already seen are not repeated; legacy-answered material is not fresh again
    expect(r.state.queue[0]).toMatchObject({ kind: 'item' });
    const asRole = (role: string) => r.state.queue.filter((q) => q.kind === 'item' && q.role === role).map((q) => (q as { item_id: string }).item_id);
    // never fresh again under the new IDs (was DEMO-P01 / DEMO-M02, the latter still pending)…
    expect(asRole('practice')).not.toContain('A2-P01');
    expect(asRole('practice')).not.toContain('A2-M02');
    // …but due for review two days after the legacy exposure (Oct 14 → due Oct 15, today Oct 16)
    expect(asRole('review')).toEqual(expect.arrayContaining(['A2-P01', 'A2-M02']));
  });

  it('a failed archive leaves the v1 save intact and reports the error', async () => {
    const kv = memoryKv();
    seedV1(kv);
    const before = kv.getItem(KvStore.KEY);
    let fail = true;
    const flaky: KvBackend = {
      getItem: (k) => kv.getItem(k),
      removeItem: (k) => kv.removeItem(k),
      setItem: (k, v) => {
        if (fail) {
          fail = false;
          throw new Error('simulated quota failure');
        }
        kv.setItem(k, v);
      },
    };
    const store = await open(flaky);
    await expect(prep(store)).rejects.toThrow(/simulated/);
    expect(kv.getItem(KvStore.KEY)).toBe(before);
  });

  it('an unreadable snapshot is archived raw and a new session starts', async () => {
    const kv = memoryKv();
    seedV1(kv, '{not json');
    const r = await prep(await open(kv));
    expect(r.kind).toBe('new');
    const archive = JSON.parse(JSON.parse(kv.getItem(KvStore.KEY)!).meta.snapshot_archive);
    expect(archive[0]).toMatchObject({ reason: 'unreadable-snapshot', raw: '{not json' });
  });

  it('a snapshot from a future app version is refused without any write', async () => {
    const kv = memoryKv();
    seedV1(kv, { ...v1Snapshot, version: 7 });
    const before = kv.getItem(KvStore.KEY);
    const r = await prep(await open(kv));
    expect(r.kind).toBe('refused');
    expect(kv.getItem(KvStore.KEY)).toBe(before);
  });

  it('a current in-progress session resumes unchanged with no write', async () => {
    const kv = memoryKv();
    const store = await open(kv);
    await store.saveLearner(learner);
    const first = await prep(store);
    expect(first.kind).toBe('new');
    const before = kv.getItem(KvStore.KEY);
    const again = await prep(await open(kv));
    expect(again.kind).toBe('resume');
    if (again.kind === 'resume' && first.kind === 'new') expect(again.state).toEqual(first.state);
    expect(kv.getItem(KvStore.KEY)).toBe(before);
  });

  it('with nothing to do, the last completed session is not overwritten by an empty one', async () => {
    const kv = memoryKv();
    const store = await open(kv);
    // every Unit A and B lesson item already attempted today; screens seen
    const all = content.items.filter((i) => i.pool === 'PRACT' || i.pool === 'READY');
    const done = { ...learner, screens_seen: content.screens.map((s) => s.screen_id) };
    await store.saveLearner(done);
    const lastDone = { ...startSession({ content, rules, history: [], learnerId: 'lrn-v1', now: NOW, budgetMinutes: 15, screensSeen: done.screens_seen, appVersion: '0.2.0', rng: zero }), phase: 'done' as const, queue: [], results: [{ item_id: 'A2-M01', outcome: 'correct' as const, role: 'practice' as const }] };
    for (const [n, it] of all.entries()) {
      await store.recordAnswer(
        // attempted today, correct, no open serious mistake (so genuinely nothing is outstanding)
        { ...typedAnswer, answer_id: `x${n}`, item_id: it.item_id, unit: it.unit, skills: it.skills, pool: it.pool, lineage: it.lineage, content_version: 'demo-synthetic-0.2', local_date: '2026-10-16', timestamp: '2026-10-16T01:00:00.000Z', role: 'practice', outcome: 'correct', serious_tag: null, error_tags: [] },
        lastDone
      );
    }
    const before = kv.getItem(KvStore.KEY);
    const r = await prep(store);
    expect(r.kind).toBe('nothing-due');
    expect(kv.getItem(KvStore.KEY)).toBe(before);
    expect(await store.loadSnapshot()).toEqual(lastDone);
  });
});
