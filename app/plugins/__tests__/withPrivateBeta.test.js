// Contract for the private tester beta build plugin (plugins/withPrivateBeta.js) and its forthcoming EAS profile,
// written before the implementation. Pure config tests: no native build, network, credentials, signing or filesystem write.
//
// - Off unless EXPO_PUBLIC_PRIVATE_BETA is exactly "on": the very same config object comes back and nothing is read or touched.
// - On: the exact flags of src/config/privateBeta.ts, two distinct staging root origins, and the owner-supplied nonsecret
//   AYAFASIH_BETA_IOS_BUNDLE_ID / AYAFASIH_BETA_ANDROID_PACKAGE. Any problem throws a message that names the setting and
//   never a supplied value. Existing, different identifiers are refused, never overwritten.
// - Only ios.bundleIdentifier and android.package are set; the caller's config object is never mutated.
//
// Fixture origins and identifiers are documented TEST-ONLY values: never real endpoints or selected identities.
// The plugin is loaded lazily, so while it is absent every case fails on the missing behavior, not on a parse error.
const fs = require('fs');
const path = require('path');

const API = 'https://api.beta.example.com';
const AUTH = 'https://auth.beta.example.com';
const IOS_ID = 'com.example.ayafasih.beta';
const ANDROID_ID = 'com.example.ayafasih.beta';

const VALID_ENV = Object.freeze({
  EXPO_PUBLIC_PRIVATE_BETA: 'on',
  EXPO_PUBLIC_APP_MODE: 'tester',
  EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
  EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
  EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
  EXPO_PUBLIC_PRIVATE_QA: undefined,
  EXPO_PUBLIC_API_BASE_URL: API,
  EXPO_PUBLIC_SUPABASE_AUTH_URL: AUTH,
  AYAFASIH_BETA_IOS_BUNDLE_ID: IOS_ID,
  AYAFASIH_BETA_ANDROID_PACKAGE: ANDROID_ID,
});
const ENV_KEYS = Object.keys(VALID_ENV);

const clone = (value) => JSON.parse(JSON.stringify(value));
const deepFreeze = (value) => {
  if (typeof value === 'object' && value !== null) Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

function loadPlugin() {
  try {
    return require('../withPrivateBeta');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && /withPrivateBeta/.test(error.message)) return undefined;
    throw error;
  }
}

/** The plugin, or a failing expectation while it does not exist yet (so a "throws" case cannot pass vacuously). */
function plugin() {
  const loaded = loadPlugin();
  expect(typeof loaded).toBe('function');
  return loaded;
}

// Env keys are set through computed objects, never as process.env.EXPO_PUBLIC_* members the Babel preset may inline.
let savedEnv;
beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function setEnv(overrides = {}) {
  for (const [key, value] of Object.entries({ ...VALID_ENV, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function baseConfig() {
  return {
    name: 'MockApp',
    slug: 'mock-app',
    scheme: 'mockscheme',
    version: '0.0.1',
    plugins: ['expo-font', ['expo-secure-store', { configureAndroidBackup: true }], './plugins/withPrivateQa'],
    extra: { appMode: 'tester', router: { origin: false } },
    ios: { supportsTablet: true, infoPlist: { ITSAppUsesNonExemptEncryption: false } },
    android: { blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW'], permissions: ['android.permission.CAMERA'] },
  };
}

/** The thrown error of `run` (after the plugin exists), with the supplied values and the whole env checked for leaks. */
function failureOf(config = baseConfig()) {
  const run = plugin();
  let failure;
  try {
    run(config);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  return failure;
}

function expectRejectedNaming(setting, overrides, config) {
  setEnv(overrides);
  const failure = failureOf(config);
  expect(failure.message).toContain(setting);
  // Only origin- and identifier-like values are checked: a flag word such as "off" may legitimately appear in a message.
  for (const value of Object.values(overrides)) {
    if (typeof value === 'string' && /[./]/.test(value)) expect(failure.message).not.toContain(value.trim());
  }
  for (const value of [API, AUTH, IOS_ID]) expect(failure.message).not.toContain(value);
}

describe('withPrivateBeta: off', () => {
  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['off', 'off'],
    ['uppercase ON', 'ON'],
    ['true', 'true'],
    ['padded', ' on'],
  ])('flag %s returns the identical config, even beside invalid settings', (_, flag) => {
    setEnv({
      EXPO_PUBLIC_PRIVATE_BETA: flag,
      EXPO_PUBLIC_API_BASE_URL: 'http://localhost:1/x',
      AYAFASIH_BETA_IOS_BUNDLE_ID: 'not an id',
      AYAFASIH_BETA_ANDROID_PACKAGE: undefined,
    });
    const input = deepFreeze(baseConfig());
    const snapshot = clone(input);
    const envBefore = { ...process.env };

    expect(plugin()(input)).toBe(input);

    expect(input).toStrictEqual(snapshot);
    expect({ ...process.env }).toStrictEqual(envBefore);
  });

  test('an ordinary config that already has identifiers keeps them untouched', () => {
    setEnv({ EXPO_PUBLIC_PRIVATE_BETA: undefined });
    const input = { ...baseConfig(), ios: { bundleIdentifier: 'other.existing.app' }, android: { package: 'other.existing.app' } };
    expect(plugin()(input)).toBe(input);
    expect(input.ios).toStrictEqual({ bundleIdentifier: 'other.existing.app' });
  });
});

describe('withPrivateBeta: on, missing and wrong settings', () => {
  test.each([
    'EXPO_PUBLIC_APP_MODE',
    'EXPO_PUBLIC_ACCOUNT_ENV',
    'EXPO_PUBLIC_AUTH_PROVIDER',
    'EXPO_PUBLIC_PRODUCTION_ACCOUNTS',
    'EXPO_PUBLIC_API_BASE_URL',
    'EXPO_PUBLIC_SUPABASE_AUTH_URL',
    'AYAFASIH_BETA_IOS_BUNDLE_ID',
    'AYAFASIH_BETA_ANDROID_PACKAGE',
  ])('%s missing: throws naming the setting', (setting) => {
    expectRejectedNaming(setting, { [setting]: undefined });
  });

  test.each([
    ['AYAFASIH_BETA_IOS_BUNDLE_ID', ''],
    ['AYAFASIH_BETA_ANDROID_PACKAGE', ''],
    ['EXPO_PUBLIC_API_BASE_URL', ''],
  ])('%s empty: throws naming the setting', (setting, value) => {
    expectRejectedNaming(setting, { [setting]: value });
  });

  test.each([
    ['app mode developer-demo', 'EXPO_PUBLIC_APP_MODE', 'developer-demo'],
    ['app mode TESTER', 'EXPO_PUBLIC_APP_MODE', 'TESTER'],
    ['account env production', 'EXPO_PUBLIC_ACCOUNT_ENV', 'production'],
    ['account env private-qa', 'EXPO_PUBLIC_ACCOUNT_ENV', 'private-qa'],
    ['provider off', 'EXPO_PUBLIC_AUTH_PROVIDER', 'off'],
    ['provider supabase', 'EXPO_PUBLIC_AUTH_PROVIDER', 'supabase'],
    ['production accounts on', 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS', 'on'],
    ['production accounts empty', 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS', ''],
    ['private QA on', 'EXPO_PUBLIC_PRIVATE_QA', 'on'],
    ['private QA true', 'EXPO_PUBLIC_PRIVATE_QA', 'true'],
  ])('wrong flag, %s: throws naming the setting', (_, setting, value) => {
    expectRejectedNaming(setting, { [setting]: value });
  });

  test.each([
    ['unset', undefined],
    ['empty', ''],
    ['off', 'off'],
  ])('private QA %s is accepted', (_, value) => {
    setEnv({ EXPO_PUBLIC_PRIVATE_QA: value });
    expect(plugin()(baseConfig()).ios.bundleIdentifier).toBe(IOS_ID);
  });

  test('a mixed private QA build (QA flag, QA origins, QA account env, production on) is refused', () => {
    setEnv({
      EXPO_PUBLIC_PRIVATE_QA: 'on',
      EXPO_PUBLIC_ACCOUNT_ENV: 'private-qa',
      EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
      EXPO_PUBLIC_API_BASE_URL: 'https://localhost:58444',
      EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://localhost:58445',
    });
    const failure = failureOf();
    expect(failure.message).toMatch(/EXPO_PUBLIC_[A-Z_]+/);
    expect(failure.message).not.toContain('58444');
    expect(failure.message).not.toContain(IOS_ID);
  });
});

describe('withPrivateBeta: on, origins', () => {
  const UNSAFE = [
    ['http', 'http://api.beta.example.com'],
    ['localhost', 'https://localhost'],
    ['loopback IP', 'https://127.0.0.1'],
    ['public IP', 'https://203.0.113.10'],
    ['single-label host', 'https://api'],
    ['a path', 'https://api.beta.example.com/v1'],
    ['a trailing slash', 'https://api.beta.example.com/'],
    ['a query', 'https://api.beta.example.com?x=1'],
    ['a fragment', 'https://api.beta.example.com#frag'],
    ['userinfo', 'https://user:hunter2@api.beta.example.com'],
    ['surrounding space', ' https://api.beta.example.com'],
  ];

  test.each(UNSAFE)('API origin with %s: throws naming the setting, never the value', (_, value) => {
    expectRejectedNaming('EXPO_PUBLIC_API_BASE_URL', { EXPO_PUBLIC_API_BASE_URL: value });
  });

  test.each(UNSAFE.map(([label, value]) => [label, value.replace('api.', 'auth.')]))(
    'Auth origin with %s: throws naming the setting, never the value',
    (_, value) => {
      expectRejectedNaming('EXPO_PUBLIC_SUPABASE_AUTH_URL', { EXPO_PUBLIC_SUPABASE_AUTH_URL: value });
    }
  );

  test('the API and Auth origins being equal is refused', () => {
    expectRejectedNaming('EXPO_PUBLIC_SUPABASE_AUTH_URL', { EXPO_PUBLIC_SUPABASE_AUTH_URL: API });
  });
});

describe('withPrivateBeta: on, identifiers', () => {
  test.each([
    ['no dot', 'ayafasih'],
    ['trailing dot', 'com.example.'],
    ['empty segment', 'com..beta'],
    ['a space', 'com.example. beta'],
    ['a slash', 'com.example/beta'],
    ['a trailing newline', `${IOS_ID}\n`],
    ['a URL', 'https://com.example.beta'],
  ])('iOS bundle id with %s: throws naming the setting, never the value', (_, value) => {
    expectRejectedNaming('AYAFASIH_BETA_IOS_BUNDLE_ID', { AYAFASIH_BETA_IOS_BUNDLE_ID: value });
  });

  test.each([
    ['no dot', 'ayafasih'],
    ['trailing dot', 'com.example.'],
    ['empty segment', 'com..beta'],
    ['a hyphen', 'com.example.beta-x'],
    ['a segment starting with a digit', 'com.example.1beta'],
    ['a segment starting with an underscore', 'com.example._beta'],
    ['a trailing newline', `${ANDROID_ID}\n`],
  ])('Android package with %s: throws naming the setting, never the value', (_, value) => {
    expectRejectedNaming('AYAFASIH_BETA_ANDROID_PACKAGE', { AYAFASIH_BETA_ANDROID_PACKAGE: value });
  });

  test.each([
    ['iOS bundleIdentifier', { ios: { bundleIdentifier: 'other.existing.app' } }, /bundleIdentifier/],
    ['Android package', { android: { package: 'other.existing.app' } }, /package/],
  ])('an existing different %s is refused, not overwritten, and never echoed', (_, patch, name) => {
    setEnv();
    const input = deepFreeze({ ...baseConfig(), ...patch });
    const snapshot = clone(input);
    const failure = failureOf(input);
    expect(failure.message).toMatch(name);
    expect(failure.message).not.toContain('other.existing.app');
    expect(input).toStrictEqual(snapshot);
  });
});

describe('withPrivateBeta: on, valid', () => {
  test('sets exactly ios.bundleIdentifier and android.package and preserves everything else', () => {
    setEnv();
    const input = deepFreeze(baseConfig());
    const snapshot = clone(input);

    const result = plugin()(input);

    const expected = clone(snapshot);
    expected.ios.bundleIdentifier = IOS_ID;
    expected.android.package = ANDROID_ID;
    expect(result).toStrictEqual(expected);
    expect(input).toStrictEqual(snapshot);
    for (const absent of ['owner', 'projectId']) expect(result).not.toHaveProperty(absent);
    expect(result.ios).not.toHaveProperty('appleTeamId');
    expect(result.extra).not.toHaveProperty('eas');
    expect(result.mods).toBeUndefined();
  });

  test('creates ios and android when the config has neither', () => {
    setEnv();
    const input = deepFreeze({ name: 'MockApp', slug: 'mock-app' });
    expect(plugin()(input)).toStrictEqual({
      name: 'MockApp',
      slug: 'mock-app',
      ios: { bundleIdentifier: IOS_ID },
      android: { package: ANDROID_ID },
    });
  });

  test('leaves the process environment as it found it', () => {
    setEnv();
    const envBefore = { ...process.env };
    plugin()(baseConfig());
    expect({ ...process.env }).toStrictEqual(envBefore);
  });
});

const APP_DIR = path.join(__dirname, '..', '..');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(APP_DIR, file), 'utf8'));

describe('eas.json: the private-beta profile', () => {
  const eas = readJson('eas.json');
  const profile = () => {
    expect(eas.build).toHaveProperty('private-beta');
    return eas.build['private-beta'];
  };

  test('is a store (TestFlight preparation) build: ios device, android apk, no dev client, no submit', () => {
    const beta = profile();
    expect(beta.distribution).toBe('store');
    expect(beta.ios.simulator).toBe(false);
    expect(beta.android.buildType).toBe('apk');
    expect([undefined, false]).toContain(beta.developmentClient);
    expect(eas).not.toHaveProperty('submit');
    for (const key of ['submit', 'autoSubmit', 'credentialsSource']) expect(beta).not.toHaveProperty(key);
  });

  test('env: beta on, tester, staging, local-supabase, production and private QA off, no dotenv', () => {
    const { env } = profile();
    expect(env).toMatchObject({
      EXPO_PUBLIC_PRIVATE_BETA: 'on',
      EXPO_PUBLIC_APP_MODE: 'tester',
      EXPO_PUBLIC_ACCOUNT_ENV: 'staging',
      EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
      EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off',
      EXPO_NO_DOTENV: '1',
    });
    expect([undefined, 'off']).toContain(env.EXPO_PUBLIC_PRIVATE_QA);
  });

  test('embeds no endpoint, identifier, team, project or credential value, and no registration switch on', () => {
    const beta = profile();
    for (const key of ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL', 'AYAFASIH_BETA_IOS_BUNDLE_ID', 'AYAFASIH_BETA_ANDROID_PACKAGE']) {
      expect(beta.env).not.toHaveProperty(key);
    }
    expect(JSON.stringify(beta)).not.toMatch(/https?:|example\.com|team|credential|projectid|owner|ascapp|serviceaccount|keystore/i);
    for (const [key, value] of Object.entries(beta.env)) {
      if (/REGISTRATION|SIGNUP|SIGN_UP/i.test(key)) expect(value).toBe('off');
    }
  });

  test('the ordinary developer, staging and production profiles keep their old values exactly', () => {
    const common = { node: '22.16.0', autoIncrement: false };
    const env = { EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'off', EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1' };
    expect(eas.cli).toStrictEqual({ version: '>= 16.0.0', appVersionSource: 'local' });
    expect(eas.build['developer-preview']).toStrictEqual({
      distribution: 'internal',
      ...common,
      env: { EXPO_PUBLIC_APP_MODE: 'developer-demo', EXPO_PUBLIC_AUTH_PROVIDER: 'off', ...env },
      android: { buildType: 'apk' },
      ios: { simulator: false },
    });
    expect(eas.build['staging-tester']).toStrictEqual({
      distribution: 'internal',
      ...common,
      env: { EXPO_PUBLIC_APP_MODE: 'tester', EXPO_PUBLIC_ACCOUNT_ENV: 'staging', EXPO_PUBLIC_AUTH_PROVIDER: 'off', ...env },
      android: { buildType: 'apk' },
      ios: { simulator: false },
    });
    expect(eas.build.production).toStrictEqual({
      distribution: 'store',
      ...common,
      env: { EXPO_PUBLIC_APP_MODE: 'tester', EXPO_PUBLIC_ACCOUNT_ENV: 'production', EXPO_PUBLIC_AUTH_PROVIDER: 'off', ...env },
      android: { buildType: 'app-bundle' },
    });
  });
});

describe('app.json', () => {
  const { expo } = readJson('app.json');

  test('references ./plugins/withPrivateBeta beside the existing ./plugins/withPrivateQa', () => {
    expect(expo.plugins).toContain('./plugins/withPrivateBeta');
    expect(expo.plugins).toContain('./plugins/withPrivateQa');
  });

  test('declares no identifiers or owner of its own: only the plugin may supply them', () => {
    expect(expo.ios).not.toHaveProperty('bundleIdentifier');
    expect(expo.android).not.toHaveProperty('package');
    expect(expo).not.toHaveProperty('owner');
    expect(expo).not.toHaveProperty('extra.eas');
  });
});
