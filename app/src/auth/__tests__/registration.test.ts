// Registration with required email confirmation against a standalone Supabase Auth server (GoTrue), written before its
// implementation (frontend only). The maintained SDK is a fake behind the injected client factory: each fake client
// answers signUp, verifyOtp and resend as the SDK's public methods do ({ data, error }, with the SDK's own error
// classes), and records the exact arguments. Nothing here reaches a network: the injected fetch fails if it is ever
// called. This is SDK mocking only; the real AuthClient transport proof and the live Mailpit proof are separate slices.
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthWeakPasswordError,
  type GoTrueClientOptions,
  type Session,
  type User,
} from '@supabase/auth-js';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { createRegistration, RegistrationError, type RegistrationErrorCode, type RegistrationSdkClient } from '@/auth/registration';

// Persistence boundaries that registering must never open.
const mockSqliteOpened = jest.fn();
const mockLearnerStoreOpened = jest.fn();
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (...args: unknown[]) => mockSqliteOpened(...args),
  openDatabaseAsync: async (...args: unknown[]) => mockSqliteOpened(...args),
}));
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async (...args: unknown[]) => mockLearnerStoreOpened(...args),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Starts `run` now and gives its rejection (a synchronous throw counts); the test fails if it resolves. */
function failure(run: () => Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve) => resolve(run())).then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );
}

/** A typed RegistrationError with a stable code, whose text shows none of `secrets`. */
function expectRegistrationError(error: unknown, code: RegistrationErrorCode, secrets: string[] = []) {
  expect(error).toBeInstanceOf(RegistrationError);
  expect((error as RegistrationError).code).toBe(code);
  const shown = `${String(error)} ${JSON.stringify(error)}`;
  for (const secret of [...secrets, ...SECRETS]) expect(shown).not.toContain(secret);
}

/** Lets queued promise callbacks run. */
async function microtasks() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

const T = Date.UTC(2026, 9, 25, 1, 0, 0);
const LOCAL: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' };
const STAGING_CONFIG: EnabledSupabaseConfig = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'staging',
  apiBaseUrl: 'https://api.staging.ayailmu.id',
  authUrl: 'https://auth.staging.ayailmu.id',
};
/** The only SDK constructor options registration may set: no storage, no lock, no API or admin key. */
const SDK_OPTIONS = ['url', 'persistSession', 'detectSessionInUrl', 'autoRefreshToken', 'debug', 'fetch', 'storageKey', 'headers', 'flowType'];

const EMAIL = 'Nia.Baru+1@ayailmu.test';
const PASSWORD = '  pw Nia baru 2026  ';
const CODE = '482913';
const SERVER_TEXT = 'SERVER-TEXT-do-not-show';
const ACCESS = 'at-SECRET-nia';
const REFRESH = 'rt-SECRET-nia';
/** Never in an error, an outcome or a log. */
const SECRETS = [PASSWORD.trim(), ACCESS, REFRESH, SERVER_TEXT];

const USER = { id: '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b', email: EMAIL, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T01:00:00Z' } as unknown as User;
const SESSION = {
  access_token: ACCESS,
  refresh_token: REFRESH,
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: T / 1000 + 3600,
  user: USER,
} as unknown as Session;

const pending = () => ({ data: { user: USER, session: null }, error: null });
const withSession = () => ({ data: { user: USER, session: SESSION }, error: null });
const refused = (error: Error) => ({ data: { user: null, session: null }, error });

/** One fake SDK client: registration's port, plus signInWithPassword as a canary that must never be called. */
function fakeSdk() {
  return {
    signUp: jest.fn(async (_credentials: unknown): Promise<unknown> => pending()),
    verifyOtp: jest.fn(async (_params: unknown): Promise<unknown> => withSession()),
    resend: jest.fn(async (_params: unknown): Promise<unknown> => ({ data: { user: null, session: null }, error: null })),
    signOut: jest.fn(async (_options?: unknown): Promise<unknown> => ({ error: null })),
    stopAutoRefresh: jest.fn(async (): Promise<void> => undefined),
    signInWithPassword: jest.fn(async (_credentials: unknown): Promise<unknown> => {
      throw new Error('registration must never sign in');
    }),
  };
}
type FakeSdk = ReturnType<typeof fakeSdk>;

function setup(config: EnabledSupabaseConfig = LOCAL, script?: (sdk: FakeSdk, index: number) => void) {
  const clients: { options: GoTrueClientOptions; sdk: FakeSdk }[] = [];
  const fetch = jest.fn(async (..._args: unknown[]): Promise<Response> => {
    throw new Error('adapter tests never reach a network');
  });
  const createClient = jest.fn((options: GoTrueClientOptions) => {
    const sdk = fakeSdk();
    script?.(sdk, clients.length);
    clients.push({ options, sdk });
    return sdk as unknown as RegistrationSdkClient;
  });
  const registration = createRegistration({ config, createClient, fetch: fetch as unknown as typeof globalThis.fetch, now: () => T });
  return { registration, clients, createClient, fetch };
}

let consoleSpies: jest.SpyInstance[] = [];
beforeEach(() => {
  mockSqliteOpened.mockClear();
  mockLearnerStoreOpened.mockClear();
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => jest.spyOn(console, name).mockImplementation(() => undefined));
});
afterEach(() => {
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) for (const secret of SECRETS) expect(JSON.stringify(call)).not.toContain(secret);
    spy.mockRestore();
  }
  expect(mockSqliteOpened).not.toHaveBeenCalled();
  expect(mockLearnerStoreOpened).not.toHaveBeenCalled();
});

describe('configuration', () => {
  it('refuses a missing, unsafe or production configuration before any client or request', () => {
    const unsafe: unknown[] = [
      undefined,
      { enabled: false, reason: 'off' },
      { ...LOCAL, provider: 'firebase-emulator' },
      { ...LOCAL, authUrl: 'http://127.0.0.1:54321/auth/v1' },
      { ...LOCAL, authUrl: 'https://auth.staging.ayailmu.id' },
      { ...LOCAL, environment: 'Staging' },
      { ...LOCAL, environment: 'staging' },
      { ...STAGING_CONFIG, authUrl: 'http://127.0.0.1:59838' },
      { enabled: true, provider: 'local-supabase', environment: 'production', productionAccounts: true, apiBaseUrl: 'https://api.ayailmu.id', authUrl: 'https://auth.ayailmu.id' },
    ];
    for (const config of unsafe) {
      const createClient = jest.fn();
      const fetch = jest.fn();
      expect(() => createRegistration({ config: config as EnabledSupabaseConfig, createClient, fetch: fetch as unknown as typeof globalThis.fetch })).toThrow();
      expect(createClient).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('builds nothing until a call, then one in-memory client per call at the validated Auth root through a bounded transport', async () => {
    const { registration, clients, createClient, fetch } = setup(STAGING_CONFIG);
    expect(createClient).not.toHaveBeenCalled();
    await registration.register(EMAIL, PASSWORD);
    await registration.resend(EMAIL);
    expect(clients).toHaveLength(2);
    for (const { options } of clients) {
      for (const key of Object.keys(options)) expect(SDK_OPTIONS).toContain(key);
      expect(options.url).toBe(STAGING_CONFIG.authUrl);
      expect(options.persistSession).toBe(false);
      expect(options.autoRefreshToken).toBe(false);
      expect(options.detectSessionInUrl).toBe(false);
      expect(options.storage).toBeUndefined();
      expect([undefined, 'implicit']).toContain(options.flowType);
      expect(Object.keys(options.headers ?? {})).toEqual([]);
      expect(typeof options.fetch).toBe('function');
      // The bounded transport refuses any address outside the Auth root without calling the fetch under it.
      await expect(options.fetch!('https://api.staging.ayailmu.id/v1/sync', { method: 'POST' })).rejects.toThrow();
      await expect(options.fetch!('https://auth.staging.ayailmu.id.evil.id/signup', { method: 'POST' })).rejects.toThrow();
    }
    expect(clients[0].options.storageKey).not.toBe(clients[1].options.storageKey);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('input', () => {
  it('takes only a synthetic .test address, and refuses any other before building anything', async () => {
    const { registration, createClient } = setup();
    for (const email of ['nia@ayailmu.id', ' nia@ayailmu.test', 'nia@ayailmu.test ', 'nia@ayailmu.test.', 'nia@test', '', 42 as unknown as string]) {
      expectRegistrationError(await failure(() => registration.register(email, PASSWORD)), 'not_synthetic');
      expectRegistrationError(await failure(() => registration.confirm(email, CODE)), 'not_synthetic');
      expectRegistrationError(await failure(() => registration.resend(email)), 'not_synthetic');
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('refuses a malformed confirmation code before building anything', async () => {
    const { registration, createClient } = setup();
    for (const code of ['', '12345', '12a456', ' 482913', '482913\n', '12345678901']) {
      expectRegistrationError(await failure(() => registration.confirm(EMAIL, code)), 'invalid_code', [code.trim()].filter(Boolean));
    }
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('register', () => {
  it('sends the exact unmodified email and password once and resolves pending confirmation for a null session', async () => {
    const { registration, clients } = setup();
    const outcome = await registration.register(EMAIL, PASSWORD);
    expect(outcome).toEqual({ status: 'confirmation_required' });
    expect(clients).toHaveLength(1);
    const { sdk } = clients[0];
    expect(sdk.signUp).toHaveBeenCalledTimes(1);
    expect(sdk.signUp).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
    expect(sdk.stopAutoRefresh).toHaveBeenCalled();
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain(USER.id);
  });

  it('refuses and retires an unexpected auto-confirmed session; it is never adopted or reported as signed in', async () => {
    const { registration, clients } = setup(LOCAL, (sdk) => sdk.signUp.mockResolvedValueOnce(withSession()));
    expectRegistrationError(await failure(() => registration.register(EMAIL, PASSWORD)), 'auto_confirm_refused');
    const { sdk } = clients[0];
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(sdk.stopAutoRefresh).toHaveBeenCalled();
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
  });

  it('lets the learner retry after a refusal with a corrected password', async () => {
    const { registration, clients } = setup(LOCAL, (sdk, index) => {
      if (index === 0) sdk.signUp.mockResolvedValueOnce(refused(new AuthWeakPasswordError(SERVER_TEXT, 422, ['length'])));
    });
    expectRegistrationError(await failure(() => registration.register(EMAIL, 'short')), 'weak_password', ['short']);
    await expect(registration.register(EMAIL, PASSWORD)).resolves.toEqual({ status: 'confirmation_required' });
    expect(clients[1].sdk.signUp).toHaveBeenCalledWith({ email: EMAIL, password: PASSWORD });
  });
});

describe('confirm and resend', () => {
  it('verifies the signup code exactly, then retires the verified session without adopting it', async () => {
    const { registration, clients } = setup();
    const outcome = await registration.confirm(EMAIL, CODE);
    expect(outcome).toEqual({ status: 'confirmed', signInRequired: true });
    const { sdk } = clients[0];
    expect(sdk.verifyOtp).toHaveBeenCalledTimes(1);
    expect(sdk.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: CODE, type: 'signup' });
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(sdk.stopAutoRefresh).toHaveBeenCalled();
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
    expect(sdk.signUp).not.toHaveBeenCalled();
    for (const secret of SECRETS) expect(JSON.stringify(outcome)).not.toContain(secret);
  });

  it('resends the signup confirmation with the exact type and never claims delivery', async () => {
    const { registration, clients } = setup();
    await expect(registration.resend(EMAIL)).resolves.toEqual({ status: 'resent' });
    expect(clients[0].sdk.resend).toHaveBeenCalledTimes(1);
    expect(clients[0].sdk.resend).toHaveBeenCalledWith({ email: EMAIL, type: 'signup' });
    expect(clients[0].sdk.signInWithPassword).not.toHaveBeenCalled();
  });
});

describe('failures', () => {
  it('maps SDK refusals to stable codes without the server text, password, code or tokens', async () => {
    const cases: { call: 'register' | 'confirm' | 'resend'; reply: () => unknown; code: RegistrationErrorCode }[] = [
      { call: 'register', reply: () => refused(new AuthWeakPasswordError(SERVER_TEXT, 422, ['length'])), code: 'weak_password' },
      { call: 'register', reply: () => refused(new AuthApiError(SERVER_TEXT, 429, 'over_email_send_rate_limit')), code: 'rate_limited' },
      { call: 'resend', reply: () => refused(new AuthApiError(SERVER_TEXT, 429, 'over_request_rate_limit')), code: 'rate_limited' },
      { call: 'confirm', reply: () => refused(new AuthApiError(SERVER_TEXT, 403, 'otp_expired')), code: 'invalid_code' },
      { call: 'confirm', reply: () => refused(new AuthRetryableFetchError(SERVER_TEXT, 0)), code: 'network' },
      { call: 'resend', reply: () => refused(new AuthRetryableFetchError(SERVER_TEXT, 0)), code: 'network' },
      { call: 'register', reply: () => refused(new AuthApiError(SERVER_TEXT, 422, 'signup_disabled')), code: 'provider_refused' },
      { call: 'register', reply: () => ({ data: { user: null, session: null }, error: null }), code: 'bad_response' },
    ];
    for (const { call, reply, code } of cases) {
      const method = call === 'register' ? 'signUp' : call === 'confirm' ? 'verifyOtp' : 'resend';
      const { registration, clients } = setup(LOCAL, (sdk) => sdk[method].mockResolvedValueOnce(reply()));
      const run = call === 'register' ? () => registration.register(EMAIL, PASSWORD) : call === 'confirm' ? () => registration.confirm(EMAIL, CODE) : () => registration.resend(EMAIL);
      expectRegistrationError(await failure(run), code, [CODE]);
      expect(clients[0].sdk.stopAutoRefresh).toHaveBeenCalled();
    }
  });

  it('maps a thrown transport failure to network', async () => {
    const { registration } = setup(LOCAL, (sdk) =>
      sdk.signUp.mockImplementationOnce(async () => {
        throw new Error(SERVER_TEXT);
      })
    );
    expectRegistrationError(await failure(() => registration.register(EMAIL, PASSWORD)), 'network');
  });
});

describe('latest wins, cancel and dispose', () => {
  it('a newer attempt supersedes the one on its way, stops its client at once and retires its late session', async () => {
    const late = deferred<unknown>();
    const { registration, clients } = setup(LOCAL, (sdk, index) => {
      if (index === 0) sdk.signUp.mockImplementationOnce(() => late.promise);
      else if (index === 1) sdk.signUp.mockResolvedValueOnce({ data: { user: { ...USER, email: 'nia.lain@ayailmu.test' }, session: null }, error: null });
    });
    const first = failure(() => registration.register(EMAIL, PASSWORD));
    await microtasks();
    const second = registration.register('nia.lain@ayailmu.test', PASSWORD);
    await microtasks();
    expect(clients[0].sdk.stopAutoRefresh).toHaveBeenCalled();
    await expect(second).resolves.toEqual({ status: 'confirmation_required' });
    late.resolve(withSession());
    expectRegistrationError(await first, 'superseded');
    await microtasks();
    expect(clients[0].sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(clients[0].sdk.signInWithPassword).not.toHaveBeenCalled();
  });

  it('cancel settles the attempt as cancelled, drops its late result and leaves registration usable', async () => {
    const late = deferred<unknown>();
    const { registration, clients } = setup(LOCAL, (sdk, index) => {
      if (index === 0) sdk.verifyOtp.mockImplementationOnce(() => late.promise);
    });
    const confirming = failure(() => registration.confirm(EMAIL, CODE));
    await microtasks();
    await registration.cancel();
    expectRegistrationError(await confirming, 'cancelled');
    expect(clients[0].sdk.stopAutoRefresh).toHaveBeenCalled();
    late.resolve(withSession());
    await microtasks();
    expect(clients[0].sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    await expect(registration.resend(EMAIL)).resolves.toEqual({ status: 'resent' });
    await expect(registration.cancel()).resolves.toBeUndefined();
  });

  it('dispose settles the attempt as disposed and refuses every later call without building a client', async () => {
    const late = deferred<unknown>();
    const { registration, createClient } = setup(LOCAL, (sdk) => sdk.signUp.mockImplementationOnce(() => late.promise));
    const registering = failure(() => registration.register(EMAIL, PASSWORD));
    await microtasks();
    await registration.dispose();
    expectRegistrationError(await registering, 'disposed');
    late.resolve(pending());
    expectRegistrationError(await failure(() => registration.register(EMAIL, PASSWORD)), 'disposed');
    expectRegistrationError(await failure(() => registration.confirm(EMAIL, CODE)), 'disposed');
    expectRegistrationError(await failure(() => registration.resend(EMAIL)), 'disposed');
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});

describe('isolation', () => {
  it('exposes only its five methods and never touches web storage, another account or the guest', async () => {
    const touched = jest.fn();
    const storage = (seed: Record<string, string>) => {
      const memory = new Map(Object.entries(seed));
      return {
        memory,
        getItem: (key: string) => (touched('get', key), memory.get(key) ?? null),
        setItem: (key: string) => touched('set', key),
        removeItem: (key: string) => touched('remove', key),
        clear: () => touched('clear'),
        key: () => null,
        get length() {
          return memory.size;
        },
      };
    };
    const local = storage({ 'ayailmu-guest-progress': 'guest', 'ayailmu-account-ani': 'ani' });
    const session = storage({ 'ayailmu-local-auth-1': 'other-sign-in' });
    const undo = [replaceGlobal('localStorage', local), replaceGlobal('sessionStorage', session)];
    try {
      const { registration } = setup();
      expect(Object.keys(registration).sort()).toEqual(['cancel', 'confirm', 'dispose', 'register', 'resend']);
      await registration.register(EMAIL, PASSWORD);
      await registration.resend(EMAIL);
      await registration.confirm(EMAIL, CODE);
      await registration.cancel();
      await registration.dispose();
      expect(touched).not.toHaveBeenCalled();
      expect([...local.memory.entries()]).toEqual([
        ['ayailmu-guest-progress', 'guest'],
        ['ayailmu-account-ani', 'ani'],
      ]);
      expect([...session.memory.entries()]).toEqual([['ayailmu-local-auth-1', 'other-sign-in']]);
    } finally {
      for (const restore of undo) restore();
    }
  });
});

/** Replaces a global for one test; returns the undo. */
function replaceGlobal(name: 'localStorage' | 'sessionStorage', value: unknown): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(globalThis, name, before);
    else Reflect.deleteProperty(globalThis, name);
  };
}
