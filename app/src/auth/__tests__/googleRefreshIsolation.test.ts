// Separate browser tabs each load their own copy of the app's modules (and so does each full-page load in a tab), so
// whatever a module counts starts again in every one. Continue with Google keeps each SDK client's session in that
// client's own RAM under its storage key, and in a browser the maintained SDK (with persistSession) opens a
// BroadcastChannel named by that key and posts every auth event there with its session, tokens included. No two tabs'
// session-holding Google clients may therefore ever share a storage key: neither the client that exchanges a
// callback's code (keyed by the attempt's random flow id) nor the fresh client each refresh hands the session to.
// Written after a source review (phase 10), before its fix. Each page here is a module realm of its own
// (jest.isolateModules), with its own adapter module and its own @supabase/auth-js AuthClient class. Two tabs sign in
// with Google the web way through the fake Google/GoTrue of test/fakeGoogleAuth.ts (one local Auth server, as tabs
// share it), then both refresh twice, each time once both sessions have expired. Every SDK client's storage key and
// storage are noted at the adapter's public factory boundary; a session holder is a client whose own storage holds a
// session under its key. Module counters, the clock and Math.random run the same in both tabs, so only secure
// randomness or the attempt's own lineage can keep two tabs' keys apart. Failures show storage keys, statuses and
// account IDs only, never a token. Local mocked protocol evidence only, never a real Google sign-in.
import type { GoTrueClientOptions } from '@supabase/auth-js';

import type { EnabledGoogleConfig } from '@/account/googleConfig';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import type { GoogleAttemptRecord, GoogleSignIn, PendingGoogleStore } from '@/auth/google';
import type { SupabaseAuth } from '@/auth/supabaseAuth';
import { FAKE_API, FAKE_GOTRUE, fakeAccountApi, providerUserId, type FakeAccountApi } from '../../../test/fakeAccountApi';
import { fakeGoogleGoTrue, type FakeGoogleGoTrue, type GoogleAccount } from '../../../test/fakeGoogleAuth';

/** The adapter and SDK modules as one page load gets them. */
type AdapterModule = typeof import('@/auth/supabaseAuth');
type SdkModule = typeof import('@supabase/auth-js');

jest.setTimeout(20_000);

const T = Date.UTC(2026, 9, 19, 8, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const CONFIG: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: FAKE_API, authUrl: FAKE_GOTRUE };
const WEB: EnabledGoogleConfig = { enabled: true, provider: 'google', platform: 'web', callbackUrl: 'http://localhost:8081/account' };
const REFRESH_GRANT = 'POST /token?grant_type=refresh_token';

/** Google accounts with ordinary (non-.test) addresses, known to the local GoTrue. */
const G_ANI: GoogleAccount = {
  email: 'ani.learner@example.com',
  password: 'mint-only-google-ani-4',
  uid: 'uid-google-ani',
  token: 'unused-legacy-token-google-ani',
  accountId: '8d3f3b60-4e5c-4f70-8b82-93c4d5e6f708',
  googleSub: '109876543210987654321',
  name: 'Ani Pelajar',
};
const G_BUDI: GoogleAccount = {
  email: 'budi.learner@example.com',
  password: 'mint-only-google-budi-5',
  uid: 'uid-google-budi',
  token: 'unused-legacy-token-google-budi',
  accountId: '9e404c71-5f6d-4081-9c93-a4d5e6f70819',
  googleSub: '108765432109876543210',
  name: 'Budi Pelajar',
};

/** An SDK client as the adapter's public factory boundary saw it built: the page that built it, its storage key and storage. */
interface Built {
  page: string;
  storageKey: string;
  storage: GoTrueClientOptions['storage'];
}

/** A loaded page: its own adapter module, and the adapter it built. */
interface Page {
  module: AdapterModule;
  auth: SupabaseAuth;
}

let clock = { now: T };
let fake: FakeAccountApi = fakeAccountApi([]);
let gotrue: FakeGoogleGoTrue = fakeGoogleGoTrue(fake, { redirects: [], known: [] });
let spies: jest.SpyInstance[] = [];

beforeEach(() => {
  clock = { now: T };
  fake = fakeAccountApi([G_ANI, G_BUDI]);
  gotrue = fakeGoogleGoTrue(fake, { redirects: [WEB.callbackUrl], known: [G_ANI, G_BUDI] });
  // Every tab reads the same clock and draws the same Math.random values: neither can tell two tabs apart.
  spies = [jest.spyOn(Date, 'now').mockImplementation(() => clock.now), jest.spyOn(Math, 'random').mockReturnValue(0.5)];
});

afterEach(() => {
  spies.forEach((spy) => spy.mockRestore());
});

/** Lets every pending reply and its follow-ups (a let-go client's teardown, say) run to the end. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The Google sign-in of an adapter given a Google configuration. */
function googleOf(auth: SupabaseAuth): GoogleSignIn {
  expect(auth.google).toBeDefined();
  if (!auth.google) throw new Error('no Google sign-in was built');
  return auth.google;
}

/** A tab's slot for its pending attempt (its sessionStorage): it outlives each page load in the tab, never the tab. */
function tabStore(): PendingGoogleStore {
  let held: GoogleAttemptRecord | null = null;
  return {
    save(record) {
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
  };
}

/**
 * Loads one page: a module realm of its own, as each tab (and each full-page load in a tab) gets, with its own adapter
 * module and its own AuthClient class. The adapter builds its Google clients with that class, each noted as built.
 */
function loadPage(name: string, store: PendingGoogleStore, built: Built[]): Page {
  const realm: { adapter?: AdapterModule; sdk?: SdkModule } = {};
  jest.isolateModules(() => {
    realm.adapter = jest.requireActual<AdapterModule>('@/auth/supabaseAuth');
    realm.sdk = jest.requireActual<SdkModule>('@supabase/auth-js');
  });
  const { adapter, sdk } = realm;
  if (!adapter || !sdk) throw new Error(`${name} did not load`);
  const auth = adapter.createSupabaseAuth({
    config: CONFIG,
    fetch: gotrue.fetch,
    google: {
      config: WEB,
      store,
      createClient: (options) => {
        built.push({ page: name, storageKey: options.storageKey ?? '', storage: options.storage });
        return new sdk.AuthClient(options);
      },
    },
  });
  return { module: adapter, auth };
}

/**
 * A tab signs in with Google as `account`, the web way: the page that starts the attempt records it in the tab's store,
 * the browser leaves for Google, and the page the callback loads (a fresh realm) resumes it and holds the session.
 */
async function signInTab(tab: string, account: GoogleAccount) {
  const store = tabStore();
  const built: Built[] = [];
  const starting = loadPage(`${tab}, starting page`, store, built);
  const attempt = await googleOf(starting.auth).start();
  const callback = gotrue.consent(attempt.url, account);
  const landing = loadPage(`${tab}, callback page`, store, built);
  const identity = await googleOf(landing.auth).resume(callback);
  return { auth: landing.auth, built, identity, modules: [starting.module, landing.module] };
}

/** The storage keys of the clients whose own storage holds a session under their key: the tab's session holders. */
async function holders(built: Built[]): Promise<string[]> {
  const keys: string[] = [];
  for (const { storageKey, storage } of built) {
    if (typeof (await storage?.getItem(storageKey)) === 'string') keys.push(storageKey);
  }
  return keys;
}

/** Every entry a client's own storage still keeps of a session, its user or a code verifier, named by key only. */
async function leftovers(built: Built[]): Promise<string[]> {
  const kept: string[] = [];
  for (const { storageKey, storage } of built) {
    for (const key of [storageKey, `${storageKey}-user`, `${storageKey}-code-verifier`, `${storageKey}-flows-code-verifier`]) {
      if (typeof (await storage?.getItem(key)) === 'string') kept.push(key);
    }
  }
  return kept;
}

/** What the account API says the session's current access token signs in as: its status and account ID, never the token. */
function accountAt(auth: SupabaseAuth): Promise<{ status: number; accountId: unknown }> {
  return auth.authorized(async (token, signal) => {
    const reply = await fake.fetch(`${FAKE_API}/v1/me`, { headers: { authorization: `Bearer ${token}` }, signal });
    const body = reply.status === 200 ? ((await reply.json()) as { account_id?: unknown }) : null;
    return { status: reply.status, accountId: body?.account_id ?? null };
  });
}

/** The adapter's number for the session in use, or null when it has none in use. */
function sessionNumber(auth: SupabaseAuth): number | null {
  const status = auth.status();
  return status.state === 'signed-in' ? status.session : null;
}

const refreshGrants = () => gotrue.requests.filter((request) => request === REFRESH_GRANT).length;

describe('Google sessions in separate tabs never share a storage key (the SDK names its BroadcastChannel after it)', () => {
  it("control: each page loads its own adapter module, and the client that exchanges each tab's callback holds its session under a key the other tab's holder never has", async () => {
    const a = await signInTab('tab A', G_ANI);
    const b = await signInTab('tab B', G_BUDI);
    // Four page loads, four adapter modules: nothing a module counts is shared between them.
    expect(new Set([...a.modules, ...b.modules]).size).toBe(4);
    expect(a.identity).toMatchObject({ uid: providerUserId(G_ANI), email: G_ANI.email });
    expect(b.identity).toMatchObject({ uid: providerUserId(G_BUDI), email: G_BUDI.email });
    await settle();

    const inA = await holders(a.built);
    const inB = await holders(b.built);
    expect([inA.length, inB.length]).toEqual([1, 1]);
    expect(inA.filter((key) => inB.includes(key))).toEqual([]);
  });

  it("the fresh client each refresh hands the session to keeps a key the other tab's session holders never have, through two rotations", async () => {
    const a = await signInTab('tab A', G_ANI);
    const b = await signInTab('tab B', G_BUDI);
    // Separate realms (so a key cannot differ merely because one module counter ran on).
    expect(new Set([...a.modules, ...b.modules]).size).toBe(4);
    await settle();
    const stages = [{ stage: 'exchange', a: await holders(a.built), b: await holders(b.built) }];
    for (const stage of ['refresh 1', 'refresh 2']) {
      clock.now += HOUR + MINUTE; // both sessions have expired: each tab refreshes its own, at the same moment
      await a.auth.refresh();
      await b.auth.refresh();
      await settle();
      stages.push({ stage, a: await holders(a.built), b: await holders(b.built) });
    }

    // One session holder per tab at each stage, a new client each time.
    for (const { stage, a: inA, b: inB } of stages) expect([stage, inA.length, inB.length]).toEqual([stage, 1, 1]);
    const keysA = stages.map(({ a: inA }) => inA[0]);
    const keysB = stages.map(({ b: inB }) => inB[0]);
    expect([new Set(keysA).size, new Set(keysB).size]).toEqual([stages.length, stages.length]);
    // Neither tab's session holders ever take a key of the other's, at the same stage or any other: their channels never meet.
    expect(stages.map(({ stage, a: inA, b: inB }) => ({ stage, shared: inA.filter((key) => inB.includes(key)) }))).toEqual(
      stages.map(({ stage }) => ({ stage, shared: [] }))
    );
    expect(keysA.filter((key) => keysB.includes(key))).toEqual([]);
  });

  it("control: each tab's session stays its own through two rotations: one refresh grant each, the same session number, its token reads its own account, and signing out revokes only its own session and leaves nothing in any client's storage", async () => {
    const a = await signInTab('tab A', G_ANI);
    const b = await signInTab('tab B', G_BUDI);
    const numbers = [sessionNumber(a.auth), sessionNumber(b.auth)];
    expect(numbers.every((n) => typeof n === 'number')).toBe(true);

    for (let round = 1; round <= 2; round += 1) {
      clock.now += HOUR + MINUTE; // both sessions have expired
      const grants = refreshGrants();
      await expect(a.auth.refresh()).resolves.toMatchObject({ uid: providerUserId(G_ANI), email: G_ANI.email });
      await expect(b.auth.refresh()).resolves.toMatchObject({ uid: providerUserId(G_BUDI), email: G_BUDI.email });
      expect([round, refreshGrants() - grants]).toEqual([round, 2]);
      expect([sessionNumber(a.auth), sessionNumber(b.auth)]).toEqual(numbers);
      // Each rotated token works, for its own account only.
      await expect(accountAt(a.auth)).resolves.toEqual({ status: 200, accountId: G_ANI.accountId });
      await expect(accountAt(b.auth)).resolves.toEqual({ status: 200, accountId: G_BUDI.accountId });
    }

    // Signing one tab out revokes its session only: the other tab's still works, until it signs out too.
    await expect(a.auth.signOut()).resolves.toEqual({ revoked: true });
    expect(fake.auth.liveSessions(G_ANI.email)).toBe(0);
    await expect(accountAt(b.auth)).resolves.toEqual({ status: 200, accountId: G_BUDI.accountId });
    await expect(b.auth.signOut()).resolves.toEqual({ revoked: true });
    await settle();
    expect(fake.auth.liveSessions(G_BUDI.email)).toBe(0);
    expect(await leftovers([...a.built, ...b.built])).toEqual([]);
  });
});
