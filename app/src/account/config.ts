// Local account sync configuration for the developer pilot: the loopback account API on port 8092 and the
// Firebase Auth emulator on port 9099, for a demo project. Anything absent or unsafe turns account sync off;
// guest learning never depends on it.

export const PILOT_API_PORT = 8092;
export const PILOT_AUTH_EMULATOR_PORT = 9099;

/** The build-time variables read. Expo inlines EXPO_PUBLIC_* values when it bundles the app. */
export interface AccountEnv {
  EXPO_PUBLIC_API_BASE_URL?: string;
  EXPO_PUBLIC_AUTH_EMULATOR_URL?: string;
  EXPO_PUBLIC_FIREBASE_PROJECT_ID?: string;
}

export interface EnabledAccountConfig {
  enabled: true;
  /** Normalized origin, e.g. http://127.0.0.1:8092, with no trailing slash. */
  apiBaseUrl: string;
  /** Normalized origin of the Auth emulator, e.g. http://127.0.0.1:9099. */
  authEmulatorUrl: string;
  /** A Firebase demo project ("demo-…"), which cannot reach real resources. */
  projectId: string;
}

export interface DisabledAccountConfig {
  enabled: false;
  /** Why account sync is off, safe to show: it names the setting, never its value. */
  reason: string;
}

export type AccountConfig = EnabledAccountConfig | DisabledAccountConfig;

/**
 * http, a loopback host, a port, and at most a root slash. Matched whole, so credentials, another host, a path,
 * a query or a fragment can never match (no URL parsing: React Native's URL does not implement its parts).
 */
const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):(\d{1,5})\/?$/;
/** A Firebase demo project ID: the emulators accept it, and it cannot reach real resources. */
const DEMO_PROJECT = /^demo-[a-z0-9-]{1,25}$/;

/** The normalized origin (http://host:port) when `value` is exactly the local pilot address on `port`; otherwise null. */
export function localPilotOrigin(value: unknown, port: number): string | null {
  if (typeof value !== 'string') return null;
  const match = LOCAL_ORIGIN.exec(value);
  return match !== null && match[2] === String(port) ? `http://${match[1]}:${port}` : null;
}

export function isDemoProjectId(value: unknown): value is string {
  return typeof value === 'string' && DEMO_PROJECT.test(value);
}

/** Account sync off, with a reason that names the setting and what it must be, never its value. */
function off(setting: keyof AccountEnv, value: unknown, expected: string): DisabledAccountConfig {
  const problem = typeof value === 'string' && value !== '' ? `is not ${expected}` : 'is not set';
  return { enabled: false, reason: `${setting} ${problem}, so account sync is off.` };
}

/**
 * Reads the local pilot configuration. Only http on 127.0.0.1 or localhost, at the pilot's ports, with no
 * credentials, path, query or fragment, and a demo project are accepted; anything else disables account
 * sync instead of throwing.
 */
export function loadAccountConfig(
  env: AccountEnv = {
    EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL,
    EXPO_PUBLIC_AUTH_EMULATOR_URL: process.env.EXPO_PUBLIC_AUTH_EMULATOR_URL,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  }
): AccountConfig {
  const apiBaseUrl = localPilotOrigin(env.EXPO_PUBLIC_API_BASE_URL, PILOT_API_PORT);
  if (!apiBaseUrl) {
    return off(
      'EXPO_PUBLIC_API_BASE_URL',
      env.EXPO_PUBLIC_API_BASE_URL,
      `the local pilot API (http on 127.0.0.1 or localhost, port ${PILOT_API_PORT}, nothing after the port)`
    );
  }
  const authEmulatorUrl = localPilotOrigin(env.EXPO_PUBLIC_AUTH_EMULATOR_URL, PILOT_AUTH_EMULATOR_PORT);
  if (!authEmulatorUrl) {
    return off(
      'EXPO_PUBLIC_AUTH_EMULATOR_URL',
      env.EXPO_PUBLIC_AUTH_EMULATOR_URL,
      `the local Auth emulator (http on 127.0.0.1 or localhost, port ${PILOT_AUTH_EMULATOR_PORT}, nothing after the port)`
    );
  }
  const projectId = env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;
  if (!isDemoProjectId(projectId)) return off('EXPO_PUBLIC_FIREBASE_PROJECT_ID', projectId, 'a Firebase demo project ID (demo-…)');
  return { enabled: true, apiBaseUrl, authEmulatorUrl, projectId };
}
