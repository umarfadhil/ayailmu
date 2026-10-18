// ENG-R01: one writer per browser profile. The tab holding the exclusive Web Lock writes; any
// other tab opens read-only and may take over only after the owner releases (tab closed).
import { KvStore, type KvBackend } from './kvStore';
import type { Store } from './types';

/** The subset of `navigator.locks` used here. */
export interface LockManagerLike {
  request(name: string, options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean }, cb: (lock: unknown) => unknown): Promise<unknown>;
}

export interface OpenedWebStore {
  store: Store;
  access: 'owner' | 'read-only';
  /** Why the store is read-only (shown to the learner). */
  reason?: string;
  /** Releases the writer lock held by this tab (no-op when none is held). */
  release(): void;
  /** Read-only with Web Locks: resolves with a freshly read writable store once the owner releases. */
  whenWritable?(): Promise<Store>;
}

export const WRITER_LOCK = 'arabic-trial-app/writer';
export const READ_ONLY_OTHER_TAB = 'another tab of this app is open and is saving your answers';
export const READ_ONLY_NO_LOCKS = 'this browser has no Web Locks API, so concurrent tabs cannot be kept safe';
export const READ_ONLY_RELEASED = 'this tab handed the writer lock to another tab';

/**
 * Requests the exclusive writer lock. Resolves with a release function once held, or null
 * when `ifAvailable` and another tab holds it. The lock is held until release is called (or
 * the tab closes, which the browser handles). It is never stolen.
 */
function acquire(locks: LockManagerLike, ifAvailable: boolean): Promise<(() => void) | null> {
  return new Promise((resolve, reject) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    locks
      .request(WRITER_LOCK, { mode: 'exclusive', ifAvailable }, async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        resolve(release);
        await held;
      })
      .catch(reject);
  });
}

async function fresh(kv: KvBackend, readOnly: string | null): Promise<KvStore> {
  const store = new KvStore(kv, readOnly);
  await store.init();
  return store;
}

export async function openWebStore({ kv, locks }: { kv: KvBackend; locks: LockManagerLike | undefined }): Promise<OpenedWebStore> {
  if (!locks) {
    return { store: await fresh(kv, READ_ONLY_NO_LOCKS), access: 'read-only', reason: READ_ONLY_NO_LOCKS, release: () => undefined };
  }
  // The writable store and its lock. Releasing revokes the store first (after its queued writes),
  // then frees the lock, so a released tab can never write again (ENG-R01 lifecycle).
  let writable: KvStore | null = null;
  let unlock: (() => void) | null = null;
  const release = () => {
    const store = writable;
    const free = unlock;
    writable = null;
    unlock = null;
    if (!free) return;
    if (store) void store.revoke(READ_ONLY_RELEASED).finally(free);
    else free();
  };

  unlock = await acquire(locks, true);
  if (unlock) {
    try {
      writable = await fresh(kv, null);
    } catch (e) {
      release();
      throw e;
    }
    return { store: writable, access: 'owner', release };
  }
  return {
    store: await fresh(kv, READ_ONLY_OTHER_TAB),
    access: 'read-only',
    reason: READ_ONLY_OTHER_TAB,
    release,
    async whenWritable() {
      const free = await acquire(locks, false);
      if (!free) throw new Error('Writer lock was not granted');
      unlock = free;
      // Re-read storage: the previous owner's writes since this tab opened must not be lost.
      try {
        writable = await fresh(kv, null);
      } catch (e) {
        release();
        throw e;
      }
      return writable;
    },
  };
}

/** The subset of `window` used for page lifecycle events. */
export interface PageLifecycleTarget {
  addEventListener(type: 'pagehide' | 'pageshow', fn: (e: { persisted?: boolean }) => void): void;
  removeEventListener(type: 'pagehide' | 'pageshow', fn: (e: { persisted?: boolean }) => void): void;
}

/**
 * ENG-R01 lifecycle: on pagehide (reload, close, navigation, back/forward cache) this tab releases
 * the writer lock, which revokes its writable store. A page restored from the back/forward cache
 * reloads, so it re-opens through openWebStore (read-only while another tab owns the lock).
 * `beforeRelease` runs first, so writes it queues or awaits (checkpoints) land before the revocation.
 * Returns an unbind function.
 */
export function bindPageLifecycle(
  opened: OpenedWebStore,
  win: PageLifecycleTarget,
  reload: () => void,
  beforeRelease?: () => Promise<unknown> | unknown
): () => void {
  let hidden = false;
  const onHide = () => {
    hidden = true;
    // Checkpoints land before the revocation: queued synchronously, or (while an answer is still
    // being saved) awaited first. On unload the browser frees the lock itself if this never runs.
    const pending = beforeRelease?.();
    if (pending && typeof (pending as Promise<unknown>).then === 'function') void Promise.resolve(pending).finally(() => opened.release());
    else opened.release();
  };
  const onShow = (e: { persisted?: boolean }) => {
    if (e.persisted && hidden) reload();
  };
  win.addEventListener('pagehide', onHide);
  win.addEventListener('pageshow', onShow);
  return () => {
    win.removeEventListener('pagehide', onHide);
    win.removeEventListener('pageshow', onShow);
  };
}
