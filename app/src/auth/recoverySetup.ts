// Password recovery's setup for this build, made only when called: nothing unless the account service is configured and
// the build turns recovery on (EXPO_PUBLIC_PASSWORD_RECOVERY=on), and then only a runtime whose callback this profile may
// use. Until both hold, no runtime or store is touched, whether this platform's own or one given.
import type { SupabaseConfig } from '@/account/supabaseConfig';
import {
  isSafeRecoveryConfig,
  NATIVE_RECOVERY_CALLBACK,
  passwordRecoveryEnabled,
  type RecoveryAttemptStore,
  type RecoveryConfig,
} from '@/auth/recovery';
import { deviceRecoveryRuntime, deviceRecoveryStore } from '@/auth/recoveryDevice';
import type { RecoveryRuntime } from '@/auth/recoveryRuntime';

export type { RecoveryAttemptStore, RecoveryRuntime };

export interface RecoverySetup {
  runtime: RecoveryRuntime;
  config: RecoveryConfig;
  /** Null when no pending-attempt store is available: a recovery link is still recognized, but recovery cannot go on. */
  store: RecoveryAttemptStore | null;
}

/**
 * The runtime, configuration and store recovery uses here, or null when it is off: not configured, not turned on, no
 * runtime (a given null included), a native runtime that is unavailable (Expo Go), or a callback this profile may not use.
 * A given runtime or store (null included) stands in for this platform's own.
 */
export function prepareRecovery(
  config: SupabaseConfig,
  runtimeOverride?: RecoveryRuntime | null,
  storeOverride?: RecoveryAttemptStore | null,
): RecoverySetup | null {
  if (!config.enabled || !passwordRecoveryEnabled()) return null;
  let runtime: RecoveryRuntime | null;
  try {
    runtime = runtimeOverride !== undefined ? runtimeOverride : deviceRecoveryRuntime();
  } catch {
    return null;
  }
  if (!runtime) return null;
  const { platform } = runtime;
  if (platform.kind === 'native' && platform.unavailable !== null) return null;
  const recoveryConfig: RecoveryConfig =
    platform.kind === 'native'
      ? { enabled: true, platform: 'native', callbackUrl: NATIVE_RECOVERY_CALLBACK }
      : { enabled: true, platform: 'web', callbackUrl: `${platform.origin}/recover` };
  if (!isSafeRecoveryConfig(recoveryConfig, config.environment)) return null;
  let store: RecoveryAttemptStore | null;
  try {
    store = storeOverride !== undefined ? storeOverride : deviceRecoveryStore();
  } catch {
    store = null;
  }
  return { runtime, config: recoveryConfig, store };
}
