// The web build's recovery pieces, built only when called (never at import): the runtime that observes this app's own
// /recover links in the address bar, and the pending attempt in this tab's sessionStorage through the session store, or
// nothing when the browser withholds it (access throws, or gives null). Never localStorage, a browser or mail.
import { sessionRecoveryStore, type RecoveryAttemptStore } from '@/auth/recovery';
import { ownsRecoveryUrl, type RecoveryRuntime } from '@/auth/recoveryRuntime';

/** At most this many links are remembered as handed over (the set then starts again). */
const MAX_DELIVERED = 16;

/**
 * The address bar's recovery links: the address when this is called (before the router's effects can change it) as the
 * launch link, and later ones as history moves (popstate, hashchange). Only links for this origin's /recover are handed
 * over, each raw and once; any other address, a Google or account one included, is left as it is. Once a link is handed
 * over, the address loses its query and fragment (its history state kept). Nothing is checked here: resume checks every
 * link it is given.
 */
export function deviceRecoveryRuntime(): RecoveryRuntime | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const win = window;
  const origin = win.location.origin;
  if (!/^https?:\/\/[^/]+$/.test(origin)) return null;
  const callbackBase = `${origin}/recover`;
  let launch: string | null = win.location.href;
  const delivered = new Set<string>();

  /** Takes the query and fragment off the address while it is a recovery link; the bare /recover left is then no new link. */
  const strip = () => {
    try {
      const current = win.location.href;
      if (current === callbackBase || !ownsRecoveryUrl(current, callbackBase)) return;
      win.history.replaceState(win.history.state, '', callbackBase);
      delivered.add(callbackBase);
    } catch {
      // The address keeps the link; resume still uses its attempt once.
    }
  };

  /** `raw` when it is a recovery link not handed over before, then remembered as handed over; else null. */
  const consume = (raw: string | null): string | null => {
    if (raw === null || !ownsRecoveryUrl(raw, callbackBase) || delivered.has(raw)) return null;
    if (delivered.size >= MAX_DELIVERED) delivered.clear();
    delivered.add(raw);
    strip();
    return raw;
  };

  return {
    platform: { kind: 'web', origin },
    takeLaunchUrl(callbackUrl: string) {
      if (callbackUrl !== callbackBase) return null;
      const raw = launch;
      launch = null;
      return consume(raw);
    },
    subscribe(onUrl: (url: string) => void) {
      const listener = () => {
        const raw = consume(win.location.href);
        if (raw !== null) onUrl(raw);
      };
      win.addEventListener('popstate', listener);
      win.addEventListener('hashchange', listener);
      return () => {
        win.removeEventListener('popstate', listener);
        win.removeEventListener('hashchange', listener);
      };
    },
  };
}

export function deviceRecoveryStore(): RecoveryAttemptStore | null {
  try {
    if (typeof window === 'undefined') return null;
    const storage: Storage | null = window.sessionStorage;
    return storage ? sessionRecoveryStore(storage) : null;
  } catch {
    return null;
  }
}
