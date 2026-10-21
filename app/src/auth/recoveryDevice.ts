// The native build's recovery pieces, built only when called (never at import): the runtime that observes the app's own
// arabictrial://recover links through React Native's Linking (the link the app was opened with, and those that arrive
// while it is open), and the pending attempt in RAM, kept while the app stays open and gone after a cold restart. Expo Go
// cannot receive the fixed scheme, so there recovery says why it is unavailable and observes nothing. Never a browser,
// mail or network. The web build uses recoveryDevice.web.ts.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking } from 'react-native';

import { memoryRecoveryStore, NATIVE_RECOVERY_CALLBACK, type RecoveryAttemptStore } from '@/auth/recovery';
import { ownsRecoveryUrl, type RecoveryRuntime } from '@/auth/recoveryRuntime';

/** At most this many links are remembered as handed over (the set then starts again). */
const MAX_DELIVERED = 16;
const EXPO_GO_UNAVAILABLE = 'Pemulihan kata sandi tidak tersedia di Expo Go. Gunakan build pengembangan atau rilis aplikasi.';

/** The launch link as read once: its URL (null without one), or that it could not be read. */
type LaunchRead = { read: true; url: string | null } | { read: false };

/**
 * Linking's recovery links: the launch link, read once when this is called and taken once, and later ones from its url
 * events. Only arabictrial://recover links are handed over, each raw and once (a launch link that also arrives as an
 * event included); any other link is left alone. Nothing is checked here: resume checks every link it is given.
 */
export function deviceRecoveryRuntime(): RecoveryRuntime | null {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return {
      platform: { kind: 'native', unavailable: EXPO_GO_UNAVAILABLE },
      takeLaunchUrl: () => null,
      subscribe: () => () => undefined,
    };
  }
  // Read now, before anything waits on it, and settled either way so a failed read is never an unhandled rejection.
  const initial = new Promise<string | null>((resolve) => resolve(Linking.getInitialURL())).then(
    (url): LaunchRead => ({ read: true, url: typeof url === 'string' ? url : null }),
    (): LaunchRead => ({ read: false }),
  );
  let launchTaken = false;
  const delivered = new Set<string>();

  /** `raw` when it is a recovery link not handed over before, then remembered as handed over; else null. */
  const consume = (raw: string | null): string | null => {
    if (raw === null || !ownsRecoveryUrl(raw, NATIVE_RECOVERY_CALLBACK) || delivered.has(raw)) return null;
    if (delivered.size >= MAX_DELIVERED) delivered.clear();
    delivered.add(raw);
    return raw;
  };

  return {
    platform: { kind: 'native', unavailable: null },
    async takeLaunchUrl(callbackUrl: string) {
      if (callbackUrl !== NATIVE_RECOVERY_CALLBACK || launchTaken) return null;
      launchTaken = true;
      const launch = await initial;
      // Not knowing the launch link is not the same as having none: the caller fails closed.
      if (!launch.read) throw new Error('The launch link could not be read.');
      return consume(launch.url);
    },
    subscribe(onUrl: (url: string) => void) {
      const subscription = Linking.addEventListener('url', ({ url }: { url: string }) => {
        const raw = consume(url);
        if (raw !== null) onUrl(raw);
      });
      return () => subscription.remove();
    },
  };
}

export function deviceRecoveryStore(): RecoveryAttemptStore | null {
  return memoryRecoveryStore();
}
