// Password recovery's setup for this build, made only when called: nothing unless the account service is configured and
// the build turns recovery on (EXPO_PUBLIC_PASSWORD_RECOVERY=on), and then only a runtime whose callback this profile may
// use. Until both hold, no runtime or store is touched, whether this platform's own or one given. A private QA build
// takes the native callback only, with its own capability, and also needs the native crypto port.
import { PRIVATE_QA } from '@/account/privateQa';
import type { SupabaseConfig } from '@/account/supabaseConfig';
import {
  isSafeRecoveryConfig,
  NATIVE_RECOVERY_CALLBACK,
  passwordRecoveryEnabled,
  type RecoveryAttemptStore,
  type RecoveryConfig,
} from '@/auth/recovery';
import { nativeRecoveryCrypto, type RecoveryCrypto } from '@/auth/recoveryCrypto';
import { deviceRecoveryRuntime, deviceRecoveryStore } from '@/auth/recoveryDevice';
import type { RecoveryRuntime } from '@/auth/recoveryRuntime';

export type { RecoveryAttemptStore, RecoveryCrypto, RecoveryRuntime };

export interface RecoverySetup {
  runtime: RecoveryRuntime;
  config: RecoveryConfig;
  /** Null when no pending-attempt store is available: a recovery link is still recognized, but recovery cannot go on. */
  store: RecoveryAttemptStore | null;
  /**
   * Only in a private QA build: its native crypto port, or null when the device has none (recovery cannot go on then).
   * Absent in every other build, which never uses one.
   */
  crypto?: RecoveryCrypto | null;
}

/**
 * The runtime, configuration and store recovery uses here, or null when it is off: not configured, not turned on, no
 * runtime (a given null included), a native runtime that is unavailable (Expo Go), or a callback this profile may not use.
 * A given runtime, store or crypto port (null included) stands in for this platform's own.
 */
export function prepareRecovery(
  config: SupabaseConfig,
  runtimeOverride?: RecoveryRuntime | null,
  storeOverride?: RecoveryAttemptStore | null,
  cryptoOverride?: RecoveryCrypto | null,
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
  if (!isSafeRecoveryConfig(recoveryConfig, config.environment, config.productionAccounts, config.privateQa)) return null;
  let store: RecoveryAttemptStore | null;
  try {
    store = storeOverride !== undefined ? storeOverride : deviceRecoveryStore(config);
  } catch {
    store = null;
  }
  if (config.environment !== PRIVATE_QA) return { runtime, config: recoveryConfig, store };
  let crypto: RecoveryCrypto | null;
  try {
    crypto = cryptoOverride !== undefined ? cryptoOverride : nativeRecoveryCrypto();
  } catch {
    crypto = null;
  }
  return { runtime, config: recoveryConfig, store, crypto };
}
