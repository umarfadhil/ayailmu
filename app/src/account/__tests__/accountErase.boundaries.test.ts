// Boundaries of erasing an account's local web dataset: which opened datasets may erase, which namespace an erase acts
// on, and which store it goes through. One parameterized case refuses the erase, with an Error and without writing or
// removing anything, for an ID that is not canonical, the guest dataset, A's names mixed with the guest's or account
// B's writer lock or SQLite file, no Web Locks, a released owner and a second tab still read-only. One case changes the
// caller's namespace object while the open is pending: the writer lock, raw surface, journal and erase stay A's. One
// case erases after a takeover, through the store the takeover made writable, which then refuses every later write.
// The real openKvDataset and KvStore run over an in-memory backend with keyed FIFO Web Locks: no browser, server or
// network, and every value is synthetic. Another account's canonical ID is covered by accountErase.owner.test.ts,
// storage faults and queued writes by accountErase.retirement.test.ts; native datasets, controllers and screens need
// their own proof.
import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type Namespace, type OpenedKvDataset } from '@/account/datasets';
import { memoryKv, type KvBackend } from '@/storage/kvStore';
import { READ_ONLY_NO_LOCKS, READ_ONLY_OTHER_TAB, type LockManagerLike } from '@/storage/webStore';

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
const NS_A = accountNamespace(A);
const NS_B = accountNamespace(B);
/** Where a dataset's sync journal is stored beside its main blob. */
const journalKey = (kvKey: string) => `${kvKey}/journal`;
/** Account A's main blob and journal. */
const A_KEYS = [NS_A.kvKey, journalKey(NS_A.kvKey)];
/** The guest's and account B's main blobs and journals. */
const OTHER_KEYS = [GUEST_NAMESPACE.kvKey, journalKey(GUEST_NAMESPACE.kvKey), NS_B.kvKey, journalKey(NS_B.kvKey)];

const seededMeta = (owner: string) => `seeded metadata of ${owner}`;
const seededJournal = (owner: string) => `opaque journal of ${owner} (fixture)`;
const TAKEN_MARKER = 'written by the tab that took over (fixture)';
const LATER_MARKER = 'written after the erase (fixture)';
const LATER_JOURNAL = 'opaque journal saved after the erase (fixture)';

/** A fresh backend holding account A's, the guest's and account B's datasets: a valid schema-2 main blob and a journal each. */
function seededBackend(): KvBackend {
  const backend = memoryKv();
  for (const { kvKey, owner } of [
    { kvKey: NS_A.kvKey, owner: 'account A' },
    { kvKey: GUEST_NAMESPACE.kvKey, owner: 'the guest' },
    { kvKey: NS_B.kvKey, owner: 'account B' },
  ]) {
    const blob = { schema: 2, meta: { fixture: seededMeta(owner) }, learner: null, answers: [], snapshot: `opaque snapshot of ${owner} (fixture)`, reports: [] };
    backend.setItem(kvKey, JSON.stringify(blob));
    backend.setItem(journalKey(kvKey), seededJournal(owner));
  }
  return backend;
}

/** navigator.locks of one browser profile: exclusive locks by name, ifAvailable, FIFO waiters. */
function namedLocks(): LockManagerLike & { held(name: string): boolean } {
  const holders = new Set<string>();
  const queues = new Map<string, (() => void)[]>();
  return {
    held: (name) => holders.has(name),
    async request(name, options, cb) {
      if (holders.has(name)) {
        if (options.ifAvailable) return cb(null);
        await new Promise<void>((grant) => queues.set(name, [...(queues.get(name) ?? []), grant]));
      } else {
        holders.add(name);
      }
      try {
        return await cb({ name });
      } finally {
        const next = queues.get(name)?.shift();
        if (next) next(); // handed straight to the next waiter
        else holders.delete(name);
      }
    },
  };
}

/** The seeded backend as the datasets see it: everything passes through, and each setItem or removeItem is logged. */
function recordingKv(backend: KvBackend) {
  const mutations: string[] = [];
  const kv = new Proxy(backend, {
    get(target, name) {
      const member: unknown = Reflect.get(target, name);
      if (typeof member !== 'function') return member;
      return (...args: unknown[]): unknown => {
        if (name === 'setItem' || name === 'removeItem') mutations.push(`${name} ${String(args[0])}`);
        return Reflect.apply(member, target, args);
      };
    },
  });
  return { kv, mutations };
}

/** Lets released locks and queued revocations settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** How the dataset asked to erase is opened: as its writer lock's owner, without Web Locks, released, or as a second tab. */
type Lifecycle = 'owner' | 'no Web Locks' | 'released owner' | 'second tab';

const REFUSALS: readonly { name: string; namespace: Namespace; eraseId: string; lifecycle: Lifecycle }[] = [
  { name: "A's ID in upper case, not a canonical account UUID", namespace: NS_A, eraseId: A.toUpperCase(), lifecycle: 'owner' },
  { name: 'the guest dataset itself', namespace: GUEST_NAMESPACE, eraseId: A, lifecycle: 'owner' },
  { name: "A's names with the guest's writer lock", namespace: { ...NS_A, writerLock: GUEST_NAMESPACE.writerLock }, eraseId: A, lifecycle: 'owner' },
  { name: "A's names with the guest's SQLite file", namespace: { ...NS_A, sqliteFile: GUEST_NAMESPACE.sqliteFile }, eraseId: A, lifecycle: 'owner' },
  { name: "A's names with B's storage key", namespace: { ...NS_A, kvKey: NS_B.kvKey }, eraseId: A, lifecycle: 'owner' },
  { name: "A's names with B's writer lock", namespace: { ...NS_A, writerLock: NS_B.writerLock }, eraseId: A, lifecycle: 'owner' },
  { name: "A's names with B's SQLite file", namespace: { ...NS_A, sqliteFile: NS_B.sqliteFile }, eraseId: A, lifecycle: 'owner' },
  { name: "A's dataset without Web Locks", namespace: NS_A, eraseId: A, lifecycle: 'no Web Locks' },
  { name: "A's owner, released before the erase", namespace: NS_A, eraseId: A, lifecycle: 'released owner' },
  { name: "A's second tab, still read-only", namespace: NS_A, eraseId: A, lifecycle: 'second tab' },
];

it.each(REFUSALS)('refuses the erase with an Error, writing and removing nothing, for $name', async ({ namespace, eraseId, lifecycle }) => {
  // Catches: an erase let through by an invalid ID, by the guest's or another account's name in the dataset's
  // namespace, or by a store that does not hold the writer lock; a refusal that resolves, rejects with a non-Error, or
  // reaches storage, on open or on the erase; any seeded value changed.
  const backend = seededBackend();
  const seeded = [...A_KEYS, ...OTHER_KEYS];
  const keys = [...new Set([...seeded, namespace.kvKey, journalKey(namespace.kvKey)])];
  expect(seeded.map((key) => backend.getItem(key))).not.toContain(null);
  const before = keys.map((key) => backend.getItem(key));
  const { kv, mutations } = recordingKv(backend);
  const locks = namedLocks();
  const handles: OpenedKvDataset[] = [];
  const open = async (withLocks: LockManagerLike | undefined) => {
    const opened = await openKvDataset({ kv, locks: withLocks, namespace });
    handles.push(opened);
    return opened;
  };
  try {
    let dataset: OpenedKvDataset;
    if (lifecycle === 'no Web Locks') {
      dataset = await open(undefined);
      expect([dataset.access, dataset.reason]).toEqual(['read-only', READ_ONLY_NO_LOCKS]);
    } else if (lifecycle === 'second tab') {
      const first = await open(locks);
      dataset = await open(locks);
      // The first tab owns the writer lock; this one only reads.
      expect([first.access, dataset.access, dataset.reason, locks.held(namespace.writerLock)]).toEqual(['owner', 'read-only', READ_ONLY_OTHER_TAB, true]);
    } else {
      dataset = await open(locks);
      expect(dataset.access).toBe('owner');
      if (lifecycle === 'released owner') {
        dataset.release();
        await settle();
      }
      // An owner holds its writer lock until it releases it.
      expect(locks.held(namespace.writerLock)).toBe(lifecycle === 'owner');
    }
    // Opening, and releasing, wrote and removed nothing.
    expect(mutations).toEqual([]);

    expect(typeof dataset.eraseAccountData).toBe('function');
    const outcome = await dataset.eraseAccountData(eraseId).then(() => 'resolved instead of rejecting', (reason: unknown) => reason);

    expect(outcome).toBeInstanceOf(Error);
    expect(mutations).toEqual([]);
    expect(keys.map((key) => backend.getItem(key))).toStrictEqual(before);
  } finally {
    for (const handle of handles) handle.release();
  }
});

it("erases account A by the namespace it was opened with, though the caller turned its namespace object into B's before the open settled", async () => {
  // Catches: a namespace read after the open's first await, so that the writer lock, the raw surface, the journal or
  // the erase follow the caller's later change; an erase that leaves A's main blob, journal or cached state; a guest
  // or B key touched.
  const backend = seededBackend();
  const othersBefore = OTHER_KEYS.map((key) => backend.getItem(key));
  const locks = namedLocks();
  const callerNamespace: Namespace = { ...NS_A };
  const opening = openKvDataset({ kv: backend, locks, namespace: callerNamespace });
  Object.assign(callerNamespace, NS_B);
  const opened = await opening;
  try {
    expect(callerNamespace).toEqual(NS_B);
    expect(opened.access).toBe('owner');
    expect([locks.held(NS_A.writerLock), locks.held(NS_B.writerLock)]).toEqual([true, false]);
    expect(opened.raw.namespace).toEqual(NS_A);
    expect(await opened.store.getMeta('fixture')).toBe(seededMeta('account A'));
    expect(await opened.journal.load()).toBe(seededJournal('account A'));

    expect(typeof opened.eraseAccountData).toBe('function');
    await opened.eraseAccountData(A);

    expect(A_KEYS.map((key) => backend.getItem(key))).toEqual([null, null]);
    expect([await opened.store.getMeta('fixture'), await opened.store.loadSnapshotRaw()]).toEqual([null, null]);
    expect(await opened.raw.readRaw()).toBeNull();
    expect(await opened.journal.load()).toBeNull();
    expect(opened.raw.namespace).toEqual(NS_A);
    expect(OTHER_KEYS.map((key) => backend.getItem(key))).toStrictEqual(othersBefore);
  } finally {
    opened.release();
  }
});

it("erases account A through the store a takeover made writable, which then refuses every later write; the guest's and B's bytes stay exact", async () => {
  // Catches: an erase that goes through the tab's original read-only store instead of the store its takeover made
  // writable; a taken store that still answers erased state from memory or writes again; a guest or B key touched.
  // The original read-only store is historical: what it still holds in memory is not checked.
  const backend = seededBackend();
  const othersBefore = OTHER_KEYS.map((key) => backend.getItem(key));
  const locks = namedLocks();
  const first = await openKvDataset({ kv: backend, locks, namespace: NS_A });
  const second = await openKvDataset({ kv: backend, locks, namespace: NS_A });
  try {
    expect([first.access, second.access]).toEqual(['owner', 'read-only']);
    expect(typeof second.whenWritable).toBe('function');
    // The second tab queues for the writer lock and, once the owner releases it, takes over with a fresh store.
    const takeover = second.whenWritable!();
    first.release();
    const taken = await takeover;
    expect(await taken.getMeta('fixture')).toBe(seededMeta('account A'));
    await taken.setMeta('taken', TAKEN_MARKER);
    expect((await second.raw.readRaw())?.meta.taken).toBe(TAKEN_MARKER);

    expect(typeof second.eraseAccountData).toBe('function');
    await second.eraseAccountData(A);

    expect(A_KEYS.map((key) => backend.getItem(key))).toEqual([null, null]);
    expect(await second.raw.readRaw()).toBeNull();
    expect(await second.journal.load()).toBeNull();
    expect([await taken.getMeta('taken'), await taken.getMeta('fixture'), await taken.loadSnapshotRaw()]).toEqual([null, null, null]);
    const later = await Promise.allSettled([taken.setMeta('later', LATER_MARKER), second.journal.save(LATER_JOURNAL)]);
    expect(later.map((result) => result.status === 'rejected' && result.reason instanceof Error)).toEqual([true, true]);
    expect(A_KEYS.map((key) => backend.getItem(key))).toEqual([null, null]);
    expect(OTHER_KEYS.map((key) => backend.getItem(key))).toStrictEqual(othersBefore);
  } finally {
    first.release();
    second.release();
  }
});
