// Web preview: an account dataset lives in browser localStorage under its own key, with its own Web Lock, under the
// same single-writer rules as the guest store (ENG-R01): one owner tab, the others read-only.
import { runCheckpoints } from '@/storage/checkpoints';
import { memoryKv, type KvBackend } from '@/storage/kvStore';
import { bindPageLifecycle, type LockManagerLike, type PageLifecycleTarget } from '@/storage/webStore';
import { openKvDataset, type Namespace, type OpenedAccountDataset } from './datasets';

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

export async function openAccountDataset(namespace: Namespace): Promise<OpenedAccountDataset> {
  const { kv, shared } = browserKv();
  const locks = shared ? (globalThis.navigator as { locks?: LockManagerLike } | undefined)?.locks : PRIVATE_LOCK;
  const opened = await openKvDataset({ kv, locks, namespace });
  const win = globalThis as unknown as Partial<PageLifecycleTarget> & { location?: { reload(): void } };
  if (typeof win.addEventListener !== 'function' || typeof win.removeEventListener !== 'function') return opened;
  // On pagehide the session checkpoint is saved first, then this tab lets go of the account dataset's lock.
  const unbind = bindPageLifecycle(opened, win as PageLifecycleTarget, () => win.location?.reload(), runCheckpoints);
  return {
    ...opened,
    release: () => {
      unbind();
      opened.release();
    },
  };
}
