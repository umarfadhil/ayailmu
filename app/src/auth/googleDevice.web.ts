// The platform's own Continue with Google boundary on the web: a full-page redirect in this tab, whose callback comes back
// with the next page load, and a pending attempt in this tab's sessionStorage (never localStorage). This page's URL is
// read when the app loads, before its router can change it. No native module is imported here.
import { sessionGoogleStore, type PendingGoogleStore } from '@/auth/google';
import { createWebGoogleBrowser, type GoogleBrowser } from '@/auth/googleBrowser';

const browser: GoogleBrowser | null =
  typeof window !== 'undefined' && typeof document !== 'undefined'
    ? createWebGoogleBrowser({
        location: window.location,
        history: window.history,
        addEventListener: (type, listener) => window.addEventListener(type, listener),
        removeEventListener: (type, listener) => window.removeEventListener(type, listener),
      })
    : null;

export function deviceGoogleBrowser(): GoogleBrowser | null {
  return browser;
}

export function deviceGoogleStore(): PendingGoogleStore | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? sessionGoogleStore(window.sessionStorage) : null;
  } catch {
    return null; // this page may not use its storage
  }
}
