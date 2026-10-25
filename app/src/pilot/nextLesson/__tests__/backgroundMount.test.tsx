// Next lesson screen mounted while the app is not in the foreground: an already backgrounded, inactive or unknown
// startup state waits for an actual 'active' change before anything is read, reserved or shown, so an eligible
// transfer day never consumes a held-out task nobody saw. Real Unit A qualification, the real next lesson controller
// and screen over a real KvStore on an isolated in-memory backend; only the AppState subscription is captured so its
// change can be dispatched. Local engineering only — no pedagogy claim.
import { act, render, screen } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import * as unitA from '@/pilot/unitA/UnitAPilotScreen';
import type { Store } from '@/storage/types';
import { qualifiedFixture, type Kv } from '../__fixtures__/helpers';
import { createNextLessonController, NEXT_LESSON_META_KEY, type NextLessonView } from '../controller';
import { NextLessonScreen } from '../NextLessonScreen';

interface Doc {
  screens: { screenId: string; shown: string[]; completed: string | null }[];
  presentations: { presentationId: string; itemId: string; shown: string; optionOrder: string[]; answered: string | null }[];
  attempts: { presentationId: string; itemId: string; optionId: string | null }[];
  current: { presentationId: string; itemId: string; day: string } | null;
  helpDays: string[];
}

const JAN3 = '2026-01-03';
const JAN4 = '2026-01-04';
const SLOW = 180_000;

/** Startup states that are deliberately not active; null stands for a state the platform has not reported. */
const STARTUP: readonly (AppStateStatus | null)[] = ['background', 'inactive', null];

const STORE_METHODS: readonly (keyof Store)[] = [
  'init', 'getLearner', 'saveLearner', 'listAnswers', 'recordAnswer', 'saveSnapshot', 'loadSnapshot', 'loadSnapshotRaw',
  'archiveSnapshot', 'getMeta', 'setMeta', 'updateMeta', 'addReport', 'listReports', 'reset',
];

const QUIET_IDS = [
  'next-lesson-screen', 'next-lesson-question', 'next-lesson-feedback', 'next-lesson-assessment-feedback', 'next-lesson-awaiting',
  'next-lesson-closed', 'next-lesson-next', 'next-lesson-check', 'next-lesson-dont-know',
];

function at<T>(list: readonly T[], index: number): T {
  const found = list[index];
  if (found === undefined) throw new Error(`nothing at ${index}`);
  return found;
}

/** The next lesson document exactly as the backend holds it. */
function doc(kv: Kv): Doc {
  const text = kv.raw();
  if (text === null) throw new Error('nothing stored');
  const raw = (JSON.parse(text) as { meta?: Record<string, string> }).meta?.[NEXT_LESSON_META_KEY];
  if (raw === undefined) throw new Error('no next lesson metadata stored');
  return JSON.parse(raw) as Doc;
}

function setAppState(state: AppStateStatus | null) {
  (AppState as unknown as { currentState: AppStateStatus | null }).currentState = state;
}

const optionIds = () =>
  screen.queryAllByTestId(/^next-lesson-option-/).map((e) => String(e.props.testID).slice('next-lesson-option-'.length));
const visible = (text: string) => screen.queryAllByText(text, { exact: false }).length > 0;

/** Bounded microtask turns for queued store work and effects; no timers. */
const settle = () =>
  act(async () => {
    for (let n = 0; n < 50; n += 1) await Promise.resolve();
  });

/** A qualified owner who, on Jan 3 with the real controller, saw the four screens and answered all six practice tasks «Belum tahu». */
async function awaitingFixture(owner: string) {
  const f = await qualifiedFixture(owner);
  let seed = 11;
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
    let view: NextLessonView = await c.load();
    for (let step = 0; view.kind !== 'awaiting-transfer'; step += 1) {
      if (step > 30) throw new Error(`no awaiting transfer after 30 actions (last: ${view.kind})`);
      view = view.kind === 'question' ? await c.answer(view.presentationId, null) : await c.next();
    }
    expect(view).toMatchObject({ kind: 'awaiting-transfer', until: JAN4 });
  } finally {
    c.dispose();
  }
  return f;
}

describe('NextLessonScreen background mount', () => {
  it('mounted background, inactive or unknown on an eligible day: nothing read, reserved or shown until an actual active change', async () => {
    for (const startup of STARTUP) {
      const f = await awaitingFixture(`background-mount-${String(startup)}`);
      const bytes = f.kv.raw();
      const before = doc(f.kv);
      expect(before.presentations).toHaveLength(6);
      expect(before.attempts).toHaveLength(6);
      before.attempts.forEach((a) => expect(a.optionId).toBeNull());
      expect(before.current).toBeNull();
      expect(before.helpDays).toEqual([JAN3]);

      // Spied only now, so setup reads and writes are not counted; every call still reaches the real store and helper.
      const target = f.store as unknown as Record<string, (...args: unknown[]) => unknown>;
      const spies = STORE_METHODS.map((m) => jest.spyOn(target, m));
      const called = () => STORE_METHODS.filter((_, n) => at(spies, n).mock.calls.length > 0);
      const helper = jest.spyOn(unitA, 'pilotAssistedOn');
      const saved: AppStateStatus | null = AppState.currentState;
      const listeners: ((state: AppStateStatus) => void)[] = [];
      const listen = jest.spyOn(AppState, 'addEventListener').mockImplementation((type, listener) => {
        if (type === 'change') listeners.push(listener);
        return {
          remove: () => {
            const n = listeners.indexOf(listener);
            if (n >= 0) listeners.splice(n, 1);
          },
        };
      });
      let mounted = false;
      try {
        try {
          setAppState(startup);
          await render(
            <NextLessonScreen
              store={f.store}
              owner={f.owner}
              mode="developer-demo"
              readOnly={null}
              arabicScale={1}
              today={() => JAN4}
              onBack={() => undefined}
              consented={() => true}
            />
          );
          mounted = true;
          await settle();

          // Not yet active: no store or assistance work, unchanged bytes, nothing of the lesson on display.
          expect({ startup, storeCalls: called(), helperCalls: helper.mock.calls.length }).toEqual({ startup, storeCalls: [], helperCalls: 0 });
          expect(f.kv.raw()).toBe(bytes);
          QUIET_IDS.forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
          expect(optionIds()).toEqual([]);
          expect(listeners).toHaveLength(1);

          // The actual change to active: the first transfer task, reserved once and stored before it is shown.
          setAppState('active');
          await act(async () => {
            at(listeners, 0)('active');
          });
          await screen.findByTestId('next-lesson-question');
          await settle();
          expect(called().length).toBeGreaterThan(0);
          expect(helper).toHaveBeenCalled();

          const after = doc(f.kv);
          expect(after.presentations).toHaveLength(before.presentations.length + 1);
          expect(after.presentations.slice(0, before.presentations.length)).toEqual(before.presentations);
          const added = at(after.presentations, before.presentations.length);
          expect(added).toMatchObject({ shown: JAN4, answered: null });
          expect(before.presentations.map((p) => p.itemId)).not.toContain(added.itemId);
          expect(after.current).toEqual({ presentationId: added.presentationId, itemId: added.itemId, day: JAN4 });
          expect(after.attempts).toEqual(before.attempts);
          expect(after.screens).toEqual(before.screens);
          expect(after.helpDays).toEqual(before.helpDays);
          expect(visible('Simpan jawaban')).toBe(true);
          expect(screen.queryByTestId('next-lesson-feedback')).toBeNull();
          expect(optionIds()).toEqual(added.optionOrder);

          // Further turns keep the first choices and their order as stored.
          const shown = f.kv.raw();
          await settle();
          expect(f.kv.raw()).toBe(shown);
          expect(optionIds()).toEqual(added.optionOrder);
        } finally {
          if (mounted) await screen.unmount();
        }
      } finally {
        setAppState(saved);
        listen.mockRestore();
        helper.mockRestore();
        spies.forEach((s) => s.mockRestore());
      }
    }
  }, SLOW);
});
