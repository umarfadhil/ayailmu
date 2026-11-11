import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { LOCAL_DEVELOPMENT, isLocalDevelopmentConfig } from '@/account/localDevelopment';
import type { SupabaseConfig } from '@/account/supabaseConfig';
import type { PrivateQaNetwork, PrivateQaNetworkOptions } from '@/auth/privateQaNetwork';
import { createPrivateQaFetch, type PrivateQaBridge } from '@/auth/privateQaTransport';

// The native module's historical name does not choose account/email policy.
// Reuse only its exact-root, certificate-bound transport; never a global fetch fallback.
export function prepareLocalDevelopmentNetwork(config: SupabaseConfig, options: PrivateQaNetworkOptions): PrivateQaNetwork {
  const c = config as { environment?: unknown; localDevelopment?: unknown };
  if (c?.environment !== LOCAL_DEVELOPMENT && c?.localDevelopment === undefined) return { state: 'off' };
  if (!isLocalDevelopmentConfig(config)) return { state: 'unavailable', reason: 'configuration' };
  if (options.platform !== 'ios' && options.platform !== 'android') return { state: 'unavailable', reason: 'platform' };
  const hash = options.expectedCaSha256;
  if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) return { state: 'unavailable', reason: 'certificate' };
  try {
    const bridge = options.loadBridge() as PrivateQaBridge | null;
    if (!bridge || typeof bridge.binding !== 'function' || typeof bridge.request !== 'function' || typeof bridge.cancel !== 'function') return { state: 'unavailable', reason: 'native' };
    let binding;
    try { binding = bridge.binding(); } catch { return { state: 'unavailable', reason: 'binding' }; }
    if (!binding || binding.enabled !== true || binding.apiOrigin !== config.apiBaseUrl || binding.authOrigin !== config.authUrl || binding.caSha256 !== hash) return { state: 'unavailable', reason: 'binding' };
    return { state: 'ready', fetch: createPrivateQaFetch({ bridge, expectedCaSha256: hash }) };
  } catch { return { state: 'unavailable', reason: 'native' }; }
}

export function deviceLocalDevelopmentNetwork(config: SupabaseConfig): PrivateQaNetwork {
  let platform: string = '', expectedCaSha256: unknown;
  try { platform = Platform.OS; expectedCaSha256 = Constants.expoConfig?.extra?.ayaLocalDevelopmentTls?.caSha256; } catch { /* fail closed below */ }
  return prepareLocalDevelopmentNetwork(config, {
    platform, expectedCaSha256,
    loadBridge: () => requireOptionalNativeModule<PrivateQaBridge>('AyaPrivateQaTransport'),
  });
}
