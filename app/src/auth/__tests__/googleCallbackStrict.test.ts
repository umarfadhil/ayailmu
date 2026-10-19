// Continue with Google's callback, held to exactly what the pinned local GoTrue (2.197.0) sends back with the
// authorization code + PKCE flow, and the attempt's record, held to single use: regression contracts written after a
// review of the first implementation (phase 10), before its fix. A code callback is the attempt's exact callback with
// one code in GoTrue's own form, a canonical lower-case UUID (never another provider's code), and nothing token-like
// beside it, in its query as in its fragment. A callback is honoured only once its attempt's record is used up, which on
// the web means removed from this tab's sessionStorage: a storage that cannot remove the record never hands it over, so
// its code is never exchanged, on the callback's page or on any reload of it. The real @supabase/auth-js AuthClient runs
// over the adapter's bounded transport; behind it test/fakeGoogleAuth.ts plays Google and GoTrue in front of the fake
// GoTrue of test/fakeAccountApi.ts. Each refusal here comes before any request: nothing is exchanged, no session is made
// at the server or adopted, the attempt is over, and neither the error nor the console shows a token, code or verifier.
// Local mocked protocol evidence only, never a real Google sign-in.
import type { EnabledGoogleConfig } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { GOOGLE_ATTEMPT_KEY, sessionGoogleStore, type GoogleAttemptRecord, type GoogleSignIn, type PendingGoogleStore } from '@/auth/google';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError, type AuthIdentity } from '@/auth/types';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeAccountApi } from '../../../test/fakeAccountApi';
import { fakeGoogleGoTrue, type FakeGoogleGoTrue, type GoogleAccount } from '../../../test/fakeGoogleAuth';

const T = Date.UTC(2026, 9, 19, 7, 0, 0);
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: FAKE_API, authUrl: FAKE_GOTRUE };
const NATIVE: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'native', callbackUrl: 'arabictrial://account' };
const WEB: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'web', callbackUrl: 'http://localhost:8081/account' };
const PKCE_EXCHANGE = 'POST /token?grant_type=pkce';
/** A Google account the local GoTrue knows, with an ordinary address; its password is only ever used inside the fake. */
const G_ANI: GoogleAccount = {
  email: 'ani.learner@example.com',
  password: 'mint-only-google-ani-4',
  uid: 'uid-google-ani',
  token: 'unused-legacy-token-google-ani',
  accountId: '8d3f3b60-4e5c-4f70-8b82-93c4d5e6f708',
  googleSub: '109876543210987654321',
  name: 'Ani Pelajar',
};

/** The link the app receives, made from GoTrue's callback: its base (the exact callback), the callback itself and its code. */
type Tamper = (at: { base: string; callback: string; code: string }) => string;

/** GoTrue's code callback with something token-like in its query too: an implicit-flow reply, or a link tampered with. */
const TOKENS_IN_THE_QUERY: { case: string; tamper: Tamper }[] = [
  { case: 'an access token', tamper: ({ callback }) => `${callback}&access_token=canary-access-token-1` },
  { case: 'a refresh token', tamper: ({ callback }) => `${callback}&refresh_token=canary-refresh-token-1` },
  { case: "Google's provider token", tamper: ({ callback }) => `${callback}&provider_token=ya29.canary-provider-token-1` },
  { case: "Google's provider refresh token", tamper: ({ callback }) => `${callback}&provider_refresh_token=canary-provider-refresh-token-1` },
  { case: 'an ID token', tamper: ({ callback }) => `${callback}&id_token=canary-id-token-1` },
  { case: 'an access token placed before the code', tamper: ({ base, code }) => `${base}?access_token=canary-access-token-2&code=${code}` },
  { case: 'an access token under a percent-encoded name', tamper: ({ callback }) => `${callback}&access%5Ftoken=canary-access-token-3` },
];

/** One code, but not in GoTrue's form (a canonical lower-case UUID): no GoTrue issued it, so it is never sent. */
const NOT_GOTRUE_CODES: { case: string; tamper: Tamper }[] = [
  { case: 'sixteen letters and digits', tamper: ({ base }) => `${base}?code=AbCdEfGh12345678` },
  { case: "GoTrue's code without its hyphens", tamper: ({ base, code }) => `${base}?code=${code.replace(/-/g, '')}` },
  { case: 'an upper-case UUID', tamper: ({ base }) => `${base}?code=7C2E2A5F-3D4B-4E6F-9A71-82B3C4D5E6F7` },
];

/** Where GoTrue's redirect lands: natively, at the attempt still open in this run; on the web, at a fresh page. */
const ARRIVALS: { arrival: string; config: EnabledGoogleConfig }[] = [
  { arrival: 'natively, at the attempt still open', config: NATIVE },
  { arrival: 'on the web, at a fresh page after the redirect', config: WEB },
];

type Removal = 'refuses' | 'ignores';
/** This tab's sessionStorage failing to remove an entry, whether it says so or not. */
const CANNOT_REMOVE: [string, Removal][] = [
  ['refuses to remove it (removeItem throws)', 'refuses'],
  ['silently keeps it (removeItem does nothing)', 'ignores'],
];

/** Replaces the global fetch for one test; returns the undo. */
function replaceFetch(value: unknown): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  Object.defineProperty(globalThis, 'fetch', { value, configurable: true, writable: true });
  return () => {
    if (before) Object.defineProperty(globalThis, 'fetch', before);
    else Reflect.deleteProperty(globalThis, 'fetch');
  };
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

/** A typed AuthError with a stable code, whose text shows none of `secrets`. */
function expectCode(error: unknown, code: string, secrets: string[]) {
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).code).toBe(code);
  const shown = `${String(error)} ${JSON.stringify(error)}`;
  for (const secret of secrets) expect(shown).not.toContain(secret);
}

/** A logged value as text, errors included. */
function printed(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message} ${value.stack ?? ''}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const codeOf = (callback: string) => new URL(callback).searchParams.get('code') ?? '';

/** The Google sign-in of an adapter given a Google configuration. */
function googleOf(auth: SupabaseAuth): GoogleSignIn {
  expect(auth.google).toBeDefined();
  if (!auth.google) throw new Error('no Google sign-in was built');
  return auth.google;
}

/** The attempt's short-lived store as the adapter sees it, with what it holds visible to the test. */
function testStore() {
  let held: GoogleAttemptRecord | null = null;
  return {
    save(record: GoogleAttemptRecord) {
      held = { ...record };
    },
    take() {
      const record = held;
      held = null;
      return record;
    },
    clear() {
      held = null;
    },
    /** What it holds now, without taking it. */
    peek: (): GoogleAttemptRecord | null => held,
  };
}

/** This tab's sessionStorage, its entries visible to the test: removing one works, is refused (it throws and the entry stays) or is silently ignored. */
function webSessionStorage(removal: 'removes' | Removal) {
  const items = new Map<string, string>();
  return {
    items,
    getItem: jest.fn((key: string) => items.get(key) ?? null),
    setItem: jest.fn((key: string, value: string) => {
      items.set(key, value);
    }),
    removeItem: jest.fn((key: string): void => {
      if (removal === 'refuses') throw new Error('SecurityError: The operation is insecure.');
      if (removal === 'removes') items.delete(key);
    }),
  };
}

/** Only the one pending-attempt key was read, written or removed (however often it was read). */
function expectOnlyItsKey(storage: ReturnType<typeof webSessionStorage>) {
  for (const [key] of [...storage.getItem.mock.calls, ...storage.setItem.mock.calls, ...storage.removeItem.mock.calls]) expect(key).toBe(GOOGLE_ATTEMPT_KEY);
}

describe("Continue with Google honours only GoTrue's exact code callback, and only once", () => {
  const networkProbe = jest.fn();
  let fake: FakeAccountApi = fakeAccountApi([]);
  let gotrue: FakeGoogleGoTrue = fakeGoogleGoTrue(fake, { redirects: [], known: [] });
  /** What neither an error nor the console may show, beside every secret the fake GoTrue saw. */
  let hidden: string[] = [];
  let logs: jest.SpyInstance[] = [];
  let undo: (() => void)[] = [];

  beforeEach(() => {
    fake = fakeAccountApi([G_ANI]);
    gotrue = fakeGoogleGoTrue(fake, { redirects: [NATIVE.callbackUrl, WEB.callbackUrl], known: [G_ANI] });
    hidden = [];
    networkProbe.mockClear();
    undo = [replaceFetch(networkProbe)];
    logs = [jest.spyOn(console, 'log'), jest.spyOn(console, 'info'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error'), jest.spyOn(console, 'debug')];
  });
  afterEach(() => {
    try {
      // Nothing hidden and no secret was logged; nothing reached the global fetch.
      const logged = logs.flatMap((spy) => spy.mock.calls.flat().map(printed)).join('\n');
      for (const secret of [...hidden, ...gotrue.secrets]) expect(logged).not.toContain(secret);
      expect(networkProbe).not.toHaveBeenCalled();
    } finally {
      logs.forEach((spy) => spy.mockRestore());
      undo.reverse().forEach((restore) => restore());
    }
  });

  const adapter = (config: EnabledGoogleConfig, store: PendingGoogleStore) => createSupabaseAuth({ config: CONFIG, fetch: gotrue.fetch, google: { config, store } });

  /** Keeps `values` (never an empty one) out of every error and the console. */
  const hide = (...values: string[]) => {
    hidden.push(...values.filter((value) => value !== ''));
  };

  /** Nothing reached the Auth server or any other fake server: no exchange was sent, and no session exists there. */
  function expectNothingSent() {
    expect(gotrue.requests).toEqual([]);
    expect(gotrue.exchanges).toEqual([]);
    expect(fake.wire).toEqual([]);
    expect(fake.auth.liveSessions(G_ANI.email)).toBe(0);
  }

  /**
   * An attempt of `config`'s platform at which G_ANI consented: GoTrue's callback and its code, the attempt's store, and
   * how a link reaches the app (natively, the attempt still open in this run; on the web, a fresh page loaded with it).
   */
  async function consented(config: EnabledGoogleConfig) {
    const store = testStore();
    const page = adapter(config, store);
    const attempt = await googleOf(page).start();
    const record = store.peek();
    if (!record) throw new Error('the attempt kept no record');
    hide(record.verifier);
    const callback = gotrue.consent(attempt.url, G_ANI);
    return {
      store,
      callback,
      code: codeOf(callback),
      receive(link: string): { auth: SupabaseAuth; result: Promise<AuthIdentity | null> } {
        if (config.platform === 'native') return { auth: page, result: attempt.complete(link) };
        const fresh = adapter(config, store);
        return { auth: fresh, result: googleOf(fresh).resume(link) };
      },
    };
  }

  /** `tamper` of GoTrue's callback reaches the app: a bad callback, refused before any request; and the attempt is over. */
  async function expectRefusedBeforeAnyRequest(config: EnabledGoogleConfig, tamper: Tamper) {
    const flow = await consented(config);
    const link = tamper({ base: config.callbackUrl, callback: flow.callback, code: flow.code });
    expect(link).not.toBe(flow.callback);
    hide(...new URL(link).searchParams.values());

    const arrived = flow.receive(link);
    expectCode(await failure(() => arrived.result), 'bad_callback', [...hidden, ...gotrue.secrets]);
    expectNothingSent();
    expect(arrived.auth.status()).toEqual({ state: 'signed-out' });
    expect(flow.store.peek()).toBeNull();

    // The attempt is over: even GoTrue's untouched callback is refused now, still without a request.
    const again = flow.receive(flow.callback);
    expectCode(await failure(() => again.result), 'bad_callback', [...hidden, ...gotrue.secrets]);
    expectNothingSent();
    expect(again.auth.status()).toEqual({ state: 'signed-out' });
  }

  describe.each(ARRIVALS)('a callback arriving $arrival', ({ config }) => {
    it.each(TOKENS_IN_THE_QUERY)('a code callback with $case in its query is refused as a bad callback before any request; nothing is adopted and the attempt is over', async ({ tamper }) => {
      await expectRefusedBeforeAnyRequest(config, tamper);
    });

    it.each(NOT_GOTRUE_CODES)(
      "a code callback whose code is $case, not GoTrue's canonical lower-case UUID, is refused as a bad callback before any request; nothing is adopted and the attempt is over",
      async ({ tamper }) => {
        await expectRefusedBeforeAnyRequest(config, tamper);
      }
    );

    it("control: GoTrue's untouched callback is exchanged once and signs the Google account in", async () => {
      const flow = await consented(config);
      const arrived = flow.receive(flow.callback);
      await expect(arrived.result).resolves.toMatchObject({ uid: providerUserId(G_ANI), email: G_ANI.email });
      expect(gotrue.requests).toEqual([PKCE_EXCHANGE]);
      expect(gotrue.exchanges).toEqual(['issued']);
      expect(arrived.auth.status()).toMatchObject({ state: 'signed-in', identity: { email: G_ANI.email } });
      expect(flow.store.peek()).toBeNull();
    });
  });

  describe("a web callback whose record this tab's sessionStorage cannot remove", () => {
    /** The page that starts the attempt keeps its record in this tab's sessionStorage; then the browser leaves for Google. */
    async function startedOnTheWeb(storage: ReturnType<typeof webSessionStorage>) {
      const store = sessionGoogleStore(storage);
      const attempt = await googleOf(adapter(WEB, store)).start();
      const kept = JSON.parse(storage.items.get(GOOGLE_ATTEMPT_KEY) ?? 'null') as GoogleAttemptRecord | null;
      if (!kept) throw new Error('the attempt kept no record');
      hide(kept.verifier);
      return { store, callback: gotrue.consent(attempt.url, G_ANI) };
    }

    it('control: a sessionStorage that removes it: the callback is exchanged once, and a reload of it is refused without a request', async () => {
      const storage = webSessionStorage('removes');
      const { store, callback } = await startedOnTheWeb(storage);
      const page = adapter(WEB, store);
      await expect(googleOf(page).resume(callback)).resolves.toMatchObject({ uid: providerUserId(G_ANI), email: G_ANI.email });
      expect(page.status()).toMatchObject({ state: 'signed-in', identity: { email: G_ANI.email } });
      expectCode(await failure(() => googleOf(adapter(WEB, store)).resume(callback)), 'bad_callback', [...hidden, ...gotrue.secrets]);
      expect(gotrue.requests).toEqual([PKCE_EXCHANGE]);
      expectOnlyItsKey(storage);
    });

    it.each(CANNOT_REMOVE)('a sessionStorage that %s: the callback is refused as a bad callback before any request, on its page and on every reload', async (_case, removal) => {
      const storage = webSessionStorage(removal);
      const { store, callback } = await startedOnTheWeb(storage);
      // The callback's page, then reloads of it: none may use a record that was not used up.
      for (let load = 0; load < 3; load += 1) {
        const page = adapter(WEB, store);
        expectCode(await failure(() => googleOf(page).resume(callback)), 'bad_callback', [...hidden, ...gotrue.secrets]);
        expect(page.status()).toEqual({ state: 'signed-out' });
      }
      expectNothingSent();
      expectOnlyItsKey(storage);
    });
  });
});

describe("the web store, when this tab's sessionStorage cannot remove the attempt's record", () => {
  /** As the SDK makes them: a 32-hex flow id and a 112-hex code verifier. */
  const RECORD: GoogleAttemptRecord = { v: 1, flowId: '0f1e2d3c4b5a69788796a5b4c3d2e1f0', verifier: 'ab'.repeat(56), callbackUrl: WEB.callbackUrl, createdAt: T };
  const NEWER: GoogleAttemptRecord = { ...RECORD, flowId: '1f1e2d3c4b5a69788796a5b4c3d2e1f0', verifier: 'cd'.repeat(56), createdAt: T + 60_000 };

  it('control: a sessionStorage that removes it hands the record over once', () => {
    const storage = webSessionStorage('removes');
    sessionGoogleStore(storage).save(RECORD);
    const page = sessionGoogleStore(storage);
    expect(page.take()).toEqual(RECORD);
    expect(page.take()).toBeNull();
    expect(sessionGoogleStore(storage).take()).toBeNull();
    expectOnlyItsKey(storage);
  });

  it.each(CANNOT_REMOVE)('a sessionStorage that %s: nothing is handed over however often it is taken, nor a newer record; clear stays best-effort; only its one key is touched', (_case, removal) => {
    const storage = webSessionStorage(removal);
    // The page that started the attempt kept its record; then the browser left for Google.
    sessionGoogleStore(storage).save(RECORD);
    expect(storage.items.has(GOOGLE_ATTEMPT_KEY)).toBe(true);

    // The callback's page, and each reload of it: a record that cannot be used up is never handed over.
    const page = sessionGoogleStore(storage);
    expect(page.take()).toBeNull();
    expect(page.take()).toBeNull();
    expect(sessionGoogleStore(storage).take()).toBeNull();

    // Nor is a newer attempt's record, left there the same way; clearing stays best-effort and quiet.
    storage.items.set(GOOGLE_ATTEMPT_KEY, JSON.stringify(NEWER));
    expect(page.take()).toBeNull();
    expect(sessionGoogleStore(storage).take()).toBeNull();
    expect(() => page.clear()).not.toThrow();
    expect(page.take()).toBeNull();
    expectOnlyItsKey(storage);
  });
});
