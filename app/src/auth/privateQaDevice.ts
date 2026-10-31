// The private native QA device adapter: its contract, before its implementation. devicePrivateQaNetwork(config) is what
// the account provider calls, once per configuration, to learn which fetch a build's account clients get. It gathers the
// three device facts preparePrivateQaNetwork (auth/privateQaNetwork.ts) needs and returns exactly what that returns; it
// decides nothing of its own:
//   - platform: React Native's Platform.OS, read at each call.
//   - expectedCaSha256: the build's public metadata, Constants.expoConfig.extra.ayaPrivateQa.caSha256 (expo-constants),
//     read at each call. It is never taken from the native module or anything the module reports.
//   - loadBridge: a loader that calls requireOptionalNativeModule('AyaPrivateQaTransport') (from 'expo', which re-exports
//     expo-modules-core's) only when preparePrivateQaNetwork calls it, so only for a usable private profile.
// So, as preparePrivateQaNetwork's rules give it:
//   - An ordinary or disabled profile is off, on any platform, and its native module is never requested. Importing this
//     module requests none either.
//   - The private profile on the web, or any platform but ios and android, is unavailable with reason 'platform'.
//   - A missing or malformed fingerprint is 'certificate'; a binary without the module (null), or a throwing or incomplete
//     one, is 'native'; a module reporting no binding or another one is 'binding'. None of these ever falls back to the
//     global fetch: the account clients of an unavailable private profile are not built.
//   - Otherwise ready, with the transport's fetch over that module.
// It never throws, keeps no state between calls, and carries no certificate, key or service address of its own.
import { requireOptionalNativeModule } from 'expo';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { SupabaseConfig } from '@/account/supabaseConfig';
import { preparePrivateQaNetwork, type PrivateQaNetwork } from '@/auth/privateQaNetwork';
import type { PrivateQaBridge } from '@/auth/privateQaTransport';

/** The native module's name, exactly as requireOptionalNativeModule takes it. */
export type PrivateQaNativeModuleName = 'AyaPrivateQaTransport';

/** The build's public metadata the fingerprint is read from, Constants.expoConfig.extra: only caSha256 is read. */
export interface PrivateQaBuildExtra {
  ayaPrivateQa?: {
    /** The designated CA certificate's SHA-256, 64 lowercase hex characters: public, never a key. */
    caSha256?: unknown;
  };
}

/** What requireOptionalNativeModule may give for PrivateQaNativeModuleName: the bridge, or null in a binary without it. Checked, never trusted. */
export type PrivateQaNativeModule = PrivateQaBridge | null;

/** The device adapter: a configuration in, the private network decision for this device out. */
export type DevicePrivateQaNetwork = (config: SupabaseConfig) => PrivateQaNetwork;

/** The module's runtime surface, once implemented. */
export interface PrivateQaDeviceFacade {
  devicePrivateQaNetwork: DevicePrivateQaNetwork;
}

const MODULE_NAME: PrivateQaNativeModuleName = 'AyaPrivateQaTransport';

/** A device fact, or undefined when reading it throws: preparation then names the missing fact itself. */
function read(fact: () => unknown): unknown {
  try {
    return fact();
  } catch {
    return undefined;
  }
}

export const devicePrivateQaNetwork: DevicePrivateQaNetwork = (config) =>
  preparePrivateQaNetwork(config, {
    platform: read(() => Platform.OS) as string,
    expectedCaSha256: read(() => (Constants.expoConfig?.extra as PrivateQaBuildExtra | undefined)?.ayaPrivateQa?.caSha256),
    loadBridge: (): PrivateQaNativeModule => requireOptionalNativeModule<PrivateQaBridge>(MODULE_NAME),
  });
