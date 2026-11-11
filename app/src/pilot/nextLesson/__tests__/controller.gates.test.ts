// Next lesson gates: every operation re-reads the owner's real Unit A qualification, context read during the Unit A
// await is honoured, and storage failures, foreign or unknown documents and a reset store all fail closed without
// rewriting or resurrecting anything.
import {
  createNextLessonController,
  NEXT_LESSON_META_KEY,
  type NextLessonController,
  type NextLessonOptions,
  type NextLessonView,
} from '@/pilot/nextLesson/controller';
import { backend, open, qualifiedFixture, type Clock } from '@/pilot/nextLesson/__fixtures__/helpers';
import { PILOT_META_KEY } from '@/pilot/unitA/controller';
import type { Store } from '@/storage/types';

const JAN3 = '2026-01-03';
const JAN4 = '2026-01-04';
const SLOW = 60_000;

type Question = Extract<NextLessonView, { kind: 'question' }>;

/** Mutable test state read through getters, so the controller sees every change when it next looks. */
interface Context {
  active: boolean;
  readOnly: boolean;
  consented: boolean;
  owner: string;
  mode: NextLessonOptions['mode'];
}

const context = (owner: string): Context => ({ active: true, readOnly: false, consented: true, owner, mode: 'developer-demo' });

function controllerFor(store: Store, clock: Clock, ctx: Context): NextLessonController {
  return createNextLessonController({
    store,
    get owner() {
      return ctx.owner;
    },
    get mode() {
      return ctx.mode;
    },
    today: () => clock.day,
    readOnly: () => ctx.readOnly,
    active: () => ctx.active,
    consented: () => ctx.consented,
    assistedToday: async () => false,
    random: () => 0.25,
  });
}

/** Load, then next through the four teaching screens, to the first practice question. */
async function toFirstQuestion(c: NextLessonController): Promise<Question> {
  let view = await c.load();
  for (let i = 0; i < 4; i += 1) {
    if (view.kind !== 'screen') throw new Error(`expected teaching screen ${i + 1}, got ${view.kind}`);
    view = await c.next();
  }
  if (view.kind !== 'question') throw new Error(`expected the first practice question, got ${view.kind}`);
  return view;
}

async function bounded<T>(promise: Promise<T>, what: string, ms = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const OPERATIONS: readonly (readonly [string, (c: NextLessonController, q: Question) => Promise<NextLessonView>])[] = [
  ['load', (c) => c.load()],
  ['next', (c) => c.next()],
  ['answer', (c, q) => c.answer(q.presentationId, q.options[0]?.id ?? null)],
];

test('every load, next and answer re-reads the real Unit A qualification', async () => {
  for (const [name, operation] of OPERATIONS) {
    const f = await qualifiedFixture();
    const c = controllerFor(f.store, f.clock, context(f.owner));
    try {
      const question = await toFirstQuestion(c);
      const own = await f.store.getMeta(NEXT_LESSON_META_KEY);
      expect(own).not.toBeNull();
      await f.store.setMeta(PILOT_META_KEY, null);
      expect(await f.store.getMeta(PILOT_META_KEY)).toBeNull();

      expect({ name, view: await operation(c, question) }).toEqual({ name, view: { kind: 'blocked', reason: 'not-qualified' } });
      expect({ name, own: await f.store.getMeta(NEXT_LESSON_META_KEY) }).toEqual({ name, own });
    } finally {
      c.dispose();
    }
  }

  // An owner who never qualified gets nothing written for them.
  const store = await open(backend());
  const c = controllerFor(store, { day: JAN3 }, context('next-test-owner'));
  try {
    expect(await c.load()).toEqual({ kind: 'blocked', reason: 'not-qualified' });
    expect(await c.next()).toEqual({ kind: 'blocked', reason: 'not-qualified' });
    expect(await c.answer('uc-pres-unknown', null)).toEqual({ kind: 'blocked', reason: 'not-qualified' });
    expect(await store.getMeta(NEXT_LESSON_META_KEY)).toBeNull();
  } finally {
    c.dispose();
  }
}, SLOW);

const FLIPS: readonly (readonly [string, (ctx: Context, clock: Clock) => void])[] = [
  ['active', (ctx) => { ctx.active = false; }],
  ['readOnly', (ctx) => { ctx.readOnly = true; }],
  ['consented', (ctx) => { ctx.consented = false; }],
  ['owner', (ctx) => { ctx.owner = 'someone-else'; }],
  ['mode', (ctx) => { ctx.mode = 'tester'; }],
  ['today', (_ctx, clock) => { clock.day = JAN4; }],
];

test('context changed while the Unit A read is in flight blocks the operation', async () => {
  const results: { flip: string; kind: NextLessonView['kind']; unchanged: boolean }[] = [];
  for (const [flip, change] of FLIPS) {
    const f = await qualifiedFixture();
    const ctx = context(f.owner);
    const c = controllerFor(f.store, f.clock, ctx);
    expect((await c.load()).kind).toBe('screen');
    const own = await f.store.getMeta(NEXT_LESSON_META_KEY);

    const original = f.store.getMeta.bind(f.store);
    let entered: () => void = () => undefined;
    let release: () => void = () => undefined;
    const enteredRead = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    let pauses = 0;
    // Pauses only the first Unit A read of the next operation; every other read passes straight through.
    const spy = jest.spyOn(f.store, 'getMeta').mockImplementation(async (key: string) => {
      if (key === PILOT_META_KEY && pauses === 0) {
        pauses += 1;
        entered();
        await released;
      }
      return original(key);
    });
    try {
      const pending = c.next();
      pending.catch(() => undefined);
      await bounded(enteredRead, `${flip}: Unit A read`);
      change(ctx, f.clock);
      release();
      const view = await bounded(pending, `${flip}: next()`);
      results.push({ flip, kind: view.kind, unchanged: (await original(NEXT_LESSON_META_KEY)) === own });
      expect(pauses).toBe(1);
    } finally {
      release();
      spy.mockRestore();
      c.dispose();
    }
  }
  expect(results).toEqual(FLIPS.map(([flip]) => ({ flip, kind: 'blocked', unchanged: true })));
}, SLOW);

test('write failures, unknown documents and a reset store fail closed', async () => {
  const f = await qualifiedFixture();
  const c = controllerFor(f.store, f.clock, context(f.owner));
  try {
    const first = await c.load();
    expect(first.kind).toBe('screen');
    const bytes = f.kv.raw();
    const own = await f.store.getMeta(NEXT_LESSON_META_KEY);
    if (own === null) throw new Error('the first screen was shown without a stored document');

    // A failed advancement rejects and leaves everything as it was; once writes work, a reload resumes there.
    f.kv.failWrites = true;
    await expect(c.next()).rejects.toThrow();
    expect(f.kv.raw()).toBe(bytes);
    expect(await f.store.getMeta(NEXT_LESSON_META_KEY)).toBe(own);
    f.kv.failWrites = false;
    expect(await c.load()).toEqual(first);
    expect(await f.store.getMeta(NEXT_LESSON_META_KEY)).toBe(own);

    // Clones of the real document that this controller must not read as its own, nor repair.
    const doc = JSON.parse(own) as { helpDays: string[]; contentVersion: string };
    const variants: readonly (readonly [string, string])[] = [
      ['foreign owner', JSON.stringify({ ...doc, owner: 'someone-else' })],
      ['schema', JSON.stringify({ ...doc, schema: 2 })],
      ['version', JSON.stringify({ ...doc, contentVersion: `${doc.contentVersion}-other` })],
      ['future help day', JSON.stringify({ ...doc, helpDays: [...doc.helpDays, JAN4] })],
      ['corrupt JSON', own.slice(0, -1)],
    ];
    for (const [name, raw] of variants) {
      await f.store.setMeta(NEXT_LESSON_META_KEY, raw);
      const view = await c.load();
      expect({ name, kind: view.kind, raw: await f.store.getMeta(NEXT_LESSON_META_KEY) }).toEqual({ name, kind: 'blocked', raw });
    }
    await f.store.setMeta(NEXT_LESSON_META_KEY, own);

    // After a real reset the old controller can bring back neither its document nor Unit A.
    await f.store.reset();
    expect(await c.load()).toEqual({ kind: 'blocked', reason: 'not-qualified' });
    expect(await c.next()).toEqual({ kind: 'blocked', reason: 'not-qualified' });
    expect(await c.answer('uc-pres-unknown', null)).toEqual({ kind: 'blocked', reason: 'not-qualified' });
    expect(await f.store.getMeta(NEXT_LESSON_META_KEY)).toBeNull();
    expect(await f.store.getMeta(PILOT_META_KEY)).toBeNull();
  } finally {
    c.dispose();
  }
}, SLOW);
