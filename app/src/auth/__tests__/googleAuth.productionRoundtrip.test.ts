import { webcrypto } from 'crypto';
import { TextEncoder } from 'util';

import { createApiClient } from '@/api/client';

import { fakeAccountApi, FAKE_GOTRUE } from '../../../test/fakeAccountApi';
import { fakeGoogleGoTrue, type GoogleAccount } from '../../../test/fakeGoogleAuth';
import { PRODUCTION_API, PRODUCTION_AUTH, productionNetwork } from '../../../test/productionNetwork';
import { memoryGoogleStore } from '../google';
import { createSupabaseAuth } from '../supabaseAuth';
import { AuthError } from '../types';

// Protocol roundtrip only: the maintained SDK runs against injected fake HTTP.
// This is not native, browser, or cloud proof and does not activate the provider.

const USER: GoogleAccount = {
  email: 'google.learner@example.org',
  password: 'fixture-only',
  uid: 'fixture-google-user',
  token: 'unused-fixture-token',
  accountId: '8d3f3b60-4e5c-4f70-8b82-93c4d5e6f708',
  googleSub: '109876543210987654321',
  name: 'Fixture Learner',
};

const GOOGLE = {
  enabled: true,
  provider: 'google',
  platform: 'native',
  callbackUrl: 'arabictrial://account',
} as const;

const PROD = {
  enabled: true,
  provider: 'local-supabase',
  environment: 'production',
  productionAccounts: true,
  apiBaseUrl: PRODUCTION_API,
  authUrl: PRODUCTION_AUTH,
} as const;

function installGlobals(values: Record<string, unknown>): () => void {
  const saved = Object.keys(values).map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

describe('Google auth production roundtrip (injected fake HTTP)', () => {
  it('completes PKCE once through the maintained SDK and rejects a replay', async () => {
    const globalFetch = jest.fn(async () => {
      throw new Error('unexpected global fetch');
    });
    const restore = installGlobals({
      crypto: webcrypto,
      TextEncoder,
      btoa: (value: string) => Buffer.from(value, 'binary').toString('base64'),
      fetch: globalFetch,
    });
    let auth: ReturnType<typeof createSupabaseAuth> | undefined;

    try {
      const fake = fakeAccountApi([USER]);
      const gotrue = fakeGoogleGoTrue(fake, { redirects: [GOOGLE.callbackUrl], known: [USER] });
      const net = productionNetwork(gotrue.fetch);
      auth = createSupabaseAuth({
        config: PROD,
        fetch: net.fetch,
        google: { config: GOOGLE, store: memoryGoogleStore() },
      });

      const g = auth.google!;
      const attempt = await g.start();
      const url = new URL(attempt.url);
      expect(`${url.origin}${url.pathname}`).toBe(`${PRODUCTION_AUTH.replace(/\/$/, '')}/authorize`);
      expect(url.searchParams.get('provider')).toBe('google');
      expect(url.searchParams.get('code_challenge_method')).toBe('s256');
      expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);

      // The frozen fake only recognizes its local origin. This maps the consent
      // fixture to the server boundary; app transport URLs stay on the public placeholders.
      const callback = await gotrue.consent(attempt.url.replace(PRODUCTION_AUTH, FAKE_GOTRUE), USER);

      const identity = await attempt.complete(callback);
      expect(identity.email).toBe(USER.email);
      expect(auth.status()).toMatchObject({ state: 'signed-in', identity });

      const api = createApiClient({
        baseUrl: PRODUCTION_API,
        environment: 'production',
        productionAccounts: true,
        fetch: net.fetch,
      });
      const me = await auth.authorized((token) => api.me(token));
      expect(me.accountId).toBe(USER.accountId);
      expect(gotrue.exchanges).toEqual(['issued']);

      await expect(attempt.complete(callback)).rejects.toBeInstanceOf(AuthError);
      expect(gotrue.exchanges).toEqual(['issued']);
      expect(auth.status()).toMatchObject({ state: 'signed-in', identity });

      await auth.signOut();
      expect(auth.status()).toEqual({ state: 'signed-out' });

      const pkceRequests = net.requests.filter((request) =>
        JSON.stringify(request).includes('grant_type=pkce'),
      );
      expect(pkceRequests).toHaveLength(1);
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      try {
        if (auth?.status().state === 'signed-in') await auth.signOut();
      } finally {
        restore();
      }
    }
  });
});
