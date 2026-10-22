// The native build's recovery pieces, built only when called (never at import): the runtime that observes the app's own
// arabictrial://recover links (the existing development scheme) through React Native's Linking (the link the app was
// opened with, and those that arrive while it is open), and the pending attempt's store. In a local or staging build that
// store is in RAM, kept while the app stays open and gone after a cold restart, as before. In a validated production build
// with recovery on it is the secure store's own item instead (createSecureRecoveryStore), so the attempt survives a cold
// restart; where that is not available there is no store at all, never one in RAM. Expo Go cannot receive the fixed
// scheme, so there recovery says why it is unavailable and observes nothing. Never a browser, mail or network. The web
// build uses recoveryDevice.web.ts.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Linking } from 'react-native';

import { accountApiOrigin } from '@/account/staging';
import { accountAuthOrigin, LOCAL_SUPABASE, type SupabaseConfig } from '@/account/supabaseConfig';
import {
  createSecureRecoveryStore,
  memoryRecoveryStore,
  NATIVE_RECOVERY_CALLBACK,
  passwordRecoveryEnabled,
  type RecoveryAttemptStore,
} from '@/auth/recovery';
import { ownsRecoveryUrl, type RecoveryRuntime } from '@/auth/recoveryRuntime';

/** At most this many links are remembered as handed over (the set then starts again). */
const MAX_DELIVERED = 16;
const EXPO_GO_UNAVAILABLE = 'Pemulihan kata sandi tidak tersedia di Expo Go. Gunakan build pengembangan atau rilis aplikasi.';
/** The pending attempt's own installation-marker database: nothing else is kept in it, and never the session vault's. */
const RECOVERY_MARKER_DATABASE = 'ayailmu-recovery-installation.db';

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

type SecureStoreModule = Pick<typeof import('expo-secure-store'), 'getItem' | 'setItem' | 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'>;
type SqliteModule = Pick<typeof import('expo-sqlite'), 'openDatabaseSync'>;
type CryptoModule = Pick<typeof import('expo-crypto'), 'randomUUID'>;

/**
 * The pending recovery attempt's store. Without a configuration, and in a local or staging build, it is in RAM as before.
 * A production build gets the secure store's own item (createSecureRecoveryStore), bound to its API and Auth roots and
 * the native callback, only when this configuration is validated here again (the provider, the production profile with
 * its exact capability, two distinct public root origins), recovery is on and this is not Expo Go; otherwise, or when the
 * native modules or the marker database are not there, it gets no store at all, never one in RAM. The native modules
 * load only then.
 */
export function deviceRecoveryStore(config?: SupabaseConfig): RecoveryAttemptStore | null {
  if (config === undefined || !config.enabled || config.environment !== 'production') return memoryRecoveryStore();
  if (config.provider !== LOCAL_SUPABASE || config.productionAccounts !== true || !passwordRecoveryEnabled()) return null;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  const api = accountApiOrigin(config.apiBaseUrl, config.environment, config.productionAccounts);
  const auth = accountAuthOrigin(config.authUrl, config.environment, config.productionAccounts);
  if (api === null || auth === null || api === auth) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const secureStore = require('expo-secure-store') as SecureStoreModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sqlite = require('expo-sqlite') as SqliteModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('expo-crypto') as CryptoModule;
    const db = sqlite.openDatabaseSync(RECOVERY_MARKER_DATABASE);
    // One row at most, replaced whole by one statement.
    db.execSync('CREATE TABLE IF NOT EXISTS installation (slot INTEGER PRIMARY KEY CHECK (slot = 1), id TEXT NOT NULL)');
    return createSecureRecoveryStore(
      {
        secureStore,
        whenUnlockedThisDeviceOnly: secureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        marker: {
          read: () => {
            const row = db.getFirstSync<{ id: unknown }>('SELECT id FROM installation WHERE slot = 1');
            return typeof row?.id === 'string' ? row.id : null;
          },
          write: (id) => {
            db.runSync('INSERT OR REPLACE INTO installation (slot, id) VALUES (1, ?)', id);
          },
        },
        newMarker: () => crypto.randomUUID(),
      },
      { api, auth, callbackUrl: NATIVE_RECOVERY_CALLBACK },
      () => Date.now(),
    );
  } catch {
    return null;
  }
}
