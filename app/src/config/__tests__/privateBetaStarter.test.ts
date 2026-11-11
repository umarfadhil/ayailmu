// The private tester starter contract: a frontend beta capability read from explicit public env, and a content-review
// gate bound to the exact Unit A content. Config never approves content; only an exact compiled review record does.
// The actual compiled record is an owner-authorized, AI-only trial acceptance (one AI reviewer in all three sections):
// not human or expert certification, no mastery claim, and the content stays a synthetic draft.
// Every fixture reviewer, timestamp and origin below is fictional data for this test only, never evidence of a real
// review lifecycle.
import { loadSupabaseConfig } from '@/account/supabaseConfig';
import { PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN } from '@/account/privateQa';
import { stagingOrigin } from '@/account/staging';
import { PILOT_CONTENT, type PilotContent } from '@/pilot/unitA/content';
import { sha256Hex } from '@/sync/sha256';

// Local contract types until the implementation exists.
type PrivateBetaConfig = { enabled: true; apiBaseUrl: string; authUrl: string } | { enabled: false; reason: string };
type StarterAccess = { allowed: true } | { allowed: false; reason: string };
interface PrivateBetaModule {
  loadPrivateBetaConfig: (env?: object) => PrivateBetaConfig;
}
interface ReviewModule {
  UNIT_A_STARTER_REVIEW: unknown;
  unitAContentFingerprint: (content?: PilotContent) => string;
  starterReviewAccess: (review?: unknown, content?: PilotContent) => StarterAccess;
}

// New modules may be absent: load them so a missing one fails these tests normally, not the whole suite.
function optionalModule<T>(path: string): { mod: Partial<T>; error?: string } {
  try {
    return { mod: jest.requireActual<Partial<T>>(path) };
  } catch (error) {
    return { mod: {}, error: String(error) };
  }
}

function need<T, K extends keyof T>(loaded: { mod: Partial<T>; error?: string }, name: K): NonNullable<T[K]> {
  const value = loaded.mod[name];
  if (value === undefined) throw new Error(`${String(name)} is not available${loaded.error ? `: ${loaded.error}` : ''}`);
  return value as NonNullable<T[K]>;
}

const beta = optionalModule<PrivateBetaModule>('../privateBeta');
const review = optionalModule<ReviewModule>('../../pilot/unitA/review');
const loadConfig = (env?: object) => need(beta, 'loadPrivateBetaConfig')(env);
const fingerprint = (content?: PilotContent) => need(review, 'unitAContentFingerprint')(content);
const access = (...args: [review?: unknown, content?: PilotContent]) => need(review, 'starterReviewAccess')(...args);

const DENIED = { allowed: false, reason: expect.stringMatching(/\S/) };
const DISABLED = { enabled: false, reason: expect.stringMatching(/\S/) };

// Fictional public root origins (example.com is reserved for documentation), never real endpoints.
const API = 'https://api.beta.example.com';
const AUTH = 'https://auth.beta.example.com';

const READY = {
  EXPO_PUBLIC_PRIVATE_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_API_BASE_URL: API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH,
};

const BETA_KEYS = [...Object.keys(READY), 'EXPO_PUBLIC_PRIVATE_QA', 'EXPO_PUBLIC_CONTENT_REVIEW', 'EXPO_PUBLIC_STARTER_REVIEW'];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of BETA_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of BETA_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('private beta config', () => {
  it('exports loadPrivateBetaConfig', () => {
    expect(beta.error).toBeUndefined();
    expect(typeof beta.mod.loadPrivateBetaConfig).toBe('function');
  });

  it('is enabled with exactly the two validated origins when every setting is explicit', () => {
    expect(loadConfig(READY)).toEqual({ enabled: true, apiBaseUrl: API, authUrl: AUTH });
  });

  it('is disabled by default and for an empty env', () => {
    expect(loadConfig()).toEqual(DISABLED);
    expect(loadConfig({})).toEqual(DISABLED);
  });

  it.each<[string, string | undefined]>([
    ['EXPO_PUBLIC_PRIVATE_BETA', undefined],
    ['EXPO_PUBLIC_PRIVATE_BETA', 'ON'],
    ['EXPO_PUBLIC_PRIVATE_BETA', 'true'],
    ['EXPO_PUBLIC_APP_MODE', undefined],
    ['EXPO_PUBLIC_APP_MODE', 'developer-demo'],
    ['EXPO_PUBLIC_APP_MODE', 'production'],
    ['EXPO_PUBLIC_ACCOUNT_ENV', undefined],
    ['EXPO_PUBLIC_ACCOUNT_ENV', 'production'],
    ['EXPO_PUBLIC_ACCOUNT_ENV', 'private-qa'],
    ['EXPO_PUBLIC_AUTH_PROVIDER', undefined],
    ['EXPO_PUBLIC_AUTH_PROVIDER', 'firebase'],
    ['EXPO_PUBLIC_PRODUCTION_ACCOUNTS', undefined],
    ['EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'on'],
    ['EXPO_PUBLIC_PRIVATE_QA', 'on'],
  ])('is disabled when %s is %p', (key, value) => {
    expect(loadConfig({ ...READY, [key]: value })).toEqual(DISABLED);
  });

  it.each<[string, string | undefined]>([
    ['missing', undefined],
    ['empty', ''],
    ['http', 'http://api.beta.example.com'],
    ['loopback', 'http://127.0.0.1:8092'],
    ['localhost', 'https://localhost'],
    ['private QA API root', PRIVATE_QA_API_ORIGIN],
    ['private QA Auth root', PRIVATE_QA_AUTH_ORIGIN],
    ['a path', 'https://beta.example.com/auth/v1'],
    ['a trailing slash', 'https://beta.example.com/'],
    ['a port', 'https://beta.example.com:443'],
    ['upper case', 'https://Beta.Example.com'],
    ['a non-public name', 'https://beta.internal'],
    ['userinfo', 'https://user@beta.example.com'],
  ])('is disabled for an API or Auth origin with %s, never guessing one', (_label, origin) => {
    expect(loadConfig({ ...READY, EXPO_PUBLIC_API_BASE_URL: origin })).toEqual(DISABLED);
    expect(loadConfig({ ...READY, EXPO_PUBLIC_SUPABASE_AUTH_URL: origin })).toEqual(DISABLED);
  });

  it('is disabled when the API and Auth origins are the same', () => {
    expect(loadConfig({ ...READY, EXPO_PUBLIC_SUPABASE_AUTH_URL: API })).toEqual(DISABLED);
  });

  it('accepts origins by the existing staging rules, matching the staging account config', () => {
    expect(stagingOrigin(API)).toBe(API);
    expect(stagingOrigin(AUTH)).toBe(AUTH);
    expect(loadSupabaseConfig(READY)).toMatchObject({ enabled: true, environment: 'staging', apiBaseUrl: API, authUrl: AUTH });
  });
});

// A compiled approval for `content`, computed independently of the module under test. Reviewers are fictional.
const REVIEWED_AT = '2026-10-20T09:00:00.000Z';
const fictionalReview = (role: string) => ({ reviewer: `Fictional fixture reviewer (${role})`, reviewedAt: REVIEWED_AT });
const approvedFor = (content: PilotContent = PILOT_CONTENT) => ({
  status: 'approved-for-trial',
  contentVersion: content.contentVersion,
  contentSha256: sha256Hex(JSON.stringify(content)),
  reviews: { arabic: fictionalReview('arabic'), indonesian: fictionalReview('indonesian'), assessment: fictionalReview('assessment') },
});

const APPROVED = approvedFor();

// The actual compiled record's exact binding, written out here rather than read from the module under test.
const ACTUAL_SHA256 = '5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e';
const ACTUAL_REVIEWED_AT = '2026-10-30T10:25:22.000Z';
const ACTUAL_REVIEWER = '/root/check_fasih_expo';
const SECTIONS = ['arabic', 'indonesian', 'assessment'] as const;
const without = (record: object, key: string) => Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
const withReviews = (reviews: object) => ({ ...APPROVED, reviews });
const withSection = (section: 'arabic' | 'indonesian' | 'assessment', value: unknown) => withReviews({ ...APPROVED.reviews, [section]: value });

const changedLessonBody = (): PilotContent => ({
  ...PILOT_CONTENT,
  lessons: PILOT_CONTENT.lessons.map((lesson, index) =>
    index === 0 ? { ...lesson, body: [`${lesson.body[0]} Kalimat tambahan.`, ...lesson.body.slice(1)] } : lesson
  ),
});

describe('Unit A starter review gate', () => {
  it('exports the AI-bound compiled review, the fingerprint and the access decision', () => {
    expect(review.error).toBeUndefined();
    expect(review.mod.UNIT_A_STARTER_REVIEW).toBeDefined();
    expect(typeof review.mod.unitAContentFingerprint).toBe('function');
    expect(typeof review.mod.starterReviewAccess).toBe('function');
  });

  it('fingerprints the exact JSON of PILOT_CONTENT as lowercase SHA-256 by default', () => {
    const expected = sha256Hex(JSON.stringify(PILOT_CONTENT));
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint()).toBe(expected);
    expect(fingerprint(PILOT_CONTENT)).toBe(expected);
  });

  it('defaults to the actual AI-bound compiled review: exact approved status and content hash, access allowed', () => {
    const starter = need(review, 'UNIT_A_STARTER_REVIEW') as { reviews: Record<string, { reviewer: string; reviewedAt: string }> };
    expect(starter).toMatchObject({ status: 'approved-for-trial', contentVersion: PILOT_CONTENT.contentVersion, contentSha256: ACTUAL_SHA256 });
    expect(fingerprint()).toBe(ACTUAL_SHA256);
    // One AI reviewer is recorded under all three sections, at the one acceptance time.
    const sections = SECTIONS.map((section) => starter.reviews[section]);
    const reviewers = sections.map((entry) => entry?.reviewer);
    expect(new Set(reviewers).size).toBe(1);
    expect(String(reviewers[0])).toContain(ACTUAL_REVIEWER);
    expect(sections.map((entry) => entry?.reviewedAt)).toEqual([ACTUAL_REVIEWED_AT, ACTUAL_REVIEWED_AT, ACTUAL_REVIEWED_AT]);
    expect(access()).toEqual({ allowed: true });
    expect(access(starter, PILOT_CONTENT)).toEqual({ allowed: true });
  });

  it('denies a bare pending record, which the actual default never falls back to', () => {
    expect(access({ status: 'pending' })).toEqual(DENIED);
    expect(access({ status: 'pending' }, PILOT_CONTENT)).toEqual(DENIED);
  });

  it('leaves the source content a synthetic draft', () => {
    const before = sha256Hex(JSON.stringify(PILOT_CONTENT));
    access(APPROVED);
    expect(PILOT_CONTENT).toMatchObject({ reviewStatus: 'draft', synthetic: true, constructed: true });
    expect(PILOT_CONTENT.items.every((item) => item.reviewStatus === 'draft')).toBe(true);
    expect(sha256Hex(JSON.stringify(PILOT_CONTENT))).toBe(before);
  });

  it('allows only an exact compiled approval of this content', () => {
    expect(access(APPROVED)).toEqual({ allowed: true });
    expect(access(APPROVED, PILOT_CONTENT)).toEqual({ allowed: true });
  });

  it.each<[string, unknown]>([
    ['null', null],
    ['an empty record', {}],
    ['a bare status string', 'approved-for-trial'],
    ['pending status', { ...APPROVED, status: 'pending' }],
    ['another status', { ...APPROVED, status: 'approved' }],
    ['a stale version', { ...APPROVED, contentVersion: 'unit-a-pilot-draft-0.0' }],
    ['a stale hash', { ...APPROVED, contentSha256: '0'.repeat(64) }],
    ['an upper-case hash', { ...APPROVED, contentSha256: APPROVED.contentSha256.toUpperCase() }],
    ['missing reviews', without(APPROVED, 'reviews')],
    ['empty reviews', withReviews({})],
    ['no Arabic review', withReviews(without(APPROVED.reviews, 'arabic'))],
    ['no Indonesian review', withReviews(without(APPROVED.reviews, 'indonesian'))],
    ['no assessment review', withReviews(without(APPROVED.reviews, 'assessment'))],
    ['an empty reviewer', withSection('arabic', { reviewer: '', reviewedAt: REVIEWED_AT })],
    ['a non-string reviewer', withSection('indonesian', { reviewer: 42, reviewedAt: REVIEWED_AT })],
    ['no timestamp', withSection('assessment', { reviewer: 'Fictional fixture reviewer (assessment)' })],
    ['an invalid timestamp', withSection('assessment', { reviewer: 'Fictional fixture reviewer (assessment)', reviewedAt: 'not-a-date' })],
    ['a non-ISO timestamp', withSection('arabic', { reviewer: 'Fictional fixture reviewer (arabic)', reviewedAt: 'October 20, 2026' })],
  ])('denies %s', (_label, record) => {
    expect(access(record, PILOT_CONTENT)).toEqual(DENIED);
  });

  it('binds approval to content: a changed lesson body changes the fingerprint and fails the former approval', () => {
    const changed = changedLessonBody();
    expect(fingerprint(changed)).not.toBe(fingerprint(PILOT_CONTENT));
    expect(fingerprint(changed)).toBe(sha256Hex(JSON.stringify(changed)));
    expect(access(APPROVED, changed)).toEqual(DENIED);
    expect(access(approvedFor(changed), changed)).toEqual({ allowed: true });
    expect(access(approvedFor(changed), PILOT_CONTENT)).toEqual(DENIED);
  });

  it('denies other content and a bumped version under the original approval', () => {
    const otherItem: PilotContent = {
      ...PILOT_CONTENT,
      items: PILOT_CONTENT.items.map((item, index) =>
        index === 0 ? { ...item, options: item.options.map((option, n) => (n === 0 ? { ...option, feedback: `${option.feedback}!` } : option)) } : item
      ),
    };
    const bumped = { ...PILOT_CONTENT, contentVersion: 'unit-a-pilot-draft-0.2' } as unknown as PilotContent;
    expect(access(APPROVED, otherItem)).toEqual(DENIED);
    expect(access(APPROVED, bumped)).toEqual(DENIED);
  });

  it('is never approved by the beta config, its env or approval-like variables', () => {
    expect(loadConfig(READY)).toMatchObject({ enabled: true });
    expect(access(loadConfig(READY))).toEqual(DENIED);
    expect(access(READY)).toEqual(DENIED);

    const compiled = need(review, 'UNIT_A_STARTER_REVIEW');
    const compiledBefore = JSON.stringify(compiled);

    Object.assign(process.env, READY, { EXPO_PUBLIC_CONTENT_REVIEW: 'approved-for-trial', EXPO_PUBLIC_STARTER_REVIEW: 'approved-for-trial' });
    jest.isolateModules(() => {
      const fresh = jest.requireActual<ReviewModule>('../../pilot/unitA/review');
      // The approval comes from the compiled record alone: a fresh load under these variables is that same record.
      expect(fresh.UNIT_A_STARTER_REVIEW).toEqual(compiled);
      expect(JSON.stringify(fresh.UNIT_A_STARTER_REVIEW)).toBe(compiledBefore);
      expect(fresh.starterReviewAccess()).toEqual({ allowed: true });
      // The variables cannot approve a missing, pending, stale or env-shaped record.
      expect(fresh.starterReviewAccess(null)).toEqual(DENIED);
      expect(fresh.starterReviewAccess({ status: 'pending' })).toEqual(DENIED);
      expect(fresh.starterReviewAccess({ ...APPROVED, contentSha256: '0'.repeat(64) })).toEqual(DENIED);
      expect(fresh.starterReviewAccess(process.env)).toEqual(DENIED);
    });
    expect(JSON.stringify(need(review, 'UNIT_A_STARTER_REVIEW'))).toBe(compiledBefore);
  });
});
