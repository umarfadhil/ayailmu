// Next lesson screen and its Unit A entry: the real screens over the real controllers and real KvStores on isolated
// in-memory backends, an owner qualified by the actual Unit A controller (no gate state written by hand), graded by
// the actual bank (no module mocks), injected day. Local engineering only — no pedagogy claim.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { AppState } from 'react-native';
import { NOMINAL_DEFINITENESS } from '@/content/increments/nominal-definiteness/content';
import type { IncrementItem, IncrementOption } from '@/content/increments/nominal-definiteness/schema';
import { UnitAPilotScreen } from '@/pilot/unitA/UnitAPilotScreen';
import { backend, open, qualifiedFixture, type Kv, type QualifiedFixture } from '../__fixtures__/helpers';
import { createNextLessonController, NEXT_LESSON_META_KEY } from '../controller';
import { NextLessonScreen } from '../NextLessonScreen';

type Props = ComponentProps<typeof NextLessonScreen>;
type UnitAProps = ComponentProps<typeof UnitAPilotScreen>;
interface Doc {
  screens: { screenId: string; shown: string[]; completed: string | null }[];
  presentations: { presentationId: string; itemId: string; shown: string; optionOrder: string[]; answered: string | null }[];
  attempts: { presentationId: string; itemId: string; optionId: string | null }[];
  current: { presentationId: string; itemId: string; day: string } | null;
  helpDays: string[];
}

const JAN3 = '2026-01-03';
const JAN4 = '2026-01-04';
const JAN5 = '2026-01-05';
const OWNER = 'next-screen-owner';
const SLOW = 60_000;
const DRAFT = 'Draf belum ditinjau';

const SCREENS = NOMINAL_DEFINITENESS.lessons.flatMap((lesson) => lesson.screens);
const PRACTICE = NOMINAL_DEFINITENESS.items.filter((item) => item.phase === 'practice');
const TRANSFER = NOMINAL_DEFINITENESS.items.filter((item) => item.phase === 'transfer');

function at<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`nothing at ${index}`);
  return found;
}

function optionFor(item: IncrementItem, correct: boolean): IncrementOption {
  const found = item.options.find((o) => o.correct === correct);
  if (!found) throw new Error(`item ${item.item_id} has no ${correct ? 'correct' : 'wrong'} option`);
  return found;
}

function blob(kv: Kv): { meta?: Record<string, string> } {
  const text = kv.raw();
  if (text === null) throw new Error('nothing stored');
  return JSON.parse(text);
}

/** The next lesson document exactly as the backend holds it, or null when none was written. */
function storedDoc(kv: Kv): Doc | null {
  const raw = blob(kv).meta?.[NEXT_LESSON_META_KEY];
  return raw === undefined ? null : (JSON.parse(raw) as Doc);
}

function doc(kv: Kv): Doc {
  const found = storedDoc(kv);
  if (found === null) throw new Error('no next lesson metadata stored');
  return found;
}

/** Everything stored except the next lesson's own metadata: Unit A state, answers, snapshot, learner, reports. */
function withoutNextLesson(kv: Kv): unknown {
  const stored = blob(kv);
  const meta = { ...(stored.meta ?? {}) };
  delete meta[NEXT_LESSON_META_KEY];
  return { ...stored, meta };
}

const props = (f: QualifiedFixture, over: Partial<Props> = {}): Props => ({
  store: f.store, owner: f.owner, mode: 'developer-demo', readOnly: null, arabicScale: 1, today: () => JAN3, onBack: () => undefined, ...over,
});
const unitAProps = (store: UnitAProps['store'], over: Partial<UnitAProps> = {}): UnitAProps => ({
  store, owner: OWNER, mode: 'developer-demo', readOnly: null, arabicScale: 1, today: () => JAN3, ...over,
});

const optionIds = () =>
  screen.queryAllByTestId(/^next-lesson-option-/).map((e) => String(e.props.testID).slice('next-lesson-option-'.length));
const visible = (text: string) => screen.queryAllByText(text, { exact: false }).length > 0;
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

/** Presses a control captured earlier; once it has left the tree RNTL may refuse, which is equally fine. */
async function pressStale(el: ReturnType<typeof screen.getByTestId>) {
  try { await fireEvent.press(el); } catch { /* detached control: nothing reachable */ }
}

/** Lets queued store work and effects finish when no visible element marks the end. */
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });

const LESSON_IDS = ['next-lesson-screen', 'next-lesson-question', 'next-lesson-feedback', 'next-lesson-next', 'next-lesson-check'];

// These scenarios run in the foreground; Jest's AppState starts non-active, so say so explicitly.
const appState = AppState as { currentState: typeof AppState.currentState | null };
let savedAppState: typeof appState.currentState;
beforeEach(() => {
  savedAppState = appState.currentState;
  appState.currentState = 'active';
});
afterEach(() => {
  appState.currentState = savedAppState;
});

describe('NextLessonScreen', () => {
  it('Unit A offers the next lesson only to its qualified owner in developer mode, and pressing it only calls onNextLesson', async () => {
    const onNextLesson = jest.fn();

    // Never qualified: Unit A teaches as before and offers no entry.
    await render(<UnitAPilotScreen {...unitAProps(await open(backend()), { onNextLesson })} />);
    await screen.findByTestId('pilot-lesson');
    await settle();
    expect(screen.queryByTestId('pilot-next-lesson')).toBeNull();
    await screen.unmount();

    // Qualified by the real Unit A controller on Jan 1–2; on Jan 3 its progress offers the entry.
    const f = await qualifiedFixture(OWNER);
    await render(<UnitAPilotScreen {...unitAProps(f.store, { onNextLesson })} />);
    await screen.findByTestId('pilot-progress');
    const entry = await screen.findByTestId('pilot-next-lesson');
    await settle();
    const bytes = f.kv.raw();
    expect(storedDoc(f.kv)).toBeNull();

    await fireEvent.press(entry);
    await settle();
    expect(onNextLesson).toHaveBeenCalledTimes(1);
    expect(f.kv.raw()).toBe(bytes);
    expect(storedDoc(f.kv)).toBeNull();
    expect(screen.getByTestId('pilot-progress')).toBeTruthy();

    // Tester mode never offers it, even to the same qualified owner.
    await screen.rerender(<UnitAPilotScreen {...unitAProps(f.store, { mode: 'tester', onNextLesson })} />);
    expect(screen.queryByTestId('pilot-next-lesson')).toBeNull();
    await settle();
    expect(screen.getByTestId('pilot-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('pilot-next-lesson')).toBeNull();
    expect(onNextLesson).toHaveBeenCalledTimes(1);
    expect(f.kv.raw()).toBe(bytes);
  }, SLOW);

  it('qualified: the four bank screens, then the first practice question; only check saves, home leaves, reopen resumes', async () => {
    const f = await qualifiedFixture(OWNER);
    const unitA = withoutNextLesson(f.kv);
    const onBack = jest.fn();
    await render(<NextLessonScreen {...props(f, { onBack })} />);

    for (let index = 0; index < SCREENS.length; index += 1) {
      const shown = at(SCREENS, index);
      await screen.findByText(shown.title, { exact: false });
      expect(screen.getByTestId('next-lesson-screen')).toBeTruthy();
      expect(doc(f.kv).screens.map((s) => s.screenId)).toEqual(SCREENS.slice(0, index + 1).map((s) => s.screen_id));
      shown.body.forEach((paragraph) => expect(visible(paragraph)).toBe(true));
      shown.examples.forEach((example) => {
        expect(visible(example.arabic)).toBe(true);
        expect(visible(example.meaning)).toBe(true);
        expect(visible(example.explanation)).toBe(true);
      });
      expect(visible(DRAFT)).toBe(true);
      expect(screen.queryByTestId('next-lesson-question')).toBeNull();
      await press('next-lesson-next');
    }

    // The first practice task, its option order stored before it was shown.
    await screen.findByTestId('next-lesson-question');
    const source = at(PRACTICE, 0);
    const asked = doc(f.kv);
    const first = at(asked.presentations, 0);
    expect(asked.current).toEqual({ presentationId: first.presentationId, itemId: source.item_id, day: JAN3 });
    expect(asked.attempts).toEqual([]);
    expect(optionIds()).toEqual(first.optionOrder);
    expect([...optionIds()].sort()).toEqual(source.options.map((o) => o.id).sort());
    expect(visible(source.stem)).toBe(true);
    expect(visible(source.prompt)).toBe(true);
    expect(visible(DRAFT)).toBe(true);

    // Choosing alone saves nothing and shows no verdict.
    const noVerdict = () => {
      expect(screen.queryByTestId('next-lesson-feedback')).toBeNull();
      source.options.forEach((o) => expect(visible(o.feedback)).toBe(false));
    };
    noVerdict();
    const wrong = optionFor(source, false);
    const keyed = optionFor(source, true);
    await press(`next-lesson-option-${wrong.id}`);
    await settle();
    noVerdict();
    expect(doc(f.kv).attempts).toEqual([]);

    await press('next-lesson-check');
    await screen.findByTestId('next-lesson-feedback');
    expect(doc(f.kv).attempts).toEqual([{ presentationId: first.presentationId, itemId: source.item_id, optionId: wrong.id }]);
    expect(at(doc(f.kv).presentations, 0)).toEqual({ ...first, answered: JAN3 });
    expect(visible(wrong.feedback)).toBe(true);
    expect(visible(keyed.feedback)).toBe(true);
    expect(visible(DRAFT)).toBe(true);

    // Home leaves without answering or advancing.
    const answered = f.kv.raw();
    await press('next-lesson-home');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(f.kv.raw()).toBe(answered);

    // Reopened on the same owner and store: the saved feedback, the stored bytes untouched.
    await screen.unmount();
    await render(<NextLessonScreen {...props(f, { onBack })} />);
    await screen.findByTestId('next-lesson-feedback');
    await settle();
    expect(visible(wrong.feedback)).toBe(true);
    expect(visible(keyed.feedback)).toBe(true);
    expect(f.kv.raw()).toBe(answered);
    expect(onBack).toHaveBeenCalledTimes(1);

    // Only an explicit next moves on, to the next practice task in its stored order.
    await press('next-lesson-next');
    await screen.findByTestId('next-lesson-question');
    const moved = doc(f.kv);
    const second = at(moved.presentations, 1);
    expect(moved.presentations).toHaveLength(2);
    expect(moved.current).toEqual({ presentationId: second.presentationId, itemId: at(PRACTICE, 1).item_id, day: JAN3 });
    expect(moved.attempts).toHaveLength(1);
    expect(optionIds()).toEqual(second.optionOrder);
    expect(visible(at(PRACTICE, 1).stem)).toBe(true);
    expect(screen.queryByTestId('next-lesson-feedback')).toBeNull();
    expect(withoutNextLesson(f.kv)).toEqual(unitA);
  }, SLOW);

  it('a later day resumes the last practice feedback, records only that day as help, then awaits transfer; rebinding hides it', async () => {
    const f = await qualifiedFixture(OWNER);
    const unitA = withoutNextLesson(f.kv);
    const last = at(PRACTICE, PRACTICE.length - 1);
    const wrong = optionFor(last, false);
    const keyed = optionFor(last, true);

    // Jan 3, real controller: the four screens and all six practice tasks, leaving the last feedback on display.
    let seed = 7;
    const c = createNextLessonController({
      store: f.store,
      owner: f.owner,
      mode: 'developer-demo',
      today: () => JAN3,
      readOnly: () => false,
      active: () => true,
      consented: () => true,
      assistedToday: async () => false,
      random: () => (seed = (seed * 16807) % 2147483647) / 2147483647,
    });
    try {
      expect((await c.load()).kind).toBe('screen');
      for (let step = 1; step < SCREENS.length; step += 1) expect((await c.next()).kind).toBe('screen');
      for (const item of PRACTICE) {
        const q = await c.next();
        if (q.kind !== 'question' || q.itemId !== item.item_id) throw new Error(`expected ${item.item_id}, got ${q.kind}`);
        const choice = item === last ? wrong.id : optionFor(item, true).id;
        expect((await c.answer(q.presentationId, choice)).kind).toBe('feedback');
      }
    } finally {
      c.dispose();
    }
    const seeded = doc(f.kv);
    expect(seeded.helpDays).toEqual([JAN3]);

    // Jan 4: the same feedback; Jan 4 joins the help days, first display and answer days stay Jan 3.
    // The injected day is read at call time, so moving it later changes no prop.
    let day = JAN4;
    const onBack = jest.fn();
    const jan4 = { today: () => day, onBack };
    await render(<NextLessonScreen {...props(f, jan4)} />);
    await screen.findByTestId('next-lesson-feedback');
    await settle();
    expect(visible(wrong.feedback)).toBe(true);
    expect(visible(keyed.feedback)).toBe(true);
    const resumed = doc(f.kv);
    expect(resumed.helpDays).toEqual([JAN3, JAN4]);
    expect(resumed).toEqual({ ...seeded, helpDays: [JAN3, JAN4] });
    resumed.presentations.forEach((p) => expect({ shown: p.shown, answered: p.answered }).toEqual({ shown: JAN3, answered: JAN3 }));
    const bytes = f.kv.raw();
    const staleNext = screen.getByTestId('next-lesson-next');

    const hidden = () => {
      LESSON_IDS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
      expect(optionIds()).toEqual([]);
      expect(visible(wrong.feedback)).toBe(false);
      expect(visible(keyed.feedback)).toBe(false);
    };

    // Tester mode and read-only storage: the feedback is gone in the same commit and nothing old can write.
    await screen.rerender(<NextLessonScreen {...props(f, { ...jan4, mode: 'tester' })} />);
    hidden();
    await pressStale(staleNext);
    await settle();
    hidden();
    expect(screen.getByTestId('next-lesson-unavailable')).toBeTruthy();
    expect(f.kv.raw()).toBe(bytes);

    await screen.rerender(<NextLessonScreen {...props(f, { ...jan4, readOnly: 'storage is read-only' })} />);
    hidden();
    await settle();
    hidden();
    expect(screen.getByTestId('next-lesson-unavailable')).toBeTruthy();
    expect(f.kv.raw()).toBe(bytes);

    // Another owner on the same store: blocked, and this owner's document is neither read as theirs nor rewritten.
    await screen.rerender(<NextLessonScreen {...props(f, { ...jan4, owner: 'someone-else' })} />);
    hidden();
    await pressStale(staleNext);
    await screen.findByTestId('next-lesson-blocked');
    await settle();
    hidden();
    expect(f.kv.raw()).toBe(bytes);

    // Back to the owner: the same feedback, then Continue awaits transfer until Jan 5 with nothing held-out shown.
    await screen.rerender(<NextLessonScreen {...props(f, jan4)} />);
    await screen.findByTestId('next-lesson-feedback');
    await settle();
    expect(f.kv.raw()).toBe(bytes);
    await press('next-lesson-next');
    await screen.findByTestId('next-lesson-awaiting');
    await settle();
    expect(screen.queryAllByText(/5 Januari 2026|2026-01-05/).length).toBeGreaterThan(0);
    LESSON_IDS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
    TRANSFER.forEach((item) => expect(visible(item.stem)).toBe(false));
    const waiting = doc(f.kv);
    expect(waiting).toEqual({ ...resumed, current: null });
    expect(withoutNextLesson(f.kv)).toEqual(unitA);

    // Jan 5 is unassisted, so an ordinary load would now present transfer; route Back only leaves.
    const awaited = f.kv.raw();
    day = JAN5;
    expect(onBack).not.toHaveBeenCalled();
    await press('next-lesson-home');
    await settle();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(f.kv.raw()).toBe(awaited);
    expect(doc(f.kv)).toEqual(waiting);
    expect(doc(f.kv).presentations).toHaveLength(PRACTICE.length);
    expect(screen.queryByTestId('next-lesson-question')).toBeNull();
    TRANSFER.forEach((item) => expect(visible(item.stem)).toBe(false));
  }, SLOW);
});
