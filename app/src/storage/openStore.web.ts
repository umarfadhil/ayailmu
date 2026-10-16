// Web preview only: browser localStorage (expo-sqlite web needs COOP/COEP headers).
import { runCheckpoints } from './checkpoints';
import { memoryKv, type KvBackend } from './kvStore';
import { bindPageLifecycle, openWebStore, type LockManagerLike, type OpenedWebStore, type PageLifecycleTarget } from './webStore';

export const STORAGE_KIND = 'localStorage (pratinjau web)';

function browserKv(): { kv: KvBackend; shared: boolean } {
  try {
    const ls = globalThis.localStorage;
    ls.getItem('probe');
    return { kv: ls, shared: true };
  } catch {
    return { kv: memoryKv(), shared: false };
  }
}

/** Memory storage is private to this tab: there is nothing to share, so it owns itself. */
const PRIVATE_LOCK: LockManagerLike = { request: (_name, _options, cb) => Promise.resolve(cb({})) };

/**
 * ENG-R01: the tab holding the Web Lock writes; other tabs are read-only until it closes. On
 * pagehide the session checkpoint is queued, then the lock is released and the store revoked; a
 * page restored from the back/forward cache reloads instead of writing with a stale store.
 */
export async function openStore(): Promise<OpenedWebStore> {
  const { kv, shared } = browserKv();
  const locks = shared ? (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks : PRIVATE_LOCK;
  const opened = await openWebStore({ kv, locks });
  const win = globalThis as unknown as Partial<PageLifecycleTarget> & { location?: { reload(): void } };
  if (typeof win.addEventListener !== 'function' || typeof win.removeEventListener !== 'function') return opened;
  const unbind = bindPageLifecycle(opened, win as PageLifecycleTarget, () => win.location?.reload(), runCheckpoints);
  return {
    ...opened,
    release: () => {
      unbind();
      opened.release();
    },
  };
}
