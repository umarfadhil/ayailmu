// The private QA profile binds a password sign-in to its one approved recipient exactly as written (no case folding),
// on the SDK's reply as on the request. A reply whose Session.user.email is only a case variant of the address asked for
// (owner-qa@example.invalid answered as OWNER-QA@example.invalid) is not that recipient: under the private QA profile it is refused
// as bad_response before it is adopted, its client is retired through the SDK's local sign-out, and nothing is
// remembered, so no record can be written that the next restore would refuse. The exact recipient still signs in and is
// remembered. Local, staging and production builds keep their case-insensitive match of the reply. Written before the
// change: the case-variant case fails on the current adapter. The provider is a SIMULATION: an in-memory SDK factory
// answers every call, the vault is an in-memory fake, and the injected fetch rejects (and fails the test) if anything
// ever reaches it. No real Auth server, device, network, email or credential.
import type { AuthTokenResponsePassword, GoTrueClientOptions, Session as SdkSession } from '@supabase/auth-js';
import { PRIVATE_QA, PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN, PRIVATE_QA_RECIPIENT } from '@/account/privateQa';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { createSupabaseAuth, type CreateSdkClient, type RememberedSessions, type SdkClient, type SupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError, type AuthErrorCode, type SessionVault } from '@/auth/types';

const INSTALLATION = 'install-private-qa-binding';
const PASSWORD = 'pw-simulated-not-a-credential';
const UID = '2f6c1a8e-4b3d-4e5f-9a10-b2c3d4e5f607';
const ACCOUNT_ID = '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a';

const PRIVATE_CONFIG: EnabledSupabaseConfig = {
  enabled: true,
  provider: 'local-supabase',
  environment: PRIVATE_QA,
  privateQa: true,
  apiBaseUrl: PRIVATE_QA_API_ORIGIN,
  authUrl: PRIVATE_QA_AUTH_ORIGIN,
};

/** What one simulated SDK client was built with and asked. */
interface SimulatedClient {
  options: GoTrueClientOptions;
  signIns: { email: string; password: string }[];
  signOuts: unknown[];
  refreshes: number;
}

/** An in-memory SDK factory whose password sign-in answers with a session for `replyEmail`, whatever was asked. */
function simulatedSdk(replyEmail: string) {
  const clients: SimulatedClient[] = [];
  const createClient: CreateSdkClient = (options) => {
    const seen: SimulatedClient = { options, signIns: [], signOuts: [], refreshes: 0 };
    clients.push(seen);
    const sdk: SdkClient = {
      async signInWithPassword(credentials) {
        const { email, password } = credentials as { email: string; password: string };
        seen.signIns.push({ email, password });
        const user = { id: UID, email: replyEmail, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-26T00:00:00.000Z' };
        const session = {
          access_token: `simulated-access-${clients.length}`,
          refresh_token: `simulated-refresh-${clients.length}`,
          token_type: 'bearer',
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        } as unknown as SdkSession;
        const reply: AuthTokenResponsePassword = { data: { user: session.user, session }, error: null };
        return reply;
      },
      async getSession() {
        throw new Error('the simulated SDK has no stored session');
      },
      async refreshSession() {
        seen.refreshes += 1;
        throw new Error('the simulated SDK refreshes nothing in this suite');
      },
      async signOut(options) {
        seen.signOuts.push(options);
        return { error: null };
      },
      async stopAutoRefresh() {
        // Nothing runs in the background.
      },
    };
    return sdk;
  };
  return { createClient, clients };
}

/** An in-memory secure vault: its record text, and how often it was written and cleared. */
function memoryVault() {
  const state = { text: null as string | null, writes: 0, clears: 0 };
  const port: SessionVault = {
    installation: () => INSTALLATION,
    read: () => state.text,
    write: (text) => {
      state.writes += 1;
      state.text = text;
    },
    clear: () => {
      state.clears += 1;
      state.text = null;
    },
  };
  return { port, state };
}

/** A fetch that must never run: every Auth call here is answered by the simulated SDK. */
const neverFetch = () =>
  jest.fn(async (..._request: Parameters<typeof fetch>): Promise<Response> => {
    throw new Error('the injected fetch was called; nothing may reach the network in this suite');
  });

function build(config: EnabledSupabaseConfig, replyEmail: string) {
  const sdk = simulatedSdk(replyEmail);
  const vault = memoryVault();
  const fetch = neverFetch();
  const auth: SupabaseAuth = createSupabaseAuth({
    config,
    createClient: sdk.createClient,
    fetch: fetch as unknown as typeof globalThis.fetch,
    remember: { vault: vault.port },
  });
  return { auth, sdk, vault, fetch };
}

function rememberedOf(auth: SupabaseAuth): RememberedSessions {
  if (!auth.remembered) throw new Error('This adapter has no remembered-session surface (auth.remembered).');
  return auth.remembered;
}

/** Starts `run` now and gives its rejection; the test fails if it resolves. */
function failure(run: () => Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve) => resolve(run())).then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );
}

function expectAuthError(error: unknown, code: AuthErrorCode) {
  expect(error).toBeInstanceOf(AuthError);
  expect((error as AuthError).code).toBe(code);
}

describe('private QA: the SDK reply is bound to the approved recipient exactly as written', () => {
  it('refuses a case-variant Session.user.email before adoption, retires its client and never remembers it', async () => {
    const variant = PRIVATE_QA_RECIPIENT.replace('owner-qa', 'OWNER-QA');
    expect(variant).toBe('OWNER-QA@example.invalid');
    const { auth, sdk, vault, fetch } = build(PRIVATE_CONFIG, variant);
    const remembered = rememberedOf(auth);

    expectAuthError(await failure(() => auth.signIn(PRIVATE_QA_RECIPIENT, PASSWORD)), 'bad_response');

    // The exact recipient was asked for, once, through one client, which was then retired by its local sign-out.
    expect(sdk.clients).toHaveLength(1);
    expect(sdk.clients[0].signIns).toEqual([{ email: PRIVATE_QA_RECIPIENT, password: PASSWORD }]);
    expect(sdk.clients[0].signOuts).toEqual([{ scope: 'local' }]);
    // Nothing adopted: no session, no token handed out.
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expectAuthError(await failure(() => auth.authorized(async (token) => token)), 'signed_out');
    // Nothing remembered: save refuses and the vault is never written.
    expect(await remembered.save(ACCOUNT_ID)).toBe(false);
    expect(vault.state.writes).toBe(0);
    expect(vault.state.text).toBeNull();
    expect(await remembered.restore()).toBeNull();
    expect(await auth.signOut()).toEqual({ revoked: false });
    expect(sdk.clients[0].refreshes).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('control: the exact recipient in the reply signs in, is remembered as written, and signs out', async () => {
    const { auth, sdk, vault, fetch } = build(PRIVATE_CONFIG, PRIVATE_QA_RECIPIENT);
    const remembered = rememberedOf(auth);

    const identity = await auth.signIn(PRIVATE_QA_RECIPIENT, PASSWORD);

    expect(identity).toEqual({ uid: UID, email: PRIVATE_QA_RECIPIENT, expiresAt: expect.any(Number) });
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity: { uid: UID, email: PRIVATE_QA_RECIPIENT } });
    expect(await remembered.save(ACCOUNT_ID)).toBe(true);
    expect(vault.state.writes).toBe(1);
    expect(JSON.parse(vault.state.text ?? 'null')).toMatchObject({ profile: PRIVATE_QA, uid: UID, email: PRIVATE_QA_RECIPIENT, accountId: ACCOUNT_ID });
    expect(sdk.clients[0].signOuts).toEqual([]);

    expect(await auth.signOut()).toEqual({ revoked: true });
    expect(sdk.clients[0].signOuts).toEqual([{ scope: 'local' }]);
    expect(vault.state.text).toBeNull();
    expect(auth.status()).toEqual({ state: 'signed-out' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

const CASE_FOLDING: { profile: string; config: EnabledSupabaseConfig; asked: string; replied: string }[] = [
  {
    profile: 'local',
    config: { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:54321' },
    asked: 'ani@ayailmu.test',
    replied: 'ANI@ayailmu.test',
  },
  {
    profile: 'staging',
    config: { enabled: true, provider: 'local-supabase', environment: 'staging', apiBaseUrl: 'https://api.staging.ayafasih.id', authUrl: 'https://auth.staging.ayafasih.id' },
    asked: 'ani@ayailmu.test',
    replied: 'ANI@ayailmu.test',
  },
  {
    profile: 'production',
    config: {
      enabled: true,
      provider: 'local-supabase',
      environment: 'production',
      productionAccounts: true,
      apiBaseUrl: 'https://api.ayafasih.id',
      authUrl: 'https://auth.ayafasih.id',
    },
    asked: 'learner@ayafasih.id',
    replied: 'Learner@AyaFasih.id',
  },
];

describe('other profiles keep their case-insensitive match of the reply', () => {
  it.each(CASE_FOLDING)('$profile: a case-variant reply is adopted as before', async ({ config, asked, replied }) => {
    const { auth, sdk, fetch } = build(config, replied);

    const identity = await auth.signIn(asked, PASSWORD);

    expect(identity).toMatchObject({ uid: UID, email: replied });
    expect(auth.status()).toMatchObject({ state: 'signed-in', identity: { uid: UID, email: replied } });
    expect(sdk.clients[0].signOuts).toEqual([]);
    expect(await auth.signOut()).toEqual({ revoked: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});
