// Retrying a failed erase of the signed-in account's local web dataset on the same opened owner, under two storage
// faults that last until repaired: removeItem throwing for account A's main blob, and getItem throwing for A's keys
// while the erase verifies that they are gone (by then the first attempt may have removed everything). In both, a
// write queued before the erase is in storage before anything is removed; the failed erase rejects with an Error and
// leaves the owner's store holding none of A's state and retired, so the writes queued behind it are refused; once the
// fault is repaired, a retry through the same handle fulfils with A's main blob and journal gone, and the store still
// refuses every write. What storage keeps after the failure, and the order of removals, are not pinned; nothing is
// written once removal begins, and the guest's and account B's stored bytes stay exact. The real openKvDataset and
// KvStore run over an in-memory backend, seen through a pass-through wrapper that injects the fault after opening,
// with an owner-lock fixture: no browser, server or network, and every value is synthetic.
import { accountNamespace, GUEST_NAMESPACE, openKvDataset } from '@/account/datasets';
import { memoryKv, type KvBackend } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
/** Where a dataset's sync journal is stored beside its main blob. */
const journalKey = (kvKey: string) => `${kvKey}/journal`;

/** Account A's main blob as seeded: schema 2, with metadata and a snapshot. */
const SEEDED_BLOB = {
  schema: 2,
  meta: { seeded: 'opaque metadata of account A (fixture)' },
  learner: null,
  answers: [],
  snapshot: 'opaque snapshot of account A (fixture)',
  reports: [],
};
const SEEDED_JOURNAL = 'opaque journal of account A (fixture)';
const BEFORE_MARKER = 'written just before the erase (fixture)';
const LATE_MARKER = 'queued behind the erase (fixture)';
const LATE_JOURNAL = 'opaque journal queued behind the erase (fixture)';
const RETRIED_MARKER = 'written after the retried erase (fixture)';
const RETRIED_JOURNAL = 'opaque journal saved after the retried erase (fixture)';

/** A storage fault that lasts until repaired. */
type Fault = 'removing the main blob' | 'verifying absence';

const MODES: readonly { name: string; fault: Fault }[] = [
  { name: "removeItem throws for A's main blob", fault: 'removing the main blob' },
  { name: "getItem throws for A's keys while the erase verifies they are gone", fault: 'verifying absence' },
];

/** Web Locks as openWebStore uses them: one exclusive holder per name, held until its callback settles. */
function ownerLocks(): LockManagerLike {
  const held = new Set<string>();
  return {
    async request(name, options, cb) {
      if (held.has(name)) {
        if (options.ifAvailable) return cb(null);
        throw new Error('This fixture never waits for a held lock');
      }
      held.add(name);
      try {
        return await cb({ name, mode: options.mode });
      } finally {
        held.delete(name);
      }
    },
  };
}

/**
 * The seeded backend as the dataset sees it: everything passes straight through until `arm` injects a fault, which
 * lasts until `repair`. 'removing the main blob' makes removeItem of `main` throw; 'verifying absence' makes getItem of
 * an `own` key throw once a removal of one has begun, so opening and earlier writes read as usual. At the first removal
 * attempt on an `own` key, before anything is removed, `main` is captured as stored; every write from then on is logged.
 */
function faultyKv(backend: KvBackend, main: string, own: readonly string[]) {
  let fault: Fault | null = null;
  let removing = false;
  const seen: { mainAtFirstRemoval?: string | null; writesOnceRemoving: string[] } = { writesOnceRemoving: [] };
  const kv: KvBackend = {
    getItem: (key) => {
      if (fault === 'verifying absence' && removing && own.includes(key)) throw new Error('Injected getItem fault (fixture)');
      return backend.getItem(key);
    },
    setItem: (key, value) => {
      if (removing) seen.writesOnceRemoving.push(key);
      backend.setItem(key, value);
    },
    removeItem: (key) => {
      if (!removing && own.includes(key)) {
        seen.mainAtFirstRemoval = backend.getItem(main);
        removing = true;
      }
      if (fault === 'removing the main blob' && key === main) throw new Error('Injected removeItem fault (fixture)');
      backend.removeItem(key);
    },
  };
  return {
    kv,
    seen,
    arm(injected: Fault) {
      fault = injected;
    },
    repair() {
      fault = null;
    },
  };
}

/** How a promise settled, without the wording of any rejection. */
function settlement(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'fulfilled';
  return result.reason instanceof Error ? 'rejected with an Error' : 'rejected with a non-Error';
}

it.each(MODES)("keeps the owner's store retired after a failed erase, and the same owner's retry completes it, when $name until repaired", async ({ fault }) => {
  // Catches: an erase that reports success over a fault; a failed erase that leaves the owner's store caching A's state
  // or writable again; a write queued before the erase that never reached storage; a retry that is refused, leaves a
  // key behind or makes the store writable again; any write once removal began; a guest or account B key touched.
  const backend = memoryKv();
  const own = accountNamespace(A);
  const ownKeys = [own.kvKey, journalKey(own.kvKey)];
  backend.setItem(own.kvKey, JSON.stringify(SEEDED_BLOB));
  backend.setItem(journalKey(own.kvKey), SEEDED_JOURNAL);
  const sentinelKeys = [GUEST_NAMESPACE.kvKey, journalKey(GUEST_NAMESPACE.kvKey), accountNamespace(B).kvKey, journalKey(accountNamespace(B).kvKey)];
  for (const key of sentinelKeys) backend.setItem(key, `distinct bytes kept at ${key}`);
  const sentinelsBefore = sentinelKeys.map((key) => backend.getItem(key));
  // Values exactly as stored, read past the wrapper.
  const stored = (keys: string[]) => keys.map((key) => backend.getItem(key));

  const { kv, seen, arm, repair } = faultyKv(backend, own.kvKey, ownKeys);
  const opened = await openKvDataset({ kv, locks: ownerLocks(), namespace: own });
  try {
    expect(opened.access).toBe('owner');
    expect(typeof opened.eraseAccountData).toBe('function');
    arm(fault);

    // A write queued before the erase, the erase, and two ordinary writes queued behind it, all handled from the start.
    const [beforeWrite, firstErase, lateMeta, lateJournal] = await Promise.allSettled([
      opened.store.setMeta('before', BEFORE_MARKER),
      opened.eraseAccountData(A),
      opened.store.setMeta('late', LATE_MARKER),
      opened.journal.save(LATE_JOURNAL),
    ]);
    expect(settlement(beforeWrite)).toBe('fulfilled');
    expect(settlement(firstErase)).toBe('rejected with an Error');
    expect([settlement(lateMeta), settlement(lateJournal)]).toEqual(['rejected with an Error', 'rejected with an Error']);
    // The earlier write was in storage before anything was removed.
    expect(seen.mainAtFirstRemoval ? JSON.parse(seen.mainAtFirstRemoval) : null).toMatchObject({ meta: { before: BEFORE_MARKER } });
    // The erase failed, yet the owner's store holds none of A's state; what storage kept is not pinned.
    expect([await opened.store.getMeta('before'), await opened.store.getMeta('seeded'), await opened.store.loadSnapshotRaw()]).toEqual([null, null, null]);
    expect(seen.writesOnceRemoving).toEqual([]);
    expect(stored(sentinelKeys)).toStrictEqual(sentinelsBefore);

    // Repaired, the same owner retries: the erase completes, and the store still writes nothing.
    repair();
    await expect(opened.eraseAccountData(A)).resolves.toBeUndefined();
    expect(stored(ownKeys)).toEqual([null, null]);
    expect(await opened.raw.readRaw()).toBeNull();
    expect(await opened.journal.load()).toBeNull();
    const afterRetry = await Promise.allSettled([opened.store.setMeta('retried', RETRIED_MARKER), opened.journal.save(RETRIED_JOURNAL)]);
    expect(afterRetry.map(settlement)).toEqual(['rejected with an Error', 'rejected with an Error']);
    expect(stored(ownKeys)).toEqual([null, null]);
    expect(seen.writesOnceRemoving).toEqual([]);
    expect(stored(sentinelKeys)).toStrictEqual(sentinelsBefore);
  } finally {
    opened.release();
  }
});
