'use strict';

const load = () => {
  try {
    const mod = require('../withGeneralUser');
    return mod && mod.default ? mod.default : mod;
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND') return undefined;
    throw error;
  }
};

const plugin = load();

const BASE = {
  AYAFASIH_GENERAL_USER: 'on',
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
  API_BASE_URL: 'https://api.example.org',
  SUPABASE_AUTH_URL: 'https://auth.example.org',
};
const WRONG = {
  APP_MODE: 'production',
  AUTH_PROVIDER: 'mock',
  ACCOUNT_ENV: 'staging',
  PRODUCTION_ACCOUNTS: 'off',
  ACCOUNT_REGISTRATION: 'off',
  PRIVATE_QA: 'on',
  PRIVATE_BETA: 'on',
  LEARNING_BETA: 'on',
  GOOGLE_SIGN_IN: 'true',
  PASSWORD_RECOVERY: 'true',
  REMEMBER_DEVICE: 'true',
};
const RESERVED_LABELS = [
  'localhost', 'local', 'test', 'example', 'invalid', 'onion', 'alt', 'arpa',
  'internal', 'home', 'lan', 'corp', 'intranet', 'private',
];
const BAD_ORIGINS = [
  undefined, '', 'localhost:58444', 'https://localhost:58444', 'https://127.0.0.1',
  'https://10.0.0.5', 'https://[::1]', 'https://dev.local', 'https://api.example.test',
  'http://api.example.org', 'https://api.example.org:443', 'https://API.example.org',
  'https://api.example.org/', 'https://api.example.org/auth/v1',
  'https://api.example.org?token=fixture-secret', 'https://api.example.org#fragment',
  'https://user:fixture-secret@api.example.org',
  ...RESERVED_LABELS.map((label) => `https://api.${label}`),
];

const envKey = (name) => (name === 'AYAFASIH_GENERAL_USER' ? name : `EXPO_PUBLIC_${name}`);
const ENV_KEYS = Object.keys(BASE).map(envKey);
const rows = (list) => list.map((value) => [value]);
const makeConfig = () => ({
  name: 'AyaFasih',
  ios: { supportsTablet: true },
  android: { blockedPermissions: ['fixture'] },
  scheme: 'arabictrial',
});
const deepFreeze = (value) => {
  Object.values(value).forEach((child) => child && typeof child === 'object' && deepFreeze(child));
  return Object.freeze(value);
};
const setEnv = (overrides = {}) => {
  Object.entries({ ...BASE, ...overrides }).forEach(([name, value]) => {
    if (value === undefined) delete process.env[envKey(name)];
    else process.env[envKey(name)] = value;
  });
};
const run = (config) => {
  expect(typeof plugin).toBe('function');
  return plugin(config);
};
const rejection = () => {
  expect(typeof plugin).toBe('function');
  try {
    plugin(deepFreeze(makeConfig()));
  } catch (error) {
    return String(error && error.message);
  }
  return undefined;
};

describe('withGeneralUser', () => {
  let saved;
  beforeEach(() => {
    saved = {};
    ENV_KEYS.forEach((key) => {
      saved[key] = process.env[key];
      delete process.env[key];
    });
  });
  afterEach(() => {
    ENV_KEYS.forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
  });

  test.each([
    ['base env', {}],
    ['remember device off', { REMEMBER_DEVICE: 'off' }],
    ['google sign-in on', { GOOGLE_SIGN_IN: 'on' }],
    ['password recovery on', { PASSWORD_RECOVERY: 'on' }],
    ['google sign-in and password recovery on', { GOOGLE_SIGN_IN: 'on', PASSWORD_RECOVERY: 'on' }],
    ['alternate valid origins', { API_BASE_URL: 'https://a1.example.org', SUPABASE_AUTH_URL: 'https://b-2.sub.example.org' }],
    ['apex origin', { API_BASE_URL: 'https://example.org' }],
  ])('valid %s returns the identical frozen config without touching env', (_label, overrides) => {
    setEnv(overrides);
    const before = { ...process.env };
    const config = deepFreeze(makeConfig());
    const result = run(config);
    expect(result).toBe(config);
    expect(result).toEqual(makeConfig());
    expect(result.ios.bundleIdentifier).toBeUndefined();
    expect(result.android.package).toBeUndefined();
    expect({ ...process.env }).toEqual(before);
  });

  test.each(rows([undefined, '', 'off', 'ON', 'true']))(
    'AYAFASIH_GENERAL_USER=%p is inactive even with bad other flags',
    (value) => {
      setEnv({ AYAFASIH_GENERAL_USER: value, APP_MODE: 'bad', API_BASE_URL: 'http://localhost', REMEMBER_DEVICE: 'maybe' });
      const before = { ...process.env };
      const config = deepFreeze(makeConfig());
      expect(run(config)).toBe(config);
      expect({ ...process.env }).toEqual(before);
    },
  );

  describe.each(Object.keys(WRONG))('%s', (name) => {
    test.each(rows([undefined, '', 'fixture-secret', WRONG[name]]))('rejects %p naming setting and expected only', (value) => {
      setEnv({ [name]: value });
      const message = rejection();
      expect(message).toContain(name);
      expect(message).toContain(BASE[name]);
      expect(message).not.toContain('fixture-secret');
    });
  });

  describe.each(['API_BASE_URL', 'SUPABASE_AUTH_URL'])('%s', (name) => {
    test.each(rows(BAD_ORIGINS))('rejects %p naming setting and expected only', (value) => {
      setEnv({ [name]: value });
      const message = rejection();
      expect(message).toContain(name);
      expect(message).toContain('https');
      expect(message).not.toContain('fixture-secret');
      if (value) expect(message).not.toContain(value);
    });
  });

  test('rejects equal roots without echoing them', () => {
    setEnv({ API_BASE_URL: 'https://api.example.org', SUPABASE_AUTH_URL: 'https://api.example.org' });
    const message = rejection();
    expect(message).toMatch(/API_BASE_URL|SUPABASE_AUTH_URL/);
    expect(message).not.toContain('https://api.example.org');
  });
});
