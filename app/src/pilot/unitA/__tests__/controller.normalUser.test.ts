// Post-integration verification of the normal-user starter path through the real controller, on an in-memory store
// with an injected day: not live backend or native proof.
// fictionalReview() below is FICTIONAL TEST ONLY fixture data: not human review, not editorial proof, never evidence
// of a real review lifecycle. The actual compiled review is the owner-authorized AI-only trial acceptance (one AI
// reviewer in all three sections; no human, expert or mastery claim). It must stay approved, current and allowed,
// unchanged, before and after every case; the pending denials below pass an explicit pending record.
import { PILOT_META_KEY, createPilotController } from '../controller';
import type { PilotControllerOptions, PilotView } from '../controller';
import { PILOT_CONTENT } from '../content';
import { APPROVED_FOR_TRIAL, REVIEW_SECTIONS, UNIT_A_STARTER_REVIEW, starterReviewAccess } from '../review';
import { KvStore, memoryKv } from '@/storage/kvStore';
import { sha256Hex } from '@/sync/sha256';

type PilotController = Awaited<ReturnType<typeof createPilotController>>;
type QuestionView = Extract<PilotView, { kind: 'question' }>;

const OWNER = 'guest:normal-controller-fixture';
const FIRST_REFERENCE_ITEM = 'ua-d01-ref-p01';
const MAX_LESSON_STEPS = 5;
const ACTUAL_SHA256 = '5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e';
const ACTUAL_REVIEWER = '/root/check_fasih_expo';

function baseEnv(): Record<string, string> {
  return {
    EXPO_PUBLIC_NORMAL_USER_STARTER: 'on',
    EXPO_PUBLIC_APP_MODE: 'tester',
    EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
    EXPO_PUBLIC_ACCOUNT_ENV: 'production',
    EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
    EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'confirmed-email',
    EXPO_PUBLIC_PRIVATE_QA: 'off',
    EXPO_PUBLIC_PRIVATE_BETA: 'off',
    EXPO_PUBLIC_LEARNING_BETA: 'off',
    EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
    EXPO_PUBLIC_PASSWORD_RECOVERY: 'off',
    EXPO_PUBLIC_REMEMBER_DEVICE: 'off',
    EXPO_PUBLIC_API_BASE_URL: 'https://api.example.org',
    EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.example.org',
  };
}

function fictionalReview() {
  const section = {
    reviewer: 'FICTIONAL TEST ONLY; not human review',
    reviewedAt: '2026-10-30T09:00:00.000Z',
  };
  return {
    status: 'approved-for-trial',
    contentVersion: PILOT_CONTENT.contentVersion,
    contentSha256: sha256Hex(JSON.stringify(PILOT_CONTENT)),
    reviews: { arabic: { ...section }, indonesian: { ...section }, assessment: { ...section } },
  } satisfies NonNullable<PilotControllerOptions['starterReview']>;
}

type Fixture = { controller: PilotController; store: KvStore };

// A null review omits the option entirely, so the controller falls back to the actual compiled review.
async function withController(
  env: Record<string, string>,
  review: PilotControllerOptions['starterReview'] | null,
  body: (fixture: Fixture) => Promise<void>,
): Promise<void> {
  const store = new KvStore(memoryKv());
  await store.init();
  const options: PilotControllerOptions = {
    store,
    owner: OWNER,
    mode: 'tester',
    today: () => '2026-10-30',
    readOnly: () => false,
    active: () => true,
    assistedToday: async () => false,
    random: () => 0.25,
    betaEnv: env,
    ...(review === null ? {} : { starterReview: review }),
  };
  const controller = await createPilotController(options);
  try {
    await body({ controller, store });
  } finally {
    await controller.dispose();
  }
}

// Serialized clone, so in-place mutation by the controller cannot make before/after trivially equal.
async function readMeta(store: KvStore): Promise<unknown> {
  const raw: unknown = await store.getMeta(PILOT_META_KEY);
  const clone: unknown = JSON.parse(JSON.stringify(raw ?? null));
  return clone;
}

function attemptCount(meta: unknown): number {
  const doc: unknown = typeof meta === 'string' ? JSON.parse(meta) : meta;
  if (typeof doc === 'object' && doc !== null && 'attempts' in doc && Array.isArray(doc.attempts)) {
    return doc.attempts.length;
  }
  throw new Error('pilot meta has no attempts array');
}

function isQuestion(view: PilotView): view is QuestionView {
  return view.kind === 'question';
}

async function loadFirstQuestion(controller: PilotController): Promise<QuestionView> {
  let view = await controller.load();
  if (view.kind !== 'lesson') throw new Error(`expected lesson after load, got ${view.kind}`);
  for (let step = 0; step < MAX_LESSON_STEPS; step += 1) {
    view = await controller.next();
    if (isQuestion(view)) return view;
    if (view.kind !== 'lesson') throw new Error(`expected lesson or question, got ${view.kind}`);
  }
  throw new Error(`no question within ${MAX_LESSON_STEPS} next() calls`);
}

function expectBlocked(view: PilotView, reason: 'mode' | 'review'): void {
  expect(view).toMatchObject({ kind: 'blocked', reason });
}

function feedbackOutcome(view: PilotView): unknown {
  if (view.kind !== 'feedback') throw new Error(`expected feedback view, got ${view.kind}`);
  return view.outcome;
}

// The actual compiled record: approved, bound to the fingerprint of the current content (computed here, not by the
// production helper), allowed, and one AI identity in all three sections.
function expectActualReviewApprovedAndAllowed(): void {
  const review = UNIT_A_STARTER_REVIEW;
  expect(review.status).toBe(APPROVED_FOR_TRIAL);
  if (review.status !== APPROVED_FOR_TRIAL) return;
  expect(review.contentSha256).toBe(ACTUAL_SHA256);
  expect(review.contentSha256).toBe(sha256Hex(JSON.stringify(PILOT_CONTENT)));
  expect(starterReviewAccess(review)).toEqual({ allowed: true });
  const reviewers = REVIEW_SECTIONS.map((section) => review.reviews[section].reviewer);
  expect(new Set(reviewers).size).toBe(1);
  expect(String(reviewers[0])).toContain(ACTUAL_REVIEWER);
}

// First reference practice is the fictional-fixture-independent item هُوَ كَاتِبٌ ("he is a writer",
// male): 'b' is the known-correct choice, written here by hand rather than read from the source key.
const CHOICE_CASES = [
  { choice: 'b', outcome: 'correct' },
  { choice: 'a', outcome: 'wrong' },
  { choice: null, outcome: 'dont-know' },
] as const;

describe('createPilotController normal-user starter (fictional review fixture)', () => {
  beforeEach(() => expectActualReviewApprovedAndAllowed());
  afterEach(() => expectActualReviewApprovedAndAllowed());

  it('blocks load, next and answer on an explicit pending review without writing meta', async () => {
    await withController(baseEnv(), { status: 'pending' }, async ({ controller, store }) => {
      expect(await readMeta(store)).toBeNull();
      expectBlocked(await controller.load(), 'review');
      expectBlocked(await controller.next(), 'review');
      expectBlocked(await controller.answer('dummy-presentation', 'b'), 'review');
      expect(await readMeta(store)).toBeNull();
    });
  });

  it.each(CHOICE_CASES)('records exactly one attempt for choice $choice ($outcome)', async ({ choice, outcome }) => {
    await withController(baseEnv(), fictionalReview(), async ({ controller, store }) => {
      const question = await loadFirstQuestion(controller);
      expect(question.itemId).toBe(FIRST_REFERENCE_ITEM);
      expect(question.options).toHaveLength(4);
      for (const entry of question.options) {
        expect(Object.keys(entry).sort()).toEqual(['id', 'text']);
      }

      const result = await controller.answer(question.presentationId, choice);
      expect(feedbackOutcome(result)).toBe(outcome);

      const afterFirst = await readMeta(store);
      expect(attemptCount(afterFirst)).toBe(1);

      await controller.answer(question.presentationId, choice);
      expect(await readMeta(store)).toEqual(afterFirst);
      expect(attemptCount(await readMeta(store))).toBe(1);
    });
  });

  // No starterReview option at all (null argument): only the actual compiled AI-only approval is in play. Memory store.
  it('with the review omitted, the actual approved record loads the lesson and records exactly one attempt', async () => {
    await withController(baseEnv(), null, async ({ controller, store }) => {
      expect(await readMeta(store)).toBeNull();
      // loadFirstQuestion requires a lesson from load() before the first question.
      const question = await loadFirstQuestion(controller);
      expect(question.itemId).toBe(FIRST_REFERENCE_ITEM);
      expect(question.options).toHaveLength(4);
      for (const entry of question.options) {
        expect(Object.keys(entry).sort()).toEqual(['id', 'text']);
      }

      const result = await controller.answer(question.presentationId, 'b');
      expect(feedbackOutcome(result)).toBe('correct');
      expect(result).toMatchObject({ kind: 'feedback', selected: { id: 'b' }, keyed: { id: 'b' } });

      const afterFirst = await readMeta(store);
      expect(attemptCount(afterFirst)).toBe(1);

      await controller.answer(question.presentationId, 'b');
      expect(await readMeta(store)).toEqual(afterFirst);
      expect(attemptCount(await readMeta(store))).toBe(1);
    });
  });

  it('rechecks mode and review on every operation, not just at mount', async () => {
    const env = baseEnv();
    const review = fictionalReview();
    await withController(env, review, async ({ controller, store }) => {
      const question = await loadFirstQuestion(controller);
      expect(question.itemId).toBe(FIRST_REFERENCE_ITEM);
      const metaBefore = await readMeta(store);

      env.EXPO_PUBLIC_NORMAL_USER_STARTER = 'off';
      expectBlocked(await controller.next(), 'mode');
      expectBlocked(await controller.answer(question.presentationId, 'b'), 'mode');
      expect(await readMeta(store)).toEqual(metaBefore);

      env.EXPO_PUBLIC_NORMAL_USER_STARTER = 'on';
      review.contentSha256 = '0'.repeat(64);
      expectBlocked(await controller.next(), 'review');
      expectBlocked(await controller.answer(question.presentationId, 'b'), 'review');
      expect(await readMeta(store)).toEqual(metaBefore);
    });
  });
});
