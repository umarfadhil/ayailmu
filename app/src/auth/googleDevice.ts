// The platform's own Continue with Google boundary on native: the system browser's auth session through expo-web-browser
// (ASWebAuthenticationSession on iOS, Custom Tabs on Android; never an embedded WebView), refused in Expo Go, and a
// pending attempt kept in RAM (the app stays alive behind the system browser). The web build uses googleDevice.web.ts.
// No crypto is shimmed here: without the runtime's own WebCrypto, Google sign-in stays off and says why.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { openAuthSessionAsync } from 'expo-web-browser';

import { memoryGoogleStore, type PendingGoogleStore } from '@/auth/google';
import { createNativeGoogleBrowser, type GoogleBrowser } from '@/auth/googleBrowser';

export function deviceGoogleBrowser(): GoogleBrowser | null {
  return createNativeGoogleBrowser({
    openAuthSession: (url, redirectUrl) => openAuthSessionAsync(url, redirectUrl),
    expoGo: Constants.executionEnvironment === ExecutionEnvironment.StoreClient,
  });
}

export function deviceGoogleStore(): PendingGoogleStore | null {
  return memoryGoogleStore();
}
