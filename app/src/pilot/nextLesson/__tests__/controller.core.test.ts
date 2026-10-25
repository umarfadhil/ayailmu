// Next lesson (U-C nominal definiteness) controller, core path: a learner whose real Unit A state qualifies opens
// the reviewed draft's teaching screens in order, then its first practice task, and resumes that exact
// presentation from durable metadata after a reopen. Driven over a real KvStore on an isolated in-memory backend
// (no module mocks, injected day, assistance and randomness). Local engineering only — no pedagogy claim.
import { NOMINAL_DEFINITENESS } from '@/content/increments/nominal-definiteness/content';
import type { IncrementItem } from '@/content/increments/nominal-definiteness/schema';
import { PILOT_META_KEY, unitAStatus } from '@/pilot/unitA/controller';
import type { KvStore } from '@/storage/kvStore';
import { open, qualifiedFixture, type Kv, type QualifiedFixture } from '../__fixtures__/helpers';
import { createNextLessonController, NEXT_LESSON_META_KEY, type NextLessonView } from '../controller';

type Question = Extract<NextLessonView, { kind: 'question' }>;

const SCREENS = NOMINAL_DEFINITENESS.lessons.flatMap((lesson) => lesson.screens);
const TRANSFER = NOMINAL_DEFINITENESS.items.filter((item) => item.phase === 'transfer');
const FIRST_PRACTICE: IncrementItem = (() => {
  const found = NOMINAL_DEFINITENESS.items.find((item) => item.phase === 'practice');
  if (!found) throw new Error('increment has no practice item');
  return found;
})();

const lcg = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function controllerFor(f: QualifiedFixture, store: KvStore, random: () => number) {
  return createNextLessonController({
    store,
    owner: f.owner,
    mode: 'developer-demo',
    today: () => f.clock.day,
    readOnly: () => false,
    active: () => true,
    consented: () => true,
    assistedToday: async () => false,
    random,
  });
}

/** The stored blob as written to the backend. */
function blob(kv: Kv): { meta?: Record<string, string> } {
  const text = kv.raw();
  if (text === null) throw new Error('nothing stored');
  return JSON.parse(text);
}

/** Everything stored except this controller's own metadata: Unit A state, answers, snapshot, learner, reports. */
function withoutNextLesson(kv: Kv): unknown {
  const stored = blob(kv);
  const meta = { ...(stored.meta ?? {}) };
  delete meta[NEXT_LESSON_META_KEY];
  return { ...stored, meta };
}

function question(view: NextLessonView | undefined): Question {
  expect(view?.kind).toBe('question');
  if (view?.kind !== 'question') throw new Error(`expected a question, got ${view?.kind ?? 'nothing'}`);
  return view;
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

const keysOf = (value: unknown): string[] =>
  typeof value !== 'object' || value === null
    ? []
    : Object.entries(value).flatMap(([key, child]: [string, unknown]) => [key, ...keysOf(child)]);

describe('next lesson controller (core path)', () => {
  it('opens a qualified learner on the first teaching screen without changing Unit A records', async () => {
    const f = await qualifiedFixture();
    expect(unitAStatus(await f.store.getMeta(PILOT_META_KEY), f.owner, f.clock.day)?.qualified).toBe(true);
    const before = withoutNextLesson(f.kv);
    const c = controllerFor(f, f.store, lcg(5));
    try {
      expect(await c.load()).toEqual({ kind: 'screen', screen: SCREENS[0] });
    } finally {
      c.dispose();
    }
    expect(withoutNextLesson(f.kv)).toEqual(before);
    expect(unitAStatus(await f.store.getMeta(PILOT_META_KEY), f.owner, f.clock.day)?.qualified).toBe(true);
  });

  it('walks all four teaching screens in order, then shows the first practice task without its answers', async () => {
    expect(SCREENS).toHaveLength(4);
    const f = await qualifiedFixture();
    const c = controllerFor(f, f.store, lcg(5));
    try {
      const views: NextLessonView[] = [await c.load()];
      for (let step = 0; step < SCREENS.length; step += 1) views.push(await c.next());
      expect(views.slice(0, SCREENS.length)).toEqual(SCREENS.map((screen) => ({ kind: 'screen', screen })));

      const q = question(views[SCREENS.length]);
      expect(q).toEqual({
        kind: 'question',
        presentationId: expect.any(String),
        itemId: FIRST_PRACTICE.item_id,
        phase: 'practice',
        format: FIRST_PRACTICE.format,
        stem: FIRST_PRACTICE.stem,
        prompt: FIRST_PRACTICE.prompt,
        help_lines: FIRST_PRACTICE.help_lines,
        options: expect.any(Array),
      });
      expect(q.presentationId).not.toBe('');
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options.map((option) => option.id)).size).toBe(4);
      expect(new Set(q.options.map((option) => option.text)).size).toBe(4);
      const choices = FIRST_PRACTICE.options.map(({ id, text, arabic }) => ({ id, text, arabic }));
      expect([...q.options].sort(byId)).toEqual(choices.sort(byId));

      const hiddenKeys = ['correct', 'feedback', 'distractor', 'solution', 'key_shape', 'combination', 'family'];
      expect(keysOf(q).filter((key) => hiddenKeys.includes(key))).toEqual([]);
      const shown = JSON.stringify(q);
      const hiddenTexts = [
        ...FIRST_PRACTICE.options.map((option) => option.feedback),
        ...TRANSFER.flatMap((item) => [item.item_id, item.stem, item.solution.arabic, item.solution.indonesian]),
      ];
      expect(hiddenTexts.filter((text) => shown.includes(text))).toEqual([]);
    } finally {
      c.dispose();
    }
  });

  it('stores the first practice presentation before showing it and resumes it exactly after a reopen', async () => {
    const f = await qualifiedFixture();
    const first = controllerFor(f, f.store, lcg(11));
    let shown: Question | undefined;
    let stored: string | undefined;
    try {
      await first.load();
      let view: NextLessonView | undefined;
      for (let step = 0; step < SCREENS.length; step += 1) view = await first.next();
      shown = question(view);
      expect(shown.itemId).toBe(FIRST_PRACTICE.item_id);
      stored = blob(f.kv).meta?.[NEXT_LESSON_META_KEY];
      expect(typeof stored).toBe('string');
    } finally {
      first.dispose();
    }

    const reopened = await open(f.kv);
    const second = controllerFor(f, reopened, lcg(977));
    try {
      const resumed = question(await second.load());
      expect(resumed).toEqual(shown);
      expect(resumed.options.map((option) => option.id)).toEqual(shown?.options.map((option) => option.id));
      expect(blob(f.kv).meta?.[NEXT_LESSON_META_KEY]).toBe(stored);
      expect(await reopened.getMeta(NEXT_LESSON_META_KEY)).toBe(stored);
    } finally {
      second.dispose();
    }
  });
});
