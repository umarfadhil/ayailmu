// Next lesson (U-C nominal definiteness) controller, practice path: after the four teaching screens a qualified
// learner answers the draft's six practice tasks in content order. Each first choice is saved in this controller's
// own metadata before its feedback is shown, is never replaced, and survives a reopen; only an explicit next moves
// on, and the last next waits for the following day's transfer. Driven over a real KvStore on an isolated in-memory
// backend graded by the actual bank (no module mocks). Local engineering only — no pedagogy claim.
import { NOMINAL_DEFINITENESS } from '@/content/increments/nominal-definiteness/content';
import type { IncrementItem, IncrementOption } from '@/content/increments/nominal-definiteness/schema';
import type { KvStore } from '@/storage/kvStore';
import { open, qualifiedFixture, type Kv, type QualifiedFixture } from '../__fixtures__/helpers';
import { createNextLessonController, NEXT_LESSON_META_KEY, type NextLessonView } from '../controller';

type Question = Extract<NextLessonView, { kind: 'question' }>;
type Controller = ReturnType<typeof createNextLessonController>;
type Choice = 'correct' | 'wrong' | null;

const SCREENS = NOMINAL_DEFINITENESS.lessons.flatMap((lesson) => lesson.screens);
const PRACTICE = NOMINAL_DEFINITENESS.items.filter((item) => item.phase === 'practice');
const TRANSFER_IDS = NOMINAL_DEFINITENESS.items.filter((item) => item.phase === 'transfer').map((item) => item.item_id);
const MIX: readonly Choice[] = ['correct', 'wrong', null];

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

interface StoredDoc {
  presentations: { presentationId: string; optionOrder: string[] }[];
  attempts: { presentationId: string; itemId: string; optionId: string | null }[];
}
const stored = (kv: Kv): StoredDoc => JSON.parse(storedRaw(kv));

function question(view: NextLessonView | undefined): Question {
  expect(view?.kind).toBe('question');
  if (view?.kind !== 'question') throw new Error(`expected a question, got ${view?.kind ?? 'nothing'}`);
  return view;
}

function practice(index: number): IncrementItem {
  const item = PRACTICE[index];
  if (!item) throw new Error(`no practice item ${index}`);
  return item;
}

function optionFor(item: IncrementItem, correct: boolean): IncrementOption {
  const found = item.options.find((o) => o.correct === correct);
  if (!found) throw new Error(`item ${item.item_id} has no ${correct ? 'correct' : 'wrong'} option`);
  return found;
}

const pick = (item: IncrementItem, choice: Choice): string | null =>
  choice === null ? null : optionFor(item, choice === 'correct').id;

const shownChoice = (o: IncrementOption) =>
  o.arabic === undefined ? { id: o.id, text: o.text } : { id: o.id, text: o.text, arabic: o.arabic };

const explained = (o: IncrementOption) => ({ id: o.id, text: o.text, explanation: o.feedback });

/** Feedback graded from the actual bank: the chosen option's and the key's own explanations. */
function expectedFeedback(presentationId: string, item: IncrementItem, optionId: string | null): NextLessonView {
  const selected = optionId === null ? null : item.options.find((o) => o.id === optionId);
  if (selected === undefined) throw new Error(`item ${item.item_id} has no option ${optionId}`);
  return {
    kind: 'feedback',
    presentationId,
    itemId: item.item_id,
    outcome: selected === null ? 'dont-know' : selected.correct ? 'correct' : 'wrong',
    selected: selected === null ? null : explained(selected),
    keyed: explained(optionFor(item, true)),
  };
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

/** load shows the first screen, three nexts the rest, the fourth next the first practice task. */
async function toFirstPractice(c: Controller): Promise<Question> {
  const screens = [await c.load()];
  for (let step = 1; step < SCREENS.length; step += 1) screens.push(await c.next());
  expect(screens).toEqual(SCREENS.map((screen) => ({ kind: 'screen', screen })));
  return question(await c.next());
}

describe('next lesson controller (practice path)', () => {
  it('saves each first choice before grading it from the bank, through all six practice tasks, then awaits transfer', async () => {
    expect(SCREENS).toHaveLength(4);
    expect(PRACTICE).toHaveLength(6);
    const f = await qualifiedFixture();
    const before = withoutNextLesson(f.kv);
    const c = controllerFor(f, f.store, lcg(5));
    const shown: NextLessonView[] = [];
    try {
      let q = await toFirstPractice(c);
      for (let index = 0; index < PRACTICE.length; index += 1) {
        const item = practice(index);
        expect(q.itemId).toBe(item.item_id);
        expect(q.phase).toBe('practice');
        expect(q.options).toHaveLength(4);
        expect([...q.options].sort(byId)).toEqual(item.options.map(shownChoice).sort(byId));

        const optionId = pick(item, MIX[index % MIX.length] ?? null);
        const feedback = await c.answer(q.presentationId, optionId);
        const { attempts } = stored(f.kv);
        expect(attempts).toHaveLength(index + 1);
        expect(attempts[index]).toEqual(expect.objectContaining({ presentationId: q.presentationId, itemId: item.item_id, optionId }));
        expect(feedback).toEqual(expectedFeedback(q.presentationId, item, optionId));
        shown.push(q, feedback);

        const after = await c.next();
        if (index < PRACTICE.length - 1) q = question(after);
        else expect(after).toEqual({ kind: 'awaiting-transfer', until: '2026-01-04' });
      }
    } finally {
      c.dispose();
    }
    expect(withoutNextLesson(f.kv)).toEqual(before);
    const exposed = JSON.stringify([shown, storedRaw(f.kv)]);
    for (const id of TRANSFER_IDS) expect(exposed).not.toContain(id);
  });

  it('keeps the first choice: the same answer replays its feedback, a different or stale answer is refused', async () => {
    const f = await qualifiedFixture();
    const item = practice(0);
    const c = controllerFor(f, f.store, lcg(7));
    try {
      const q = await toFirstPractice(c);
      const first = await c.answer(q.presentationId, null);
      expect(first).toEqual(expectedFeedback(q.presentationId, item, null));
      expect(stored(f.kv).attempts).toEqual([
        expect.objectContaining({ presentationId: q.presentationId, itemId: item.item_id, optionId: null }),
      ]);
      const saved = f.kv.raw();

      expect(await c.answer(q.presentationId, null)).toEqual(first);
      expect(f.kv.raw()).toBe(saved);
      expect((await c.answer(q.presentationId, optionFor(item, true).id)).kind).toBe('blocked');
      expect(f.kv.raw()).toBe(saved);

      expect(question(await c.next()).itemId).toBe(practice(1).item_id);
      const moved = f.kv.raw();
      for (const optionId of [null, optionFor(item, true).id]) {
        expect((await c.answer(q.presentationId, optionId)).kind).toBe('blocked');
      }
      expect(f.kv.raw()).toBe(moved);
      expect(stored(f.kv).attempts).toHaveLength(1);
    } finally {
      c.dispose();
    }
  });

  it('resumes saved feedback after a same-day reopen and moves on only by an explicit next', async () => {
    const f = await qualifiedFixture();
    const item = practice(0);
    const wrongId = optionFor(item, false).id;
    const c = controllerFor(f, f.store, lcg(11));
    const saved = await (async () => {
      try {
        const q = await toFirstPractice(c);
        const feedback = await c.answer(q.presentationId, wrongId);
        expect(feedback).toEqual(expectedFeedback(q.presentationId, item, wrongId));
        return { q, feedback, raw: storedRaw(f.kv) };
      } finally {
        c.dispose();
      }
    })();
    const firstOrder = (JSON.parse(saved.raw) as StoredDoc).presentations[0]?.optionOrder;
    expect(firstOrder).toHaveLength(4);

    const reopened = controllerFor(f, await open(f.kv), lcg(987));
    try {
      expect(await reopened.load()).toEqual(saved.feedback);
      expect(await reopened.load()).toEqual(saved.feedback);
      expect(storedRaw(f.kv)).toBe(saved.raw);

      const second = question(await reopened.next());
      expect(second.itemId).toBe(practice(1).item_id);
      const pending = storedRaw(f.kv);
      expect(await reopened.next()).toEqual(second);
      expect(storedRaw(f.kv)).toBe(pending);

      const doc = stored(f.kv);
      expect(doc.attempts).toEqual([
        expect.objectContaining({ presentationId: saved.q.presentationId, itemId: item.item_id, optionId: wrongId }),
      ]);
      expect(doc.presentations[0]?.optionOrder).toEqual(firstOrder);
    } finally {
      reopened.dispose();
    }
  });
});
