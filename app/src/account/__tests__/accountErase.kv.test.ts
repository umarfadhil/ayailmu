// Erasing the signed-in account's local web dataset, RED (regression-first), one positive case only. The proposed
// eraseAccountData(accountId) on an opened account dataset removes that account's own main blob and its sync journal
// from storage and leaves none of its learning state cached in the dataset's store, while the guest dataset and another
// account keep their stored bytes exactly. The real openKvDataset and KvStore run over an in-memory backend with an
// owner-lock fixture: no browser, server or network, and every value is synthetic. Refusals (guest, another account, a
// read-only or released store), storage faults, native datasets, controllers and screens need their own proof; this
// case covers none of them.
import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type OpenedKvDataset } from '@/account/datasets';
import { memoryKv } from '@/storage/kvStore';
import type { Learner } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';

/** The proposed erase, typed here before OpenedKvDataset declares it. */
interface ProposedErase {
  eraseAccountData(accountId: string): Promise<void>;
}

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
/** Where a dataset's sync journal is stored beside its main blob. */
const journalKey = (kvKey: string) => `${kvKey}/journal`;

const LEARNER: Learner = {
  learner_id: '7c1e4b2a-5d3f-4a8e-9b6c-0f2d1e3a4b5c',
  created_at: '2026-10-20T08:00:00.000Z',
  consent_version: 'v1',
  consent_at: '2026-10-20T08:00:00.000Z',
  age_confirmed: true,
  session_minutes: 10,
  arabic_scale: 1,
  screens_seen: [],
};
const SNAPSHOT = 'opaque snapshot of account A (fixture)';
const ARCHIVE = JSON.stringify([{ archived_at: '2026-10-20T08:05:00.000Z', reason: 'fixture', raw: 'opaque archived snapshot of account A' }]);
const NOTICE = 'fixture notice for account A';
const JOURNAL = 'opaque journal of account A (fixture)';

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

/** What the dataset's store holds in memory of the seeded learning state. */
async function cached(opened: OpenedKvDataset) {
  return {
    learner: await opened.store.getLearner(),
    snapshot: await opened.store.loadSnapshotRaw(),
    archive: await opened.store.getMeta('snapshot_archive'),
    notice: await opened.store.getMeta('pending_notice'),
  };
}

it("erases account A's own main blob, journal and cached learning state, leaving the guest's and account B's bytes exactly", async () => {
  // Catches: a missing erase; an own key emptied or rewritten instead of removed; a journal left behind; a store that
  // still answers the erased learner, snapshot or notices from memory; a guest or other-account key touched.
  const kv = memoryKv();
  const own = accountNamespace(A);
  const blob = { schema: 2, meta: { snapshot_archive: ARCHIVE, pending_notice: NOTICE }, learner: LEARNER, answers: [], snapshot: SNAPSHOT, reports: [] };
  kv.setItem(own.kvKey, JSON.stringify(blob));
  kv.setItem(journalKey(own.kvKey), JOURNAL);
  const others = [GUEST_NAMESPACE.kvKey, journalKey(GUEST_NAMESPACE.kvKey), accountNamespace(B).kvKey, journalKey(accountNamespace(B).kvKey)];
  for (const key of others) kv.setItem(key, `distinct bytes kept at ${key}`);
  const before = others.map((key) => kv.getItem(key));

  const opened = await openKvDataset({ kv, locks: ownerLocks(), namespace: own });
  try {
    // The seeded dataset is A's own, opened as its owner, and fully loaded.
    expect(opened.access).toBe('owner');
    expect(await cached(opened)).toEqual({ learner: LEARNER, snapshot: SNAPSHOT, archive: ARCHIVE, notice: NOTICE });
    expect(await opened.journal.load()).toBe(JOURNAL);
    expect(await opened.raw.readRaw()).not.toBeNull();

    const dataset = opened as OpenedKvDataset & ProposedErase;
    expect(typeof dataset.eraseAccountData).toBe('function');
    await dataset.eraseAccountData(A);

    expect([kv.getItem(own.kvKey), kv.getItem(journalKey(own.kvKey))]).toEqual([null, null]);
    expect(await opened.raw.readRaw()).toBeNull();
    expect(await opened.journal.load()).toBeNull();
    expect(await cached(opened)).toEqual({ learner: null, snapshot: null, archive: null, notice: null });
    expect(others.map((key) => kv.getItem(key))).toStrictEqual(before);
  } finally {
    opened.release();
  }
});
