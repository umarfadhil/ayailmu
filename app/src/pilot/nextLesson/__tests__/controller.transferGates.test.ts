// Next lesson transfer gates: the learner's own Unit A activity is help on its day whatever the injected assistance
// check reports, and the assistance read before a first transfer task is strict and async-safe: a non-boolean, a
// throw or a rejection rejects unwritten, and context changed while it is pending blocks unwritten, so neither ever
// consumes the first transfer presentation. Driven over a real KvStore and the real Unit A controller (no module or
// store mocks), choosing the first displayed option rather than reading the draft. Characterization only.
import { qualifiedFixture, type Kv, type QualifiedFixture } from '../__fixtures__/helpers';
import {
  createNextLessonController,
  NEXT_LESSON_META_KEY,
  type NextLessonController,
  type NextLessonOptions,
  type NextLessonView,
} from '../controller';
import { createPilotController, PILOT_META_KEY, unitAStatus } from '@/pilot/unitA/controller';

type Question = Extract<NextLessonView, { kind: 'question' }>;

const JAN3 = '2026-01-03';
const JAN4 = '2026-01-04';
const JAN5 = '2026-01-05';
const JAN9 = '2026-01-09';
const JAN10 = '2026-01-10';
const SLOW = 60_000;

/** Live context read through getters, and the assistance answer as given, whatever its type. */
interface Context {
  active: boolean;
  readOnly: boolean;
  mode: NextLessonOptions['mode'];
  assist: (day: string) => unknown;
}

const LIVE = { active: true, readOnly: false, mode: 'developer-demo' } as const;

// The owner is captured once and never changed here.
function controllerFor(f: QualifiedFixture, ctx: Context): NextLessonController {
  return createNextLessonController({
    store: f.store,
    owner: f.owner,
    get mode() {
      return ctx.mode;
    },
    today: () => f.clock.day,
    readOnly: () => ctx.readOnly,
    active: () => ctx.active,
    consented: () => true,
    assistedToday: ((day: string) => ctx.assist(day)) as unknown as NextLessonOptions['assistedToday'],
    random: () => 0.25,
  });
}

/** This controller's metadata exactly as written to the backend. */
function storedRaw(kv: Kv): string {
  const text = kv.raw();
  if (text === null) throw new Error('nothing stored');
  const raw = (JSON.parse(text) as { meta?: Record<string, string> }).meta?.[NEXT_LESSON_META_KEY];
  if (raw === undefined) throw new Error('no next lesson metadata stored');
  return raw;
}

interface StoredDoc {
  owner: string;
  presentations: { presentationId: string; itemId: string; shown: string; answered: string | null }[];
  helpDays: string[];
  assessments?: unknown[];
}

const storedDoc = (kv: Kv): StoredDoc => JSON.parse(storedRaw(kv)) as StoredDoc;

function question(view: NextLessonView | undefined): Question {
  expect(view?.kind).toBe('question');
  if (view?.kind !== 'question') throw new Error(`expected a question, got ${view?.kind ?? 'nothing'}`);
  return view;
}

/** Jan 3: the four screens, then six practice tasks each answered with its first displayed option; their item ids. */
async function throughPractice(c: NextLessonController): Promise<string[]> {
  let view = await c.load();
  for (let i = 0; i < 4; i += 1) {
    expect(view.kind).toBe('screen');
    view = await c.next();
  }
  const practiced: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const q = question(view);
    expect(q.phase).toBe('practice');
    practiced.push(q.itemId);
    expect((await c.answer(q.presentationId, q.options[0]?.id ?? null)).kind).toBe('feedback');
    view = await c.next();
  }
  expect(view).toEqual({ kind: 'awaiting-transfer', until: JAN4 });
  expect(new Set(practiced).size).toBe(6);
  return practiced;
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

/** An assistance read that signals when it is entered and answers only when released. */
function deferredRead() {
  let entered: () => void = () => undefined;
  let release: (value: unknown) => void = () => undefined;
  const seen = new Promise<void>((resolve) => { entered = resolve; });
  const answer = new Promise<unknown>((resolve) => { release = resolve; });
  return { seen, release, assist: () => { entered(); return answer; } };
}

const FLIPS: readonly (readonly [string, string, (ctx: Context, f: QualifiedFixture) => void])[] = [
  ['active', 'inactive', (ctx) => { ctx.active = false; }],
  ['readOnly', 'read-only', (ctx) => { ctx.readOnly = true; }],
  ['mode', 'mode', (ctx) => { ctx.mode = 'tester'; }],
  ['today', 'today', (_ctx, f) => { f.clock.day = JAN5; }],
];

describe('next lesson controller (transfer gates)', () => {
  it("counts the learner's own Unit A delayed check as help on its day even when the assistance check says false", async () => {
    const f = await qualifiedFixture();
    const calls: string[] = [];
    const ctx: Context = { ...LIVE, assist: async (day) => { calls.push(day); return false; } };
    const c = controllerFor(f, ctx);
    const unitA = createPilotController({
      store: f.store,
      owner: f.owner,
      mode: 'developer-demo',
      today: () => f.clock.day,
      readOnly: () => false,
      active: () => true,
      assistedToday: async () => false,
      random: () => 0.25,
    });
    try {
      const practiced = await throughPractice(c);

      // Jan 9 is the anchor (Jan 2) + 7: the real Unit A controller presents its d7 check, unassisted.
      f.clock.day = JAN9;
      const before = unitAStatus(await f.store.getMeta(PILOT_META_KEY), f.owner, JAN9);
      expect(before?.qualified).toBe(true);
      expect(before?.days).not.toContain(JAN9);
      const check = await unitA.load();
      expect(check).toEqual(expect.objectContaining({ kind: 'question', phase: 'd7' }));
      const after = unitAStatus(await f.store.getMeta(PILOT_META_KEY), f.owner, JAN9);
      expect(after?.qualified).toBe(true);
      expect(after?.days).toContain(JAN9);

      // The caller reports no help on Jan 9, yet nothing held-out is stored or shown that day.
      const bytes = f.kv.raw();
      const own = storedRaw(f.kv);
      expect(await c.load()).toEqual({ kind: 'awaiting-transfer', until: JAN10 });
      expect(calls).toEqual([JAN9]);
      expect(f.kv.raw()).toBe(bytes);
      expect(storedRaw(f.kv)).toBe(own);
      const doc = storedDoc(f.kv);
      expect(doc.presentations.map((p) => p.itemId)).toEqual(practiced);
      expect(Object.keys(doc)).not.toContain('assessments');
      expect(doc.helpDays).toEqual([JAN3]);
    } finally {
      unitA.dispose();
      c.dispose();
    }
  }, SLOW);

  it('rejects or blocks unwritten on a bad or interrupted assistance read, then presents the first transfer task', async () => {
    const f = await qualifiedFixture();
    const calls: string[] = [];
    const ctx: Context = { ...LIVE, assist: async () => false };
    const c = controllerFor(f, ctx);
    try {
      const practiced = await throughPractice(c);
      f.clock.day = JAN4;
      const bytes = f.kv.raw();
      const own = storedRaw(f.kv);

      // Anything but a boolean, a synchronous throw or a rejection rejects the operation with nothing written.
      const failures: readonly (readonly [string, () => unknown, string | RegExp])[] = [
        ['string', async () => 'false', /true or false/],
        ['null', async () => null, /true or false/],
        ['throws', () => { throw new Error('assistance check failed'); }, 'assistance check failed'],
        ['rejects', () => Promise.reject(new Error('assistance check unavailable')), 'assistance check unavailable'],
      ];
      for (const [name, read, error] of failures) {
        calls.length = 0;
        ctx.assist = (day) => { calls.push(day); return read(); };
        await expect(bounded(c.load(), `${name}: load()`)).rejects.toThrow(error);
        expect({ name, calls, all: f.kv.raw() === bytes, own: storedRaw(f.kv) === own }).toEqual({
          name,
          calls: [JAN4],
          all: true,
          own: true,
        });
      }

      // Context changed while an honest false read is pending blocks before anything is used or written.
      const results: { flip: string; view: NextLessonView; all: boolean; own: boolean }[] = [];
      for (const [flip, , change] of FLIPS) {
        const held = deferredRead();
        ctx.assist = held.assist;
        const pending = c.load();
        pending.catch(() => undefined);
        await bounded(held.seen, `${flip}: assistance read`);
        change(ctx, f);
        held.release(false);
        const view = await bounded(pending, `${flip}: load()`);
        results.push({ flip, view, all: f.kv.raw() === bytes, own: storedRaw(f.kv) === own });
        Object.assign(ctx, LIVE);
        f.clock.day = JAN4;
      }
      expect(results).toEqual(
        FLIPS.map(([flip, reason]) => ({ flip, view: { kind: 'blocked', reason }, all: true, own: true })),
      );

      // Restored, an honest false read presents the first transfer task in the first transfer slot.
      calls.length = 0;
      ctx.assist = async (day) => { calls.push(day); return false; };
      const q = question(await c.load());
      expect(calls).toEqual([JAN4]);
      expect(q).toEqual(expect.objectContaining({ phase: 'transfer', help_lines: [] }));
      expect(practiced).not.toContain(q.itemId);
      const doc = storedDoc(f.kv);
      expect(doc.owner).toBe(f.owner);
      expect(doc.presentations.map((p) => p.itemId)).toEqual([...practiced, q.itemId]);
      expect(doc.presentations[practiced.length]).toEqual(
        expect.objectContaining({ presentationId: q.presentationId, shown: JAN4, answered: null }),
      );
      expect(doc.assessments).toEqual([{ presentationId: q.presentationId, assistedWhenShown: false, assistedWhenAnswered: null }]);
      expect(doc.helpDays).toEqual([JAN3]);
      // The strict parser requires presentation i to hold the i-th planned item, so this reload confirms the slot.
      const presented = f.kv.raw();
      expect(await c.load()).toEqual(q);
      expect(f.kv.raw()).toBe(presented);
    } finally {
      c.dispose();
    }
  }, SLOW);
});
