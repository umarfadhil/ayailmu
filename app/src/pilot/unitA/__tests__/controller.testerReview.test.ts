// Unit A pilot controller, tester mode: runs only when the private beta configuration is enabled AND the starter
// review is an exact approval of the content, both checked on every operation. Real KvStore on an isolated in-memory
// backend (no accounts, no network, no module mocks, injected day). The approved review here is a fictional fixture
// built only in this file; the compiled review stays pending and the source content stays a synthetic draft.
// Proposed interface pinned here: PilotControllerOptions gains optional betaEnv (PrivateBetaEnv) and starterReview
// (unknown); a missing or invalid beta blocks 'mode', a validated beta with a missing, stale or incomplete review
// blocks 'review'. 'developer-demo' behaviour is unchanged (controller.initial.test.ts).
import { loadPrivateBetaConfig, type PrivateBetaEnv } from '@/config/privateBeta';
import { KvStore, memoryKv } from '@/storage/kvStore';
import { sha256Hex } from '@/sync/sha256';
import { PILOT_CONTENT } from '../content';
import { createPilotController, PILOT_META_KEY, type PilotView } from '../controller';
import { starterReviewAccess } from '../review';

type BaseOptions = Parameters<typeof createPilotController>[0];
/** The options this batch proposes; cast to the current type so the file compiles before the implementation. */
type TesterOptions = BaseOptions & { betaEnv?: PrivateBetaEnv; starterReview?: unknown };
type Controller = ReturnType<typeof createPilotController>;
type Question = Extract<PilotView, { kind: 'question' }>;

const DAY = '2026-10-27';
const OWNER = 'pilot-tester-owner';

const BETA_ENV: PrivateBetaEnv = Object.freeze({
  EXPO_PUBLIC_PRIVATE_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_API_BASE_URL: 'https://api.beta.example.com',
  EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.beta.example.com',
});

/** The fingerprint computed here from the exact content, never taken from the production helper. */
const FIXTURE_SHA = sha256Hex(JSON.stringify(PILOT_CONTENT));

/** A fictional, mutable approval of the exact content; it exists only in this test. */
function approvedReview(contentSha256 = FIXTURE_SHA) {
  return {
    status: 'approved-for-trial' as string,
    contentVersion: PILOT_CONTENT.contentVersion as string,
    contentSha256,
    reviews: {
      arabic: { reviewer: 'Fixture Arabic Reviewer', reviewedAt: '2026-10-20T09:00:00.000Z' },
      indonesian: { reviewer: 'Fixture Indonesian Reviewer', reviewedAt: '2026-10-21T09:00:00.000Z' },
      assessment: { reviewer: 'Fixture Assessment Reviewer', reviewedAt: '2026-10-22T09:00:00.000Z' },
    } as Record<string, unknown>,
  };
}

function backend() {
  const inner = memoryKv();
  return {
    raw: () => inner.getItem(KvStore.KEY),
    getItem: (k: string) => inner.getItem(k),
    setItem: (k: string, v: string) => inner.setItem(k, v),
    removeItem: (k: string) => inner.removeItem(k),
  };
}
type Kv = ReturnType<typeof backend>;

async function open(kv: Kv): Promise<KvStore> {
  const store = new KvStore(kv);
  await store.init();
  return store;
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

const make = (store: KvStore, over: Partial<TesterOptions> = {}): Controller => {
  const options: TesterOptions = {
    store, owner: OWNER, mode: 'tester', today: () => DAY, readOnly: () => false, active: () => true,
    assistedToday: async () => false, random: seeded(7), betaEnv: BETA_ENV, starterReview: approvedReview(), ...over,
  };
  return createPilotController(options as BaseOptions);
};

/** The pilot document's exact bytes as a freshly reopened store sees them. */
const readMeta = async (kv: Kv): Promise<string | null> => (await open(kv)).getMeta(PILOT_META_KEY);

const blockedBy = (reason: string) => ({ kind: 'blocked', reason });

function item(id: string) {
  const found = PILOT_CONTENT.items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown item ${id}`);
  return found;
}
const keyOf = (q: Question) => item(q.itemId).options.find((o) => o.correct)?.id ?? '';

function asQuestion(view: PilotView): Question {
  expect(view.kind).toBe('question');
  const q = view as Question;
  const source = item(q.itemId);
  expect(q.options).toHaveLength(4);
  q.options.forEach((o) => expect(Object.keys(o).sort()).toEqual(['id', 'text']));
  const text = JSON.stringify(view);
  expect(text).not.toMatch(/"(correct|feedback|correctOptionId|answerKey)"\s*:/);
  source.options.forEach((o) => expect(text).not.toContain(o.feedback));
  return q;
}

async function firstQuestion(c: Controller): Promise<Question> {
  const lesson = await c.load();
  expect(lesson.kind).toBe('lesson');
  return asQuestion(await c.next());
}

/** Every operation is refused with `reason` and neither the pilot document nor any other byte changes. */
async function expectAllBlocked(kv: Kv, c: Controller, reason: string, presentationId = 'ua-pres-none'): Promise<void> {
  const raw = kv.raw();
  const meta = await readMeta(kv);
  expect(await c.load()).toEqual(blockedBy(reason));
  expect(await c.next()).toEqual(blockedBy(reason));
  expect(await c.answer(presentationId, null)).toEqual(blockedBy(reason));
  expect(kv.raw()).toBe(raw);
  expect(await readMeta(kv)).toBe(meta);
}

describe('Unit A pilot controller (tester mode behind beta and review)', () => {
  beforeAll(() => {
    // Preconditions on the real gates, so a failure below is the controller's, not the fixture's.
    expect(loadPrivateBetaConfig(BETA_ENV)).toEqual({
      enabled: true, apiBaseUrl: 'https://api.beta.example.com', authUrl: 'https://auth.beta.example.com',
    });
    expect(starterReviewAccess(approvedReview())).toEqual({ allowed: true });
    expect(starterReviewAccess()).toMatchObject({ allowed: false });
  });

  afterAll(() => {
    // The fixture approval never touches the source: it stays a synthetic, constructed draft with the same bytes.
    expect(PILOT_CONTENT).toMatchObject({ synthetic: true, constructed: true, reviewStatus: 'draft' });
    PILOT_CONTENT.items.forEach((i) => expect(i).toMatchObject({ reviewStatus: 'draft', constructed: true }));
    expect(sha256Hex(JSON.stringify(PILOT_CONTENT))).toBe(FIXTURE_SHA);
  });

  it('a valid beta with the compiled pending review blocks review and creates no pilot metadata', async () => {
    const kv = backend();
    const store = await open(kv);
    await store.setMeta('legacy_sentinel', 'keep-me');
    await expectAllBlocked(kv, make(store, { starterReview: undefined }), 'review');
    expect(await readMeta(kv)).toBeNull();
    expect(await (await open(kv)).getMeta('legacy_sentinel')).toBe('keep-me');
  });

  it('a valid beta with an exact approval loads the first lesson, then saves a four-choice question', async () => {
    const kv = backend();
    const c = make(await open(kv));
    const lesson = await c.load();
    expect(lesson).toMatchObject({ kind: 'lesson', lesson: { id: 'ua-d01-ref-lesson' } });
    const q = asQuestion(await c.next());
    expect(item(q.itemId)).toMatchObject({ construct: 'reference', phase: 'practice' });
    expect(JSON.parse((await readMeta(kv)) ?? 'null')).toMatchObject({
      owner: OWNER, contentVersion: PILOT_CONTENT.contentVersion, policyVersion: PILOT_CONTENT.policyVersion,
      attempts: [], current: { presentationId: q.presentationId, itemId: q.itemId, day: DAY },
    });
  });

  it('an exact approval without a valid private beta stays blocked on mode and writes nothing', async () => {
    expect(loadPrivateBetaConfig().enabled).toBe(false);
    const envs: (PrivateBetaEnv | undefined)[] = [
      undefined,
      {},
      { ...BETA_ENV, EXPO_PUBLIC_PRIVATE_QA: 'on' },
      { ...BETA_ENV, EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on' },
    ];
    for (const betaEnv of envs) {
      const kv = backend();
      await expectAllBlocked(kv, make(await open(kv), { betaEnv }), 'mode');
      expect(await readMeta(kv)).toBeNull();
    }
  });

  it('a stale, incomplete or bare-boolean review blocks review and writes nothing', async () => {
    const stale = approvedReview(sha256Hex(JSON.stringify({ ...PILOT_CONTENT, items: PILOT_CONTENT.items.slice(1) })));
    const incomplete = approvedReview();
    delete incomplete.reviews.assessment;
    for (const starterReview of [stale, incomplete, true, { allowed: true }]) {
      const kv = backend();
      await expectAllBlocked(kv, make(await open(kv), { starterReview }), 'review');
      expect(await readMeta(kv)).toBeNull();
    }
  });

  it('revoking the review on a live controller blocks next and answer, leaving the saved bytes exact', async () => {
    const kv = backend();
    const review = approvedReview();
    const c = make(await open(kv), { starterReview: review });
    const q = await firstQuestion(c);
    const before = await readMeta(kv);
    expect(before).not.toBeNull();
    review.status = 'pending';
    expect(await c.answer(q.presentationId, keyOf(q))).toEqual(blockedBy('review'));
    expect(await c.next()).toEqual(blockedBy('review'));
    expect(await c.load()).toEqual(blockedBy('review'));
    expect(await readMeta(kv)).toBe(before);
  });

  it.each([
    ['read-only', { readOnly: () => true }],
    ['inactive', { active: () => false }],
  ] as [string, Partial<TesterOptions>][])('an otherwise approved tester that is %s is refused and writes nothing', async (reason, over) => {
    const kv = backend();
    await expectAllBlocked(kv, make(await open(kv), over), reason);
    expect(await readMeta(kv)).toBeNull();
  });

  it('reopening after a saved first choice resumes from durable bytes; another learner is refused on owner', async () => {
    const kv = backend();
    const first = make(await open(kv), { random: seeded(1) });
    const q = await firstQuestion(first);
    const key = keyOf(q);
    expect(await first.answer(q.presentationId, key)).toMatchObject({ kind: 'feedback', outcome: 'correct' });
    first.dispose();
    const saved = await readMeta(kv);
    expect(JSON.parse(saved ?? 'null')).toMatchObject({
      attempts: [{ presentationId: q.presentationId, itemId: q.itemId, optionId: key }],
    });

    const resumed = make(await open(kv), { random: seeded(424242) });
    expect(await resumed.load()).toMatchObject({ kind: 'feedback', presentationId: q.presentationId, outcome: 'correct' });
    expect(await readMeta(kv)).toBe(saved);
    resumed.dispose();

    const stranger = make(await open(kv), { owner: 'pilot-tester-other' });
    await expectAllBlocked(kv, stranger, 'owner', q.presentationId);
    expect(await readMeta(kv)).toBe(saved);
  });
});
