// Private native QA boundaries. A private-qa build carries the exact profile ("private-qa") and the exact capability
// (privateQa: true), and talks only to https://localhost:58444 (API) and https://localhost:58445 (Auth). The origin
// helpers take the capability as a fourth argument (their three-argument behaviour unchanged); the API client, the Auth
// adapter, the registration policy and the registration adapter revalidate it themselves and need an injected fetch.
// Sign-in and registration take one recipient only, refusing any other before a client is built or anything is sent.
// Nothing here reaches a real network or mailbox: every fetch is an injected fake that rejects, so an approved call only
// proves it got past the guards to the transport, and the global fetch is replaced by one that fails the test if used.
import { accountApiOrigin } from '@/account/staging';
import { accountAuthOrigin, type EnabledSupabaseConfig, type SupabaseConfig } from '@/account/supabaseConfig';
import { ApiError, createApiClient } from '@/api/client';
import { createRegistration, RegistrationError, type RegistrationEmailPolicy, type RegistrationOptions } from '@/auth/registration';
import { createSupabaseAuth } from '@/auth/supabaseAuth';
import { AuthError } from '@/auth/types';
import { registrationPolicy } from '@/ui/account/registrationController';

const QA_API = 'https://localhost:58444';
const QA_AUTH = 'https://localhost:58445';
const OWNER = 'owner-qa@example.invalid';
const PASSWORD = 'Strong-fixture-password-2026';
const PRIVATE_POLICY = 'private-qa-confirmed-email' as unknown as RegistrationEmailPolicy;
/** The registration flag that selects the private policy: exactly its name. */
const PRIVATE_FLAG = 'private-qa-confirmed-email';

/** Runtime input on purpose: the private profile and capability are what the current types do not name. */
const config = (over: Record<string, unknown> = {}): EnabledSupabaseConfig =>
  ({ enabled: true, provider: 'local-supabase', environment: 'private-qa', privateQa: true, apiBaseUrl: QA_API, authUrl: QA_AUTH, ...over }) as unknown as EnabledSupabaseConfig;
const PRIVATE = config();
const PRODUCTION = { enabled: true, provider: 'local-supabase', environment: 'production', productionAccounts: true, apiBaseUrl: 'https://api.example.org', authUrl: 'https://auth.example.org' } as const;
const STAGING = { enabled: true, provider: 'local-supabase', environment: 'staging', apiBaseUrl: 'https://api.example.org', authUrl: 'https://auth.example.org' } as const;

type OriginCheck = (url: unknown, environment?: unknown, productionAccounts?: unknown, privateQa?: unknown) => string | null;
const apiOrigin = accountApiOrigin as unknown as OriginCheck;
const authOrigin = accountAuthOrigin as unknown as OriginCheck;
/** The helper's origin, or null when it refuses in any way. */
const originOr = (check: () => unknown): unknown => {
  try {
    return check() ?? null;
  } catch {
    return null;
  }
};

type ApiOptions = Parameters<typeof createApiClient>[0];
type AuthOptions = Parameters<typeof createSupabaseAuth>[0];

/** An injected fetch that is never answered with success: reaching it proves only that the guards let the call through. */
const offline = () => jest.fn(async (_input: unknown, _init?: unknown) => Promise.reject(new TypeError('offline fixture')));
const asFetch = (probe: jest.Mock) => probe as unknown as typeof fetch;
/** A client factory that must never run (refusals happen before any client is built). */
const noClient = () =>
  jest.fn(() => {
    throw new Error('no client may be built');
  });

/** Builds with an assertion, so a constructor that still refuses is a failed expectation. */
function built<T>(make: () => T): T {
  let made: T | undefined;
  expect(() => {
    made = make();
  }).not.toThrow();
  return made as T;
}

/** The stable code a call rejected with (its class checked), or 'resolved'. */
async function codeOf(call: () => Promise<unknown>, kind: typeof AuthError | typeof RegistrationError | typeof ApiError): Promise<string> {
  try {
    await call();
    return 'resolved';
  } catch (error) {
    expect(error).toBeInstanceOf(kind);
    return (error as { code: string }).code;
  }
}

const realFetch = globalThis.fetch;
let globalProbe: jest.Mock;
beforeEach(() => {
  globalProbe = jest.fn(async () => Promise.reject(new Error('the global fetch must never be reached')));
  globalThis.fetch = globalProbe as unknown as typeof fetch;
});
afterEach(() => {
  expect(globalProbe).not.toHaveBeenCalled();
  globalThis.fetch = realFetch;
});

it('the origin helpers take the private roots only with the fourth privateQa capability, and keep their three-argument behaviour', () => {
  expect(originOr(() => apiOrigin(QA_API, 'private-qa', undefined, true))).toBe(QA_API);
  expect(originOr(() => authOrigin(QA_AUTH, 'private-qa', undefined, true))).toBe(QA_AUTH);
  // Swapped roots, near misses and a missing or inexact capability are refused.
  expect(originOr(() => apiOrigin(QA_AUTH, 'private-qa', undefined, true))).toBeNull();
  expect(originOr(() => authOrigin(QA_API, 'private-qa', undefined, true))).toBeNull();
  for (const near of [`${QA_API}/`, 'http://localhost:58444', 'https://127.0.0.1:58444', 'https://localhost:58446', 'https://api.example.org']) {
    expect(originOr(() => apiOrigin(near, 'private-qa', undefined, true))).toBeNull();
  }
  for (const capability of [undefined, false, 'true', 1]) {
    expect(originOr(() => apiOrigin(QA_API, 'private-qa', undefined, capability))).toBeNull();
    expect(originOr(() => authOrigin(QA_AUTH, 'private-qa', undefined, capability))).toBeNull();
  }
  expect(originOr(() => apiOrigin(QA_API, 'private-qa'))).toBeNull();
  expect(originOr(() => authOrigin(QA_AUTH, 'private-qa'))).toBeNull();
  // The capability never widens another profile; the production three-argument form is unchanged.
  expect(originOr(() => apiOrigin(QA_API, 'production', true, true))).toBeNull();
  expect(originOr(() => apiOrigin(QA_API, 'staging', undefined, true))).toBeNull();
  expect(originOr(() => apiOrigin(PRODUCTION.apiBaseUrl, 'production', true))).toBe(PRODUCTION.apiBaseUrl);
  expect(originOr(() => authOrigin(PRODUCTION.authUrl, 'production', true))).toBe(PRODUCTION.authUrl);
});

it('the API client takes the private API root with an injected fetch and sends only there', async () => {
  const probe = offline();
  const api = built(() => createApiClient({ baseUrl: QA_API, environment: 'private-qa', privateQa: true, fetch: asFetch(probe) } as unknown as ApiOptions));
  await expect(codeOf(() => api.me('fixture-token'), ApiError)).resolves.toBe('network');
  expect(probe).toHaveBeenCalledTimes(1);
  expect(probe).toHaveBeenCalledWith(`${QA_API}/v1/me`, expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
});

it.each<[string, Record<string, unknown>]>([
  ['no injected fetch (no QA network fallback)', { fetch: undefined }],
  ['the Auth root as its API', { baseUrl: QA_AUTH }],
  ['a trailing slash', { baseUrl: `${QA_API}/` }],
  ['plain http', { baseUrl: 'http://localhost:58444' }],
  ['a loopback IP', { baseUrl: 'https://127.0.0.1:58444' }],
  ['another port', { baseUrl: 'https://localhost:58443' }],
  ['a public root', { baseUrl: 'https://api.example.org' }],
  ['no capability', { privateQa: undefined }],
  ['the capability as a string', { privateQa: 'true' }],
  ['the staging profile', { environment: 'staging' }],
  ['the production profile', { environment: 'production', productionAccounts: true }],
])('the API client refuses the private profile with %s, sending nothing', (_case, over) => {
  const probe = offline();
  const options = { baseUrl: QA_API, environment: 'private-qa', privateQa: true, fetch: asFetch(probe), ...over } as unknown as ApiOptions;
  expect(() => createApiClient(options)).toThrow();
  expect(probe).not.toHaveBeenCalled();
});

it('the Auth adapter takes the private configuration with an injected fetch', () => {
  const probe = offline();
  built(() => createSupabaseAuth({ config: PRIVATE, fetch: asFetch(probe) }));
  expect(probe).not.toHaveBeenCalled();
});

it.each<[string, Record<string, unknown>, boolean]>([
  ['no injected fetch', {}, false],
  ['swapped roots', { apiBaseUrl: QA_AUTH, authUrl: QA_API }, true],
  ['one root for both', { authUrl: QA_API }, true],
  ['an unknown Auth root', { authUrl: 'https://localhost:58446' }, true],
  ['public roots', { apiBaseUrl: PRODUCTION.apiBaseUrl, authUrl: PRODUCTION.authUrl }, true],
  ['no capability', { privateQa: undefined }, true],
  ['the capability as a string', { privateQa: 'true' }, true],
  ['the production profile', { environment: 'production', productionAccounts: true }, true],
])('the Auth adapter refuses the private profile with %s, building and sending nothing', (_case, over, withFetch) => {
  const probe = offline();
  const createClient = noClient();
  const options = { config: config(over), createClient, ...(withFetch ? { fetch: asFetch(probe) } : {}) } as unknown as AuthOptions;
  expect(() => createSupabaseAuth(options)).toThrow();
  expect(createClient).not.toHaveBeenCalled();
  expect(probe).not.toHaveBeenCalled();
});

it('a private sign-in of the approved owner gets past the guards to the injected transport at the Auth root', async () => {
  const probe = offline();
  const auth = built(() => createSupabaseAuth({ config: PRIVATE, fetch: asFetch(probe) }));
  const code = await codeOf(() => auth.signIn(OWNER, PASSWORD), AuthError);
  expect(['private_recipient', 'invalid_email', 'not_synthetic', 'resolved']).not.toContain(code);
  expect(probe).toHaveBeenCalled();
  for (const [input] of probe.mock.calls) expect(String(input).startsWith(`${QA_AUTH}/`)).toBe(true);
});

it.each(['learner@example.org', 'owner-qa+qa@example.invalid', 'qa.owner-qa@example.invalid', 'owner-qa@alternate.example.invalid', 'Owner-qa@example.invalid', 'owner.fixture@example.test'])(
  'a private sign-in of %s is refused as private_recipient before any client or request',
  async (email) => {
    const probe = offline();
    const createClient = noClient();
    const auth = built(() => createSupabaseAuth({ config: PRIVATE, createClient, fetch: asFetch(probe) } as unknown as AuthOptions));
    await expect(codeOf(() => auth.signIn(email, PASSWORD), AuthError)).resolves.toBe('private_recipient');
    expect(createClient).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  }
);

it('the registration policy selects private-qa-confirmed-email only for its exact flag and a validated private configuration', () => {
  expect(registrationPolicy(PRIVATE as SupabaseConfig, PRIVATE_FLAG)).toBe('private-qa-confirmed-email');
  // The existing policies are unchanged.
  expect(registrationPolicy(PRODUCTION as unknown as SupabaseConfig, 'confirmed-email')).toBe('confirmed-email');
  expect(registrationPolicy(STAGING as unknown as SupabaseConfig, 'on')).toBe('synthetic');
});

it.each<[string, string, SupabaseConfig]>([
  ['the synthetic flag', 'on', PRIVATE],
  ['the confirmed-email flag', 'confirmed-email', PRIVATE],
  ['the flag in another case', 'Private-QA-confirmed-email', PRIVATE],
  ['the flag with a space', `${PRIVATE_FLAG} `, PRIVATE],
  ['a production configuration', PRIVATE_FLAG, PRODUCTION as unknown as SupabaseConfig],
  ['a staging configuration', PRIVATE_FLAG, STAGING as unknown as SupabaseConfig],
  ['no capability', PRIVATE_FLAG, config({ privateQa: undefined })],
  ['the capability as a string', PRIVATE_FLAG, config({ privateQa: 'true' })],
  ['swapped roots', PRIVATE_FLAG, config({ apiBaseUrl: QA_AUTH, authUrl: QA_API })],
  ['an unknown Auth root', PRIVATE_FLAG, config({ authUrl: 'https://localhost:58446' })],
  ['another provider', PRIVATE_FLAG, config({ provider: 'supabase' })],
  ['a disabled configuration', PRIVATE_FLAG, config({ enabled: false })],
])('the registration policy offers nothing with %s', (_case, flag, supabase) => {
  expect(registrationPolicy(supabase, flag)).toBeNull();
});

it('a private registration of the approved owner gets past the guards to the injected transport at /signup', async () => {
  const probe = offline();
  const registration = built(() => createRegistration({ config: PRIVATE, emailPolicy: PRIVATE_POLICY, fetch: asFetch(probe) }));
  try {
    await expect(codeOf(() => registration.register(OWNER, PASSWORD), RegistrationError)).resolves.toBe('network');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(`${QA_AUTH}/signup`, expect.objectContaining({ method: 'POST', credentials: 'omit' }));
  } finally {
    await registration?.dispose();
  }
});

it('a private registration refuses another recipient as private_recipient and a malformed one as invalid_email, before any client or request', async () => {
  const probe = offline();
  const createClient = noClient();
  const options = { config: PRIVATE, emailPolicy: PRIVATE_POLICY, createClient, fetch: asFetch(probe) } as unknown as RegistrationOptions;
  const registration = built(() => createRegistration(options));
  try {
    for (const email of ['learner@example.org', 'owner-qa+qa@example.invalid', 'Owner-qa@example.invalid']) {
      await expect(codeOf(() => registration.register(email, PASSWORD), RegistrationError)).resolves.toBe('private_recipient');
      await expect(codeOf(() => registration.resend(email), RegistrationError)).resolves.toBe('private_recipient');
    }
    for (const email of [` ${OWNER}`, 'owner-qa@', 'owner-qa@example..invalid', 'not-an-address']) {
      await expect(codeOf(() => registration.register(email, PASSWORD), RegistrationError)).resolves.toBe('invalid_email');
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
  } finally {
    await registration?.dispose();
  }
});

it.each<[string, EnabledSupabaseConfig, unknown, boolean]>([
  ['the private configuration with the confirmed-email policy', PRIVATE, 'confirmed-email', true],
  ['the private configuration with the synthetic policy', PRIVATE, 'synthetic', true],
  ['the private configuration with no policy', PRIVATE, undefined, true],
  ['the private policy with a production configuration', PRODUCTION as unknown as EnabledSupabaseConfig, PRIVATE_POLICY, true],
  ['the private policy with a staging configuration', STAGING as unknown as EnabledSupabaseConfig, PRIVATE_POLICY, true],
  ['the private policy with swapped roots', config({ apiBaseUrl: QA_AUTH, authUrl: QA_API }), PRIVATE_POLICY, true],
  ['the private policy without its capability', config({ privateQa: undefined }), PRIVATE_POLICY, true],
  ['the private policy without an injected fetch', PRIVATE, PRIVATE_POLICY, false],
])('registration refuses %s, building and sending nothing', (_case, supabase, emailPolicy, withFetch) => {
  const probe = offline();
  const createClient = noClient();
  const options = { config: supabase, emailPolicy, createClient, ...(withFetch ? { fetch: asFetch(probe) } : {}) } as unknown as RegistrationOptions;
  expect(() => createRegistration(options)).toThrow();
  expect(createClient).not.toHaveBeenCalled();
  expect(probe).not.toHaveBeenCalled();
});

it('production confirmed-email stays conventional and staging stays .test-only, the owner address included', async () => {
  const productionProbe = offline();
  const production = createRegistration({ config: PRODUCTION, emailPolicy: 'confirmed-email', fetch: asFetch(productionProbe) });
  const stagingClient = noClient();
  const stagingProbe = offline();
  const staging = createRegistration({ config: STAGING, createClient: stagingClient, fetch: asFetch(stagingProbe) } as unknown as RegistrationOptions);
  try {
    await expect(codeOf(() => production.register('learner@example.org', PASSWORD), RegistrationError)).resolves.toBe('network');
    expect(productionProbe).toHaveBeenCalledWith(`${PRODUCTION.authUrl}/signup`, expect.anything());
    await expect(codeOf(() => staging.register(OWNER, PASSWORD), RegistrationError)).resolves.toBe('not_synthetic');
    const stagingAuth = createSupabaseAuth({ config: STAGING, createClient: stagingClient, fetch: asFetch(stagingProbe) } as unknown as AuthOptions);
    await expect(codeOf(() => stagingAuth.signIn(OWNER, PASSWORD), AuthError)).resolves.toBe('not_synthetic');
    expect(stagingClient).not.toHaveBeenCalled();
    expect(stagingProbe).not.toHaveBeenCalled();
  } finally {
    await production.dispose();
    await staging.dispose();
  }
});

it('the Auth adapter and registration keep the private configuration they validated, whatever the caller changes later', async () => {
  const mutable = config();
  const authProbe = offline();
  const registrationProbe = offline();
  const auth = built(() => createSupabaseAuth({ config: mutable, fetch: asFetch(authProbe) }));
  const registration = built(() => createRegistration({ config: mutable, emailPolicy: PRIVATE_POLICY, fetch: asFetch(registrationProbe) }));
  Object.assign(mutable as unknown as Record<string, unknown>, { environment: 'production', productionAccounts: true, privateQa: false, apiBaseUrl: PRODUCTION.apiBaseUrl, authUrl: PRODUCTION.authUrl });
  try {
    // Still the private recipient rule, not production's conventional one.
    await expect(codeOf(() => auth.signIn('learner@example.org', PASSWORD), AuthError)).resolves.toBe('private_recipient');
    await expect(codeOf(() => registration.register('learner@example.org', PASSWORD), RegistrationError)).resolves.toBe('private_recipient');
    expect(authProbe).not.toHaveBeenCalled();
    expect(registrationProbe).not.toHaveBeenCalled();
    // Still the private Auth root.
    await codeOf(() => auth.signIn(OWNER, PASSWORD), AuthError);
    await codeOf(() => registration.register(OWNER, PASSWORD), RegistrationError);
    expect(authProbe).toHaveBeenCalled();
    for (const [input] of authProbe.mock.calls) expect(String(input).startsWith(`${QA_AUTH}/`)).toBe(true);
    expect(registrationProbe).toHaveBeenCalledWith(`${QA_AUTH}/signup`, expect.anything());
  } finally {
    await registration?.dispose();
  }
});
