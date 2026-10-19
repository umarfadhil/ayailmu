// Continue with Google's build configuration, written before its implementation (phase 10). It is off unless the build
// opts in explicitly (EXPO_PUBLIC_GOOGLE_SIGN_IN=on) with the exact callback of the platform it runs on: on the web, the
// account route on this page's own loopback origin (the tab that started an attempt must be the one it comes back to);
// on native, the app's scheme and account route, in a build that can run the system browser's auth session (never Expo
// Go). The app holds no Google client ID or secret: the Auth server does. Anything absent or unsafe keeps it off with a
// reason that names the setting, never its value, and nothing is contacted.
import { GOOGLE_NATIVE_CALLBACK, loadGoogleConfig, type GoogleEnv, type GooglePlatform } from '@/account/googleConfig';

const PAGE: GooglePlatform = { kind: 'web', origin: 'http://localhost:8081' };
const DEVICE: GooglePlatform = { kind: 'native', unavailable: null };
const WEB_CALLBACK = 'http://localhost:8081/account';
const NATIVE_CALLBACK = 'arabictrial://account';
const WEB_ON: GoogleEnv = { EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL: WEB_CALLBACK };
const NATIVE_ON: GoogleEnv = { EXPO_PUBLIC_GOOGLE_SIGN_IN: 'on', EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL: NATIVE_CALLBACK };
const ENV_KEYS = ['EXPO_PUBLIC_GOOGLE_SIGN_IN', 'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL', 'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL'] as const;
const SIGN_IN = 'EXPO_PUBLIC_GOOGLE_SIGN_IN';
const WEB = 'EXPO_PUBLIC_GOOGLE_WEB_CALLBACK_URL';
const NATIVE = 'EXPO_PUBLIC_GOOGLE_NATIVE_CALLBACK_URL';

/** Replaces a global for one test; returns the undo. */
function replaceGlobal(name: 'fetch', value: unknown): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(globalThis, name, before);
    else Reflect.deleteProperty(globalThis, name);
  };
}

/** Sets (or, for undefined, removes) the Google build variables in process.env; returns their previous values. */
function setProcessEnv(values: GoogleEnv): GoogleEnv {
  const previous: GoogleEnv = {};
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return previous;
}

describe('Continue with Google configuration', () => {
  let networkProbe = jest.fn();
  let restoreFetch: () => void = () => undefined;
  beforeEach(() => {
    networkProbe = jest.fn();
    restoreFetch = replaceGlobal('fetch', networkProbe);
  });
  afterEach(() => {
    restoreFetch();
    // Reading the configuration, or refusing it, never contacts anything.
    expect(networkProbe).not.toHaveBeenCalled();
  });

  it("is off by default on both platforms, and on only with the explicit opt-in and the exact callback of the platform it runs on", () => {
    // The app's scheme (app.json) and its account route.
    expect(GOOGLE_NATIVE_CALLBACK).toBe(NATIVE_CALLBACK);
    for (const platform of [PAGE, DEVICE]) {
      expect(loadGoogleConfig(platform, {})).toEqual({ enabled: false, reason: expect.stringContaining(SIGN_IN) });
    }

    // Exactly these fields: the provider, the platform and its callback; no client ID, secret or scope list.
    expect(loadGoogleConfig(PAGE, WEB_ON)).toEqual({ enabled: true, provider: 'google', platform: 'web', callbackUrl: WEB_CALLBACK });
    expect(loadGoogleConfig({ kind: 'web', origin: 'http://127.0.0.1:8082' }, { ...WEB_ON, [WEB]: 'http://127.0.0.1:8082/account' })).toEqual({
      enabled: true,
      provider: 'google',
      platform: 'web',
      callbackUrl: 'http://127.0.0.1:8082/account',
    });
    expect(loadGoogleConfig(DEVICE, NATIVE_ON)).toEqual({ enabled: true, provider: 'google', platform: 'native', callbackUrl: NATIVE_CALLBACK });

    // One build may name both callbacks; each platform reads only its own.
    const both: GoogleEnv = { ...WEB_ON, ...NATIVE_ON };
    expect(loadGoogleConfig(PAGE, both)).toMatchObject({ enabled: true, platform: 'web', callbackUrl: WEB_CALLBACK });
    expect(loadGoogleConfig(DEVICE, both)).toMatchObject({ enabled: true, platform: 'native', callbackUrl: NATIVE_CALLBACK });
    expect(loadGoogleConfig(PAGE, NATIVE_ON)).toEqual({ enabled: false, reason: expect.stringContaining(WEB) });
    expect(loadGoogleConfig(DEVICE, WEB_ON)).toEqual({ enabled: false, reason: expect.stringContaining(NATIVE) });
  });

  const OFF: { case: string; platform: GooglePlatform; env: GoogleEnv; setting: keyof GoogleEnv; notShown?: string }[] = [
    { case: 'an opt-in that is "true"', platform: DEVICE, env: { ...NATIVE_ON, [SIGN_IN]: 'true' }, setting: SIGN_IN },
    { case: 'an upper-case opt-in', platform: DEVICE, env: { ...NATIVE_ON, [SIGN_IN]: 'ON' }, setting: SIGN_IN },
    { case: 'an opt-in with spaces', platform: PAGE, env: { ...WEB_ON, [SIGN_IN]: ' on ' }, setting: SIGN_IN },
    { case: 'a provider name as the opt-in', platform: PAGE, env: { ...WEB_ON, [SIGN_IN]: 'gotrue-google-please' }, setting: SIGN_IN, notShown: 'gotrue-google-please' },
    { case: 'no web callback', platform: PAGE, env: { [SIGN_IN]: 'on' }, setting: WEB },
    { case: 'the site root as the web callback', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:8081/' }, setting: WEB },
    { case: 'a dedicated callback route', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:8081/auth/callback' }, setting: WEB, notShown: '/auth/callback' },
    { case: 'a trailing slash after the account route', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:8081/account/' }, setting: WEB },
    { case: 'a longer path', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:8081/account/google' }, setting: WEB, notShown: '/account/google' },
    { case: 'a query in the web callback', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:8081/account?next=%2F' }, setting: WEB, notShown: 'next=' },
    { case: 'a fragment in the web callback', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:8081/account#done' }, setting: WEB, notShown: '#done' },
    { case: 'https on loopback', platform: PAGE, env: { ...WEB_ON, [WEB]: 'https://localhost:8081/account' }, setting: WEB, notShown: 'https://localhost' },
    { case: 'an external host', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://app.example.com:8081/account' }, setting: WEB, notShown: 'example.com' },
    { case: 'a look-alike loopback host', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost.evil.test:8081/account' }, setting: WEB, notShown: 'evil.test' },
    { case: 'credentials in the web callback', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://learner:hunter2@localhost:8081/account' }, setting: WEB, notShown: 'hunter2' },
    { case: 'no port', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost/account' }, setting: WEB },
    { case: 'port 0', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:0/account' }, setting: WEB },
    { case: 'a port above 65535', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:65536/account' }, setting: WEB, notShown: '65536' },
    { case: 'another loopback host than this page', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://127.0.0.1:8081/account' }, setting: WEB },
    { case: 'another port than this page', platform: PAGE, env: { ...WEB_ON, [WEB]: 'http://localhost:8082/account' }, setting: WEB, notShown: '8082' },
    { case: 'no native callback', platform: DEVICE, env: { [SIGN_IN]: 'on' }, setting: NATIVE },
    { case: 'a trailing slash after the native route', platform: DEVICE, env: { ...NATIVE_ON, [NATIVE]: 'arabictrial://account/' }, setting: NATIVE },
    { case: 'the triple-slash form', platform: DEVICE, env: { ...NATIVE_ON, [NATIVE]: 'arabictrial:///account' }, setting: NATIVE },
    { case: 'another route of the app', platform: DEVICE, env: { ...NATIVE_ON, [NATIVE]: 'arabictrial://lesson-review' }, setting: NATIVE, notShown: 'lesson-review' },
    { case: 'an Expo Go address', platform: DEVICE, env: { ...NATIVE_ON, [NATIVE]: 'exp://127.0.0.1:8081/--/account' }, setting: NATIVE, notShown: 'exp://' },
    { case: 'another scheme', platform: DEVICE, env: { ...NATIVE_ON, [NATIVE]: 'com.example.app://account' }, setting: NATIVE, notShown: 'com.example.app' },
    { case: 'a query on the native callback', platform: DEVICE, env: { ...NATIVE_ON, [NATIVE]: 'arabictrial://account?next=home' }, setting: NATIVE, notShown: 'next=home' },
    { case: 'an upper-case scheme', platform: DEVICE, env: { ...NATIVE_ON, [NATIVE]: 'ARABICTRIAL://account' }, setting: NATIVE, notShown: 'ARABICTRIAL' },
    { case: 'an https app link', platform: DEVICE, env: { ...NATIVE_ON, [NATIVE]: 'https://ayailmu.example/account' }, setting: NATIVE, notShown: 'ayailmu.example' },
  ];
  it.each(OFF)('$case keeps Google sign-in off instead of failing; the reason names $setting, not its value', ({ platform, env, setting, notShown }) => {
    const config = loadGoogleConfig(platform, env);
    expect(config).toEqual({ enabled: false, reason: expect.any(String) });
    const reason = config.enabled ? '' : config.reason;
    expect(reason).toContain(setting);
    if (notShown) expect(reason).not.toContain(notShown);
  });

  it('a native build that cannot run the system browser auth session (Expo Go, or no auth-session module) keeps it off, saying why', () => {
    const why = 'Expo Go cannot receive the arabictrial callback: use a development build.';
    expect(loadGoogleConfig({ kind: 'native', unavailable: why }, NATIVE_ON)).toEqual({ enabled: false, reason: expect.stringContaining(why) });
  });

  it('reads the static EXPO_PUBLIC_* build variables by default', () => {
    const previous = setProcessEnv(NATIVE_ON);
    try {
      expect(loadGoogleConfig(DEVICE)).toEqual({ enabled: true, provider: 'google', platform: 'native', callbackUrl: NATIVE_CALLBACK });
      setProcessEnv({});
      expect(loadGoogleConfig(DEVICE)).toEqual({ enabled: false, reason: expect.stringContaining(SIGN_IN) });
    } finally {
      setProcessEnv(previous);
    }
  });
});
