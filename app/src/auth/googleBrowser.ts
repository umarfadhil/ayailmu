// The OS/browser boundary of Continue with Google. On the web, a full-page redirect in this tab (no popup, no frame), whose
// callback arrives with the next page load: that page takes its URL once and removes the single-use code from the
// address bar at once. On native, the system browser's auth session (expo-web-browser's openAuthSessionAsync:
// ASWebAuthenticationSession or Custom Tabs, never an embedded WebView), which hands its callback back to this app run;
// it is unavailable in Expo Go (which cannot receive the app's own scheme), without the auth-session module, and without
// the WebCrypto that PKCE's S256 challenge needs. The platform defaults live in googleDevice.ts and googleDevice.web.ts.
import type { GooglePlatform } from '@/account/googleConfig';
import { missingWebCrypto } from '@/auth/google';

/** How the browser came back: at a callback URL (still to be checked), or without one. */
export type GoogleBrowserResult = { type: 'callback'; url: string } | { type: 'cancelled' };

export interface GoogleBrowser {
  platform: GooglePlatform;
  /**
   * Opens the authorize URL. Native: settles once the auth session ends, with the URL it reached, or as cancelled. Web:
   * the page navigates away and this never settles, unless the page is shown again without a callback (the
   * back/forward cache), which settles as cancelled.
   */
  open(authorizeUrl: string, callbackUrl: string): Promise<GoogleBrowserResult>;
  /**
   * Web: the URL this page was loaded with, once per page, when it is at `callbackUrl` with a query or a fragment; its
   * query and fragment are then removed from the address bar. Otherwise (and always on native) null.
   */
  takeLaunchUrl(callbackUrl: string): string | null;
}

/** The parts of the browser page the web boundary uses. */
export interface WebPage {
  location: { href: string; origin: string; assign(url: string): void };
  history: { state: unknown; replaceState(state: unknown, unused: string, url: string): void };
  addEventListener(type: 'pageshow', listener: (event: { persisted: boolean }) => void): void;
  removeEventListener(type: 'pageshow', listener: (event: { persisted: boolean }) => void): void;
}

export function createWebGoogleBrowser(page: WebPage): GoogleBrowser {
  // The URL this page was loaded with, read now (before the app's router can change it), and taken at most once.
  let launch: string | null = page.location.href;
  return {
    platform: { kind: 'web', origin: page.location.origin },
    open(authorizeUrl) {
      return new Promise<GoogleBrowserResult>((resolve) => {
        const shown = (event: { persisted: boolean }) => {
          if (!event.persisted) return;
          page.removeEventListener('pageshow', shown);
          resolve({ type: 'cancelled' });
        };
        page.addEventListener('pageshow', shown);
        page.location.assign(authorizeUrl);
      });
    },
    takeLaunchUrl(callbackUrl) {
      const url = launch;
      launch = null;
      if (url === null || !url.startsWith(callbackUrl)) return null;
      const rest = url.slice(callbackUrl.length);
      if (rest === '' || (rest[0] !== '?' && rest[0] !== '#')) return null;
      // The single-use code leaves the address bar and this history entry at once; the router's entry state stays.
      page.history.replaceState(page.history.state, '', callbackUrl);
      return url;
    },
  };
}

/** expo-web-browser's openAuthSessionAsync(url, redirectUrl). */
export type OpenAuthSession = (url: string, redirectUrl: string) => Promise<{ type: string; url?: string }>;

const IN_EXPO_GO = "Expo Go cannot receive this app's own arabictrial:// callback: Google sign-in needs a development or standalone build.";
const NO_AUTH_SESSION = "The system browser's auth session (expo-web-browser) is not available in this build.";

export function createNativeGoogleBrowser({ openAuthSession, expoGo }: { openAuthSession: OpenAuthSession | null; expoGo: boolean }): GoogleBrowser {
  const lacking = missingWebCrypto();
  const unavailable = expoGo
    ? IN_EXPO_GO
    : !openAuthSession
      ? NO_AUTH_SESSION
      : lacking !== null
        ? `This build's JavaScript runtime lacks ${lacking}, which Google sign-in needs for its S256 PKCE challenge.`
        : null;
  return {
    platform: { kind: 'native', unavailable },
    async open(authorizeUrl, callbackUrl) {
      if (unavailable !== null || !openAuthSession) throw new Error(`Google sign-in cannot open the browser here. ${unavailable ?? NO_AUTH_SESSION}`);
      let result: { type: string; url?: string };
      try {
        result = await openAuthSession(authorizeUrl, callbackUrl);
      } catch {
        return { type: 'cancelled' }; // the session could not run (another one already open, say): nothing came back
      }
      return result.type === 'success' && typeof result.url === 'string' ? { type: 'callback', url: result.url } : { type: 'cancelled' };
    },
    takeLaunchUrl: () => null,
  };
}
