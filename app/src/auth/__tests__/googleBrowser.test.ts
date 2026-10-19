// The OS/browser boundary of Continue with Google, written before its implementation (phase 10). On the web, leaving for
// Google is a full-page navigation in this tab (no popup, no frame), and the page that loads at the exact callback takes
// its URL once and removes its query and fragment (the single-use code) from the address bar, keeping the router's
// history entry state; a page shown again from the back/forward cache without a callback is a cancellation. On native,
// only the system browser's auth session (expo-web-browser's openAuthSessionAsync, never an embedded WebView) is used,
// with the exact callback; it is unavailable in Expo Go (which cannot receive the app's own scheme) and while that
// module is missing. The page and the auth-session function are the only doubles: they are the OS boundary.
import { createNativeGoogleBrowser, createWebGoogleBrowser, type GoogleBrowserResult, type OpenAuthSession } from '@/auth/googleBrowser';

const WEB_CALLBACK = 'http://localhost:8081/account';
const NATIVE_CALLBACK = 'arabictrial://account';
const AUTHORIZE = 'http://127.0.0.1:54321/authorize?provider=google&redirect_to=arabictrial%3A%2F%2Faccount&scopes=openid%20email%20profile';
const CODE = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';

/** A browser page at `href`: its location, history and pageshow listeners, as the test drives them. */
function fakePage(href: string) {
  const listeners = new Set<(event: { persisted: boolean }) => void>();
  const routerState = { key: 'expo-router-entry-1' };
  return {
    location: { href, origin: new URL(href).origin, assign: jest.fn() },
    history: { state: routerState as unknown, replaceState: jest.fn() },
    addEventListener: jest.fn((_type: 'pageshow', listener: (event: { persisted: boolean }) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: jest.fn((_type: 'pageshow', listener: (event: { persisted: boolean }) => void) => {
      listeners.delete(listener);
    }),
    /** The page is shown: restored from the back/forward cache when `persisted`. */
    show(persisted: boolean) {
      for (const listener of [...listeners]) listener({ persisted });
    },
    listening: () => listeners.size,
    routerState,
  };
}

/** Follows a promise without awaiting it: whether it settled, and how. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; value?: T; error?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(state, { settled: true, value }),
    (error: unknown) => Object.assign(state, { settled: true, error })
  );
  return state;
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('the web boundary: a full-page redirect in this tab', () => {
  it('takes the callback this page was loaded with once, and strips its code from the address bar, keeping the history entry', () => {
    for (const loaded of [`${WEB_CALLBACK}?code=${CODE}`, `${WEB_CALLBACK}#error=access_denied&error_description=Denied`]) {
      const page = fakePage(loaded);
      const browser = createWebGoogleBrowser(page);
      expect(browser.platform).toEqual({ kind: 'web', origin: 'http://localhost:8081' });

      expect(browser.takeLaunchUrl(WEB_CALLBACK)).toBe(loaded);
      expect(page.history.replaceState).toHaveBeenCalledTimes(1);
      const [state, , url] = page.history.replaceState.mock.calls[0] as [unknown, string, string];
      expect(state).toBe(page.routerState);
      expect(new URL(url, page.location.origin).href).toBe(WEB_CALLBACK);
      // Once per page: asking again (a remount, say) gets nothing.
      expect(browser.takeLaunchUrl(WEB_CALLBACK)).toBeNull();
      expect(page.history.replaceState).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    ['another route with a code', `http://localhost:8081/settings?code=${CODE}`],
    ['a look-alike route', `http://localhost:8081/accounts?code=${CODE}`],
    ['a longer path', `http://localhost:8081/account/google?code=${CODE}`],
    ['another origin', `http://127.0.0.1:8081/account?code=${CODE}`],
    ['the callback route with nothing after it', WEB_CALLBACK],
  ])('leaves %s alone: nothing taken, the address bar untouched', (_case, loaded) => {
    const page = fakePage(loaded);
    const browser = createWebGoogleBrowser(page);
    expect(browser.takeLaunchUrl(WEB_CALLBACK)).toBeNull();
    expect(page.history.replaceState).not.toHaveBeenCalled();
  });

  it('leaves for Google by navigating this tab; coming back from the back/forward cache without a callback is a cancellation', async () => {
    const page = fakePage(WEB_CALLBACK);
    const browser = createWebGoogleBrowser(page);
    const leaving = track(browser.open(AUTHORIZE, WEB_CALLBACK));
    await flush();

    expect(page.location.assign).toHaveBeenCalledTimes(1);
    expect(page.location.assign).toHaveBeenCalledWith(AUTHORIZE);
    // The page is leaving: nothing settles, and an ordinary page show changes nothing.
    expect(leaving.settled).toBe(false);
    page.show(false);
    await flush();
    expect(leaving.settled).toBe(false);

    // Shown again from the back/forward cache: the learner came back without a callback.
    page.show(true);
    await flush();
    const cancelled: GoogleBrowserResult = { type: 'cancelled' };
    expect(leaving).toEqual({ settled: true, value: cancelled });
    expect(page.listening()).toBe(0);
  });
});

describe("the native boundary: the system browser's auth session", () => {
  it('opens only the auth session, with the exact callback, and reports its outcome as a callback or a cancellation', async () => {
    const callback = `${NATIVE_CALLBACK}?code=${CODE}`;
    const openAuthSession = jest.fn<ReturnType<OpenAuthSession>, Parameters<OpenAuthSession>>(async () => ({ type: 'success', url: callback }));
    const browser = createNativeGoogleBrowser({ openAuthSession, expoGo: false });
    expect(browser.platform).toEqual({ kind: 'native', unavailable: null });

    await expect(browser.open(AUTHORIZE, NATIVE_CALLBACK)).resolves.toEqual({ type: 'callback', url: callback });
    expect(openAuthSession).toHaveBeenCalledTimes(1);
    expect(openAuthSession).toHaveBeenCalledWith(AUTHORIZE, NATIVE_CALLBACK);

    for (const ended of [{ type: 'cancel' }, { type: 'dismiss' }, { type: 'locked' }, { type: 'opened' }, { type: 'success' }]) {
      openAuthSession.mockResolvedValueOnce(ended);
      await expect(browser.open(AUTHORIZE, NATIVE_CALLBACK)).resolves.toEqual({ type: 'cancelled' });
    }
    openAuthSession.mockRejectedValueOnce(new Error('Another web browser is already open'));
    await expect(browser.open(AUTHORIZE, NATIVE_CALLBACK)).resolves.toEqual({ type: 'cancelled' });

    // A callback reaches native through the auth session only: a launch URL is never taken here.
    expect(browser.takeLaunchUrl(NATIVE_CALLBACK)).toBeNull();
  });

  it('is unavailable in Expo Go and without the auth-session module, and then never opens anything', async () => {
    const openAuthSession = jest.fn<ReturnType<OpenAuthSession>, Parameters<OpenAuthSession>>();
    const inExpoGo = createNativeGoogleBrowser({ openAuthSession, expoGo: true });
    expect(inExpoGo.platform).toEqual({ kind: 'native', unavailable: expect.stringMatching(/Expo Go/) });
    await expect(inExpoGo.open(AUTHORIZE, NATIVE_CALLBACK)).rejects.toThrow();

    const withoutModule = createNativeGoogleBrowser({ openAuthSession: null, expoGo: false });
    expect(withoutModule.platform).toEqual({ kind: 'native', unavailable: expect.stringMatching(/expo-web-browser/) });
    await expect(withoutModule.open(AUTHORIZE, NATIVE_CALLBACK)).rejects.toThrow();

    expect(openAuthSession).not.toHaveBeenCalled();
  });
});
