// The account registration controller, written before its implementation, for a later small hook and AccountPanel. A
// fake Registration (its five methods) stands in for the adapter: no SDK, network or storage is involved.
// - registrationAllowed(config, flag = process.env.EXPO_PUBLIC_ACCOUNT_REGISTRATION): true only for the flag exactly 'on'
//   with an enabled local-supabase configuration, local (no environment) or exactly staging; never production or unknown.
// - createRegistrationController({ registration, active, onChange? }) gives read(): a fresh RegistrationState { stage:
//   'idle' | 'email' | 'code' | 'confirmed', busy, email, message, error } that never holds a password, code, token or
//   user id; start(), useCode(email), cancel() and dispose(): void or Promise<void> (awaited here), changing the state at
//   once; register(email, password), confirm(code), resend(): Promise<void>, never rejecting, outcomes in read() only.
//   register runs in the email stage, confirm and resend in the code stage; an action in another stage, while busy or
//   after dispose sends nothing and changes nothing. While active() is false an action sends nothing and clears the flow
//   to idle. A reply arriving while active() is false, after a newer start or cancel, or after dispose changes nothing.
import { LOCAL_SUPABASE, type EnabledSupabaseConfig, type SupabaseConfig } from '@/account/supabaseConfig';
import { RegistrationError, type Registration, type RegistrationErrorCode } from '@/auth/registration';
import { createRegistrationController, registrationAllowed, type RegistrationState } from '@/ui/account/registrationController';

// Persistence boundaries that registering must never open.
const mockSqliteOpened = jest.fn();
const mockLearnerStoreOpened = jest.fn();
jest.mock('expo-sqlite', () => ({ openDatabaseSync: (...args: unknown[]) => mockSqliteOpened(...args), openDatabaseAsync: async (...args: unknown[]) => mockSqliteOpened(...args) }));
jest.mock('@/storage/openStore', () => ({ STORAGE_KIND: 'test-memory', openStore: async (...args: unknown[]) => mockLearnerStoreOpened(...args) }));

const EMAIL = 'murid.satu@ayangaji.test';
const PASSWORD = 'Sandi-Uji-7319-rahasia';
const CODE = '483920';
const IDLE: RegistrationState = { stage: 'idle', busy: false, email: null, message: null, error: null };
const NO_DELIVERY_CLAIM = /terkirim|telah dikirim|sudah dikirim|\bsent\b|delivered/i;

const LOCAL: EnabledSupabaseConfig = { enabled: true, provider: LOCAL_SUPABASE, apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:54321' };
const STAGING: EnabledSupabaseConfig = { ...LOCAL, environment: 'staging', apiBaseUrl: 'https://api.staging-ayangaji.dev', authUrl: 'https://auth.staging-ayangaji.dev' };
const PRODUCTION: EnabledSupabaseConfig = { ...LOCAL, environment: 'production', productionAccounts: true, apiBaseUrl: 'https://api.ayangaji.dev', authUrl: 'https://auth.ayangaji.dev' };

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A Registration whose calls are recorded; the next call can be held open or made to fail. */
function fakeRegistration() {
  const calls: string[][] = [];
  const held: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  const failures: unknown[] = [];
  let holdNext = false;
  function op<T>(name: string, args: string[], value: T): Promise<T> {
    calls.push([name, ...args]);
    if (failures.length > 0) return Promise.reject(failures.shift());
    if (!holdNext) return Promise.resolve(value);
    holdNext = false;
    return new Promise<T>((resolve, reject) => held.push({ resolve: () => resolve(value), reject }));
  }
  const registration = {
    register: (email: string, password: string) => op('register', [email, password], { status: 'confirmation_required' as const }),
    confirm: (email: string, code: string) => op('confirm', [email, code], { status: 'confirmed' as const, signInRequired: true as const }),
    resend: (email: string) => op('resend', [email], { status: 'resent' as const }),
    cancel: jest.fn(async () => undefined),
    dispose: jest.fn(async () => undefined),
  } satisfies Registration;
  return { registration, calls, held, hold: () => void (holdNext = true), fail: (error: unknown) => void failures.push(error) };
}

function setup(initiallyActive = true) {
  const fake = fakeRegistration();
  const changes: RegistrationState[] = [];
  let live = initiallyActive;
  const controller = createRegistrationController({ registration: fake.registration, active: () => live, onChange: (state) => changes.push(state) });
  return { fake, changes, controller, setActive: (value: boolean) => void (live = value) };
}

/** Every state has exactly the public fields, and none carries the password, a code, a token or a user id. */
function expectNoSecrets(states: RegistrationState[]) {
  for (const state of states) {
    expect(Object.keys(state).sort()).toEqual(['busy', 'email', 'error', 'message', 'stage']);
    for (const secret of [PASSWORD, CODE, '000000', 'token', 'session', 'user_id', 'userId']) expect(JSON.stringify(state)).not.toContain(secret);
  }
}

/** A stable Indonesian message: never the adapter's or server's text, a code identifier or a secret. */
function expectSafeMessage(message: string | null, ...forbidden: string[]) {
  expect(typeof message).toBe('string');
  for (const text of [PASSWORD, CODE, 'Account registration problem', ...forbidden]) expect(message).not.toContain(text);
  expect(message).not.toMatch(/\b(error|problem|failed)\b/i);
}

// Nothing a learner typed is ever logged.
let consoleSpies: jest.SpyInstance[] = [];
beforeEach(() => {
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => jest.spyOn(console, name).mockImplementation(() => undefined));
});
afterEach(() => {
  for (const spy of consoleSpies) {
    for (const secret of [PASSWORD, CODE]) expect(spy.mock.calls.flat().map(String).join(' ')).not.toContain(secret);
    spy.mockRestore();
  }
});

it('registrationAllowed: only the flag exactly on, in a local or staging build; never production or anything unknown', () => {
  expect(registrationAllowed(LOCAL, 'on')).toBe(true);
  expect(registrationAllowed(STAGING, 'on')).toBe(true);
  for (const flag of [undefined, '', 'ON', 'On', ' on', 'on ', 'true', '1', 'yes', 'off']) {
    expect(registrationAllowed(LOCAL, flag)).toBe(false);
    expect(registrationAllowed(STAGING, flag)).toBe(false);
  }
  expect(registrationAllowed(LOCAL)).toBe(false); // the build sets no registration flag here: off by default
  const refused: unknown[] = [
    PRODUCTION, { ...PRODUCTION, productionAccounts: undefined }, { ...LOCAL, productionAccounts: true },
    { ...LOCAL, environment: 'preview' }, { ...LOCAL, environment: 'Staging' }, { ...LOCAL, provider: 'firebase' },
    { enabled: true, apiBaseUrl: LOCAL.apiBaseUrl, authUrl: LOCAL.authUrl }, { ...LOCAL, enabled: 'true' },
    { enabled: false, reason: 'EXPO_PUBLIC_AUTH_PROVIDER is not set, so account sync is off.' },
  ];
  for (const config of refused) expect(registrationAllowed(config as SupabaseConfig, 'on')).toBe(false);
});

describe('createRegistrationController', () => {
  it('starts at idle and enters the email stage only while active', async () => {
    const off = setup(false);
    expect(off.controller.read()).toEqual(IDLE);
    await off.controller.start();
    await off.controller.useCode(EMAIL);
    await off.controller.register(EMAIL, PASSWORD);
    expect(off.controller.read()).toEqual(IDLE);
    expect(off.fake.calls).toEqual([]);
    const { controller } = setup();
    await controller.start();
    expect(controller.read()).toMatchObject({ stage: 'email', busy: false, email: null, error: null });
  });

  it('registers the exact address and password once, then waits for the code keeping only the address', async () => {
    const { fake, controller, changes } = setup();
    await controller.start();
    await controller.register(EMAIL, PASSWORD);
    expect(fake.calls).toEqual([['register', EMAIL, PASSWORD]]);
    const state = controller.read();
    expect(state).toMatchObject({ stage: 'code', busy: false, email: EMAIL, error: null });
    expect(state.message).toMatch(/kode/i);
    expect(state.message).toMatch(/uji/i);
    expect(state.message).not.toMatch(NO_DELIVERY_CLAIM);
    expect(changes[changes.length - 1]).toEqual(state);
    expectNoSecrets([state, ...changes]);
  });

  it('ignores every action while a request is under way', async () => {
    const { fake, controller } = setup();
    await controller.start();
    fake.hold();
    const first = controller.register(EMAIL, PASSWORD);
    expect(controller.read().busy).toBe(true);
    void controller.register(EMAIL, PASSWORD);
    void controller.register('murid.lain@ayangaji.test', 'Sandi-Lain-1');
    await flush();
    expect(fake.calls).toEqual([['register', EMAIL, PASSWORD]]);
    fake.held[0].resolve();
    await first;
    expect(controller.read()).toMatchObject({ stage: 'code', busy: false, email: EMAIL });
  });

  it('re-enters the code stage for an address (after a reload) without signing up or sending anything', async () => {
    const { fake, controller, changes } = setup();
    await controller.confirm(CODE); // not in the code stage: nothing is sent
    await controller.useCode(EMAIL);
    expect(controller.read()).toMatchObject({ stage: 'code', busy: false, email: EMAIL, error: null });
    expect(fake.calls).toEqual([]);
    await controller.confirm(CODE);
    expect(fake.calls).toEqual([['confirm', EMAIL, CODE]]);
    expectNoSecrets(changes);
  });

  it('refuses an address that is not synthetic (.test) as not_synthetic, sending nothing', async () => {
    for (const email of ['murid@ayangaji.com', 'murid.ayangaji.test', ' murid@ayangaji.test', 'murid@ayangaji.test.id']) {
      const { fake, controller } = setup();
      await controller.useCode(email);
      expect(controller.read().stage).not.toBe('code');
      expect(controller.read()).toMatchObject({ busy: false, email: null, error: 'not_synthetic' });
      await controller.start();
      await controller.register(email, PASSWORD);
      expect(controller.read()).toMatchObject({ stage: 'email', busy: false, email: null, error: 'not_synthetic' });
      expectSafeMessage(controller.read().message, 'not_synthetic');
      expect(fake.calls).toEqual([]);
    }
  });

  it('confirms the exact address and code, then asks for a password sign-in without holding any account', async () => {
    const { fake, controller, changes } = setup();
    await controller.start();
    await controller.register(EMAIL, PASSWORD);
    await controller.confirm(CODE);
    expect(fake.calls).toEqual([['register', EMAIL, PASSWORD], ['confirm', EMAIL, CODE]]);
    const state = controller.read();
    expect(state).toMatchObject({ stage: 'confirmed', busy: false, email: EMAIL, error: null });
    expect(state.message).toMatch(/terkonfirmasi/i);
    expect(state.message).toMatch(/kata sandi/i);
    expect(state.message).not.toMatch(/berhasil masuk|sudah masuk|signed in/i);
    expectNoSecrets([state, ...changes]);
    for (const name of ['signIn', 'signInWithPassword', 'session', 'user', 'token', 'adopt']) expect(name in controller).toBe(false);
    await controller.confirm(CODE); // confirmed ends the flow: nothing more is sent
    await controller.resend();
    await controller.register(EMAIL, PASSWORD);
    expect(fake.calls).toHaveLength(2);
  });

  it('asks for a new code for the exact address once, never claiming an email was delivered', async () => {
    const { fake, controller } = setup();
    await controller.useCode(EMAIL);
    fake.hold();
    const pending = controller.resend();
    void controller.resend();
    await flush();
    expect(fake.calls).toEqual([['resend', EMAIL]]);
    fake.held[0].resolve();
    await pending;
    expect(controller.read()).toMatchObject({ stage: 'code', busy: false, email: EMAIL, error: null });
    expect(controller.read().message).toMatch(/kode baru/i);
    expect(controller.read().message).not.toMatch(NO_DELIVERY_CLAIM);
  });

  it('maps every refusal to its stable code and a stable Indonesian message, never raw text', async () => {
    const codes: RegistrationErrorCode[] = ['weak_password', 'rate_limited', 'network', 'auto_confirm_refused', 'provider_refused', 'bad_response'];
    const messages = new Map<RegistrationErrorCode, string | null>();
    for (const code of [...codes, ...codes]) {
      const { fake, controller } = setup();
      await controller.start();
      fake.fail(new RegistrationError(code));
      await controller.register(EMAIL, PASSWORD);
      const state = controller.read();
      expect(state).toMatchObject({ stage: 'email', busy: false, email: null, error: code });
      expectSafeMessage(state.message, code);
      if (messages.has(code)) expect(state.message).toBe(messages.get(code));
      else messages.set(code, state.message);
    }
    expect(messages.get('weak_password')).toMatch(/kata sandi/i);
    // Anything but a RegistrationError is a bad response, and its text never shows.
    const { fake, controller, changes } = setup();
    await controller.start();
    fake.fail(Object.assign(new Error(`User already registered: ${EMAIL} ${PASSWORD}`), { status: 422 }));
    await controller.register(EMAIL, PASSWORD);
    expect(controller.read()).toMatchObject({ stage: 'email', busy: false, error: 'bad_response' });
    expectSafeMessage(controller.read().message, 'already registered', '422');
    expectNoSecrets(changes);
  });

  it('lets the learner retry after a refusal', async () => {
    const { fake, controller, changes } = setup();
    await controller.start();
    fake.fail(new RegistrationError('network'));
    await controller.register(EMAIL, PASSWORD);
    await controller.register(EMAIL, PASSWORD);
    expect(controller.read()).toMatchObject({ stage: 'code', busy: false, email: EMAIL, error: null });
    fake.fail(new RegistrationError('invalid_code'));
    await controller.confirm('000000');
    expect(controller.read()).toMatchObject({ stage: 'code', busy: false, email: EMAIL, error: 'invalid_code' });
    expect(controller.read().message).toMatch(/kode/i);
    expectSafeMessage(controller.read().message, '000000', 'invalid_code');
    await controller.confirm(CODE);
    expect(controller.read()).toMatchObject({ stage: 'confirmed', busy: false, error: null });
    expect(fake.calls.slice(2)).toEqual([['confirm', EMAIL, '000000'], ['confirm', EMAIL, CODE]]);
    expectNoSecrets(changes);
  });

  it('cancel clears the flow at once and cancels the adapter; a late reply cannot revive it', async () => {
    const { fake, controller, changes } = setup();
    await controller.start();
    fake.hold();
    const pending = controller.register(EMAIL, PASSWORD);
    const cancelling = controller.cancel();
    expect(controller.read()).toEqual(IDLE);
    await cancelling;
    expect(fake.registration.cancel).toHaveBeenCalledTimes(1);
    const seen = changes.length;
    fake.held[0].resolve();
    await pending;
    await flush();
    expect(controller.read()).toEqual(IDLE);
    expect(changes).toHaveLength(seen);
    await controller.start(); // still usable
    expect(controller.read().stage).toBe('email');
  });

  it('a newer start resets the flow and cancels the request under way; its late reply writes nothing', async () => {
    const { fake, controller, changes } = setup();
    await controller.useCode(EMAIL);
    fake.hold();
    const pending = controller.confirm(CODE);
    const restarting = controller.start();
    const fresh = { stage: 'email', busy: false, email: null, error: null };
    expect(controller.read()).toMatchObject(fresh);
    await restarting;
    expect(fake.registration.cancel).toHaveBeenCalled();
    fake.held[0].resolve();
    await pending;
    await flush();
    expect(controller.read()).toMatchObject(fresh);
    expect(changes.some((state) => state.stage === 'confirmed')).toBe(false);
    await controller.register(EMAIL, PASSWORD);
    expect(controller.read()).toMatchObject({ stage: 'code', email: EMAIL });
  });

  it('dispose disposes the adapter for good: no late result, no change, nothing sent afterwards', async () => {
    const { fake, controller, changes } = setup();
    await controller.useCode(EMAIL);
    fake.hold();
    const pending = controller.confirm(CODE);
    await controller.dispose();
    expect(fake.registration.dispose).toHaveBeenCalledTimes(1);
    expect(controller.read()).toEqual(IDLE);
    const seen = changes.length;
    fake.held[0].reject(new RegistrationError('disposed'));
    await pending;
    await controller.start();
    await controller.useCode(EMAIL);
    await controller.register(EMAIL, PASSWORD);
    await controller.resend();
    await controller.confirm(CODE);
    await flush();
    expect(fake.calls).toEqual([['confirm', EMAIL, CODE]]);
    expect(controller.read()).toEqual(IDLE);
    expect(changes).toHaveLength(seen);
  });

  it('once active() is false, sends nothing and clears the flow, and drops a reply under way', async () => {
    const before = setup();
    await before.controller.useCode(EMAIL);
    before.setActive(false); // e.g. the account changed, the route blurred or the app went to the background
    await before.controller.confirm(CODE);
    await before.controller.resend();
    expect(before.fake.calls).toEqual([]);
    expect(before.controller.read()).toEqual(IDLE);
    const { fake, controller, changes, setActive } = setup();
    await controller.useCode(EMAIL);
    fake.hold();
    const pending = controller.confirm(CODE);
    setActive(false);
    fake.held[0].resolve();
    await pending;
    await flush();
    expect(controller.read()).toEqual(IDLE);
    expect(changes.some((state) => state.stage === 'confirmed')).toBe(false);
  });

  it('keeps two controllers apart and never opens SQLite, the learner store or web storage', async () => {
    const touched: string[] = [];
    const names = ['localStorage', 'sessionStorage', 'indexedDB'];
    const originals = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
    for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, get: () => void touched.push(name) });
    try {
      const a = setup();
      const b = setup();
      await a.controller.start();
      await a.controller.register(EMAIL, PASSWORD);
      await a.controller.confirm(CODE);
      await b.controller.useCode('murid.dua@ayangaji.test');
      expect(a.controller.read()).toMatchObject({ stage: 'confirmed', email: EMAIL });
      expect(b.controller.read()).toMatchObject({ stage: 'code', email: 'murid.dua@ayangaji.test' });
      expect([a.fake.calls.length, b.fake.calls.length]).toEqual([2, 0]);
      await a.controller.cancel();
      expect(b.controller.read().stage).toBe('code');
      expect(b.fake.registration.cancel).not.toHaveBeenCalled();
    } finally {
      names.forEach((name, index) => {
        if (originals[index]) Object.defineProperty(globalThis, name, originals[index]!);
        else delete (globalThis as Record<string, unknown>)[name];
      });
    }
    expect(touched).toEqual([]);
    expect(mockSqliteOpened).not.toHaveBeenCalled();
    expect(mockLearnerStoreOpened).not.toHaveBeenCalled();
  });
});
