// Regression tests for plugins/withLearningBeta.js and the eas.json "learning-beta" build profile.
// Fictional, local-only inputs: no credentials, accounts, builds, signing or network.
const fs = require('fs');
const path = require('path');

const IOS_ID = 'com.example.beta.ios';
const ANDROID_ID = 'com.example.beta.android';
const OTHER_ID = 'com.example.other';
const SIX_OFF = ['PRODUCTION_ACCOUNTS', 'PRIVATE_QA', 'PRIVATE_BETA', 'ACCOUNT_REGISTRATION', 'GOOGLE_SIGN_IN', 'PASSWORD_RECOVERY'].map((name) => `EXPO_PUBLIC_${name}`);
const URL_AND_ID_KEYS = ['EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_SUPABASE_AUTH_URL', 'AYAFASIH_LEARNING_BETA_IOS_BUNDLE_ID', 'AYAFASIH_LEARNING_BETA_ANDROID_PACKAGE'];
const KEYS = [...SIX_OFF, ...URL_AND_ID_KEYS, 'EXPO_PUBLIC_LEARNING_BETA', 'EXPO_PUBLIC_APP_MODE', 'EXPO_PUBLIC_ACCOUNT_ENV', 'EXPO_PUBLIC_AUTH_PROVIDER'];

function load() {
  try {
    return require('../withLearningBeta');
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return undefined;
    throw error;
  }
}

function deepFreeze(value) {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const baseConfig = () => ({ name: 'Beta', ios: { supportsTablet: true }, android: { adaptiveIcon: { backgroundColor: '#fff' } } });

function setValidEnv(overrides = {}) {
  Object.assign(process.env, {
    EXPO_PUBLIC_LEARNING_BETA: 'on',
    EXPO_PUBLIC_APP_MODE: 'tester',
    EXPO_PUBLIC_ACCOUNT_ENV: 'learning-beta',
    EXPO_PUBLIC_AUTH_PROVIDER: 'local-supabase',
    EXPO_PUBLIC_API_BASE_URL: 'https://api.beta.example.com',
    EXPO_PUBLIC_SUPABASE_AUTH_URL: 'https://auth.beta.example.com',
    AYAFASIH_LEARNING_BETA_IOS_BUNDLE_ID: IOS_ID,
    AYAFASIH_LEARNING_BETA_ANDROID_PACKAGE: ANDROID_ID,
    ...Object.fromEntries(SIX_OFF.map((key) => [key, 'off'])),
    ...overrides,
  });
}

describe('withLearningBeta', () => {
  let saved;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
    KEYS.forEach((key) => delete process.env[key]);
  });

  afterEach(() => {
    KEYS.forEach((key) => (saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key])));
  });

  it('returns the identical config unless EXPO_PUBLIC_LEARNING_BETA is exactly on, even with bad flags', () => {
    const plugin = load();
    expect(typeof plugin).toBe('function');
    for (const flag of [undefined, '', 'off', 'ON', 'true', ' on']) {
      setValidEnv({ EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_AUTH_PROVIDER: 'bogus', EXPO_PUBLIC_API_BASE_URL: 'http://x', EXPO_PUBLIC_LEARNING_BETA: flag });
      if (flag === undefined) delete process.env.EXPO_PUBLIC_LEARNING_BETA;
      const config = baseConfig();
      expect(plugin(config)).toBe(config);
    }
  });

  it('returns a new config that differs only in the two identifiers, without touching input or env', () => {
    const plugin = load();
    expect(typeof plugin).toBe('function');
    setValidEnv();
    const envBefore = { ...process.env };
    const config = deepFreeze(baseConfig());
    const result = plugin(config);
    expect(result).not.toBe(config);
    expect(result).toEqual({ ...baseConfig(), ios: { supportsTablet: true, bundleIdentifier: IOS_ID }, android: { adaptiveIcon: { backgroundColor: '#fff' }, package: ANDROID_ID } });
    expect(config).toEqual(baseConfig());
    expect(process.env).toEqual(envBefore);
  });

  it('rejects when GOOGLE_SIGN_IN is on and leaves the input unchanged', () => {
    const plugin = load();
    expect(typeof plugin).toBe('function');
    setValidEnv({ EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on' });
    const config = deepFreeze(baseConfig());
    expect(() => plugin(config)).toThrow();
    expect(plain(config)).toEqual(baseConfig());
  });

  it('refuses to overwrite an existing, different identifier', () => {
    const plugin = load();
    expect(typeof plugin).toBe('function');
    setValidEnv();
    const cases = [{ ...baseConfig(), ios: { bundleIdentifier: OTHER_ID } }, { ...baseConfig(), android: { package: OTHER_ID } }];
    for (const original of cases) {
      const config = deepFreeze(plain(original));
      expect(() => plugin(config)).toThrow();
      expect(plain(config)).toEqual(original);
    }
  });

  it('declares a store learning-beta EAS build with explicit off flags and no URLs or identifiers', () => {
    const eas = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'eas.json'), 'utf8'));
    const profile = eas.build['learning-beta'];
    expect(profile).toBeDefined();
    expect(profile.distribution).toBe('store');
    expect(profile.ios.simulator).toBe(false);
    expect(profile.android.buildType).toBe('apk');
    for (const key of SIX_OFF) expect(profile.env[key]).toBe('off');
    expect(profile.env.EXPO_PUBLIC_REMEMBER_DEVICE).toBe('on');
    expect(profile.env.EXPO_PUBLIC_LEARNING_BETA).toBe('on');
    for (const key of URL_AND_ID_KEYS) expect(profile.env).not.toHaveProperty(key);
  });
});
