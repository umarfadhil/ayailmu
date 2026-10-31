// Next lesson help days as cross-unit assistance: a day the next lesson showed its owner a question or feedback
// counts as help for that owner's Unit A timed checks, read only from the next lesson's own stored document.
import { loadScreenViews } from '@/engine/exposure';
import { nextLessonAssistedOn } from '@/pilot/nextLesson/assistance';
import {
  createNextLessonController,
  NEXT_LESSON_META_KEY,
  type NextLessonController,
  type NextLessonView,
} from '@/pilot/nextLesson/controller';
import { qualifiedFixture, type QualifiedFixture } from '@/pilot/nextLesson/__fixtures__/helpers';
import { createPilotController, PILOT_META_KEY } from '@/pilot/unitA/controller';
import { pilotAssistedOn } from '@/pilot/unitA/UnitAPilotScreen';

const JAN3 = '2026-01-03';
const JAN4 = '2026-01-04';
const JAN5 = '2026-01-05';
const JAN9 = '2026-01-09';
const JAN10 = '2026-01-10';

type Question = Extract<NextLessonView, { kind: 'question' }>;
type Feedback = Extract<NextLessonView, { kind: 'feedback' }>;

interface StoredDoc {
  owner: string;
  schema: number;
  contentVersion: string;
  screens: unknown[];
  presentations: { presentationId: string; itemId: string; shown: string; optionOrder: string[]; answered: string | null }[];
  attempts: unknown[];
  current: { presentationId: string; itemId: string; day: string } | null;
  helpDays: string[];
}

const live: { dispose(): void }[] = [];

afterEach(() => {
  for (const c of live.splice(0)) c.dispose();
});

function nextLesson(f: QualifiedFixture): NextLessonController {
  const c = createNextLessonController({
    store: f.store,
    owner: f.owner,
    mode: 'developer-demo',
    today: () => f.clock.day,
    readOnly: () => false,
    active: () => true,
    consented: () => true,
    assistedToday: async () => false,
    random: () => 0.37,
  });
  live.push(c);
  return c;
}

function close(c: { dispose(): void }): void {
  live.splice(live.indexOf(c), 1);
  c.dispose();
}

async function readDoc(f: QualifiedFixture): Promise<StoredDoc> {
  const raw = await f.store.getMeta(NEXT_LESSON_META_KEY);
  if (raw === null) throw new Error('no next lesson document stored');
  return JSON.parse(raw) as StoredDoc;
}

function asQuestion(view: NextLessonView): Question {
  if (view.kind !== 'question') throw new Error(`expected a question, got ${view.kind}`);
  return view;
}

function asFeedback(view: NextLessonView): Feedback {
  if (view.kind !== 'feedback') throw new Error(`expected feedback, got ${view.kind}`);
  return view;
}

// Correctness is irrelevant here: the first option shown is always a legitimate first choice.
function firstChoice(q: Question): string {
  const option = q.options[0];
  if (option === undefined) throw new Error(`question ${q.itemId} shows no options`);
  return option.id;
}

/** The four teaching screens, then the first practice question, all through the real controller. */
async function toFirstQuestion(c: NextLessonController): Promise<Question> {
  let view = await c.load();
  for (let i = 0; i < 4; i += 1) {
    expect(view.kind).toBe('screen');
    view = await c.next();
  }
  return asQuestion(view);
}

/** Every `availableOn` day anywhere in a view; the Unit A progress shape is not restated here. */
function availableOnDays(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(availableOnDays);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === 'availableOn' && typeof inner === 'string' ? [inner] : availableOnDays(inner),
  );
}

describe('next lesson assistance', () => {
  it('an unanswered question resumed on the Unit A D7 day is help there, so D7 waits a day', async () => {
    const f = await qualifiedFixture();
    const first = nextLesson(f);
    const q = await toFirstQuestion(first);
    const before = await readDoc(f);
    expect(before.presentations).toHaveLength(1);
    expect(before.presentations[0]).toMatchObject({ presentationId: q.presentationId, shown: JAN3, answered: null });
    expect(before.attempts).toEqual([]);
    close(first);
    const unitARaw = await f.store.getMeta(PILOT_META_KEY);
    expect(unitARaw).not.toBeNull();

    f.clock.day = JAN9;
    const again = asQuestion(await nextLesson(f).load());
    expect(again.presentationId).toBe(q.presentationId);
    expect(again.options.map((o) => o.id)).toEqual(q.options.map((o) => o.id));
    const after = await readDoc(f);
    expect(after.helpDays).toContain(JAN9);
    expect(after.presentations).toEqual(before.presentations);
    expect(after.attempts).toEqual([]);
    expect(after.current).toEqual(before.current);
    expect(await f.store.getMeta(PILOT_META_KEY)).toBe(unitARaw);

    // Nothing legacy happened on Jan 9: only the next lesson's own document can say so.
    const answers = await f.store.listAnswers();
    const views = await loadScreenViews(f.store);
    expect(answers.some((a) => a.local_date === JAN9)).toBe(false);
    expect(views.some((v) => v.local_date === JAN9)).toBe(false);
    const raw = await f.store.getMeta(NEXT_LESSON_META_KEY);
    await expect(nextLessonAssistedOn(f.store, f.owner, JAN9)).resolves.toBe(true);
    await expect(pilotAssistedOn(f.store, JAN9, f.owner)).resolves.toBe(true);
    expect(await f.store.listAnswers()).toEqual(answers);
    expect(await loadScreenViews(f.store)).toEqual(views);
    expect(await f.store.getMeta(NEXT_LESSON_META_KEY)).toBe(raw);

    const unitA = createPilotController({
      store: f.store,
      owner: f.owner,
      mode: 'developer-demo',
      today: () => f.clock.day,
      readOnly: () => false,
      active: () => true,
      assistedToday: (day) => pilotAssistedOn(f.store, day, f.owner),
      random: () => 0.42,
    });
    live.push(unitA);
    const progress = await unitA.load();
    expect(progress.kind).toBe('progress');
    expect(availableOnDays(progress)).toContain(JAN10);
    expect(availableOnDays(progress)).not.toContain(JAN9);
  });

  it("reads only its owner's current document, failing closed without repairing anything", async () => {
    const f = await qualifiedFixture();
    expect(await f.store.getMeta(NEXT_LESSON_META_KEY)).toBeNull();
    await expect(nextLessonAssistedOn(f.store, f.owner, JAN3)).resolves.toBe(false);
    await expect(nextLessonAssistedOn(f.store, undefined, JAN3)).resolves.toBe(false);
    await expect(pilotAssistedOn(f.store, JAN3)).resolves.toBe(false);
    await expect(pilotAssistedOn(f.store, JAN3, f.owner)).resolves.toBe(false);

    const c = nextLesson(f);
    expect((await c.load()).kind).toBe('screen');
    close(c);
    const raw = await f.store.getMeta(NEXT_LESSON_META_KEY);
    if (raw === null) throw new Error('loading the next lesson stored nothing');
    const doc = JSON.parse(raw) as StoredDoc;
    expect(doc).toMatchObject({ owner: f.owner, helpDays: [JAN3] });
    await expect(nextLessonAssistedOn(f.store, f.owner, JAN3)).resolves.toBe(true);
    await expect(nextLessonAssistedOn(f.store, f.owner, JAN4)).resolves.toBe(false);
    expect(await f.store.getMeta(NEXT_LESSON_META_KEY)).toBe(raw);

    const variants: [string, string | undefined, string][] = [
      ['no owner for a present document', undefined, raw],
      ['foreign owner', f.owner, JSON.stringify({ ...doc, owner: `${f.owner}-other` })],
      ['other content version', f.owner, JSON.stringify({ ...doc, contentVersion: `${doc.contentVersion}-other` })],
      ['newer schema', f.owner, JSON.stringify({ ...doc, schema: doc.schema + 1 })],
      ['corrupt JSON', f.owner, raw.slice(0, -1)],
      ['help recorded after the asked day', f.owner, JSON.stringify({ ...doc, helpDays: [JAN3, '2026-02-01'] })],
    ];
    for (const [label, owner, stored] of variants) {
      await f.store.setMeta(NEXT_LESSON_META_KEY, stored);
      const bytes = f.kv.raw();
      const outcome = await nextLessonAssistedOn(f.store, owner, JAN3).then(
        (value) => ({ label, value }),
        () => ({ label, rejected: true }),
      );
      expect(outcome).toEqual({ label, rejected: true });
      expect(await f.store.getMeta(NEXT_LESSON_META_KEY)).toBe(stored);
      expect(f.kv.raw()).toBe(bytes);
    }
  });

  it('last practice feedback left overnight makes the next morning a help day, reloaded or left directly', async () => {
    for (const variant of ['reload', 'direct'] as const) {
      const f = await qualifiedFixture();
      const c = nextLesson(f);
      let view: NextLessonView = await toFirstQuestion(c);
      for (let n = 0; n < 6; n += 1) {
        const q = asQuestion(view);
        view = await c.answer(q.presentationId, firstChoice(q));
        asFeedback(view);
        if (n < 5) view = await c.next();
      }
      const last = asFeedback(view);
      const evening = await readDoc(f);
      expect(evening.presentations).toHaveLength(6);
      expect(evening.attempts).toHaveLength(6);
      expect(evening.presentations.every((p) => p.shown === JAN3 && p.answered === JAN3)).toBe(true);
      expect(evening.current).toMatchObject({ presentationId: last.presentationId, day: JAN3 });
      expect(evening.helpDays).toEqual([JAN3]);

      f.clock.day = JAN4;
      let leaving = c;
      if (variant === 'reload') {
        close(c);
        leaving = nextLesson(f);
        expect(await leaving.load()).toMatchObject({ kind: 'feedback', presentationId: last.presentationId });
        const shown = await readDoc(f);
        expect(shown.helpDays).toEqual([JAN3, JAN4]);
        expect(shown.current).toEqual(evening.current);
      }
      expect({ variant, view: await leaving.next() }).toEqual({
        variant,
        view: { kind: 'awaiting-transfer', until: JAN5 },
      });
      const morning = await readDoc(f);
      expect({ variant, helpDays: morning.helpDays }).toEqual({ variant, helpDays: [JAN3, JAN4] });
      expect(morning.current).toBeNull();
      expect(morning.screens).toEqual(evening.screens);
      expect(morning.presentations).toEqual(evening.presentations);
      expect(morning.attempts).toEqual(evening.attempts);
      await expect(nextLessonAssistedOn(f.store, f.owner, JAN4)).resolves.toBe(true);
      close(leaving);
    }
  });
});
