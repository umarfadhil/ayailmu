// Learning-beta account configuration (B1), written before its implementation. A learning-beta build opts in with
// EXPO_PUBLIC_ACCOUNT_ENV=learning-beta and EXPO_PUBLIC_LEARNING_BETA=on beside the explicit self-hosted provider, in the
// tester app mode, with every other capability and every account feature flag exactly "off", and is then bound to two
// distinct strict public HTTPS root origins. Its capability (learningBeta: true) is the fifth argument of the two origin
// helpers (their four-argument behaviour unchanged). Nothing here contacts anything: the roots are only compared, and the
// public names are fictional placeholders (example.com). The profile and its flags are literals on purpose: no module of
// the profile exists yet, so this file reads the current ones only and fails on behaviour, never on a missing import.
import { accountApiOrigin, isUnknownAccountEnv } from '@/account/staging';
import { accountAuthOrigin, loadSupabaseConfig, type EnabledSupabaseConfig, type SupabaseConfig, type SupabaseEnv } from '@/account/supabaseConfig';

/** The build variables with the learning-beta ones, until SupabaseEnv names them. */
type LearningBetaEnv = SupabaseEnv & {
  EXPO_PUBLIC_LEARNING_BETA?: string;
  EXPO_PUBLIC_APP_MODE?: string;
  EXPO_PUBLIC_PRIVATE_BETA?: string;
  EXPO_PUBLIC_ACCOUNT_REGISTRATION?: string;
  EXPO_PUBLIC_GOOGLE_SIGN_IN?: string;
  EXPO_PUBLIC_PASSWORD_RECOVERY?: string;
};
/** What a loaded configuration carries once the capability exists, as a runtime shape. */
type LoadedConfig = EnabledSupabaseConfig & { learningBeta?: true };
/** The origin helpers with the future fifth argument, the learning-beta capability, so this file type-checks against their four parameters. */
type OriginCheck = (value: unknown, environment?: unknown, productionAccounts?: unknown, privateQa?: unknown, learningBeta?: unknown) => string | null;

const API = 'https://api.beta.example.com';
const AUTH = 'https://auth.beta.example.com';
const QA_API = 'https://localhost:58444';
const QA_AUTH = 'https://localhost:58445';
/** A value no refusal may repeat. */
const SENTINEL = 'leaky-sentinel-7';

const VALID: LearningBetaEnv = {
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_ACCOUNT_ENV: 'learning-beta',
  EXPO_PUBLIC_LEARNING_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: 'off',
  EXPO_PUBLIC_PRIVATE_BETA: 'off',
  EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'off',
  EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
  EXPO_PUBLIC_PASSWORD_RECOVERY: 'off',
  EXPO_PUBLIC_API_BASE_URL: API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH,
};
/** Exactly the fields of a learning-beta configuration: no productionAccounts and no privateQa. */
const ENABLED = { enabled: true, provider: 'local-supabase', environment: 'learning-beta', learningBeta: true, apiBaseUrl: API, authUrl: AUTH };

const load = (overrides: LearningBetaEnv = {}): SupabaseConfig => loadSupabaseConfig({ ...VALID, ...overrides });
const loadWith = (setting: keyof LearningBetaEnv, value: string | undefined): SupabaseConfig => loadSupabaseConfig({ ...VALID, [setting]: value });
const reasonOf = (config: SupabaseConfig): string => (config.enabled ? '' : config.reason);

/** Whether the build with `value` for `setting` is off, names the setting in its reason, and repeats nothing it was given. */
function verdict(setting: keyof LearningBetaEnv, value: string | undefined) {
  const config = loadWith(setting, value);
  const reason = reasonOf(config);
  return { value, enabled: config.enabled, names: reason.includes(setting), echoed: reason.includes(SENTINEL) || reason.includes('hunter2') };
}
const refused = (values: ReadonlyArray<string | undefined>) => values.map((value) => ({ value, enabled: false, names: true, echoed: false }));

/** Sets (or, for undefined, removes) one build variable in process.env. */
function setProcessEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** Runs `run` with the build variables in process.env set to `values` (unset ones removed), restoring their previous values after. */
function withProcessEnv<T>(values: LearningBetaEnv, run: () => T): T {
  const keys = Object.keys(VALID) as (keyof LearningBetaEnv)[];
  const previous = keys.map((key) => [key, process.env[key]] as const);
  for (const key of keys) setProcessEnv(key, values[key]);
  try {
    return run();
  } finally {
    for (const [key, value] of previous) setProcessEnv(key, value);
  }
}

const WRONG_ON = [undefined, '', 'ON', 'On', ' on', 'on ', 'true', '1', 'yes', 'off', SENTINEL];
const WRONG_TESTER = [undefined, '', 'TESTER', 'Tester', ' tester', 'tester ', 'developer-demo', 'developer', 'demo', 'on', SENTINEL];
const WRONG_OFF = [undefined, '', 'on', 'ON', 'OFF', 'Off', ' off', 'off ', 'false', '0', 'confirmed-email', 'private-qa-confirmed-email', SENTINEL];
const WRONG_PROVIDER = [undefined, '', 'supabase', 'LOCAL-SUPABASE', 'local-supabase ', 'firebase', 'supabase-cloud', SENTINEL];
/** Every setting a learning-beta build requires, with the values that must each turn it off. */
const REQUIRED: [keyof LearningBetaEnv, ReadonlyArray<string | undefined>][] = [
  ['EXPO_PUBLIC_AUTH_PROVIDER', WRONG_PROVIDER],
  ['EXPO_PUBLIC_LEARNING_BETA', WRONG_ON],
  ['EXPO_PUBLIC_APP_MODE', WRONG_TESTER],
  ['EXPO_PUBLIC_PRODUCTION_ACCOUNTS', WRONG_OFF],
  ['EXPO_PUBLIC_PRIVATE_QA', WRONG_OFF],
  ['EXPO_PUBLIC_PRIVATE_BETA', WRONG_OFF],
  ['EXPO_PUBLIC_ACCOUNT_REGISTRATION', WRONG_OFF],
  ['EXPO_PUBLIC_GOOGLE_SIGN_IN', WRONG_OFF],
  ['EXPO_PUBLIC_PASSWORD_RECOVERY', WRONG_OFF],
];

/** Not a canonical public HTTPS root origin: another scheme, case, port, path, host kind, or a non-public name. */
const BAD_ROOTS = [
  undefined,
  '',
  'http://api.beta.example.com',
  'HTTPS://api.beta.example.com',
  'https://API.beta.example.com',
  'https://api.beta.example.com/',
  'https://api.beta.example.com/v1',
  'https://api.beta.example.com/auth/v1',
  'https://api.beta.example.com:443',
  'https://api.beta.example.com:8443',
  'https://api.beta.example.com?x=1',
  'https://api.beta.example.com#x',
  'https://api.beta.example.com.',
  ' https://api.beta.example.com',
  'https://api.beta.example.com ',
  'https://user:hunter2@api.beta.example.com',
  `https://${SENTINEL}.beta.example.com:8443`,
  'https://beta',
  'https://127.0.0.1',
  'https://[::1]',
  'https://localhost',
  QA_API,
  'https://api.beta.example.test',
  'https://api.beta.example.internal',
  'http://127.0.0.1:8092',
  'http://127.0.0.1:54321',
];

describe('the learning-beta profile', () => {
  it('turns account sync on at the two public roots, marked learning-beta with the learningBeta capability and nothing of production or private QA', () => {
    const config = load();
    expect(config).toStrictEqual(ENABLED);
    expect(config).not.toHaveProperty('productionAccounts');
    expect(config).not.toHaveProperty('privateQa');
  });

  it('reads a frozen environment without writing to it, and is not a live view of it afterwards', () => {
    expect(loadSupabaseConfig(Object.freeze({ ...VALID }))).toStrictEqual(ENABLED);

    const env: LearningBetaEnv = { ...VALID };
    const config = loadSupabaseConfig(env);
    env.EXPO_PUBLIC_API_BASE_URL = 'https://api.other.example.com';
    env.EXPO_PUBLIC_LEARNING_BETA = 'off';
    expect(config).toStrictEqual(ENABLED);
    expect(loadSupabaseConfig(env).enabled).toBe(false);
  });

  it('reads the static EXPO_PUBLIC_* build variables by default, the new ones included', () => {
    expect(withProcessEnv(VALID, () => loadSupabaseConfig())).toStrictEqual(ENABLED);
    expect(withProcessEnv({ ...VALID, EXPO_PUBLIC_PASSWORD_RECOVERY: 'on' }, () => loadSupabaseConfig()).enabled).toBe(false);
    expect(withProcessEnv({ ...VALID, EXPO_PUBLIC_APP_MODE: undefined }, () => loadSupabaseConfig()).enabled).toBe(false);
  });

  it.each(REQUIRED)('turns off when %s is missing, wrong or in another case, naming the setting and never its value', (setting, wrong) => {
    expect(wrong.map((value) => verdict(setting, value))).toStrictEqual(refused(wrong));
  });

  it('turns off for any other spelling of the profile, however the flags and roots are set', () => {
    const spellings = [undefined, '', 'learning_beta', 'LEARNING-BETA', 'Learning-Beta', ' learning-beta', 'learning-beta ', 'learning-beta\n', 'learningbeta', 'beta'];
    expect(spellings.filter((profile) => load({ EXPO_PUBLIC_ACCOUNT_ENV: profile }).enabled)).toStrictEqual([]);
  });

  it.each(['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL'] as const)(
    'turns off when %s is not a canonical public https root, naming the setting and never echoing the value',
    (setting) => {
      expect(BAD_ROOTS.map((root) => verdict(setting, root))).toStrictEqual(refused(BAD_ROOTS));
      expect(BAD_ROOTS.filter((root) => typeof root === 'string' && root !== '' && reasonOf(loadWith(setting, root)).includes(root))).toStrictEqual([]);
    }
  );

  it.each<[string, string]>([
    ['the API root', API],
    ['the Auth root', AUTH],
  ])('turns off when one root (%s) serves both the API and the Auth server, naming an origin setting and never the origin', (_, root) => {
    const config = load({ EXPO_PUBLIC_API_BASE_URL: root, EXPO_PUBLIC_SUPABASE_AUTH_URL: root });
    expect(config.enabled).toBe(false);
    expect(reasonOf(config)).toMatch(/EXPO_PUBLIC_(API_BASE_URL|SUPABASE_AUTH_URL)/);
    expect(reasonOf(config)).not.toContain(root);
  });
});

describe('the learning-beta flags in another build', () => {
  /** Every variable the profile adds, set the way a learning-beta build sets them. */
  const NEW_FLAGS: LearningBetaEnv = {
    EXPO_PUBLIC_LEARNING_BETA: 'on',
    EXPO_PUBLIC_APP_MODE: 'tester',
    EXPO_PUBLIC_PRIVATE_BETA: 'off',
    EXPO_PUBLIC_ACCOUNT_REGISTRATION: 'off',
    EXPO_PUBLIC_GOOGLE_SIGN_IN: 'off',
    EXPO_PUBLIC_PASSWORD_RECOVERY: 'off',
  };
  const PROVIDER: LearningBetaEnv = { EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase' };

  it.each<[string, LearningBetaEnv, boolean]>([
    ['local', { ...PROVIDER, EXPO_PUBLIC_API_BASE_URL: 'http://127.0.0.1:8092', EXPO_PUBLIC_SUPABASE_AUTH_URL: 'http://127.0.0.1:54321' }, true],
    ['staging', { ...PROVIDER, EXPO_PUBLIC_ACCOUNT_ENV: 'staging', EXPO_PUBLIC_API_BASE_URL: API, EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH }, true],
    [
      'production',
      { ...PROVIDER, EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on', EXPO_PUBLIC_API_BASE_URL: API, EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH },
      true,
    ],
    [
      'private-qa',
      { ...PROVIDER, EXPO_PUBLIC_ACCOUNT_ENV: 'private-qa', EXPO_PUBLIC_PRIVATE_QA: 'on', EXPO_PUBLIC_API_BASE_URL: QA_API, EXPO_PUBLIC_SUPABASE_AUTH_URL: QA_AUTH },
      true,
    ],
    ['production without its flag', { ...PROVIDER, EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_API_BASE_URL: API, EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH }, false],
  ])('leave a %s build exactly as it is, and never confer the learningBeta capability on it', (_, build, enabled) => {
    const baseline = loadSupabaseConfig(build);
    expect(baseline.enabled).toBe(enabled);
    for (const flags of [{ EXPO_PUBLIC_LEARNING_BETA: 'on' }, NEW_FLAGS]) {
      const config = loadSupabaseConfig({ ...build, ...flags });
      expect(config).toStrictEqual(baseline);
      expect(config).not.toHaveProperty('learningBeta');
      expect(config).not.toMatchObject({ environment: 'learning-beta' });
    }
  });
});

const apiOrigin = accountApiOrigin as unknown as OriginCheck;
const authOrigin = accountAuthOrigin as unknown as OriginCheck;

interface Helper {
  name: string;
  check: OriginCheck;
  /** Its own side's public root (the learning-beta, staging and production one), private QA root and local root. */
  root: string;
  privateQaRoot: string;
  localRoot: string;
}
const HELPERS: Helper[] = [
  { name: 'accountApiOrigin', check: apiOrigin, root: API, privateQaRoot: QA_API, localRoot: 'http://127.0.0.1:8092' },
  { name: 'accountAuthOrigin', check: authOrigin, root: AUTH, privateQaRoot: QA_AUTH, localRoot: 'http://127.0.0.1:54321' },
];

interface OtherProfile {
  name: string;
  environment: unknown;
  productionAccounts?: unknown;
  privateQa?: unknown;
  rootOf: (helper: Helper) => string;
}
const OTHER_PROFILES: OtherProfile[] = [
  { name: 'local default', environment: undefined, rootOf: (helper) => helper.localRoot },
  { name: 'staging', environment: 'staging', rootOf: (helper) => helper.root },
  { name: 'production', environment: 'production', productionAccounts: true, rootOf: (helper) => helper.root },
  { name: 'private-qa', environment: 'private-qa', privateQa: true, rootOf: (helper) => helper.privateQaRoot },
];

describe.each(HELPERS)('$name and the learning-beta capability', (helper) => {
  const { check, root } = helper;

  it('takes a canonical public root, as written, only with the exact learning-beta profile and the fifth capability argument', () => {
    expect(check(root, 'learning-beta', undefined, undefined, true)).toBe(root);
  });

  it('refuses a missing or inexact capability, the capability beside another capability, and another spelling of the profile', () => {
    expect(check(root, 'learning-beta')).toBeNull();
    expect(check(root, 'learning-beta', undefined, undefined)).toBeNull();
    const capabilities = [undefined, null, false, 'true', 'on', 1, {}];
    expect(capabilities.filter((capability) => check(root, 'learning-beta', undefined, undefined, capability) !== null)).toStrictEqual([]);
    // A production or private QA capability beside it, whatever its value, is mixing profiles.
    const mixed = [
      [true, undefined],
      [false, undefined],
      [undefined, true],
      [undefined, false],
      [true, true],
    ];
    expect(mixed.filter(([production, privateQa]) => check(root, 'learning-beta', production, privateQa, true) !== null)).toStrictEqual([]);
    const spellings = [undefined, null, '', 'learning_beta', 'LEARNING-BETA', 'Learning-Beta', ' learning-beta', 'learning-beta ', 'learningbeta', 'beta'];
    expect(spellings.filter((profile) => check(root, profile, undefined, undefined, true) !== null)).toStrictEqual([]);
  });

  it('refuses a value that is not a canonical public https root, capability or not', () => {
    const values = [...BAD_ROOTS, null, 42, {}, [root]];
    expect(values.filter((value) => check(value, 'learning-beta', undefined, undefined, true) !== null)).toStrictEqual([]);
    expect(values.filter((value) => check(value, 'learning-beta') !== null)).toStrictEqual([]);
  });

  it.each(OTHER_PROFILES)('does not lend the capability to the $name profile, and leaves its answer alone without it', (profile) => {
    const value = profile.rootOf(helper);
    expect(check(value, profile.environment, profile.productionAccounts, profile.privateQa)).toBe(value);
    expect(check(value, profile.environment, profile.productionAccounts, profile.privateQa, undefined)).toBe(value);
    expect(check(value, profile.environment, profile.productionAccounts, profile.privateQa, true)).toBeNull();
  });
});

it('hands a loaded learning-beta configuration to the origin helpers unchanged, and each helper accepts the root of its own side', () => {
  const config = load() as LoadedConfig;
  expect(config.enabled).toBe(true);
  const { apiBaseUrl, authUrl, environment, productionAccounts, privateQa, learningBeta } = config;
  expect(apiOrigin(apiBaseUrl, environment, productionAccounts, privateQa, learningBeta)).toBe(API);
  expect(authOrigin(authUrl, environment, productionAccounts, privateQa, learningBeta)).toBe(AUTH);
});

it('keeps learning-beta an unknown profile for the shared guard, so the old Google guard keeps refusing it', () => {
  const unknown = ['learning-beta', 'LEARNING-BETA', ' learning-beta', 'learning-beta ', 'learning_beta', 'production', 'private-qa'];
  expect(unknown.filter((profile) => !isUnknownAccountEnv(profile))).toStrictEqual([]);
  const known = [undefined, '', 'staging'];
  expect(known.filter((profile) => isUnknownAccountEnv(profile))).toStrictEqual([]);
});
