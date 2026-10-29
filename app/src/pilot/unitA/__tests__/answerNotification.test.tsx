// The screen's post-answer notification over the real KvStore, controller and UnitAPilotScreen: a throwing or late
// callback never undoes, repeats or relabels a durable first choice, and never leaks into another dataset's panel.
// MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF (as in capture.boundaries.test.tsx): only the compiled
// UNIT_A_STARTER_REVIEW is swapped, pending by default and a FICTIONAL approval for these cases; the real beta
// config check, review verifier and controller run on in-memory stores. No account, session, network or native proof.
// `onAnswersSaved` is not a typed screen prop yet, so it is passed through a local cast.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadPrivateBetaConfig } from '@/config/privateBeta';
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';
import { sha256Hex } from '@/sync/sha256';
import { isPilotAnswer, PILOT_META_KEY } from '../capture';
import { PILOT_CONTENT } from '../content';
import { UnitAPilotScreen, type UnitAPilotScreenProps } from '../UnitAPilotScreen';

let mockStarterReview: unknown;
jest.mock('@/pilot/unitA/review', () => {
  const actual = jest.requireActual('@/pilot/unitA/review');
  return {
    ...actual,
    get UNIT_A_STARTER_REVIEW() {
      return mockStarterReview;
    },
    starterReviewAccess: (review: unknown = mockStarterReview, content?: unknown) => actual.starterReviewAccess(review, content),
  };
});
const actualReview = jest.requireActual('@/pilot/unitA/review') as typeof import('@/pilot/unitA/review');

const OWNER = 'guest:lrn-pilot-1';
const OTHER_OWNER = 'guest:lrn-pilot-2';
const LEARNER_ID = 'lrn-pilot-1';
const OTHER_LEARNER_ID = 'lrn-pilot-2';
const DAY = '2026-10-27';

const ENV_KEYS = [
  'EXPO_PUBLIC_PRIVATE_BETA',
  'EXPO_PUBLIC_APP_MODE',
  'EXPO_PUBLIC_AUTH_PROVIDER',
  'EXPO_PUBLIC_ACCOUNT_ENV',
  'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
  'EXPO_PUBLIC_PRIVATE_QA',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_SUPABASE_AUTH_URL',
] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;
/** Test fixture: the explicit private beta profile, fixture https roots. */
const BETA: Env = {
  EXPO_PUBLIC_PRIVATE_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.beta.example.com',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.beta.example.com',
};
const setEnv = (env: Env) => {
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
};

/** FICTIONAL approval of the exact draft content, for the reviewed tester fixture only; not a real review. */
const fictionalApproval = () => ({
  status: 'approved-for-trial',
  contentVersion: PILOT_CONTENT.contentVersion,
  contentSha256: sha256Hex(JSON.stringify(PILOT_CONTENT)),
  reviews: {
    arabic: { reviewer: 'Fictional Arabic Reviewer', reviewedAt: '2026-10-20T09:00:00.000Z' },
    indonesian: { reviewer: 'Fictional Indonesian Reviewer', reviewedAt: '2026-10-21T09:00:00.000Z' },
    assessment: { reviewer: 'Fictional Assessment Reviewer', reviewedAt: '2026-10-22T09:00:00.000Z' },
  },
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } };

type NotifyProps = UnitAPilotScreenProps & { onAnswersSaved?: () => Promise<void> };
const NotifyScreen = UnitAPilotScreen as unknown as (props: NotifyProps) => ReactElement;

const propsFor = (store: KvStore, owner: string, learnerId: string, onAnswersSaved: () => Promise<void>, active: () => boolean = () => true): NotifyProps => ({
  store,
  owner,
  mode: 'tester',
  readOnly: null,
  arabicScale: 1,
  today: () => DAY,
  active,
  captureLearnerId: learnerId,
  onAnswersSaved,
});
const tree = (props: NotifyProps) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <NotifyScreen {...props} />
  </SafeAreaProvider>
);

async function newStore(learnerId: string): Promise<KvStore> {
  const learner: Learner = {
    learner_id: learnerId,
    created_at: '2026-10-27T01:00:00.000Z',
    consent_version: 'demo-consent-0.1',
    consent_at: '2026-10-27T01:00:00.000Z',
    age_confirmed: true,
    session_minutes: 15,
    arabic_scale: 1,
    screens_seen: [],
  };
  const store = new KvStore(memoryKv());
  await store.init();
  await store.saveLearner(learner);
  return store;
}

/**
 * A notification over `store` that returns normally while it holds no answers (an initial load) and, once a row
 * exists, throws only while `failing`; `calls` counts every invocation.
 */
function notifier(store: KvStore) {
  const state = { failing: false, calls: 0, threw: 0 };
  const onAnswersSaved = async (): Promise<void> => {
    state.calls += 1;
    if ((await store.listAnswers()).length === 0) return;
    if (state.failing) {
      state.threw += 1;
      throw new Error('simulated notification failure');
    }
  };
  return { state, onAnswersSaved };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });

async function toQuestion(): Promise<void> {
  await screen.findByTestId('pilot-lesson');
  fireEvent.press(screen.getByTestId('pilot-next'));
  await screen.findByTestId('pilot-question');
}

/** Picks the first shown option and presses Periksa; returns the option ID. */
async function answerFirst(): Promise<string> {
  const option = screen.getAllByTestId(/^pilot-option-/)[0]!;
  const id = String(option.props.testID).replace('pilot-option-', '');
  await act(async () => { fireEvent.press(option); });
  await act(async () => { fireEvent.press(screen.getByTestId('pilot-check')); });
  return id;
}

async function docOf(store: KvStore): Promise<{ attempts: { presentationId: string; itemId: string; optionId: string | null }[] }> {
  const raw = await store.getMeta(PILOT_META_KEY);
  return raw === null ? { attempts: [] } : JSON.parse(raw);
}

describe('UnitAPilotScreen post-answer notification in a fictional reviewed tester build', () => {
  let saved: Env = {};
  beforeAll(() => {
    // Preconditions on the real gates: the compiled review stays pending; only the fixture approves.
    expect(loadPrivateBetaConfig(BETA)).toMatchObject({ enabled: true });
    expect(actualReview.UNIT_A_STARTER_REVIEW).toEqual({ status: 'pending' });
    expect(actualReview.starterReviewAccess(fictionalApproval())).toEqual({ allowed: true });
  });
  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    setEnv(BETA);
    mockStarterReview = fictionalApproval();
  });
  afterEach(() => {
    setEnv(saved);
    mockStarterReview = actualReview.UNIT_A_STARTER_REVIEW;
  });

  it('a throwing notification leaves one durable checked answer and its feedback, shows only the sync note, and a reopen with a working callback heals it', async () => {
    const store = await newStore(LEARNER_ID);
    const notify = notifier(store);
    notify.state.failing = true;
    const props = propsFor(store, OWNER, LEARNER_ID, notify.onAnswersSaved);
    const view = await render(tree(props));
    await toQuestion();
    const chosen = await answerFirst();

    const note = await screen.findByTestId('pilot-sync-note');
    expect(notify.state.threw).toBeGreaterThan(0);
    expect(within(note).getByText(/tersimpan di perangkat/i)).toBeTruthy();
    expect(within(note).getByText(/sinkron/i)).toBeTruthy();
    expect(within(note).getByText(/belum tersedia|tidak tersedia/i)).toBeTruthy();
    // Never the ordinary save failure, and no second choice to make.
    expect(screen.queryByTestId('pilot-error')).toBeNull();
    expect(screen.queryByText(/Belum tersimpan/i)).toBeNull();
    expect(screen.getByTestId('pilot-feedback')).toBeTruthy();
    expect(screen.queryByTestId('pilot-question')).toBeNull();
    expect(screen.queryAllByTestId(/^pilot-option-/)).toHaveLength(0);

    const answers = await store.listAnswers();
    expect(answers).toHaveLength(1);
    const [answer] = answers;
    expect(isPilotAnswer(answer, OWNER)).toBe(true);
    expect(answer).toMatchObject({ learner_id: LEARNER_ID, selected_option_id: chosen, local_date: DAY });
    const doc = await docOf(store);
    expect(doc.attempts).toHaveLength(1);
    expect(doc.attempts[0]).toMatchObject({ itemId: answer!.item_id, optionId: chosen });

    // Nothing replays the choice or rewrites it while the failure is shown.
    await settle();
    expect(screen.getByTestId('pilot-feedback')).toBeTruthy();
    expect(screen.queryByTestId('pilot-question')).toBeNull();
    expect(await store.listAnswers()).toEqual([answer]);
    expect(await docOf(store)).toEqual(doc);

    // Reopened with a callback that now succeeds: the same single answer, no warning of any kind.
    await view.unmount();
    notify.state.failing = false;
    await render(tree(props));
    await screen.findByTestId('pilot-feedback');
    await settle();
    expect(screen.queryByTestId('pilot-sync-note')).toBeNull();
    expect(screen.queryByTestId('pilot-error')).toBeNull();
    expect(await store.listAnswers()).toEqual([answer]);
    expect(await docOf(store)).toEqual(doc);
  });

  it('a held notification rejected after switching account stays bound to its own controller: no warning, row or callback call in the new dataset', async () => {
    const storeA = await newStore(LEARNER_ID);
    const storeB = await newStore(OTHER_LEARNER_ID);
    let aLive = true;
    let entered = 0;
    let rejectHeld: (error: Error) => void = () => {};
    // A's first post-answer notification never settles until released; an initial load (no answers) returns normally.
    const heldA = async (): Promise<void> => {
      if ((await storeA.listAnswers()).length === 0) return;
      entered += 1;
      if (entered === 1) {
        await new Promise<void>((_, reject) => {
          rejectHeld = reject;
        });
      }
    };
    const notifyB = notifier(storeB);

    const view = await render(tree(propsFor(storeA, OWNER, LEARNER_ID, heldA, () => aLive)));
    await toQuestion();
    await answerFirst();
    await waitFor(() => expect(entered).toBe(1));
    const [answerA] = await storeA.listAnswers();
    const docA = await docOf(storeA);
    expect(docA.attempts).toHaveLength(1);

    // Another account owner, store and liveness guard, with its own callback, takes the same screen.
    aLive = false;
    await view.rerender(tree(propsFor(storeB, OTHER_OWNER, OTHER_LEARNER_ID, notifyB.onAnswersSaved)));
    await screen.findByTestId('pilot-lesson');
    expect(screen.queryByTestId('pilot-feedback')).toBeNull();
    await settle();
    const callsBefore = notifyB.state.calls;

    await act(async () => {
      rejectHeld(new Error('simulated late notification failure'));
    });
    await settle();

    expect(screen.getByTestId('pilot-lesson')).toBeTruthy();
    expect(screen.queryByTestId('pilot-sync-note')).toBeNull();
    expect(screen.queryByTestId('pilot-error')).toBeNull();
    expect(screen.queryByText(/Belum tersimpan/i)).toBeNull();
    expect(notifyB.state.calls).toBe(callsBefore);
    expect(await storeB.listAnswers()).toEqual([]);
    expect((await docOf(storeB)).attempts).toEqual([]);
    expect(await storeA.listAnswers()).toEqual([answerA]);
    expect(await docOf(storeA)).toEqual(docA);
  });
});
