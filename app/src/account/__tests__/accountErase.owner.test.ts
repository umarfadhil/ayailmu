// Refusing to erase another account from an opened account dataset, RED (regression-first), one refusal case only.
// The proposed eraseAccountData(accountId), called on account A's dataset, opened as its owner, with account B's
// canonical id, rejects with an Error and leaves storage untouched: no write or removal reaches the backend, on open
// or on the refused erase, and A's, the guest's and B's main blobs and sync journals keep their bytes exactly. The
// real openKvDataset and KvStore run over an in-memory backend, seen through a pass-through recorder of its writes
// and removals, with an owner-lock fixture: no browser, server or network, and every value is synthetic. Invalid
// ids, namespace mutation, lock and storage faults need their own proof; this case covers none of them.
import { accountNamespace, GUEST_NAMESPACE, openKvDataset, type OpenedKvDataset } from '@/account/datasets';
import { memoryKv } from '@/storage/kvStore';
import type { LockManagerLike } from '@/storage/webStore';

/** The proposed erase, typed here before OpenedKvDataset declares it. */
interface ProposedErase {
  eraseAccountData(accountId: string): Promise<void>;
}

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
/** Where a dataset's sync journal is stored beside its main blob. */
const journalKey = (kvKey: string) => `${kvKey}/journal`;

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

/** The seeded backend as the dataset sees it: everything passes through, and each setItem or removeItem is logged. */
function recordingKv(backend: ReturnType<typeof memoryKv>) {
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

it("rejects account A's erase of canonical account B with an Error, writing or removing nothing and keeping all six stored values exactly", async () => {
  // Catches: a missing erase mistaken for a refusal; an erase of an account the dataset does not own that resolves
  // or rejects with anything but an Error; a write or removal reaching storage, on open or on the refused erase; any
  // of A's, the guest's or B's main blobs or journals changed.
  const backend = memoryKv();
  const own = accountNamespace(A);
  const other = accountNamespace(B);
  const blob = { schema: 2, meta: { fixture: 'A' }, learner: null, answers: [], snapshot: null, reports: [] };
  backend.setItem(own.kvKey, JSON.stringify(blob));
  backend.setItem(journalKey(own.kvKey), JOURNAL);
  const sentinelKeys = [GUEST_NAMESPACE.kvKey, journalKey(GUEST_NAMESPACE.kvKey), other.kvKey, journalKey(other.kvKey)];
  for (const key of sentinelKeys) backend.setItem(key, `distinct bytes kept at ${key}`);
  const keys = [own.kvKey, journalKey(own.kvKey), ...sentinelKeys];
  const before = keys.map((key) => backend.getItem(key));
  expect(before).not.toContain(null);

  const { kv, mutations } = recordingKv(backend);
  const opened = await openKvDataset({ kv, locks: ownerLocks(), namespace: own });
  try {
    // A's dataset is opened as its owner, and opening wrote and removed nothing.
    expect(opened.access).toBe('owner');
    expect(mutations).toEqual([]);

    const dataset = opened as OpenedKvDataset & ProposedErase;
    expect(typeof dataset.eraseAccountData).toBe('function');
    const outcome = await dataset.eraseAccountData(B).then(() => 'resolved instead of rejecting', (reason: unknown) => reason);

    expect(outcome).toBeInstanceOf(Error);
    expect(mutations).toEqual([]);
    expect(keys.map((key) => backend.getItem(key))).toStrictEqual(before);
  } finally {
    opened.release();
  }
});
