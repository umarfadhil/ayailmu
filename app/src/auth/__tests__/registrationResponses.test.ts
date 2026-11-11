// Regression, written before its repair: registration must never take a malformed or foreign Auth reply as success.
// Sign-up needs a canonical user (a UUID id and the requested address, up to the provider's lower-casing) and no session.
// GoTrue v2.197.0 answers POST /verify type=signup with a session every time (verify.go#L240-L292), so confirm needs a
// canonical session whose user is that same canonical user; a user-only reply, even one with email_confirmed_at, is never
// a signup confirmation. Every session given, malformed ones included, is still retired through the SDK's local sign-out
// before the refusal. The SDK is a small injected fake; nothing reaches a network or storage, and nothing signs in.
import type { Session, User } from '@supabase/auth-js';
import type { EnabledSupabaseConfig } from '@/account/supabaseConfig';
import { createRegistration, RegistrationError, type RegistrationSdkClient } from '@/auth/registration';

// Persistence boundaries that registering must never open.
const mockOpened = jest.fn();
jest.mock('expo-sqlite', () => ({
  openDatabaseSync: (...args: unknown[]) => mockOpened(...args),
  openDatabaseAsync: async (...args: unknown[]) => mockOpened(...args),
}));
jest.mock('@/storage/openStore', () => ({ STORAGE_KIND: 'test-memory', openStore: async (...args: unknown[]) => mockOpened(...args) }));

const LOCAL: EnabledSupabaseConfig = { enabled: true, provider: 'local-supabase', apiBaseUrl: 'http://127.0.0.1:8092', authUrl: 'http://127.0.0.1:59838' };
const EMAIL = 'Nia.Baru+1@ayailmu.test';
const PROVIDER_EMAIL = 'nia.baru+1@ayailmu.test';
const OTHER_EMAIL = 'someone.else@ayailmu.test';
const PASSWORD = 'pw Nia baru 2026';
const CODE = '482913';
const ACCESS = 'at-SECRET-regression';
const REFRESH = 'rt-SECRET-regression';
const ID = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const OTHER_ID = '0b9e8d7c-6f5a-4b3c-9d2e-1f0a9b8c7d6e';
const CONFIRMED_AT = '2026-10-25T01:05:00Z';

const user = (over: Record<string, unknown> = {}) =>
  ({ id: ID, email: PROVIDER_EMAIL, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T01:00:00Z', ...over }) as unknown as User;
const session = (over: Record<string, unknown> = {}) =>
  ({ access_token: ACCESS, refresh_token: REFRESH, token_type: 'bearer', expires_in: 3600, expires_at: 1792890000, user: user(), ...over }) as unknown as Session;
const reply = (data: { user?: unknown; session?: unknown }) => ({ data, error: null });

/** One fake SDK client answering `answer`, plus a password sign-in canary; the injected fetch fails if ever called. */
function setup(answer: unknown) {
  const fetch = jest.fn(async (..._args: unknown[]): Promise<Response> => {
    throw new Error('never a network');
  });
  const sdk = {
    signUp: jest.fn(async (_credentials: unknown): Promise<unknown> => answer),
    verifyOtp: jest.fn(async (_params: unknown): Promise<unknown> => answer),
    resend: jest.fn(async (_params: unknown): Promise<unknown> => reply({ user: null, session: null })),
    signOut: jest.fn(async (_options?: unknown): Promise<unknown> => ({ error: null })),
    stopAutoRefresh: jest.fn(async (): Promise<void> => undefined),
    signInWithPassword: jest.fn(async (_credentials: unknown): Promise<unknown> => {
      throw new Error('registration must never sign in');
    }),
  };
  const registration = createRegistration({ config: LOCAL, createClient: () => sdk as unknown as RegistrationSdkClient, fetch: fetch as unknown as typeof globalThis.fetch });
  return { registration, sdk, fetch };
}
type Setup = ReturnType<typeof setup>;

function expectNoSideDoors({ sdk, fetch }: Setup) {
  expect(sdk.signInWithPassword).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(mockOpened).not.toHaveBeenCalled();
}

/** The call must refuse with bad_response, whose text shows no token. */
async function expectBadResponse(call: Promise<unknown>) {
  const error = await call.then(
    (outcome) => {
      throw new Error(`expected bad_response, got ${JSON.stringify(outcome)}`);
    },
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(RegistrationError);
  expect((error as RegistrationError).code).toBe('bad_response');
  const shown = `${String(error)} ${JSON.stringify(error)}`;
  for (const secret of [ACCESS, REFRESH, PASSWORD]) expect(shown).not.toContain(secret);
}

beforeEach(() => mockOpened.mockClear());

describe('register refuses a sign-up reply without a canonical user', () => {
  it.each<[string, unknown]>([
    ['empty user', reply({ user: {}, session: null })],
    ['invalid uuid', reply({ user: user({ id: 'not-a-uuid' }), session: null })],
    ['missing email', reply({ user: user({ email: undefined }), session: null })],
    ['different email', reply({ user: user({ email: OTHER_EMAIL }), session: null })],
  ])('%s', async (_label, answer) => {
    const setupped = setup(answer);
    await expectBadResponse(setupped.registration.register(EMAIL, PASSWORD));
    expect(setupped.sdk.signOut).not.toHaveBeenCalled();
    expectNoSideDoors(setupped);
  });

  it.each<[string, User]>([
    ['canonical new user, provider lower-cased email', user()],
    ['obfuscated repeated sign-up user', user({ id: OTHER_ID, role: '', identities: [] })],
  ])('still accepts a %s', async (_label, pendingUser) => {
    const setupped = setup(reply({ user: pendingUser, session: null }));
    await expect(setupped.registration.register(EMAIL, PASSWORD)).resolves.toEqual({ status: 'confirmation_required' });
    expect(setupped.sdk.signOut).not.toHaveBeenCalled();
    expectNoSideDoors(setupped);
  });
});

describe('confirm refuses a signup verify reply without a canonical session', () => {
  it.each<[string, { user?: unknown; session?: unknown }]>([
    ['user true', { user: true, session: null }],
    ['unconfirmed user only', { user: user(), session: null }],
    ['confirmed user only', { user: user({ email_confirmed_at: CONFIRMED_AT }), session: null }],
    ['different email user only', { user: user({ email: OTHER_EMAIL, email_confirmed_at: CONFIRMED_AT }), session: null }],
    ['empty session', { user: user(), session: {} }],
    ['missing access token', { user: user(), session: session({ access_token: undefined }) }],
    ['empty refresh token', { user: user(), session: session({ refresh_token: '' }) }],
    ['session without user', { user: user(), session: session({ user: undefined }) }],
    ['session user invalid id', { user: user({ id: 'not-a-uuid' }), session: session({ user: user({ id: 'not-a-uuid' }) }) }],
    ['session user different email', { user: user({ email: OTHER_EMAIL }), session: session({ user: user({ email: OTHER_EMAIL }) }) }],
    ['contradictory data.user', { user: user({ id: OTHER_ID }), session: session() }],
  ])('%s', async (_label, data) => {
    const setupped = setup(reply(data));
    await expectBadResponse(setupped.registration.confirm(EMAIL, CODE));
    // Any session given, malformed or not, is retired locally before the refusal; a user-only reply has none to retire.
    if (data.session) expect(setupped.sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    else expect(setupped.sdk.signOut).not.toHaveBeenCalled();
    expectNoSideDoors(setupped);
  });

  it('still accepts a canonical session (no email_confirmed_at needed) for the mixed-case address, and retires it', async () => {
    const setupped = setup(reply({ user: user(), session: session() }));
    await expect(setupped.registration.confirm(EMAIL, CODE)).resolves.toEqual({ status: 'confirmed', signInRequired: true });
    expect(setupped.sdk.signOut).toHaveBeenCalledTimes(1);
    expect(setupped.sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expectNoSideDoors(setupped);
  });
});
