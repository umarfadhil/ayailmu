import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { demoPack } from '@/content/load';
import { SessionController, restoreSnapshot } from '@/engine/controller';
import { currentStep, startSession } from '@/engine/session';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner, Store } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(demoPack, 'developer-demo');
const T0 = new Date('2026-10-15T09:00:00+07:00').getTime();

const learner: Learner = {
  learner_id: 'lrn-1',
  created_at: '2026-10-15T00:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-15T00:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: ['DEMO-S1', 'DEMO-S2', 'DEMO-S3'],
};

/** Store wrapper whose next write(s) can be made to fail. */
function flaky(inner: Store) {
  let failures = 0;
  const failOnce = <A extends unknown[]>(fn: (...a: A) => Promise<void>) =>
    async (...a: A) => {
      if (failures > 0) {
        failures--;
        throw new Error('simulated write failure');
      }
      return fn(...a);
    };
  const store: Store = {
    ...inner,
    init: () => inner.init(),
    getLearner: () => inner.getLearner(),
    listAnswers: () => inner.listAnswers(),
    loadSnapshot: () => inner.loadSnapshot(),
    listReports: () => inner.listReports(),
    reset: () => inner.reset(),
    addReport: failOnce((r) => inner.addReport(r)),
    saveLearner: failOnce((l) => inner.saveLearner(l)),
    recordAnswer: failOnce((r, s) => inner.recordAnswer(r, s)),
    saveSnapshot: failOnce((s) => inner.saveSnapshot(s)),
  };
  return { store, failNext: (n = 1) => (failures = n) };
}

async function setup() {
  const inner = new KvStore(memoryKv());
  await inner.init();
  await inner.saveLearner(learner);
  const f = flaky(inner);
  const state = startSession({
    content,
    rules,
    history: [],
    learnerId: learner.learner_id,
    now: T0,
    budgetMinutes: 15,
    screensSeen: learner.screens_seen,
    appVersion: '0.1.0',
  });
  const c = new SessionController({ store: f.store, content, rules, learner, history: [], state, clock: () => T0 });
  return { inner, ...f, c };
}

describe('SessionController persistence safeguards', () => {
  it('a rapid double submit produces exactly one answer event', async () => {
    const { c, inner } = await setup();
    const [a, b] = await Promise.all([
      c.submit({ kind: 'typed', text: 'jujur' }, 1000),
      c.submit({ kind: 'typed', text: 'jujur' }, 1000),
    ]);
    expect([a, b].sort()).toEqual(['ignored', 'saved']);
    expect(await inner.listAnswers()).toHaveLength(1);
    // A third tap while feedback is shown is also ignored
    expect(await c.submit({ kind: 'typed', text: 'jujur' }, 1000)).toBe('ignored');
    expect(await inner.listAnswers()).toHaveLength(1);
  });

  it('does not advance the UI state when saving the answer fails, and the retry saves it once', async () => {
    const { c, inner, failNext } = await setup();
    const before = c.state;
    failNext();
    expect(await c.submit({ kind: 'typed', text: 'jujur' }, 1000)).toBe('failed');
    expect(c.state).toBe(before);
    expect(c.error).toMatch(/simulated/);
    expect(c.history).toHaveLength(0);
    expect(await inner.listAnswers()).toHaveLength(0);

    expect(await c.submit({ kind: 'typed', text: 'jujur' }, 1000)).toBe('saved');
    expect(c.error).toBeNull();
    expect(c.state.phase).toBe('feedback');
    expect(await inner.listAnswers()).toHaveLength(1);
    expect(await inner.loadSnapshot()).toEqual(c.state);
  });

  it('does not move to the next step when saving the snapshot fails', async () => {
    const { c, inner, failNext } = await setup();
    await c.submit({ kind: 'typed', text: 'jujur' }, 1000);
    const atFeedback = c.state;
    failNext();
    expect(await c.next()).toBe('failed');
    expect(c.state).toBe(atFeedback);
    expect(await inner.loadSnapshot()).toEqual(atFeedback);
    expect(await c.next()).toBe('saved');
    expect(currentStep(c.state)).toEqual({ kind: 'item', item_id: 'DEMO-F01', role: 'practice' });
  });

  it('resumes from the saved snapshot after a restart', async () => {
    const { c, inner } = await setup();
    await c.submit({ kind: 'typed', text: 'jujur' }, 1000);
    await c.next();
    const restored = restoreSnapshot(await inner.loadSnapshot(), content);
    expect(restored).toEqual(c.state);
    expect(currentStep(restored!)).toEqual({ kind: 'item', item_id: 'DEMO-F01', role: 'practice' });
  });

  it('ignores snapshots from another content version or with unknown items', () => {
    const state = startSession({
      content, rules, history: [], learnerId: 'x', now: T0, budgetMinutes: 15, screensSeen: [], appVersion: '0.1.0',
    });
    expect(restoreSnapshot({ ...state, content_version: 'other' }, content)).toBeNull();
    expect(restoreSnapshot({ ...state, queue: [{ kind: 'item', item_id: 'GONE', role: 'practice' }] }, content)).toBeNull();
    expect(restoreSnapshot({ nonsense: true }, content)).toBeNull();
    expect(restoreSnapshot(null, content)).toBeNull();
  });

  it('records seen lesson screens on the learner so they are not repeated', async () => {
    const inner = new KvStore(memoryKv());
    await inner.init();
    const fresh = { ...learner, screens_seen: [] };
    await inner.saveLearner(fresh);
    const state = startSession({
      content, rules, history: [], learnerId: fresh.learner_id, now: T0, budgetMinutes: 15, screensSeen: [], appVersion: '0.1.0',
    });
    const c = new SessionController({ store: inner, content, rules, learner: fresh, history: [], state, clock: () => T0 });
    expect(await c.next()).toBe('saved');
    expect((await inner.getLearner())?.screens_seen).toEqual(['DEMO-S1']);
  });
});
