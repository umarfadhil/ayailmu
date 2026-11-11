/**
 * @jest-environment node
 */
// Opt-in pilot answer capture: a truthful AnswerRecord per fresh first choice, saved as an intent with that choice in
// the pilot document and then appended once to the real KvStore under the exact committed metadata. The capture
// module and Controller.captureStatus are loaded lazily, so missing behavior fails each case, not compilation.
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import { PILOT_CONTENT, type PilotItem } from '../content';
import { createPilotController, PILOT_META_KEY, type PilotControllerOptions, type PilotView } from '../controller';

interface CaptureInput {
  owner: string;
  learnerId: string;
  presentationId: string;
  itemId: string;
  optionId: string | null;
  optionOrder: string[];
  day: string;
  timestamp: string;
}
interface CaptureModule {
  makePilotAnswer(input: CaptureInput): AnswerRecord;
  isPilotAnswer(record: unknown, owner?: string): boolean;
  drainPilotAnswers(args: { store: KvStore; owner: string; active: () => boolean }): Promise<number>;
}
type CaptureOption = { learnerId: string; now: () => string; active: () => boolean };
type Controller = ReturnType<typeof createPilotController>;
type Question = Extract<PilotView, { kind: 'question' }>;

const capture = (): CaptureModule => jest.requireActual<CaptureModule>('../capture');

function statusOf(controller: Controller): 'off' | 'saved' | 'pending' {
  const method = (controller as Controller & { captureStatus?: () => 'off' | 'saved' | 'pending' }).captureStatus;
  if (typeof method !== 'function') throw new Error('Controller.captureStatus is not implemented.');
  return method.call(controller);
}

const OWNER = 'pilot-owner-1';
const OTHER_OWNER = 'pilot-owner-2';
const LEARNER_ID = 'lrn-pilot-1';
const DAY = '2026-10-27';
const T1 = '2026-10-27T03:15:42.123Z';
const T2 = '2026-10-27T04:20:00.000Z';
const OTHER_KEY = 'synthetic.other';
const OTHER_RAW = '{ "kept" : true }';
/** Valid JSON whose bytes a re-serialization would change. */
const SNAPSHOT_RAW = '{ "session_id":"pilot-ses-1", "phase" : "step",\n  "index": 3, "note":"\\u00e9" }';
const DOC_KEYS = ['owner', 'schema', 'contentVersion', 'policyVersion', 'attempts', 'current', 'presentations', 'lessons'];

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

const itemOf = (id: string): PilotItem => {
  const item = PILOT_CONTENT.items.find((i) => i.id === id);
  if (item === undefined) throw new Error(`fixture item ${id} missing`);
  return item;
};
const keyOf = (item: PilotItem) => item.options.find((o) => o.correct)!;
const wrongOf = (item: PilotItem) => item.options.find((o) => !o.correct)!;

const input = (over: Partial<CaptureInput> = {}): CaptureInput => ({
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

/** Throwing or producing no record both count as a refusal. */
function refused(make: () => unknown): boolean {
  try {
    const out = make();
    return out === null || out === undefined || typeof out !== 'object';
  } catch {
    return true;
  }
}

// ---- Real KvStore harness: answer writes can fail at the backend, the store can be reopened ----

const answerCount = (text: string | null): number => (text ? (JSON.parse(text).answers as unknown[]).length : 0);

async function harness() {
  const kv = memoryKv();
  let failAnswerWrites = 0;
  const backend: KvBackend = {
    getItem: (k) => kv.getItem(k),
    removeItem: (k) => kv.removeItem(k),
    setItem: (k, v) => {
      if (failAnswerWrites > 0 && k === KvStore.KEY && answerCount(v) > answerCount(kv.getItem(k))) {
        failAnswerWrites -= 1;
        throw new Error('simulated quota failure');
      }
      kv.setItem(k, v);
    },
  };
  const open = async () => {
    const s = new KvStore(backend);
    await s.init();
    return s;
  };
  const first = await open();
  await first.saveLearner(learner);
  await first.setMeta(OTHER_KEY, OTHER_RAW);
  const blob = JSON.parse(kv.getItem(KvStore.KEY)!);
  blob.snapshot = SNAPSHOT_RAW;
  kv.setItem(KvStore.KEY, JSON.stringify(blob));
  return {
    store: await open(),
    open,
    failNextAnswerWrite: () => {
      failAnswerWrites = 1;
    },
  };
}

/** Delegates to the real store; `before` runs once as appendAnswer is called. */
function onAppend(store: KvStore, before: () => void): KvStore {
  let pending: (() => void) | null = before;
  return new Proxy(store, {
    get(target, prop) {
      if (prop === 'appendAnswer') {
        return (record: AnswerRecord, guard: Parameters<KvStore['appendAnswer']>[1]) => {
          const hook = pending;
          pending = null;
          hook?.();
          return target.appendAnswer(record, guard);
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

let clock = T1;
function controller(store: KvStore, withCapture: CaptureOption | false = { learnerId: LEARNER_ID, now: () => clock, active: () => true }) {
  const options: PilotControllerOptions & { capture?: CaptureOption } = {
    store,
    owner: OWNER,
    mode: 'developer-demo',
    today: () => DAY,
    readOnly: () => false,
    active: () => true,
    assistedToday: async () => false,
    random: () => 0.5,
    ...(withCapture ? { capture: withCapture } : {}),
  };
  return createPilotController(options as PilotControllerOptions);
}

async function firstQuestion(c: Controller): Promise<Question> {
  expect((await c.load()).kind).toBe('lesson');
  const q = await c.next();
  if (q.kind !== 'question') throw new Error(`expected a question, got ${q.kind}`);
  return q;
}

async function docOf(store: KvStore): Promise<Record<string, unknown> & { captures?: AnswerRecord[] }> {
  const raw = await store.getMeta(PILOT_META_KEY);
  if (raw === null) throw new Error('no pilot document');
  return JSON.parse(raw);
}

beforeEach(() => {
  clock = T1;
});

// ---- makePilotAnswer ----

describe('makePilotAnswer', () => {
  it('records the actual practice item, shown order, choice, position and first-choice time with explicit provenance', () => {
    const item = itemOf('ua-d01-ref-p01');
    const rec = capture().makePilotAnswer(input());
    const text = new Map(item.options.map((o) => [o.id, o.text]));
    expect(rec).toMatchObject({
      learner_id: LEARNER_ID,
      item_id: item.id,
      content_version: PILOT_CONTENT.contentVersion,
      timestamp: T1,
      local_date: DAY,
      pool: 'PRACT',
      unit: 'A',
      outcome: 'correct',
      first_attempt: true,
      fresh_evidence: false,
      retention_valid: false,
      time_on_item_ms: 0,
      review_status: 'draft',
      synthetic: true,
      answer_schema: 2,
      evidence_mode: 'recognition-4',
      selected_option_id: 'b',
      selected_position: 3,
    });
    expect(rec.presented_options).toEqual(['c', 'a', 'd', 'b'].map((id, position) => ({ id, text: text.get(id), position })));
    expect((rec as unknown as { pilot_capture: unknown }).pilot_capture).toEqual({
      version: 1,
      owner: OWNER,
      presentation_id: 'ua-pres-fixture-1',
      phase: 'practice',
      content_fingerprint: expect.any(String),
      duration: 'unmeasured',
    });

    // Stable per owner + content version + presentation; never per call.
    const id = rec.answer_id;
    expect(typeof id === 'string' && id.length > 0).toBe(true);
    expect(capture().makePilotAnswer(input()).answer_id).toBe(id);
    expect(capture().makePilotAnswer(input()).answer_id).toBe(id);
    expect(capture().makePilotAnswer(input({ owner: OTHER_OWNER })).answer_id).not.toBe(id);
    expect(capture().makePilotAnswer(input({ presentationId: 'ua-pres-fixture-2' })).answer_id).not.toBe(id);
    expect(capture().makePilotAnswer(input({ optionId: 'a' })).answer_id).toBe(id);
    expect(capture().makePilotAnswer(input())).toEqual(rec);
  });

  it('keys wrong and "I don\'t know" practice outcomes; a null choice has no selected option or position', () => {
    const item = itemOf('ua-d01-agr-p02');
    const order = item.options.map((o) => o.id).reverse();
    const wrong = capture().makePilotAnswer(input({ itemId: item.id, optionOrder: order, optionId: wrongOf(item).id }));
    expect(wrong.outcome).toBe('wrong');
    expect(wrong.selected_position).toBe(order.indexOf(wrongOf(item).id));
    const unknown = capture().makePilotAnswer(input({ itemId: item.id, optionOrder: order, optionId: null }));
    expect(unknown).toMatchObject({ outcome: 'dont_know', selected_option_id: null, selected_position: null, pool: 'PRACT' });
    expect(unknown.presented_options?.map((o) => o.id)).toEqual(order);
  });

  it.each([
    ['transfer', 'ua-d01-ref-t01', 'TRANS'],
    ['d7', 'ua-d01-ref-d7-01', 'D7'],
    ['d30', 'ua-d01-agr-d30-02', 'D30'],
  ] as const)('a held-out %s answer is pending and deferred, with no key, explanation or invented score', (phase, itemId, pool) => {
    const item = itemOf(itemId);
    const order = item.options.map((o) => o.id);
    for (const optionId of [keyOf(item).id, wrongOf(item).id, null]) {
      const rec = capture().makePilotAnswer(input({ itemId, optionOrder: order, optionId }));
      expect(rec).toMatchObject({
        item_id: itemId,
        pool,
        outcome: 'pending',
        auto_score: {},
        feedback_deferred: true,
        fresh_evidence: false,
        retention_valid: false,
        time_on_item_ms: 0,
        error_tags: [],
        serious_tag: null,
        selected_option_id: optionId,
      });
      expect((rec as unknown as { pilot_capture: { phase: string } }).pilot_capture.phase).toBe(phase);
      const json = JSON.stringify(rec);
      for (const o of item.options) expect(json).not.toContain(o.feedback);
      expect(json).not.toMatch(/"correct"|keyed|correct_option|explanation/);
      expect(rec.misconceptions ?? []).toEqual([]);
    }
  });

  it('refuses an invalid owner, learner, item, option, order, day or non-canonical timestamp', () => {
    const { makePilotAnswer } = capture();
    const bad: Partial<CaptureInput>[] = [
      { owner: '' },
      { owner: 7 as unknown as string },
      { learnerId: '' },
      { presentationId: '' },
      { itemId: 'ua-d01-ref-p99' },
      { optionId: 'e' },
      { optionId: '' },
      { optionOrder: ['a', 'b', 'c'] },
      { optionOrder: ['a', 'b', 'c', 'c'] },
      { optionOrder: ['a', 'b', 'c', 'e'] },
      { optionOrder: ['a', 'b', 'c', 'd', 'e'] },
      { day: '2026-02-30' },
      { day: '27-10-2026' },
      { timestamp: '2026-10-27T03:15:42Z' },
      { timestamp: '2026-10-27T10:15:42.123+07:00' },
      { timestamp: 'not a time' },
    ];
    expect(refused(() => makePilotAnswer(input()))).toBe(false);
    for (const over of bad) expect([over, refused(() => makePilotAnswer(input(over)))]).toEqual([over, true]);
  });
});

// ---- isPilotAnswer ----

describe('isPilotAnswer', () => {
  it('accepts its own record, filtered by owner; refuses legacy records and non-records', () => {
    const { makePilotAnswer, isPilotAnswer } = capture();
    const rec = makePilotAnswer(input());
    expect(isPilotAnswer(rec)).toBe(true);
    expect(isPilotAnswer(rec, OWNER)).toBe(true);
    expect(isPilotAnswer(rec, OTHER_OWNER)).toBe(false);
    expect(isPilotAnswer(JSON.parse(JSON.stringify(rec)), OWNER)).toBe(true);
    const legacy: Record<string, unknown> = JSON.parse(JSON.stringify(rec));
    delete legacy.pilot_capture;
    expect(isPilotAnswer(legacy)).toBe(false);
    for (const v of [null, undefined, 'x', 3, [], [rec]]) expect(isPilotAnswer(v)).toBe(false);
  });

  it('refuses forged, altered or malformed lookalikes', () => {
    const { makePilotAnswer, isPilotAnswer } = capture();
    const practice = makePilotAnswer(input());
    const held = makePilotAnswer(input({ itemId: 'ua-d01-ref-t01', optionOrder: ['a', 'b', 'c', 'd'], optionId: 'b' }));
    const marker = (practice as unknown as { pilot_capture: Record<string, unknown> }).pilot_capture;
    const forge = (base: AnswerRecord, over: Record<string, unknown>) => ({ ...JSON.parse(JSON.stringify(base)), ...over });
    const forged: [string, unknown][] = [
      ['answer_id', forge(practice, { answer_id: 'pilot-forged-1' })],
      ['item_id', forge(practice, { item_id: 'ua-d01-ref-p02' })],
      ['content_version', forge(practice, { content_version: 'unit-a-pilot-draft-0.2' })],
      ['pool', forge(practice, { pool: 'TRANS' })],
      ['outcome', forge(practice, { outcome: 'wrong' })],
      ['selected_option_id', forge(practice, { selected_option_id: 'a' })],
      ['selected_position', forge(practice, { selected_position: 0 })],
      ['option text', forge(practice, { presented_options: practice.presented_options!.map((o, i) => (i ? o : { ...o, text: 'x' })) })],
      ['option positions', forge(practice, { presented_options: practice.presented_options!.map((o) => ({ ...o, position: 3 - o.position })) })],
      ['fresh_evidence', forge(practice, { fresh_evidence: true })],
      ['retention_valid', forge(practice, { retention_valid: undefined })],
      ['time_on_item_ms', forge(practice, { time_on_item_ms: 3100 })],
      ['review_status', forge(practice, { review_status: 'approved-for-trial' })],
      ['synthetic', forge(practice, { synthetic: false })],
      ['timestamp', forge(practice, { timestamp: '2026-10-27T03:15:42Z' })],
      ['unknown field', forge(practice, { verdict: 'mastered' })],
      ['marker version', forge(practice, { pilot_capture: { ...marker, version: 2 } })],
      ['marker owner', forge(practice, { pilot_capture: { ...marker, owner: OTHER_OWNER } })],
      ['marker presentation', forge(practice, { pilot_capture: { ...marker, presentation_id: 'ua-pres-other' } })],
      ['marker phase', forge(practice, { pilot_capture: { ...marker, phase: 'transfer' } })],
      ['marker fingerprint', forge(practice, { pilot_capture: { ...marker, content_fingerprint: 'forged' } })],
      ['marker duration', forge(practice, { pilot_capture: { ...marker, duration: 3100 } })],
      ['marker extra field', forge(practice, { pilot_capture: { ...marker, verified: true } })],
      ['marker not an object', forge(practice, { pilot_capture: 'v1' })],
      ['held-out graded', forge(held, { outcome: 'correct', auto_score: { choice: 'correct' } })],
      ['held-out feedback shown', forge(held, { feedback_deferred: false })],
      ['held-out pool', forge(held, { pool: 'PRACT' })],
    ];
    expect(isPilotAnswer(practice, OWNER) && isPilotAnswer(held, OWNER)).toBe(true);
    for (const [what, record] of forged) expect([what, isPilotAnswer(record)]).toEqual([what, false]);
  });
});

// ---- Controller capture over the real KvStore ----

describe('controller capture', () => {
  it('stays off by default: the developer document keeps its exact keys, nothing is appended or drained', async () => {
    const h = await harness();
    const c = controller(h.store, false);
    const q = await firstQuestion(c);
    expect((await c.answer(q.presentationId, keyOf(itemOf(q.itemId)).id)).kind).toBe('feedback');
    expect(statusOf(c)).toBe('off');
    const raw = await h.store.getMeta(PILOT_META_KEY);
    expect(Object.keys(JSON.parse(raw!)).sort()).toEqual([...DOC_KEYS].sort());
    expect(await capture().drainPilotAnswers({ store: h.store, owner: OWNER, active: () => true })).toBe(0);
    expect(await h.store.listAnswers()).toEqual([]);
    expect(await h.store.getMeta(PILOT_META_KEY)).toBe(raw);
  });

  it('a fresh first choice saves one intent with it and appends exactly that answer, keeping snapshot bytes across reopen', async () => {
    const h = await harness();
    const c = controller(h.store);
    const q = await firstQuestion(c);
    const item = itemOf(q.itemId);
    const chosen = wrongOf(item).id;
    const view = await c.answer(q.presentationId, chosen);
    expect(view).toMatchObject({ kind: 'feedback', presentationId: q.presentationId, outcome: 'wrong' });
    expect(statusOf(c)).toBe('saved');

    const doc = await docOf(h.store);
    expect(Object.keys(doc).sort()).toEqual([...DOC_KEYS, 'captures'].sort());
    expect(doc.captures).toHaveLength(1);
    const expected = capture().makePilotAnswer({
      owner: OWNER,
      learnerId: LEARNER_ID,
      presentationId: q.presentationId,
      itemId: q.itemId,
      optionId: chosen,
      optionOrder: q.options.map((o) => o.id),
      day: DAY,
      timestamp: T1,
    });
    expect(doc.captures![0]).toEqual(expected);
    expect(capture().isPilotAnswer(doc.captures![0], OWNER)).toBe(true);
    expect(await h.store.listAnswers()).toEqual([expected]);
    expect(await h.store.loadSnapshotRaw()).toBe(SNAPSHOT_RAW);
    expect(await h.store.getMeta(OTHER_KEY)).toBe(OTHER_RAW);

    const reopened = await h.open();
    clock = T2;
    const again = controller(reopened);
    expect(await again.load()).toMatchObject({ kind: 'feedback', presentationId: q.presentationId });
    expect(await reopened.listAnswers()).toEqual([expected]);
    expect(await reopened.loadSnapshotRaw()).toBe(SNAPSHOT_RAW);
    expect((await docOf(reopened)).captures).toEqual([expected]);
  });

  it('a failed append keeps the saved choice and its feedback; a later load appends the same payload exactly once', async () => {
    const h = await harness();
    const c = controller(h.store);
    const q = await firstQuestion(c);
    const key = keyOf(itemOf(q.itemId)).id;
    h.failNextAnswerWrite();
    const view = await c.answer(q.presentationId, key);
    expect(view).toMatchObject({ kind: 'feedback', presentationId: q.presentationId, outcome: 'correct' });
    expect(statusOf(c)).toBe('pending');
    expect(await h.store.listAnswers()).toEqual([]);
    const doc = await docOf(h.store);
    expect(doc.attempts).toEqual([{ presentationId: q.presentationId, itemId: q.itemId, optionId: key }]);
    expect(doc.captures).toHaveLength(1);
    const intent = doc.captures![0];
    expect(intent.timestamp).toBe(T1);

    clock = T2;
    expect(await c.load()).toMatchObject({ kind: 'feedback', presentationId: q.presentationId });
    expect(statusOf(c)).toBe('saved');
    expect(await h.store.listAnswers()).toEqual([intent]);
    expect((await h.store.listAnswers())[0].timestamp).toBe(T1);
    expect((await docOf(h.store)).captures).toEqual([intent]);

    await c.load();
    expect(await capture().drainPilotAnswers({ store: h.store, owner: OWNER, active: () => true })).toBe(0);
    const reopened = await h.open();
    await controller(reopened).load();
    expect(await reopened.listAnswers()).toEqual([intent]);
  });

  it('opting in over older developer history backfills nothing; only the next fresh first choice is captured', async () => {
    const h = await harness();
    const dev = controller(h.store, false);
    const q1 = await firstQuestion(dev);
    await dev.answer(q1.presentationId, keyOf(itemOf(q1.itemId)).id);
    const raw = await h.store.getMeta(PILOT_META_KEY);
    expect(await capture().drainPilotAnswers({ store: h.store, owner: OWNER, active: () => true })).toBe(0);

    const c = controller(h.store);
    expect(await c.load()).toMatchObject({ kind: 'feedback', presentationId: q1.presentationId });
    expect(await h.store.getMeta(PILOT_META_KEY)).toBe(raw);
    expect(await c.answer(q1.presentationId, keyOf(itemOf(q1.itemId)).id)).toMatchObject({ kind: 'feedback' });
    expect(await h.store.getMeta(PILOT_META_KEY)).toBe(raw);
    expect(await h.store.listAnswers()).toEqual([]);

    const q2 = await c.next();
    if (q2.kind !== 'question') throw new Error(`expected a question, got ${q2.kind}`);
    await c.answer(q2.presentationId, null);
    const answers = await h.store.listAnswers();
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ item_id: q2.itemId, outcome: 'dont_know', selected_option_id: null, timestamp: T1 });
    expect((answers[0] as unknown as { pilot_capture: { presentation_id: string } }).pilot_capture.presentation_id).toBe(q2.presentationId);
    expect((await docOf(h.store)).captures).toEqual(answers);
  });

  it('a duplicate choice, reopen or next creates no new intent and no duplicate answer', async () => {
    const h = await harness();
    const c = controller(h.store);
    const q = await firstQuestion(c);
    const key = keyOf(itemOf(q.itemId)).id;
    const first = await c.answer(q.presentationId, key);
    const raw = await h.store.getMeta(PILOT_META_KEY);
    const stored = await h.store.listAnswers();
    expect(stored).toHaveLength(1);

    clock = T2;
    expect(await c.answer(q.presentationId, key)).toEqual(first);
    await expect(c.answer(q.presentationId, wrongOf(itemOf(q.itemId)).id)).rejects.toThrow();
    expect(await h.store.getMeta(PILOT_META_KEY)).toBe(raw);
    const reopened = await h.open();
    const again = controller(reopened);
    expect(await again.load()).toEqual(first);
    expect(await again.answer(q.presentationId, key)).toEqual(first);
    expect((await again.next()).kind).toBe('question');
    expect((await docOf(reopened)).captures).toEqual(stored);
    expect(await reopened.listAnswers()).toEqual(stored);
  });

  it('liveness lost during the append writes no account answer and keeps the saved local intent', async () => {
    const h = await harness();
    let live = true;
    const store = onAppend(h.store, () => {
      live = false;
    });
    const c = controller(store, { learnerId: LEARNER_ID, now: () => clock, active: () => live });
    const q = await firstQuestion(c);
    expect(await c.answer(q.presentationId, keyOf(itemOf(q.itemId)).id)).toMatchObject({ kind: 'feedback' });
    expect(await h.store.listAnswers()).toEqual([]);
    expect(statusOf(c)).toBe('pending');
    const intents = (await docOf(h.store)).captures;
    expect(intents).toHaveLength(1);

    await c.load();
    expect(await h.store.listAnswers()).toEqual([]);
    live = true;
    await c.load();
    expect(await h.store.listAnswers()).toEqual(intents);
    expect(statusOf(c)).toBe('saved');
  });

  it('a reset fences a pending intent: nothing is resurrected, even after the same learner returns', async () => {
    const h = await harness();
    const c = controller(h.store);
    const q = await firstQuestion(c);
    h.failNextAnswerWrite();
    await c.answer(q.presentationId, keyOf(itemOf(q.itemId)).id);
    expect(statusOf(c)).toBe('pending');

    await h.store.reset();
    await h.store.saveLearner(learner);
    expect(await c.load()).toEqual({ kind: 'blocked', reason: 'owner' });
    expect(await capture().drainPilotAnswers({ store: h.store, owner: OWNER, active: () => true })).toBe(0);
    expect(await h.store.listAnswers()).toEqual([]);
    expect(await h.store.getMeta(PILOT_META_KEY)).toBeNull();
    const reopened = await h.open();
    expect(await reopened.listAnswers()).toEqual([]);
  });
});
