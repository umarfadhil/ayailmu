// The web build keeps no session vault: a sign-in is never remembered in a browser, since no localStorage, IndexedDB,
// cookie or SQLite file holds a token. So a remembering build offers no choice there. No native module is imported here.
import type { SessionVault } from '@/auth/types';

export function deviceSessionVault(): SessionVault | null {
  return null;
}
