// Local configuration proof only: these tests exercise the pure config loader
// and safety predicate. They do not show that Google or any other provider
// accepts the callback URLs, and nothing here touches the network.
//
// Regression-first: while `isSafeGoogleConfig` still rejects every production
// config, the positive production cases below are expected to fail (RED).
import {
  GOOGLE_NATIVE_CALLBACK,
  isSafeGoogleConfig,
  loadGoogleConfig,
} from '../googleConfig';

type TestEnv = Record<string, string | undefined>;

const WEB_ORIGIN = 'https://learn.example.org';
const WEB_CALLBACK = `${WEB_ORIGIN}/account`;

const NATIVE_PLATFORM = { kind: 'native', unavailable: null } as const;
const WEB_PLATFORM = { kind: 'web', origin: WEB_ORIGIN } as const;

const NATIVE_CONFIG = {
  enabled: true,
  provider: 'google',
  platform: 'native',
  callbackUrl: GOOGLE_NATIVE_CALLBACK,
} as const;

const WEB_CONFIG = {
  enabled: true,
  provider: 'google',
  platform: 'web',
  callbackUrl: WEB_CALLBACK,
} as const;

// The real local environment is undefined (or an empty build env). The string
// 'local' is not a known environment, so it stays here as an unknown value.
const NON_PRODUCTION_ENVIRONMENTS = [
  undefined,
  'local',
  'staging',
  'private-qa',
  'learning-beta',
  'unknown',
] as const;

function productionEnv(overrides: TestEnv = {}): TestEnv {
  return {
    EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on',
    EXPO_PUBLIC_ACCOUNT_ENV: 'production',
    EXPO_PUBLIC_PRODUCTION_ACCOUNTS: 'on',
    EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: GOOGLE_NATIVE_CALLBACK,
    EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: WEB_CALLBACK,
    ...overrides,
  };
}

function omit(env: TestEnv, key: string): TestEnv {
  const clone = { ...env };
  delete clone[key];
  return clone;
}

const originalFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
let fetchSpy: jest.Mock;

beforeEach(() => {
  fetchSpy = jest.fn(() => {
    throw new Error('googleConfig must not perform network requests');
  });
  Object.defineProperty(globalThis, 'fetch', {
    value: fetchSpy,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  const calls = fetchSpy.mock.calls.length;
  if (originalFetchDescriptor) {
    Object.defineProperty(globalThis, 'fetch', originalFetchDescriptor);
  } else {
    delete (globalThis as { fetch?: unknown }).fetch;
  }
  expect(calls).toBe(0);
});

describe('GOOGLE_NATIVE_CALLBACK', () => {
  it('is the exact native account callback', () => {
    expect(GOOGLE_NATIVE_CALLBACK).toBe('arabictrial://account');
  });
});

describe('loadGoogleConfig in production', () => {
  it('enables the exact native config and adds no client secrets', () => {
    const config = loadGoogleConfig(NATIVE_PLATFORM, productionEnv());

    expect(config).toEqual(NATIVE_CONFIG);
    expect(Object.keys(config).filter((key) => /secret/i.test(key))).toEqual([]);
  });

  it('enables the exact web config and adds no client secrets', () => {
    const config = loadGoogleConfig(WEB_PLATFORM, productionEnv());

    expect(config).toEqual(WEB_CONFIG);
    expect(Object.keys(config).filter((key) => /secret/i.test(key))).toEqual([]);
  });

  describe.each([
    ['native', NATIVE_PLATFORM],
    ['web', WEB_PLATFORM],
  ] as const)('%s platform without the production capability', (_name, platform) => {
    it('is disabled when the capability is missing', () => {
      const env = omit(productionEnv(), 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS');

      expect(loadGoogleConfig(platform, env)).toMatchObject({ enabled: false });
    });

    it.each(['off', 'ON', 'true'])('is disabled when the capability is %p', (value) => {
      const env = productionEnv({ EXPO_PUBLIC_PRODUCTION_ACCOUNTS: value });

      expect(loadGoogleConfig(platform, env)).toMatchObject({ enabled: false });
    });
  });

  it('is disabled with an Expo Go explanation when native is unavailable', () => {
    const config = loadGoogleConfig(
      {
        kind: 'native',
        unavailable: 'Google sign-in is unavailable in Expo Go.',
      },
      productionEnv(),
    );

    expect(config).toMatchObject({ enabled: false });
    expect(JSON.stringify(config)).toContain('Expo Go');
  });

  describe('web callback validation', () => {
    it.each([
      ['another origin', 'https://other.example.org/account'],
      ['root only', `${WEB_ORIGIN}/`],
      ['origin without a path', WEB_ORIGIN],
      ['a trailing slash', `${WEB_CALLBACK}/`],
      ['a query string', `${WEB_CALLBACK}?next=/home`],
      ['a fragment', `${WEB_CALLBACK}#section`],
      ['embedded credentials', 'https://user:pass@learn.example.org/account'],
      ['an uppercase path', `${WEB_ORIGIN}/ACCOUNT`],
      ['an uppercase origin', 'HTTPS://LEARN.EXAMPLE.ORG/account'],
      ['plain http', 'http://learn.example.org/account'],
      ['localhost over http', 'http://localhost:8081/account'],
      ['localhost over https', 'https://localhost/account'],
      ['a malformed URL', 'not a url'],
    ])('is disabled without throwing for %s', (_name, callback) => {
      const env = productionEnv({ EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: callback });

      expect(() => loadGoogleConfig(WEB_PLATFORM, env)).not.toThrow();
      expect(loadGoogleConfig(WEB_PLATFORM, env)).toMatchObject({ enabled: false });
    });
  });

  describe('native callback validation', () => {
    it.each([
      ['another route', 'arabictrial://other'],
      ['another scheme', 'othertrial://account'],
      ['an Expo development URL', 'exp://127.0.0.1:8081/--/account'],
    ])('is disabled for %s', (_name, callback) => {
      const env = productionEnv({ EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: callback });

      expect(() => loadGoogleConfig(NATIVE_PLATFORM, env)).not.toThrow();
      expect(loadGoogleConfig(NATIVE_PLATFORM, env)).toMatchObject({ enabled: false });
    });
  });

  it('sends nothing while loading configuration', () => {
    loadGoogleConfig(NATIVE_PLATFORM, productionEnv());
    loadGoogleConfig(WEB_PLATFORM, productionEnv());
    loadGoogleConfig(WEB_PLATFORM, omit(productionEnv(), 'EXPO_PUBLIC_PRODUCTION_ACCOUNTS'));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('loadGoogleConfig with a missing callback', () => {
  it.each([
    ['native', NATIVE_PLATFORM, 'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL'],
    ['web', WEB_PLATFORM, 'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL'],
  ] as const)('is disabled in production on %s', (_name, platform, key) => {
    const env = omit(productionEnv(), key);

    expect(loadGoogleConfig(platform, env)).toMatchObject({ enabled: false });
  });

  it.each([
    ['native', NATIVE_PLATFORM, 'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL'],
    ['web', WEB_PLATFORM, 'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL'],
  ] as const)('does not fall back to a local callback on %s', (_name, platform, key) => {
    const env = omit(
      productionEnv({ EXPO_PUBLIC_ACCOUNT_ENV: undefined }),
      key,
    );
    const config = loadGoogleConfig(platform, env);

    expect(config).toMatchObject({ enabled: false });
    expect(JSON.stringify(config)).not.toMatch(/localhost|127\.0\.0\.1/);
  });
});

describe('isSafeGoogleConfig', () => {
  describe('production with the capability', () => {
    it('accepts the exact native config', () => {
      expect(isSafeGoogleConfig(NATIVE_CONFIG, 'production', true)).toBe(true);
    });

    it('accepts the exact web config', () => {
      expect(isSafeGoogleConfig(WEB_CONFIG, 'production', true)).toBe(true);
    });

    // The predicate has no expected page origin, so it accepts any canonical
    // public callback; the same-page origin check lives in loadGoogleConfig.
    it('rejects a production web config with a malformed callback', () => {
      const config = {
        ...WEB_CONFIG,
        callbackUrl: 'https://other.example.org/account?next=home',
      };

      expect(isSafeGoogleConfig(config, 'production', true)).toBe(false);
    });
  });

  describe.each([
    ['native', NATIVE_CONFIG],
    ['web', WEB_CONFIG],
  ] as const)('production %s config without the capability', (_name, config) => {
    it('rejects when the capability is omitted', () => {
      expect(isSafeGoogleConfig(config, 'production')).toBe(false);
    });

    it('rejects when the capability is false', () => {
      expect(isSafeGoogleConfig(config, 'production', false)).toBe(false);
    });

    it('rejects when the capability is the string "on"', () => {
      expect(
        isSafeGoogleConfig(config, 'production', 'on' as unknown as boolean),
      ).toBe(false);
    });
  });

  describe('the capability outside production', () => {
    it.each(NON_PRODUCTION_ENVIRONMENTS)(
      'does not make the web config safe in %s',
      (environment) => {
        expect(isSafeGoogleConfig(WEB_CONFIG, environment, true)).toBe(false);
      },
    );
  });

  describe('without the capability argument', () => {
    it('rejects the same web config under the undefined local environment', () => {
      expect(isSafeGoogleConfig(WEB_CONFIG, undefined)).toBe(false);
    });

    it.each([undefined, 'staging'])('still accepts the native config under %s', (environment) => {
      expect(isSafeGoogleConfig(NATIVE_CONFIG, environment)).toBe(true);
    });
  });
});
