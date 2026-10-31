// Capture boundaries over the real KvStore, records and controller: the record's app version, own pilot records
// against same-day assistance and the legacy session history, and the actual UnitAPilotScreen opting into capture.
// MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF (as in private-beta-starter-flow.test.tsx): only the compiled
// UNIT_A_STARTER_REVIEW is swapped, per test, for a FICTIONAL approval fixture in the reviewed tester cases; the real
// beta config check, review verifier and controller run. The actual compiled record is an owner-authorized, AI-only trial
// acceptance of the current draft content (not human or expert review, not 3 independent people, no efficacy, native or
// backend proof) and is only checked as a precondition. No account, session, network or native proof is involved.
// The screen's capture props are not typed yet, so they are passed through a local cast.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadPrivateBetaConfig } from '@/config/privateBeta';
import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { prepareSession } from '@/engine/controller';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';
import { sha256Hex } from '@/sync/sha256';
import { APP_VERSION } from '@/ui/AppContext';
import { isPilotAnswer, makePilotAnswer, PILOT_META_KEY, type PilotAnswerInput } from '../capture';
import { PILOT_CONTENT } from '../content';
import { pilotAssistedOn, UnitAPilotScreen, type UnitAPilotScreenProps } from '../UnitAPilotScreen';

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
const DAY = '2026-10-27';
const T1 = '2026-10-27T03:15:42.123Z';
const NOW = Date.parse('2026-10-27T05:00:00.000Z');
/** The actual compiled record's current content fingerprint. */
const ACTUAL_SHA256 = '5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const RETRY_NOTE = 'Jawaban tersimpan di perangkat. Pencatatan akun akan dicoba lagi.';

const learner: Learner = {
  learner_id: LEARNER_ID,
  created_at: '2026-10-27T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-27T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
};

const input = (over: Partial<PilotAnswerInput> = {}): PilotAnswerInput => ({
  owner: OWNER,
  learnerId: LEARNER_ID,
  presentationId: 'ua-pres-fixture-1',
  itemId: 'ua-d01-ref-p01',
  optionId: 'b',
  optionOrder: ['c', 'a', 'd', 'b'],
  day: DAY,
  timestamp: T1,
  ...over,
});
const ownPractice = () => makePilotAnswer(input());
const ownHeld = () => makePilotAnswer(input({ presentationId: 'ua-pres-held-1', itemId: 'ua-d01-ref-t01', optionOrder: ['a', 'b', 'c', 'd'] }));
const copy = (r: AnswerRecord, over: Record<string, unknown>): AnswerRecord => ({ ...JSON.parse(JSON.stringify(r)), ...over });
/** The same answer without its capture marker, under its own ID: an ordinary legacy record. */
function legacyOf(r: AnswerRecord, id: string): AnswerRecord {
  const plain = copy(r, { answer_id: id }) as unknown as Record<string, unknown>;
  delete plain.pilot_capture;
  return plain as unknown as AnswerRecord;
}
const markerOf = (r: AnswerRecord) => (r as unknown as { pilot_capture: Record<string, unknown> }).pilot_capture;

async function storeWith(records: AnswerRecord[], backend: KvBackend = memoryKv()): Promise<KvStore> {
  const store = new KvStore(backend);
  await store.init();
  await store.saveLearner(learner);
  for (const r of records) await store.recordAnswer(r, null);
  return store;
}

// ---- The record's app version ----

describe('makePilotAnswer app_version', () => {
  it('is the app version AppContext reports, not a capture-writer label, and the record stays recognized', () => {
    expect(APP_VERSION).toBe('0.2.0');
    const rec = ownPractice();
    expect(rec.app_version).toBe(APP_VERSION);
    expect(rec.app_version).not.toMatch(/capture/);
    expect(isPilotAnswer(rec, OWNER)).toBe(true);
  });
});

// ---- Same-day assistance ----

describe('pilotAssistedOn with captured pilot answers', () => {
  it('ignores the exact owner\'s own pilot answers that day, practice or held-out, but not without that owner', async () => {
    const records = [ownPractice(), ownHeld()];
    const store = await storeWith(records);
    expect(await pilotAssistedOn(store, DAY, OWNER)).toBe(false);
    expect(await pilotAssistedOn(store, DAY)).toBe(true);
    expect(await store.listAnswers()).toEqual(records);
  });

  it('still counts a foreign owner\'s, an altered-marker or a legacy answer the same day', async () => {
    const own = ownPractice();
    const cases: [string, AnswerRecord][] = [
      ['foreign owner', makePilotAnswer(input({ owner: OTHER_OWNER, presentationId: 'ua-pres-foreign-1' }))],
      ['altered marker', copy(own, { answer_id: 'pilot-ua-altered-1', pilot_capture: { ...markerOf(own), duration: 3100 } })],
      ['altered field', copy(own, { answer_id: 'pilot-ua-altered-2', time_on_item_ms: 3100 })],
      ['legacy', legacyOf(own, 'ans-legacy-1')],
    ];
    for (const [what, record] of cases) {
      const store = await storeWith([own, record]);
      expect([what, await pilotAssistedOn(store, DAY, OWNER)]).toEqual([what, true]);
    }
  });
});

// ---- Legacy session history ----

describe('prepareSession with captured pilot answers', () => {
  const rules = loadRules('developer-demo');
  const content = gateContent(activePack, rules.mode);
  const seeded = () => {
    let s = 7;
    return () => {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  };
  const plan = (p: Awaited<ReturnType<typeof prepareSession>>) =>
    'state' in p ? { kind: p.kind, queue: p.state.queue, flags: p.state.flags, budget: p.state.budget_minutes } : { kind: p.kind };

  it('leaves the learner\'s own pilot records out of history and planning; legacy, lookalike and other-learner records stay', async () => {
    const own = ownPractice();
    const kept = [
      legacyOf(own, 'ans-legacy-1'),
      copy(own, { answer_id: 'pilot-ua-lookalike-1', pilot_capture: { ...markerOf(own), owner: 7 } }),
      copy(own, { answer_id: 'pilot-ua-lookalike-2', outcome: 'wrong' }),
      makePilotAnswer(input({ learnerId: 'lrn-other', presentationId: 'ua-pres-other-learner' })),
    ];
    expect(kept.map((r) => isPilotAnswer(r))).toEqual([false, false, false, true]);
    const withPilot = await storeWith([own, kept[0]!, ownHeld(), ...kept.slice(1)]);
    const without = await storeWith(kept);
    const stored = await withPilot.listAnswers();

    const a = await prepareSession({ store: withPilot, content, rules, now: NOW, appVersion: APP_VERSION, rng: seeded() });
    const b = await prepareSession({ store: without, content, rules, now: NOW, appVersion: APP_VERSION, rng: seeded() });
    expect('history' in a && a.history).toEqual(kept);
    expect(plan(a)).toEqual(plan(b));
    expect(await withPilot.listAnswers()).toEqual(stored);
  });
});

// ---- The actual screen, opted into capture in a fictional reviewed tester build ----

type CaptureProps = UnitAPilotScreenProps & { active?: () => boolean; captureLearnerId?: string };
const CaptureScreen = UnitAPilotScreen as unknown as (props: CaptureProps) => ReactElement;

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

/** FICTIONAL approval of the exact draft content, a per-test fixture for the same generic validator; not a real review. */
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

const answerCount = (text: string | null): number => (text ? (JSON.parse(text).answers as unknown[]).length : 0);
/** A memory backend whose next answer-growing write can be made to fail. */
function flakyBackend() {
  const kv = memoryKv();
  let fail = 0;
  const backend: KvBackend = {
    getItem: (k) => kv.getItem(k),
    removeItem: (k) => kv.removeItem(k),
    setItem: (k, v) => {
      if (fail > 0 && k === KvStore.KEY && answerCount(v) > answerCount(kv.getItem(k))) {
        fail -= 1;
        throw new Error('simulated quota failure');
      }
      kv.setItem(k, v);
    },
  };
  return { backend, failNextAnswerWrite: () => (fail = 1) };
}

function mountScreen(store: KvStore, active: () => boolean) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <CaptureScreen
        store={store}
        owner={OWNER}
        mode="tester"
        readOnly={null}
        arabicScale={1}
        today={() => DAY}
        active={active}
        captureLearnerId={LEARNER_ID}
      />
    </SafeAreaProvider>
  );
}

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

describe('UnitAPilotScreen capture in a fictional reviewed tester build', () => {
  let saved: Env = {};
  beforeAll(() => {
    // Preconditions on the real gates: the actual compiled record is approved for the current content fingerprint, which is
    // still a synthetic, constructed draft; each case below nevertheless uses its own fictional fixture approval.
    expect(loadPrivateBetaConfig(BETA)).toMatchObject({ enabled: true });
    expect(actualReview.UNIT_A_STARTER_REVIEW).toMatchObject({ status: 'approved-for-trial', contentSha256: ACTUAL_SHA256 });
    expect(actualReview.unitAContentFingerprint()).toBe(ACTUAL_SHA256);
    expect(actualReview.starterReviewAccess(actualReview.UNIT_A_STARTER_REVIEW)).toEqual({ allowed: true });
    expect(PILOT_CONTENT).toMatchObject({ synthetic: true, constructed: true, reviewStatus: 'draft' });
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

  it('a checked first choice becomes the learner\'s account answer, timed when chosen, and stays resumable', async () => {
    const store = await storeWith([]);
    const view = await mountScreen(store, () => true);
    await toQuestion();
    const before = new Date().toISOString();
    const chosen = await answerFirst();
    await screen.findByTestId('pilot-feedback');
    await waitFor(async () => expect(await store.listAnswers()).toHaveLength(1));
    const after = new Date().toISOString();

    const [answer] = await store.listAnswers();
    const [attempt] = (await docOf(store)).attempts;
    expect(isPilotAnswer(answer, OWNER)).toBe(true);
    expect(answer).toMatchObject({ learner_id: LEARNER_ID, item_id: attempt!.itemId, selected_option_id: chosen, local_date: DAY });
    expect(answer!.timestamp).toMatch(ISO);
    expect(answer!.timestamp >= before && answer!.timestamp <= after).toBe(true);
    expect(screen.queryByText(RETRY_NOTE)).toBeNull();

    await view.unmount();
    await mountScreen(store, () => true);
    await screen.findByTestId('pilot-feedback');
    expect(await store.listAnswers()).toEqual([answer]);
  });

  it('a failed append keeps the feedback with a short retry note; the next load records the same answer once', async () => {
    const flaky = flakyBackend();
    const store = await storeWith([], flaky.backend);
    const view = await mountScreen(store, () => true);
    await toQuestion();
    flaky.failNextAnswerWrite();
    await answerFirst();
    await screen.findByTestId('pilot-feedback');
    expect(await screen.findByText(RETRY_NOTE)).toBeTruthy();
    expect(await store.listAnswers()).toEqual([]);
    expect((await docOf(store)).attempts).toHaveLength(1);

    await view.unmount();
    await mountScreen(store, () => true);
    await screen.findByTestId('pilot-feedback');
    await waitFor(async () => expect(await store.listAnswers()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByText(RETRY_NOTE)).toBeNull());
    expect(isPilotAnswer((await store.listAnswers())[0], OWNER)).toBe(true);
  });

  it('a capture callback turning false before the check writes no choice and no answer', async () => {
    const store = await storeWith([]);
    let live = true;
    await mountScreen(store, () => live);
    await toQuestion();
    live = false;
    await answerFirst();
    await waitFor(() => expect(screen.queryByTestId('pilot-check')).toBeNull());
    expect(screen.queryByTestId('pilot-feedback')).toBeNull();
    expect((await docOf(store)).attempts).toEqual([]);
    expect(await store.listAnswers()).toEqual([]);
  });
});
