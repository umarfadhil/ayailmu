import { UNIT_A_STARTER_REVIEW, starterReviewAccess } from '@/pilot/unitA/review';

// Build eligibility only. This gate neither approves nor rewrites the content review: that is the compiled AI-only
// trial record alone (not human or expert certification), checked separately against the exact content.
type Env = Record<string, unknown>;

const API = 'https://api.example.org';
const AUTH = 'https://auth.example.org';
const k = (short: string) => `EXPO_PUBLIC_${short}`;
const SHORT: Record<string, string> = {
  NORMAL_USER_STARTER: 'on',
  APP_MODE: 'tester',
  AUTH_PROVIDER: 'local-supabase',
  ACCOUNT_ENV: 'production',
  PRODUCTION_ACCOUNTS: 'on',
  ACCOUNT_REGISTRATION: 'confirmed-email',
  PRIVATE_QA: 'off',
  PRIVATE_BETA: 'off',
  LEARNING_BETA: 'off',
  GOOGLE_SIGN_IN: 'off',
  PASSWORD_RECOVERY: 'off',
  REMEMBER_DEVICE: 'on',
  API_BASE_URL: API,
  SUPABASE_AUTH_URL: AUTH,
};
const VALID: Record<string, string> = Object.fromEntries(
  Object.entries(SHORT).map(([name, value]) => [k(name), value]),
);
const KEYS = Object.keys(VALID);
const REQUIRED = ['APP_MODE', 'AUTH_PROVIDER', 'ACCOUNT_ENV', 'PRODUCTION_ACCOUNTS', 'ACCOUNT_REGISTRATION'];
const CAPS = ['PRIVATE_QA', 'PRIVATE_BETA', 'LEARNING_BETA'];
const OPTIONAL_FEATURES = ['GOOGLE_SIGN_IN', 'PASSWORD_RECOVERY'];

// An undefined override removes the key.
const make = (over: Env = {}): Env => {
  const env: Env = { ...VALID, ...over };
  Object.keys(env).forEach((key) => {
    if (env[key] === undefined) delete env[key];
  });
  return env;
};

const load = (): { normalStarterBuild?: unknown } | undefined => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../normalStarter');
  } catch (error) {
    if ((error as { code?: string }).code === 'MODULE_NOT_FOUND') return undefined;
    throw error;
  }
};

const build = (env?: Env): boolean => {
  const fn = load()?.normalStarterBuild;
  expect(typeof fn).toBe('function');
  return (fn as (e?: Env) => boolean)(env);
};

const badUrls = (host: string) => [
  `httP://${host}`, `http://${host}`, 'https://localhost', 'https://127.0.0.1',
  `https://${host.replace(/\.org$/, '.invalid')}`, `https://${host.toUpperCase()}`,
  `https://${host}/`, `https://${host}/v1`, `https://${host}/auth/v1`, `https://${host}:8443`,
  `https://${host}?x=y`, `https://user@${host}`, 'not a url', '',
];

describe('normalStarterBuild', () => {
  it('is true for a valid frozen env and leaves the input unchanged', () => {
    const env = Object.freeze(make());
    expect(build(env)).toBe(true);
    expect(env).toEqual(VALID);
  });

  it.each(['on', 'off'])('accepts remember device %s', (value) => {
    expect(build(make({ [k('REMEMBER_DEVICE')]: value }))).toBe(true);
  });

  it.each([undefined, '', 'true', 'ON', 'yes'])('rejects remember device %p', (value) => {
    expect(build(make({ [k('REMEMBER_DEVICE')]: value }))).toBe(false);
  });

  it.each([undefined, '', 'off', 'ON', 'true'])('rejects starter flag %p', (value) => {
    expect(build(make({ [k('NORMAL_USER_STARTER')]: value }))).toBe(false);
  });

  it.each(REQUIRED.flatMap((name) => [[name, undefined], [name, ''], [name, 'bogus'], [name, SHORT[name].toUpperCase()]]))(
    'rejects required %s=%p',
    (name, value) => {
      expect(build(make({ [k(name as string)]: value }))).toBe(false);
    },
  );

  it.each(CAPS.flatMap((name) => [[name, undefined], [name, ''], [name, 'on'], [name, 'OFF'], [name, 'true']]))(
    'requires exact off for %s (got %p)',
    (name, value) => {
      expect(build(make({ [k(name as string)]: value }))).toBe(false);
    },
  );

  it.each(OPTIONAL_FEATURES.flatMap((name) => [[name, 'on'], [name, 'off']]))(
    'accepts optional feature %s=%p',
    (name, value) => {
      expect(build(make({ [k(name)]: value }))).toBe(true);
    },
  );

  it.each(OPTIONAL_FEATURES.flatMap((name) => [[name, undefined], [name, ''], [name, 'ON'], [name, 'OFF'], [name, 'true'], [name, 'bogus']]))(
    'rejects optional feature %s=%p',
    (name, value) => {
      expect(build(make({ [k(name as string)]: value }))).toBe(false);
    },
  );

  it.each(['staging', 'private-qa', 'learning-beta'])('rejects %s profile even with starter on', (mode) => {
    expect(build(make({ [k('APP_MODE')]: mode }))).toBe(false);
    expect(build(make({ [k('ACCOUNT_ENV')]: mode }))).toBe(false);
  });

  it('rejects endpoints that are missing, identical, or non-canonical, with no fallback', () => {
    expect(build(make({ [k('API_BASE_URL')]: undefined }))).toBe(false);
    expect(build(make({ [k('SUPABASE_AUTH_URL')]: undefined }))).toBe(false);
    expect(build(make({ [k('API_BASE_URL')]: undefined, [k('SUPABASE_AUTH_URL')]: undefined }))).toBe(false);
    expect(build(make({ [k('SUPABASE_AUTH_URL')]: API }))).toBe(false);
    badUrls('api.example.org').forEach((url) => expect(build(make({ [k('API_BASE_URL')]: url }))).toBe(false));
    badUrls('auth.example.org').forEach((url) => expect(build(make({ [k('SUPABASE_AUTH_URL')]: url }))).toBe(false));
  });

  it('never throws on non-string or malformed values', () => {
    KEYS.forEach((key) => {
      [null, 7, {}, [], true].forEach((value) => {
        expect(() => build(make({ [key]: value }))).not.toThrow();
        expect(build(make({ [key]: value }))).toBe(false);
      });
    });
  });

  it('reads process.env by default and restores it', () => {
    const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    try {
      Object.assign(process.env, VALID);
      expect(build()).toBe(true);
      process.env[k('NORMAL_USER_STARTER')] = 'off';
      expect(build()).toBe(false);
    } finally {
      KEYS.forEach((key) => {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      });
    }
  });

  it('build capability does not rewrite the content review: the compiled record allows, pending and stale deny', () => {
    const compiledBefore = JSON.stringify(UNIT_A_STARTER_REVIEW);
    expect(build(make())).toBe(true);
    // Allowed only because the actual compiled AI-only record matches the exact current content.
    expect(starterReviewAccess(UNIT_A_STARTER_REVIEW)).toEqual({ allowed: true });
    expect(starterReviewAccess()).toEqual({ allowed: true });
    // An explicit pending or stale record is still denied while the build gate is true.
    expect(starterReviewAccess({ status: 'pending' })).toMatchObject({ allowed: false });
    expect(starterReviewAccess({ ...UNIT_A_STARTER_REVIEW, contentSha256: '0'.repeat(64) })).toMatchObject({ allowed: false });
    // The build env alone is no review, and building leaves the compiled record exactly as it was.
    expect(starterReviewAccess(make())).toMatchObject({ allowed: false });
    expect(JSON.stringify(UNIT_A_STARTER_REVIEW)).toBe(compiledBefore);
  });
});
