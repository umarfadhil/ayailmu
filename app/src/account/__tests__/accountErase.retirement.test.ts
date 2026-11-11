// Erasing the signed-in account's local web dataset while writes are queued around it, and while its removals fail:
// focused coverage of the erase core, one parameterized case over five storage modes run through one pipeline. A
// write queued before eraseAccountData(A) lands; the erase fulfils only when account A's main blob and sync journal
// are really gone from storage, and rejects with an Error when removeItem throws for either key or silently keeps it;
// the two ordinary writes queued behind the erase are refused in every mode and change none of A's stored values; the
// guest's and account B's stored bytes stay exact. The real openKvDataset and KvStore run over an in-memory backend,
// seen through a pass-through wrapper that injects the removal fault after opening, with an owner-lock fixture: no
// browser, server or network, and every value is synthetic. The order of removals, and what else a failed erase
// leaves, are not pinned. Namespace checks, read-only and released stores, native datasets, controllers and screens
// need their own proof.
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

/** A fault in removing one of A's keys: removeItem throws, or returns as if it removed the value and keeps it. */
interface RemoveFault {
  target: 'main' | 'journal';
  kind: 'throws' | 'ignores';
}

const MODES: readonly { name: string; fault: RemoveFault | null }[] = [
  { name: 'every removal succeeds', fault: null },
  { name: "removeItem throws for A's main blob", fault: { target: 'main', kind: 'throws' } },
  { name: "removeItem throws for A's journal", fault: { target: 'journal', kind: 'throws' } },
  { name: "removeItem silently keeps A's main blob", fault: { target: 'main', kind: 'ignores' } },
  { name: "removeItem silently keeps A's journal", fault: { target: 'journal', kind: 'ignores' } },
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
 * The seeded backend as the dataset sees it: every read, write and removal passes straight through until `arm` aims a
 * removal fault at one key. Each write to a `watched` key once a removal of any of them has been attempted is logged.
 */
function faultyRemovalKv(backend: KvBackend, watched: readonly string[]) {
  let armed: { key: string; kind: RemoveFault['kind'] } | null = null;
  let removing = false;
  const writesOnceRemoving: string[] = [];
  const kv: KvBackend = {
    getItem: (key) => backend.getItem(key),
    setItem: (key, value) => {
      if (removing && watched.includes(key)) writesOnceRemoving.push(key);
      backend.setItem(key, value);
    },
    removeItem: (key) => {
      if (watched.includes(key)) removing = true;
      const fault = armed !== null && armed.key === key ? armed.kind : null;
      if (fault === 'throws') throw new Error('Injected removeItem fault (fixture)');
      // 'ignores' returns as if the value were removed, and keeps it.
      if (fault !== 'ignores') backend.removeItem(key);
    },
  };
  return {
    kv,
    writesOnceRemoving,
    arm(key: string, kind: RemoveFault['kind']) {
      armed = { key, kind };
    },
  };
}

/** How a promise settled, without the wording of any rejection. */
function settlement(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'fulfilled';
  return result.reason instanceof Error ? 'rejected with an Error' : 'rejected with a non-Error';
}

it.each(MODES)("retires the writes queued behind account A's erase and settles the erase truthfully when $name", async ({ fault }) => {
  // Catches: an erase that trusts removeItem, or reports success over a fault; a write queued behind the erase that
  // lands, or brings back or rewrites any of A's stored values, before or after the erase settles; a write queued
  // before the erase that fails, or that stays cached after a successful erase; a guest or account B key touched.
  const backend = memoryKv();
  const own = accountNamespace(A);
  const ownKeys = { main: own.kvKey, journal: journalKey(own.kvKey) };
  backend.setItem(ownKeys.main, JSON.stringify(SEEDED_BLOB));
  backend.setItem(ownKeys.journal, SEEDED_JOURNAL);
  const sentinelKeys = [GUEST_NAMESPACE.kvKey, journalKey(GUEST_NAMESPACE.kvKey), accountNamespace(B).kvKey, journalKey(accountNamespace(B).kvKey)];
  for (const key of sentinelKeys) backend.setItem(key, `distinct bytes kept at ${key}`);
  const sentinelsBefore = sentinelKeys.map((key) => backend.getItem(key));
  // A's main blob and journal exactly as stored, read past the wrapper.
  const ownStored = () => [backend.getItem(ownKeys.main), backend.getItem(ownKeys.journal)];

  const { kv, arm, writesOnceRemoving } = faultyRemovalKv(backend, [ownKeys.main, ownKeys.journal]);
  const opened = await openKvDataset({ kv, locks: ownerLocks(), namespace: own });
  try {
    expect(opened.access).toBe('owner');
    expect(typeof opened.eraseAccountData).toBe('function');
    if (fault) arm(ownKeys[fault.target], fault.kind);

    // The same pipeline in every mode: a write queued before the erase, the erase, and two ordinary writes queued
    // behind it at once, without waiting for it. Every promise is handled from the start, and A's stored values are
    // captured the moment the erase settles.
    let ownWhenErased: (string | null)[] | undefined;
    const [beforeWrite, erase, lateMeta, lateJournal] = await Promise.allSettled([
      opened.store.setMeta('before', BEFORE_MARKER),
      opened.eraseAccountData(A).finally(() => {
        ownWhenErased = ownStored();
      }),
      opened.store.setMeta('late', LATE_MARKER),
      opened.journal.save(LATE_JOURNAL),
    ]);

    expect(settlement(beforeWrite)).toBe('fulfilled');
    expect(settlement(erase)).toBe(fault ? 'rejected with an Error' : 'fulfilled');
    expect([settlement(lateMeta), settlement(lateJournal)]).toEqual(['rejected with an Error', 'rejected with an Error']);
    // The erase fulfils exactly when A's main blob and journal are both gone; a faulted key is still there.
    expect(ownWhenErased?.every((value) => value === null)).toBe(fault === null);
    // Nothing queued behind the erase brings back or rewrites any of A's values. The capture can come after the first
    // late write's turn in the queue, so every write to A's keys once removal began is logged as well.
    expect(ownStored()).toStrictEqual(ownWhenErased);
    expect(writesOnceRemoving).toEqual([]);
    expect(sentinelKeys.map((key) => backend.getItem(key))).toStrictEqual(sentinelsBefore);
    if (fault === null) {
      // Erased: nothing read back from storage, and neither marker answered from memory.
      expect(await opened.raw.readRaw()).toBeNull();
      expect(await opened.journal.load()).toBeNull();
      expect([await opened.store.getMeta('before'), await opened.store.getMeta('late')]).toEqual([null, null]);
    }
  } finally {
    opened.release();
  }
});
