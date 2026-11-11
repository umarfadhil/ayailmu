// Next lesson (U-C nominal definiteness) controller, transfer path: after practice the learner waits for a day
// without other help, then answers the draft's four reserved transfer tasks once each, in content order. Each first
// choice is saved before an ungraded acknowledgement; the fourth closes the block with counts over those four first
// choices only, where a choice not saved on its own unassisted display day is kept but not valid. Driven over a real
// KvStore on an isolated in-memory backend graded by the actual bank (no module mocks). Local engineering only — no
// pedagogy claim.
import { NOMINAL_DEFINITENESS } from '@/content/increments/nominal-definiteness/content';
import type { IncrementItem, IncrementOption } from '@/content/increments/nominal-definiteness/schema';
import type { KvStore } from '@/storage/kvStore';
import { open, qualifiedFixture, type Kv, type QualifiedFixture } from '../__fixtures__/helpers';
import { createNextLessonController, NEXT_LESSON_META_KEY, type NextLessonView } from '../controller';

type Question = Extract<NextLessonView, { kind: 'question' }>;
type Controller = ReturnType<typeof createNextLessonController>;
type Choice = 'correct' | 'wrong' | null;
type Json = Record<string, unknown>;

const JAN3 = '2026-01-03';
const JAN4 = '2026-01-04';
const JAN5 = '2026-01-05';
const JAN6 = '2026-01-06';
const SLOW = 60_000;

const SCREENS = NOMINAL_DEFINITENESS.lessons.flatMap((lesson) => lesson.screens);
const PRACTICE = NOMINAL_DEFINITENESS.items.filter((item) => item.phase === 'practice');
const TRANSFER = NOMINAL_DEFINITENESS.items.filter((item) => item.phase === 'transfer');
const TRANSFER_IDS = TRANSFER.map((item) => item.item_id);
/** Keys that would give away a key, a grade or an explanation before the block closes. */
const HIDDEN_KEYS = ['correct', 'feedback', 'explanation', 'solution', 'keyed', 'outcome', 'distractor', 'counts'];

const lcg = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** Whether the learner had other help today, as the caller reports it; read afresh on every call. */
interface Context {
  assisted: boolean;
}

function controllerFor(f: QualifiedFixture, store: KvStore, ctx: Context, random: () => number): Controller {
  return createNextLessonController({
    store,
    owner: f.owner,
    mode: 'developer-demo',
    today: () => f.clock.day,
    readOnly: () => false,
    active: () => true,
    consented: () => true,
    assistedToday: async () => ctx.assisted,
    random,
  });
}

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

/** This controller's metadata exactly as written to the backend. */
function storedRaw(kv: Kv): string {
  const raw = blob(kv).meta?.[NEXT_LESSON_META_KEY];
  if (raw === undefined) throw new Error('no next lesson metadata stored');
  return raw;
}

const helpDays = (kv: Kv): string[] => (JSON.parse(storedRaw(kv)) as { helpDays: string[] }).helpDays;

/** Every object in this controller's stored document, wherever the document keeps it. */
function storedObjects(kv: Kv): Json[] {
  const found: Json[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (typeof value === 'object' && value !== null) {
      found.push(value as Json);
      Object.values(value).forEach(walk);
    }
  };
  walk(JSON.parse(storedRaw(kv)));
  return found;
}

const recordsFor = (kv: Kv, presentationId: string): Json[] =>
  storedObjects(kv).filter((o) => o.presentationId === presentationId);

const keysOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysOf)
    : typeof value === 'object' && value !== null
      ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
      : [];

function question(view: NextLessonView | undefined): Question {
  expect(view?.kind).toBe('question');
  if (view?.kind !== 'question') throw new Error(`expected a question, got ${view?.kind ?? 'nothing'}`);
  return view;
}

function transfer(index: number): IncrementItem {
  const item = TRANSFER[index];
  if (!item) throw new Error(`no transfer item ${index}`);
  return item;
}

function optionFor(item: IncrementItem, correct: boolean): IncrementOption {
  const found = item.options.find((o) => o.correct === correct);
  if (!found) throw new Error(`item ${item.item_id} has no ${correct ? 'correct' : 'wrong'} option`);
  return found;
}

function option(item: IncrementItem, id: string): IncrementOption {
  const found = item.options.find((o) => o.id === id);
  if (!found) throw new Error(`item ${item.item_id} has no option ${id}`);
  return found;
}

const pick = (item: IncrementItem, choice: Choice): string | null =>
  choice === null ? null : optionFor(item, choice === 'correct').id;

const shownChoice = (o: IncrementOption) =>
  o.arabic === undefined ? { id: o.id, text: o.text } : { id: o.id, text: o.text, arabic: o.arabic };

const deferred = (q: Question): NextLessonView => ({
  kind: 'assessment-feedback',
  presentationId: q.presentationId,
  itemId: q.itemId,
  deferred: true,
});

const closed = (answered: number, correct: number, valid: number): NextLessonView => ({
  kind: 'closed',
  counts: { answered, correct, valid },
});

/** Jan 3: the four screens, then all six practice tasks answered with their keys, leaving the last feedback. */
async function throughPractice(c: Controller): Promise<void> {
  const screens = [await c.load()];
  for (let step = 1; step < SCREENS.length; step += 1) screens.push(await c.next());
  expect(screens).toEqual(SCREENS.map((screen) => ({ kind: 'screen', screen })));
  for (const item of PRACTICE) {
    const q = question(await c.next());
    expect(q.itemId).toBe(item.item_id);
    expect((await c.answer(q.presentationId, optionFor(item, true).id)).kind).toBe('feedback');
  }
  expect(await c.next()).toEqual({ kind: 'awaiting-transfer', until: JAN4 });
}

/** The question exactly as the bank and its persisted option order give it: no help lines, keys or feedback. */
function expectTransferQuestion(kv: Kv, q: Question, item: IncrementItem, day: string): void {
  const presented = recordsFor(kv, q.presentationId).find((o) => Array.isArray(o.optionOrder));
  expect(presented).toEqual(expect.objectContaining({ itemId: item.item_id, shown: day }));
  const order = (presented?.optionOrder ?? []) as string[];
  expect([...order].sort()).toEqual(item.options.map((o) => o.id).sort());
  expect(q).toEqual({
    kind: 'question',
    presentationId: q.presentationId,
    itemId: item.item_id,
    phase: 'transfer',
    format: item.format,
    stem: item.stem,
    prompt: item.prompt,
    help_lines: [],
    options: order.map((id) => shownChoice(option(item, id))),
  });
  expect(keysOf(q).filter((key) => HIDDEN_KEYS.includes(key))).toEqual([]);
}

/** The stored first display and answer days and the raw first choice of one transfer presentation. */
function expectSaved(kv: Kv, q: Question, days: { shown: string; answered: string }, optionId: string | null): void {
  expect(recordsFor(kv, q.presentationId)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ itemId: q.itemId, ...days }),
      expect.objectContaining({ itemId: q.itemId, optionId }),
    ]),
  );
}

describe('next lesson controller (transfer path)', () => {
  it('waits out an assisted day, then shows the first reserved transfer task without help, keys or new help days', async () => {
    expect(TRANSFER).toHaveLength(4);
    const f = await qualifiedFixture();
    const before = withoutNextLesson(f.kv);
    const ctx: Context = { assisted: false };
    const c = controllerFor(f, f.store, ctx, lcg(5));
    try {
      await throughPractice(c);
      expect(await c.load()).toEqual({ kind: 'awaiting-transfer', until: JAN4 });
      const practiced = helpDays(f.kv);
      expect(practiced).toEqual([JAN3]);

      // Help elsewhere on Jan 4 moves transfer to the following day; nothing of it is stored or shown.
      f.clock.day = JAN4;
      ctx.assisted = true;
      const wait = { kind: 'awaiting-transfer', until: JAN5 };
      const waits = [await c.load(), await c.next(), await c.load()];
      expect(waits).toEqual([wait, wait, wait]);
      const exposed = JSON.stringify([waits, storedRaw(f.kv)]);
      for (const id of TRANSFER_IDS) expect(exposed).not.toContain(id);

      f.clock.day = JAN5;
      ctx.assisted = false;
      const q = question(await c.load());
      expectTransferQuestion(f.kv, q, transfer(0), JAN5);
      expect(await c.load()).toEqual(q);
      expect(helpDays(f.kv)).toEqual(practiced);
    } finally {
      c.dispose();
    }
    expect(withoutNextLesson(f.kv)).toEqual(before);
  }, SLOW);

  it('saves four first choices behind deferred acknowledgements, survives reopens, and closes with their counts', async () => {
    const f = await qualifiedFixture();
    const before = withoutNextLesson(f.kv);
    const ctx: Context = { assisted: false };
    let seed = 100;
    let c = controllerFor(f, f.store, ctx, lcg(3));
    const reopen = async () => {
      c.dispose();
      seed += 1;
      c = controllerFor(f, await open(f.kv), ctx, lcg(seed));
    };
    const choices: readonly Choice[] = ['correct', 'wrong', null, 'correct'];
    try {
      await throughPractice(c);
      const seen = new Set(storedObjects(f.kv).flatMap((o) => (typeof o.presentationId === 'string' ? [o.presentationId] : [])));
      f.clock.day = JAN4;
      const asked: string[] = [];
      let view = await c.load();
      for (let index = 0; index < TRANSFER.length; index += 1) {
        const item = transfer(index);
        const q = question(view);
        // A fresh presentation, with its option order stored before the question was returned.
        expect(seen.has(q.presentationId)).toBe(false);
        seen.add(q.presentationId);
        expectTransferQuestion(f.kv, q, item, JAN4);
        asked.push(q.itemId);
        if (index === 0) {
          const raw = storedRaw(f.kv);
          await reopen();
          expect(await c.load()).toEqual(q);
          expect(storedRaw(f.kv)).toBe(raw);
        }

        const optionId = pick(item, choices[index] ?? null);
        const answered = await c.answer(q.presentationId, optionId);
        expectSaved(f.kv, q, { shown: JAN4, answered: JAN4 }, optionId);
        if (index === TRANSFER.length - 1) {
          expect(answered).toEqual(closed(4, 2, 4));
          break;
        }
        expect(answered).toEqual(deferred(q));

        const raw = storedRaw(f.kv);
        expect(await c.answer(q.presentationId, optionId)).toEqual(deferred(q));
        expect((await c.answer(q.presentationId, optionId === null ? optionFor(item, true).id : null)).kind).toBe('blocked');
        expect(storedRaw(f.kv)).toBe(raw);
        if (index === 0) {
          await reopen();
          expect(await c.load()).toEqual(deferred(q));
          expect(storedRaw(f.kv)).toBe(raw);
        }

        view = await c.next();
        const moved = storedRaw(f.kv);
        expect((await c.answer(q.presentationId, optionId)).kind).toBe('blocked');
        expect(storedRaw(f.kv)).toBe(moved);
      }

      const done = storedRaw(f.kv);
      expect([await c.load(), await c.next(), await c.load()]).toEqual([closed(4, 2, 4), closed(4, 2, 4), closed(4, 2, 4)]);
      expect(storedRaw(f.kv)).toBe(done);
      expect(asked).toEqual(TRANSFER_IDS);
      const presented = storedObjects(f.kv).filter((o) => Array.isArray(o.optionOrder) && TRANSFER_IDS.includes(String(o.itemId)));
      expect(presented.map((o) => o.itemId)).toEqual(TRANSFER_IDS);
      expect(helpDays(f.kv)).toEqual([JAN3]);
    } finally {
      c.dispose();
    }
    expect(withoutNextLesson(f.kv)).toEqual(before);
  }, SLOW);

  it('keeps a late or assisted first choice but counts it invalid, still without grading early', async () => {
    const f = await qualifiedFixture();
    const ctx: Context = { assisted: false };
    const c = controllerFor(f, f.store, ctx, lcg(17));
    try {
      await throughPractice(c);

      // Shown on an unassisted Jan 4, answered on Jan 5.
      f.clock.day = JAN4;
      const late = question(await c.load());
      expectTransferQuestion(f.kv, late, transfer(0), JAN4);
      f.clock.day = JAN5;
      const lateId = optionFor(transfer(0), false).id;
      expect(await c.answer(late.presentationId, lateId)).toEqual(deferred(late));
      expectSaved(f.kv, late, { shown: JAN4, answered: JAN5 }, lateId);

      // Shown on an unassisted Jan 5, answered after other help that same day.
      const assisted = question(await c.next());
      expectTransferQuestion(f.kv, assisted, transfer(1), JAN5);
      ctx.assisted = true;
      expect(await c.answer(assisted.presentationId, null)).toEqual(deferred(assisted));
      expectSaved(f.kv, assisted, { shown: JAN5, answered: JAN5 }, null);

      // The rest on an unassisted Jan 6: only these two are valid.
      f.clock.day = JAN6;
      ctx.assisted = false;
      const third = question(await c.next());
      expectTransferQuestion(f.kv, third, transfer(2), JAN6);
      const thirdId = optionFor(transfer(2), true).id;
      expect(await c.answer(third.presentationId, thirdId)).toEqual(deferred(third));
      expectSaved(f.kv, third, { shown: JAN6, answered: JAN6 }, thirdId);

      const fourth = question(await c.next());
      expectTransferQuestion(f.kv, fourth, transfer(3), JAN6);
      const fourthId = optionFor(transfer(3), false).id;
      expect(await c.answer(fourth.presentationId, fourthId)).toEqual(closed(4, 1, 2));
      expectSaved(f.kv, fourth, { shown: JAN6, answered: JAN6 }, fourthId);
      expect(await c.load()).toEqual(closed(4, 1, 2));
    } finally {
      c.dispose();
    }
  }, SLOW);
});
