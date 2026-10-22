// Password recovery's configuration in a production build, RED. Like the API and Auth origins, a production recovery
// configuration needs the explicit production capability (productionAccounts exactly true): with it, the web callback is
// exactly the production page's own HTTPS root origin and /recover, and the native one the existing development scheme's
// arabictrial://recover (no final app identity is chosen here); without it, neither is taken. Unsafe web callbacks are
// refused even with it, and the staging rules are unchanged. prepareRecovery and the Auth adapter apply the same rule.
// The hosts are fictional placeholders (example.org): no native module, real window or network is reached.
import { isSafeRecoveryConfig, type RecoveryAttemptRecord, type RecoveryAttemptStore, type RecoveryConfig } from '@/auth/recovery';
import { prepareRecovery, type RecoveryRuntime } from '@/auth/recoverySetup';
import { createSupabaseAuth } from '@/auth/supabaseAuth';

const API = 'https://api.example.org';
const AUTH = 'https://auth.example.org';
const APP = 'https://app.example.org';
const WEB: RecoveryConfig = { enabled: true, platform: 'web', callbackUrl: `${APP}/recover` };
const NATIVE: RecoveryConfig = { enabled: true, platform: 'native', callbackUrl: 'arabictrial://recover' };
const PRODUCTION = { enabled: true, provider: 'local-supabase', environment: 'production', productionAccounts: true, apiBaseUrl: API, authUrl: AUTH } as const;
const WITHOUT_CAPABILITY = { enabled: true, provider: 'local-supabase', environment: 'production', apiBaseUrl: API, authUrl: AUTH } as const;

/** The check with the production capability as its third input, typed here before the function takes it. */
const isSafe: (config: unknown, environment: unknown, productionAccounts?: unknown) => boolean = isSafeRecoveryConfig;

const RECOVERY_KEY = 'EXPO_PUBLIC_PASSWORD_RECOVERY';
const savedRecovery = process.env.EXPO_PUBLIC_PASSWORD_RECOVERY;
afterEach(() => {
  if (savedRecovery === undefined) delete process.env[RECOVERY_KEY];
  else process.env[RECOVERY_KEY] = savedRecovery;
});

/** A web runtime on the production page that never offers a link, and an in-memory store. */
function boundary() {
  const runtime: RecoveryRuntime = { platform: { kind: 'web', origin: APP }, takeLaunchUrl: () => null, subscribe: () => () => undefined };
  let held: RecoveryAttemptRecord | null = null;
  const store: RecoveryAttemptStore = {
    save: (record) => {
      held = { ...record };
    },
    take: () => {
      const record = held;
      held = null;
      return record;
    },
    clear: () => {
      held = null;
    },
  };
  return { runtime, store };
}

it('a production web callback, its own page and /recover, is taken only with the production capability', () => {
  expect(isSafe(WEB, 'production', true)).toBe(true);
});

it.each([
  ['missing', undefined],
  ['false', false],
  ['the string "true"', 'true'],
])('with the production capability %s, neither the production web nor the native callback is taken', (_case, capability: unknown) => {
  expect(isSafe(WEB, 'production', capability)).toBe(false);
  expect(isSafe(NATIVE, 'production', capability)).toBe(false);
});

it.each([
  ['plain http', 'http://app.example.org/recover'],
  ['loopback', 'https://127.0.0.1/recover'],
  ['a path before /recover', `${APP}/app/recover`],
  ['a path after /recover', `${APP}/recover/x`],
  ['a query', `${APP}/recover?next=1`],
  ['a fragment', `${APP}/recover#x`],
  ['port 443 written out', 'https://app.example.org:443/recover'],
])('a production web callback with %s is refused even with the production capability', (_case, callbackUrl) => {
  expect(isSafe({ enabled: true, platform: 'web', callbackUrl }, 'production', true)).toBe(false);
});

it('unchanged: the staging web callback with the two old inputs, and the native development callback under production with its capability', () => {
  expect(isSafeRecoveryConfig(WEB, 'staging')).toBe(true);
  expect(isSafe(NATIVE, 'production', true)).toBe(true);
});

it("prepareRecovery takes the production page's callback only with the production capability, using the given runtime and store", () => {
  process.env[RECOVERY_KEY] = 'on';
  const { runtime, store } = boundary();
  const setup = prepareRecovery(PRODUCTION, runtime, store);
  expect(setup?.runtime).toBe(runtime);
  expect(setup?.store).toBe(store);
  expect(setup?.config).toEqual({ enabled: true, platform: 'web', callbackUrl: `${APP}/recover` });
  expect(prepareRecovery(WITHOUT_CAPABILITY, runtime, store)).toBeNull();
});

it('the Auth adapter takes the production web recovery configuration, sending nothing', () => {
  const probe = jest.fn();
  const { store } = boundary();
  expect(() => createSupabaseAuth({ config: PRODUCTION, fetch: probe as unknown as typeof fetch, recovery: { config: WEB, store } })).not.toThrow();
  expect(probe).not.toHaveBeenCalled();
});
