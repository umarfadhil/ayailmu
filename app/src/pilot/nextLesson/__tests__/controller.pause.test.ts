// Next lesson controller, pause (route Back): unlike load it never settles, advances, answers or presents, so a
// newly eligible transfer task is never created by leaving. It records today as a help day only for teaching, a
// practice question or its feedback already on display. A pause requested while active may finish after the route
// blurs; every other guard stays authoritative. Driven over the real KvStore of a fixture qualified by the actual
// Unit A controller (no module mocks, no gate state written by hand). Local engineering only — no pedagogy claim.
import type { KvStore } from '@/storage/kvStore';
import { PILOT_META_KEY } from '@/pilot/unitA/controller';
import { qualifiedFixture, type Clock, type Kv, type QualifiedFixture } from '../__fixtures__/helpers';
import {
  createNextLessonController,
  NEXT_LESSON_META_KEY,
  type NextLessonController,
  type NextLessonOptions,
  type NextLessonView,
} from '../controller';

type Feedback = Extract<NextLessonView, { kind: 'feedback' }>;
interface Doc {
  presentations: { presentationId: string; itemId: string; shown: string; optionOrder: string[]; answered: string | null }[];
  attempts: { presentationId: string; itemId: string; optionId: string | null }[];
  current: { presentationId: string; itemId: string; day: string } | null;
  helpDays: string[];
}

const JAN3 = '2026-01-03';
const JAN4 = '2026-01-04';
const JAN5 = '2026-01-05';
const JAN6 = '2026-01-06';
const SCREEN_COUNT = 4;
const PRACTICE_COUNT = 6;
const SLOW = 60_000;

/** Mutable test state read through getters, so the controller sees every change when it next looks. */
interface Context {
  active: boolean;
  readOnly: boolean;
  consented: boolean;
  owner: string;
  mode: NextLessonOptions['mode'];
  assisted: boolean;
  /** How many times the assistance check was read. */
  reads: number;
}

const context = (owner: string): Context => ({
  active: true, readOnly: false, consented: true, owner, mode: 'developer-demo', assisted: false, reads: 0,
});

function controllerFor(f: QualifiedFixture, clock: Clock, ctx: Context): NextLessonController {
  let seed = 11;
  return createNextLessonController({
    store: f.store,
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
    assistedToday: async () => {
      ctx.reads += 1;
      return ctx.assisted;
    },
    random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
  });
}

function blob(kv: Kv): { meta?: Record<string, string> } {
  const text = kv.raw();
  if (text === null) throw new Error('nothing stored');
  return JSON.parse(text);
}

/** This controller's metadata exactly as written to the backend. */
function storedRaw(kv: Kv): string {
  const raw = blob(kv).meta?.[NEXT_LESSON_META_KEY];
  if (raw === undefined) throw new Error('no next lesson metadata stored');
  return raw;
}

const doc = (kv: Kv): Doc => JSON.parse(storedRaw(kv)) as Doc;
const helpDays = (kv: Kv): string[] => doc(kv).helpDays;

/** Everything stored except this controller's own metadata: Unit A state, answers, snapshot, learner, reports. */
function withoutNextLesson(kv: Kv): unknown {
  const stored = blob(kv);
  const meta = { ...(stored.meta ?? {}) };
  delete meta[NEXT_LESSON_META_KEY];
  return { ...stored, meta };
}

/** Jan 3: the four screens, then all six practice tasks answered with their first displayed option; returns the last feedback, still on display. */
async function throughPractice(c: NextLessonController): Promise<Feedback> {
  let view = await c.load();
  for (let step = 0; step < SCREEN_COUNT; step += 1) {
    if (view.kind !== 'screen') throw new Error(`expected teaching screen ${step + 1}, got ${view.kind}`);
    view = await c.next();
  }
  let feedback: Feedback | null = null;
  for (let index = 0; index < PRACTICE_COUNT; index += 1) {
    if (index > 0) view = await c.next();
    if (view.kind !== 'question' || view.phase !== 'practice') throw new Error(`expected practice ${index + 1}, got ${view.kind}`);
    const first = view.options[0];
    if (first === undefined) throw new Error('a practice question displayed no options');
    const answered = await c.answer(view.presentationId, first.id);
    if (answered.kind !== 'feedback') throw new Error(`expected feedback ${index + 1}, got ${answered.kind}`);
    feedback = answered;
  }
  if (feedback === null) throw new Error('no practice feedback');
  return feedback;
}

/** Holds the first Unit A read made after this call until released; every other read passes straight through. */
function holdUnitARead(store: KvStore) {
  const original = store.getMeta.bind(store);
  let entered: () => void = () => undefined;
  let release: () => void = () => undefined;
  const enteredRead = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  let holds = 0;
  const spy = jest.spyOn(store, 'getMeta').mockImplementation(async (key: string) => {
    if (key === PILOT_META_KEY && holds === 0) {
      holds += 1;
      entered();
      await released;
    }
    return original(key);
  });
  return {
    enteredRead,
    release: () => release(),
    holds: () => holds,
    restore: () => {
      release();
      spy.mockRestore();
    },
  };
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

describe('next lesson controller (pause)', () => {
  it('awaiting transfer on a newly eligible day: pause presents nothing and changes no byte', async () => {
    const f = await qualifiedFixture();
    const ctx = context(f.owner);
    const c = controllerFor(f, f.clock, ctx);
    try {
      await throughPractice(c);
      expect(await c.next()).toEqual({ kind: 'awaiting-transfer', until: JAN4 });

      // Help elsewhere on Jan 4 moves transfer to Jan 5.
      f.clock.day = JAN4;
      ctx.assisted = true;
      expect(await c.load()).toEqual({ kind: 'awaiting-transfer', until: JAN5 });
      const bytes = f.kv.raw();
      const waiting = doc(f.kv);
      const ids = waiting.presentations.map((p) => p.presentationId);
      expect(ids).toHaveLength(PRACTICE_COUNT);
      expect(waiting.current).toBeNull();

      // Jan 5 is unassisted, so an ordinary load would now present a transfer task; pause must not.
      f.clock.day = JAN5;
      ctx.assisted = false;
      const reads = ctx.reads;
      await expect(c.pause()).resolves.toBeUndefined();
      expect(f.kv.raw()).toBe(bytes);
      const after = doc(f.kv);
      expect(after).toEqual(waiting);
      expect(after.presentations.map((p) => p.presentationId)).toEqual(ids);
      expect(after.presentations).toHaveLength(PRACTICE_COUNT);
      expect(after.attempts).toHaveLength(PRACTICE_COUNT);
      expect(after.current).toBeNull();
      expect(ctx.reads).toBe(reads);
    } finally {
      c.dispose();
    }
  }, SLOW);

  it('final practice feedback still on display: pause records only today as help, and load then resumes the same feedback', async () => {
    const f = await qualifiedFixture();
    const unitA = withoutNextLesson(f.kv);
    const ctx = context(f.owner);
    const c = controllerFor(f, f.clock, ctx);
    try {
      const feedback = await throughPractice(c);
      const seeded = doc(f.kv);
      expect(seeded.helpDays).toEqual([JAN3]);
      expect(seeded.presentations).toHaveLength(PRACTICE_COUNT);
      expect(seeded.attempts).toHaveLength(PRACTICE_COUNT);
      expect(seeded.current).toEqual({ presentationId: feedback.presentationId, itemId: feedback.itemId, day: JAN3 });

      f.clock.day = JAN4;
      const reads = ctx.reads;
      await expect(c.pause()).resolves.toBeUndefined();
      expect(helpDays(f.kv)).toEqual([JAN3, JAN4]);
      const paused = doc(f.kv);
      expect(paused).toEqual({ ...seeded, helpDays: [JAN3, JAN4] });
      expect(paused.presentations).toEqual(seeded.presentations);
      expect(paused.attempts).toEqual(seeded.attempts);
      expect(paused.current).toEqual(seeded.current);
      expect(ctx.reads).toBe(reads);
      expect(withoutNextLesson(f.kv)).toEqual(unitA);

      // The same feedback resumes with its presentation and days untouched; only an explicit next moves on.
      const raw = storedRaw(f.kv);
      expect(await c.load()).toEqual(feedback);
      expect(storedRaw(f.kv)).toBe(raw);
      expect(await c.next()).toEqual({ kind: 'awaiting-transfer', until: JAN5 });
      expect(doc(f.kv)).toEqual({ ...paused, current: null });
    } finally {
      c.dispose();
    }
  }, SLOW);

  it('a pause requested while active finishes after the route blurs; inactive, foreign, disposed and reset still guard', async () => {
    const f = await qualifiedFixture();
    const ctx = context(f.owner);
    const c = controllerFor(f, f.clock, ctx);
    try {
      await throughPractice(c);
      const seeded = doc(f.kv);
      expect(seeded.helpDays).toEqual([JAN3]);

      // Requested while active on Jan 4; the route blurs while its Unit A read is in flight.
      f.clock.day = JAN4;
      const held = holdUnitARead(f.store);
      try {
        const pending = c.pause();
        pending.catch(() => undefined);
        await bounded(Promise.race([held.enteredRead, pending]), 'pause: Unit A read');
        ctx.active = false;
        held.release();
        await expect(bounded(pending, 'pause()')).resolves.toBeUndefined();
        expect(helpDays(f.kv)).toEqual([JAN3, JAN4]);
        expect(doc(f.kv)).toEqual({ ...seeded, helpDays: [JAN3, JAN4] });
        expect(held.holds()).toBe(1);
      } finally {
        held.restore();
      }
      const flushed = storedRaw(f.kv);

      // Requested when already inactive: nothing, on a day the feedback would otherwise be recorded.
      f.clock.day = JAN5;
      await c.pause();
      expect(storedRaw(f.kv)).toBe(flushed);
      ctx.active = true;

      // Every other guard changed while the Unit A read is in flight still blocks the pause.
      const flips: readonly (readonly [string, () => void])[] = [
        ['readOnly', () => { ctx.readOnly = true; }],
        ['consented', () => { ctx.consented = false; }],
        ['owner', () => { ctx.owner = 'someone-else'; }],
        ['mode', () => { ctx.mode = 'tester'; }],
        ['today', () => { f.clock.day = JAN6; }],
      ];
      for (const [flip, change] of flips) {
        Object.assign(ctx, context(f.owner), { reads: ctx.reads });
        f.clock.day = JAN5;
        const inFlight = holdUnitARead(f.store);
        try {
          const pending = c.pause();
          pending.catch(() => undefined);
          await bounded(Promise.race([inFlight.enteredRead, pending]), `${flip}: Unit A read`);
          change();
          inFlight.release();
          await bounded(pending.catch(() => undefined), `${flip}: pause()`);
          expect({ flip, raw: storedRaw(f.kv) }).toEqual({ flip, raw: flushed });
        } finally {
          inFlight.restore();
        }
      }
      Object.assign(ctx, context(f.owner), { reads: ctx.reads });
      f.clock.day = JAN5;

      // A controller disposed while its pause is in flight writes nothing.
      const other = controllerFor(f, f.clock, context(f.owner));
      const inFlight = holdUnitARead(f.store);
      try {
        const pending = other.pause();
        pending.catch(() => undefined);
        await bounded(Promise.race([inFlight.enteredRead, pending]), 'disposed: Unit A read');
        other.dispose();
        inFlight.release();
        await bounded(pending.catch(() => undefined), 'disposed: pause()');
        expect(storedRaw(f.kv)).toBe(flushed);
      } finally {
        inFlight.restore();
        other.dispose();
      }

      // A foreign owner's document under this key is neither read as this owner's nor rewritten.
      const foreign = JSON.stringify({ ...JSON.parse(flushed), owner: 'someone-else' });
      await f.store.setMeta(NEXT_LESSON_META_KEY, foreign);
      await c.pause().catch(() => undefined);
      expect(storedRaw(f.kv)).toBe(foreign);
      await f.store.setMeta(NEXT_LESSON_META_KEY, flushed);

      // After a real reset the old controller brings back neither its document nor Unit A.
      await f.store.reset();
      await c.pause().catch(() => undefined);
      expect(await f.store.getMeta(NEXT_LESSON_META_KEY)).toBeNull();
      expect(await f.store.getMeta(PILOT_META_KEY)).toBeNull();
    } finally {
      c.dispose();
    }
  }, SLOW);
});
