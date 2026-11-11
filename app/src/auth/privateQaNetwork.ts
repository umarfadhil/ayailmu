// The private native QA network: its contract, before its implementation. preparePrivateQaNetwork(config, options)
// decides, once and synchronously, which fetch a build's account clients get. It never imports a native package: the
// bridge comes only from options.loadBridge, and nothing here ever falls back to the global fetch.
//
// Its rules, in this order, so that the first problem is the one named:
//   - Off: a configuration with no private marker (no environment 'private-qa', no privateQa key with a value, neither
//     URL one of the two private roots) is an ordinary or disabled profile: { state: 'off' }, whatever the platform or
//     fingerprint, and loadBridge is never called.
//   - Configuration: any private marker requires the whole private shape exactly: enabled true, provider
//     local-supabase, environment 'private-qa', privateQa exactly true, productionAccounts undefined, apiBaseUrl exactly
//     https://localhost:58444 and authUrl exactly https://localhost:58445. Anything else (a drifted capability included)
//     is unavailable with reason 'configuration', never off.
//   - Platform: exactly 'ios' or 'android'; otherwise 'platform'.
//   - Certificate: expectedCaSha256 is the build's public metadata, supplied apart from the bridge and exactly 64
//     lowercase hex characters; otherwise 'certificate'. It is never taken from what the bridge reports.
//   - Native: loadBridge is called once, only now; a missing or throwing loader, or anything but an object with
//     binding, request and cancel functions, is 'native'.
//   - Binding: bridge.binding() must report exactly the transport's binding for expectedCaSha256; null, a throw or a
//     mismatch is 'binding'.
//   - Ready: { state: 'ready', fetch }, where fetch is createPrivateQaFetch({ bridge, expectedCaSha256 }), so the binding
//     is checked again on every call.
// Preparing sends no request and cancels nothing. It never throws, keeps no state between calls, and an unavailable
// result carries its reason only, never an exception, message or bridge value.
import { PRIVATE_QA, PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN } from '@/account/privateQa';
import type { LOCAL_SUPABASE, SupabaseConfig } from '@/account/supabaseConfig';
import { createPrivateQaFetch } from '@/auth/privateQaTransport';
import type { PrivateQaBinding, PrivateQaBridge } from '@/auth/privateQaTransport';

/** The native platforms a private QA build runs on, exactly as React Native's Platform.OS spells them. */
export type PrivateQaPlatform = 'ios' | 'android';

/** Why an explicitly private profile cannot be used. */
export type PrivateQaNetworkFailure = 'configuration' | 'platform' | 'certificate' | 'native' | 'binding';

/** An ordinary or disabled profile: its clients use their usual transport, and no native code was loaded. */
export interface PrivateQaNetworkOff {
  state: 'off';
}

/** An explicitly private profile that cannot be used: its account clients must not be built. */
export interface PrivateQaNetworkUnavailable {
  state: 'unavailable';
  reason: PrivateQaNetworkFailure;
}

/** A private profile with a bound native bridge: `fetch` is the only transport its account clients get. */
export interface PrivateQaNetworkReady {
  state: 'ready';
  fetch: typeof fetch;
}

export type PrivateQaNetwork = PrivateQaNetworkOff | PrivateQaNetworkUnavailable | PrivateQaNetworkReady;

export interface PrivateQaNetworkOptions {
  /** The running platform, e.g. Platform.OS. */
  platform: string;
  /** The designated CA's SHA-256 from public build metadata, checked here: 64 lowercase hex characters. */
  expectedCaSha256: unknown;
  /** Loads the native bridge; called at most once, and only for a usable private profile. */
  loadBridge: () => unknown;
}

export type PreparePrivateQaNetwork = (config: SupabaseConfig, options: PrivateQaNetworkOptions) => PrivateQaNetwork;

/** The module's runtime surface. */
export interface PrivateQaNetworkFacade {
  preparePrivateQaNetwork: PreparePrivateQaNetwork;
}

// Spelled here rather than imported, so loading this module loads no configuration code; the type keeps it in step.
const PROVIDER: typeof LOCAL_SUPABASE = 'local-supabase';
const ROOTS: unknown[] = [PRIVATE_QA_API_ORIGIN, PRIVATE_QA_AUTH_ORIGIN];
const SHA256_HEX = /^[0-9a-f]{64}$/;

const unavailable = (reason: PrivateQaNetworkFailure): PrivateQaNetworkUnavailable => ({ state: 'unavailable', reason });

export const preparePrivateQaNetwork: PreparePrivateQaNetwork = (config, options) => {
  const { enabled, provider, environment, privateQa, productionAccounts, apiBaseUrl, authUrl } = (config ?? {}) as unknown as Record<string, unknown>;
  if (environment !== PRIVATE_QA && privateQa === undefined && !ROOTS.includes(apiBaseUrl) && !ROOTS.includes(authUrl)) return { state: 'off' };
  if (
    enabled !== true ||
    provider !== PROVIDER ||
    environment !== PRIVATE_QA ||
    privateQa !== true ||
    productionAccounts !== undefined ||
    apiBaseUrl !== PRIVATE_QA_API_ORIGIN ||
    authUrl !== PRIVATE_QA_AUTH_ORIGIN
  ) {
    return unavailable('configuration');
  }

  const { platform, expectedCaSha256, loadBridge } = (options ?? {}) as Partial<PrivateQaNetworkOptions>;
  if (platform !== 'ios' && platform !== 'android') return unavailable('platform');
  if (typeof expectedCaSha256 !== 'string' || !SHA256_HEX.test(expectedCaSha256)) return unavailable('certificate');

  let bridge: PrivateQaBridge;
  try {
    const loaded = typeof loadBridge === 'function' ? (loadBridge() as Partial<PrivateQaBridge> | null) : null;
    if (
      typeof loaded !== 'object' ||
      loaded === null ||
      typeof loaded.binding !== 'function' ||
      typeof loaded.request !== 'function' ||
      typeof loaded.cancel !== 'function'
    ) {
      return unavailable('native');
    }
    bridge = loaded as PrivateQaBridge;
  } catch {
    return unavailable('native');
  }

  try {
    const binding = bridge.binding() as Partial<PrivateQaBinding> | null;
    if (
      typeof binding !== 'object' ||
      binding === null ||
      binding.enabled !== true ||
      binding.apiOrigin !== PRIVATE_QA_API_ORIGIN ||
      binding.authOrigin !== PRIVATE_QA_AUTH_ORIGIN ||
      binding.caSha256 !== expectedCaSha256
    ) {
      return unavailable('binding');
    }
  } catch {
    return unavailable('binding');
  }

  try {
    return { state: 'ready', fetch: createPrivateQaFetch({ bridge, expectedCaSha256 }) };
  } catch {
    // Only a bridge that changed shape since it was checked gets here.
    return unavailable('native');
  }
};
