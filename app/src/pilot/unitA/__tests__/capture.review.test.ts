/**
 * @jest-environment node
 */
// Review regressions for the standalone drain over the real KvStore and controller. A: a stored document the
// controller refuses (lessons null, a presentation without its shown day, a later day than today) drains nothing,
// though its captures alone verify. B: every capture, one an unqueued read already shows included, goes through the
// queued appendAnswer check, and only that check makes it saved. C: a format-1 record keeps the app version it
// recorded and is never rebuilt with the current one.
import { APP_VERSION } from '@/config/appVersion';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import { drainPilotAnswers, isPilotAnswer, makePilotAnswer, PILOT_META_KEY, type PilotAnswerInput } from '../capture';
import { PILOT_CONTENT } from '../content';
import { createPilotController, unitAStatus } from '../controller';

const OWNER = 'guest:lrn-pilot-1';
const LEARNER_ID = 'lrn-pilot-1';
const DAY = '2026-10-27';
const T1 = '2026-10-27T03:15:42.123Z';
const LEGACY_LABEL = 'unit-a-pilot-capture-1';

const learner: Learner = {
  learner_id: LEARNER_ID,
  created_at: '2026-10-27T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-27T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
};

const input = (over: Partial<PilotAnswerInput> = {}): PilotAnswerInput => ({
  owner: OWNER,
  learnerId: LEARNER_ID,
  presentationId: 'ua-pres-fixture-1',
  itemId: 'ua-d01-ref-p01',
  optionId: 'b',
  optionOrder: ['c', 'a', 'd', 'b'],
  day: DAY,
  timestamp: T1,
  ...over,
});

const answerCount = (text: string | null): number => (text ? (JSON.parse(text).answers as unknown[]).length : 0);

type Doc = Record<string, unknown> & { presentations: Record<string, unknown>[]; captures: AnswerRecord[] };

/** A real store holding one captured first choice whose append failed: the intent is only in the document. */
async function pendingIntent() {
  const kv = memoryKv();
  let fail = 0;
  const backend: KvBackend = {
    getItem: (k) => kv.getItem(k),
    removeItem: (k) => kv.removeItem(k),
    setItem: (k, v) => {
      if (fail > 0 && k === KvStore.KEY && answerCount(v) > answerCount(kv.getItem(k))) {
        fail -= 1;
        throw new Error('simulated quota failure');
      }
      kv.setItem(k, v);
    },
  };
  const store = new KvStore(backend);
  await store.init();
  await store.saveLearner(learner);
  const c = createPilotController({
    store,
    owner: OWNER,
    mode: 'developer-demo',
    today: () => DAY,
    readOnly: () => false,
    active: () => true,
    assistedToday: async () => false,
    random: () => 0.5,
    capture: { learnerId: LEARNER_ID, now: () => T1, active: () => true },
  });
  expect((await c.load()).kind).toBe('lesson');
  const q = await c.next();
  if (q.kind !== 'question') throw new Error(`expected a question, got ${q.kind}`);
  fail = 1;
  const item = PILOT_CONTENT.items.find((i) => i.id === q.itemId)!;
  expect((await c.answer(q.presentationId, item.options[0]!.id)).kind).toBe('feedback');
  expect(c.captureStatus()).toBe('pending');
  const raw = (await store.getMeta(PILOT_META_KEY))!;
  const doc = JSON.parse(raw) as Doc;
  expect(doc.captures).toHaveLength(1);
  expect(await store.listAnswers()).toEqual([]);
  c.dispose();
  return { store, raw, doc, intent: doc.captures[0]!, failNextAnswerWrite: () => (fail = 1) };
}

/** Delegates to the real store, but its unqueued listAnswers shows `rows` and every appendAnswer call is recorded. */
function observedAs(store: KvStore, rows: AnswerRecord[]) {
  const calls: AnswerRecord[] = [];
  const proxy = new Proxy(store, {
    get(target, prop) {
      if (prop === 'listAnswers') return async () => JSON.parse(JSON.stringify(rows)) as AnswerRecord[];
      if (prop === 'appendAnswer') {
        return (record: AnswerRecord, guard: Parameters<KvStore['appendAnswer']>[1]) => {
          calls.push(record);
          return target.appendAnswer(record, guard);
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { store: proxy, calls };
}

// ---- A. The controller's strict reading before any capture is drained ----

describe('drainPilotAnswers over a document the controller refuses', () => {
  it('drains the intact document on its own day (control)', async () => {
    const { store, raw, intent } = await pendingIntent();
    expect(unitAStatus(raw, OWNER, DAY)).not.toBeNull();
    expect(await drainPilotAnswers({ store, owner: OWNER, active: () => true, today: DAY })).toBe(1);
    expect(await store.listAnswers()).toEqual([intent]);
    expect(await store.getMeta(PILOT_META_KEY)).toBe(raw);
  });

  it.each([
    ['lessons null', (d: Doc): unknown => ({ ...d, lessons: null })],
    ['a presentation without its shown day', (d: Doc): unknown => ({ ...d, presentations: d.presentations.map(({ shown: _shown, ...p }) => p) })],
  ])('%s: rejects, appends nothing and leaves the document as stored', async (_what, alter) => {
    const { store, doc } = await pendingIntent();
    const altered = JSON.stringify(alter(doc));
    await store.setMeta(PILOT_META_KEY, altered);
    expect(unitAStatus(altered, OWNER, DAY)).toBeNull();
    await expect(drainPilotAnswers({ store, owner: OWNER, active: () => true, today: DAY })).rejects.toThrow();
    expect(await store.listAnswers()).toEqual([]);
    expect(await store.getMeta(PILOT_META_KEY)).toBe(altered);
  });

  it('a today earlier than the document\'s days refuses, as the controller would', async () => {
    const { store, raw } = await pendingIntent();
    await expect(drainPilotAnswers({ store, owner: OWNER, active: () => true, today: '2026-10-26' })).rejects.toThrow();
    expect(await store.listAnswers()).toEqual([]);
    expect(await store.getMeta(PILOT_META_KEY)).toBe(raw);
  });
});

// ---- B. The queued append check is the only durability barrier ----

describe('drainPilotAnswers and records an unqueued read already shows', () => {
  it('still submits the identical record through appendAnswer, which then actually stores it', async () => {
    const { store, raw, intent } = await pendingIntent();
    const seen = observedAs(store, [intent]);
    // Nothing was missing from the first observation: the number is diagnostic only.
    expect(await drainPilotAnswers({ store: seen.store, owner: OWNER, active: () => true, today: DAY })).toBe(0);
    expect(seen.calls).toEqual([intent]);
    expect(await store.listAnswers()).toEqual([intent]);
    expect(await store.getMeta(PILOT_META_KEY)).toBe(raw);
  });

  it('rejects when that queued check fails, so the capture is never taken as saved', async () => {
    const { store, raw, intent, failNextAnswerWrite } = await pendingIntent();
    const seen = observedAs(store, [intent]);
    failNextAnswerWrite();
    await expect(drainPilotAnswers({ store: seen.store, owner: OWNER, active: () => true, today: DAY })).rejects.toThrow();
    expect(seen.calls).toEqual([intent]);
    expect(await store.listAnswers()).toEqual([]);
    expect(await store.getMeta(PILOT_META_KEY)).toBe(raw);
  });

  it('a record truly stored is re-checked as an exact no-op, never duplicated', async () => {
    const { store, raw, intent } = await pendingIntent();
    await drainPilotAnswers({ store, owner: OWNER, active: () => true, today: DAY });
    const real = observedAs(store, await store.listAnswers());
    expect(await drainPilotAnswers({ store: real.store, owner: OWNER, active: () => true, today: DAY })).toBe(0);
    expect(real.calls).toEqual([intent]);
    expect(await store.listAnswers()).toEqual([intent]);
    expect(await store.getMeta(PILOT_META_KEY)).toBe(raw);
  });
});

// ---- C. Recorded app versions ----

describe('recorded app_version', () => {
  it('a new record carries the app version; an older record keeps an explicit version or the legacy label it recorded', () => {
    const rec = makePilotAnswer(input());
    expect(rec.app_version).toBe(APP_VERSION);
    for (const version of [LEGACY_LABEL, '0.1.0', '0.2.0-beta.1']) {
      expect([version, isPilotAnswer({ ...rec, app_version: version }, OWNER)]).toEqual([version, true]);
    }
    for (const version of ['', 'unit-a-pilot-capture-2', 'v0.2.0', '0.2', 'capture', 7, null, undefined]) {
      expect([version, isPilotAnswer({ ...rec, app_version: version }, OWNER)]).toEqual([version, false]);
    }
    const unversioned: Record<string, unknown> = { ...rec };
    delete unversioned.app_version;
    expect(isPilotAnswer(unversioned, OWNER)).toBe(false);
  });

  it('a stored legacy-labelled intent drains exactly as recorded, not rebuilt with the current version', async () => {
    const { store, doc } = await pendingIntent();
    const legacy = { ...doc.captures[0]!, app_version: LEGACY_LABEL };
    const raw = JSON.stringify({ ...doc, captures: [legacy] });
    await store.setMeta(PILOT_META_KEY, raw);
    expect(unitAStatus(raw, OWNER, DAY)).not.toBeNull();
    expect(await drainPilotAnswers({ store, owner: OWNER, active: () => true, today: DAY })).toBe(1);
    expect(await store.listAnswers()).toEqual([legacy]);
    expect(await store.getMeta(PILOT_META_KEY)).toBe(raw);
  });
});
