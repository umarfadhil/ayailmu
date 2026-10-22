// Requesting a password recovery link in a production build, RED. Under the explicit production configuration (with the
// productionAccounts capability), auth.recovery.request takes a real-format address by its format alone and asks the
// standalone GoTrue's root, through the maintained SDK's PKCE request, for a link to the exact native callback. Its result
// is the generic { requested: true }: never a claim that the address is registered or that mail was sent. The one pending
// attempt it saves is bound to the production Auth root and profile and holds no email, password or token. A local
// protocol fixture only: the fictional hosts (example.org) are answered by the frozen fake of test/fakeRecoveryApi.ts,
// which knows no user here, so its mailbox stays empty; nothing is resolved, contacted or delivered.
import { webcrypto } from 'crypto';

import type { RecoveryAttemptRecord, RecoveryAttemptStore, RecoveryConfig } from '@/auth/recovery';
import { createSupabaseAuth, type SupabaseAuth } from '@/auth/supabaseAuth';
import { fakeRecoveryApi } from '../../../test/fakeRecoveryApi';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';

const CALLBACK = 'arabictrial://recover';
const NATIVE: RecoveryConfig = { enabled: true, platform: 'native', callbackUrl: CALLBACK };
const CONFIG = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: PRODUCTION_API,
  authUrl: PRODUCTION_AUTH,
} as const;
const RECORD_KEYS = ['auth', 'callbackUrl', 'createdAt', 'flowId', 'profile', 'v', 'verifier'];

it('a production recovery request for a real-format address asks the production Auth root once and saves an attempt bound to production', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
  let auth: SupabaseAuth | null = null;
  try {
    const server = fakeRecoveryApi({ callbacks: [CALLBACK] });
    const net = productionNetwork(server.fetch);
    const state = { held: null as RecoveryAttemptRecord | null };
    const store: RecoveryAttemptStore = {
      save: (record) => {
        state.held = { ...record };
      },
      take: () => {
        const record = state.held;
        state.held = null;
        return record;
      },
      clear: () => {
        state.held = null;
      },
    };
    auth = createSupabaseAuth({ config: CONFIG, fetch: net.fetch, recovery: { config: NATIVE, store } });
    const recovery = auth.recovery;
    if (!recovery) throw new Error('This adapter has no password-recovery surface (auth.recovery).');

    await expect(recovery.request('learner@example.org')).resolves.toEqual({ requested: true });

    // Exactly one request: POST /recover at the production Auth root, to the exact native callback; no account API request.
    expect(net.requests).toHaveLength(1);
    const [method = '', url = ''] = (net.requests[0] ?? '').split(' ');
    expect(method).toBe('POST');
    const sent = new URL(url);
    expect(`${sent.origin}${sent.pathname}`).toBe(`${PRODUCTION_AUTH}/recover`);
    expect([...sent.searchParams.keys()]).toEqual(['redirect_to']);
    expect(sent.searchParams.get('redirect_to')).toBe(CALLBACK);

    // One pending attempt of exactly seven keys, bound to production, with an RFC 7636 verifier (compared as a boolean,
    // so it is never printed), and no email, password or token.
    const record = state.held;
    expect(Object.keys(record ?? {}).sort()).toEqual(RECORD_KEYS);
    expect(record?.v).toBe(1);
    expect(record?.profile).toBe('production');
    expect(record?.auth).toBe(PRODUCTION_AUTH);
    expect(record?.callbackUrl).toBe(CALLBACK);
    expect(/^[A-Za-z0-9._~-]{43,128}$/.test(record?.verifier ?? '')).toBe(true);
    expect(JSON.stringify(record ?? {}).includes('learner@example.org')).toBe(false);

    // The fake knows no user here: no link would be mailed, and nothing says whether the address is registered.
    expect(server.mailbox).toHaveLength(0);
    expect(auth.status()).toEqual({ state: 'signed-out' });
  } finally {
    try {
      await auth?.recovery?.cancel();
      await auth?.signOut();
    } finally {
      if (before) Object.defineProperty(globalThis, 'crypto', before);
      else Reflect.deleteProperty(globalThis, 'crypto');
    }
  }
});
