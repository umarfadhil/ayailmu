// Local datasets: the guest dataset exactly where earlier versions of the app keep it, plus one separate dataset
// per verified server account. Account work never writes the guest dataset. Guest data reaches an account only
// through an explicit, affirmative copy, which keeps the guest originals exactly as they are.
import { isCanonicalUuid } from '@/account/ids';
import { KvStore, readKvRaw, type KvBackend } from '@/storage/kvStore';
import type { CopyResult, RawDataset } from '@/storage/rawRecords';
import type { SqlDb } from '@/storage/sqlDb';
import { readSqlRaw, SqlStore } from '@/storage/sqlStore';
import type { Store } from '@/storage/types';
import { openWebStore, WRITER_LOCK, type LockManagerLike, type OpenedWebStore } from '@/storage/webStore';

export type { CopyResult, RawDataset, RawRecord } from '@/storage/rawRecords';

/** Where one dataset lives: its web storage key and writer lock, and its native SQLite file name. */
export interface Namespace {
  kvKey: string;
  writerLock: string;
  sqliteFile: string;
}

/** The guest dataset, exactly where earlier versions of the app keep it. */
export const GUEST_NAMESPACE: Namespace = Object.freeze({ kvKey: KvStore.KEY, writerLock: WRITER_LOCK, sqliteFile: 'arabic-trial.db' });

export type DatasetErrorCode =
  /** Not a canonical account UUID from the verified server account. */
  | 'invalid_account'
  /** No explicit, affirmative consent to copy guest data. */
  | 'consent_required'
  /** The guest dataset is never a copy target, and never erased as an account's. */
  | 'guest_read_only'
  /** Only guest data may be copied into an account: accounts are never merged. An account erases only its own dataset. */
  | 'cross_account';

export class DatasetError extends Error {
  constructor(readonly code: DatasetErrorCode) {
    super(`Local dataset refused: ${code}`);
    this.name = 'DatasetError';
  }
}

/**
 * The dataset of one verified server account ID. Only the canonical UUID the account API returns is accepted, so
 * one account has exactly one dataset and no address, uid, learner ID or path can name one.
 */
export function accountNamespace(accountId: string): Namespace {
  if (!isCanonicalUuid(accountId)) throw new DatasetError('invalid_account');
  return Object.freeze({
    kvKey: `arabic-trial-app/account/${accountId}/v1`,
    writerLock: `arabic-trial-app/account/${accountId}/writer`,
    sqliteFile: `arabic-trial-account-${accountId}.db`,
  });
}

/** Sharing any name with the guest dataset makes a namespace the guest's. */
const isGuest = (ns: Namespace): boolean =>
  ns.kvKey === GUEST_NAMESPACE.kvKey || ns.writerLock === GUEST_NAMESPACE.writerLock || ns.sqliteFile === GUEST_NAMESPACE.sqliteFile;

/** The learner's explicit, affirmative choice to copy guest data into the signed-in account. */
export interface GuestCopyConsent {
  copyGuestData: true;
  at: string;
}

/** Affirmative means exactly `copyGuestData: true` with the time it was given; nothing merely truthy counts. */
const isConsent = (consent: unknown): consent is GuestCopyConsent => {
  if (typeof consent !== 'object' || consent === null) return false;
  const { copyGuestData, at } = consent as { copyGuestData?: unknown; at?: unknown };
  return copyGuestData === true && typeof at === 'string' && at !== '';
};

/** A dataset's records, read-only. */
export interface RawSource {
  readonly namespace: Namespace;
  /** Every record exactly as stored, as fresh values; null when the dataset holds nothing. */
  readRaw(): Promise<RawDataset | null>;
}

/**
 * The raw surface of an opened dataset. It writes through that dataset's learning store, with the same writer
 * guard, queue and state, so neither can overwrite the other.
 */
export interface RawTarget extends RawSource {
  /**
   * Adds the records the dataset lacks in one atomic write. What the dataset already has is kept as it is, and a
   * copy that adds nothing writes nothing. Refused without consent, and for the guest dataset.
   */
  addCopy(copy: RawDataset, consent: GuestCopyConsent): Promise<CopyResult>;
}

/** The two learning stores (KvStore, SqlStore), as far as raw export, copy and the journal document are concerned. */
interface RawCapableStore {
  readRaw(): Promise<RawDataset | null>;
  addCopy(copy: RawDataset): Promise<CopyResult>;
  loadDoc(name: string): Promise<string | null>;
  saveDoc(name: string, text: string): Promise<void>;
}

/** The name of the sync journal's document beside an account dataset. */
const JOURNAL_DOC = 'journal';

/** The raw surface of an opened dataset: every call goes to `store()`, the dataset's current learning store. */
function rawTarget(namespace: Namespace, store: () => RawCapableStore): RawTarget {
  const ns: Namespace = Object.freeze({ ...namespace });
  return {
    namespace: ns,
    readRaw: () => store().readRaw(),
    async addCopy(copy, consent) {
      if (!isConsent(consent)) throw new DatasetError('consent_required');
      if (isGuest(ns)) throw new DatasetError('guest_read_only');
      return store().addCopy(copy);
    },
  };
}

/** Reads a web dataset's records exactly as stored; never writes. */
export function kvRawSource(kv: KvBackend, namespace: Namespace): RawSource {
  const ns: Namespace = Object.freeze({ ...namespace });
  return { namespace: ns, readRaw: async () => readKvRaw(kv, ns.kvKey) };
}

/** Reads a native dataset's records exactly as stored; never writes. */
export function sqlRawSource(db: SqlDb, namespace: Namespace): RawSource {
  const ns: Namespace = Object.freeze({ ...namespace });
  return { namespace: ns, readRaw: () => readSqlRaw(db) };
}

/** An account dataset's one durable sync-journal document, written through the same writer guard as its learning store. */
export interface JournalStorage {
  load(): Promise<string | null>;
  /** Replaces the document in one atomic write. */
  save(text: string): Promise<void>;
}

/** The journal document of an opened dataset, through its current store. The guest dataset never has one. */
function journalStorage(namespace: Namespace, store: () => RawCapableStore): JournalStorage {
  const guest = isGuest(namespace);
  return {
    load: () => (guest ? Promise.resolve(null) : store().loadDoc(JOURNAL_DOC)),
    save: (text) => (guest ? Promise.reject(new DatasetError('guest_read_only')) : store().saveDoc(JOURNAL_DOC, text)),
  };
}

/** A learning store as far as erasing its dataset is concerned. */
interface ErasableStore {
  /** Removes the side documents `docs` and then the dataset itself from storage. */
  erase(docs: readonly string[]): Promise<void>;
}

/**
 * The erase of an opened dataset, through its current store. Refused before anything is touched for the guest
 * dataset, for an ID that is not a canonical account UUID, and for every account but the one whose storage key,
 * writer lock and SQLite file are exactly this dataset's.
 */
function accountErase(namespace: Namespace, store: () => ErasableStore): (accountId: string) => Promise<void> {
  const ns: Namespace = Object.freeze({ ...namespace });
  return async (accountId) => {
    if (isGuest(ns)) throw new DatasetError('guest_read_only');
    const requested = accountNamespace(accountId);
    if (requested.kvKey !== ns.kvKey || requested.writerLock !== ns.writerLock || requested.sqliteFile !== ns.sqliteFile) {
      throw new DatasetError('cross_account');
    }
    return store().erase([JOURNAL_DOC]);
  };
}

export interface OpenedKvDataset extends OpenedWebStore {
  /** Writes through this tab's current learning store: a read-only or released store refuses here too. */
  raw: RawTarget;
  /** The sync journal's document, under the same writer as `raw`. */
  journal: JournalStorage;
  /**
   * Erases the dataset of its own account `accountId` from this browser: its main blob and sync journal are removed
   * from storage through this tab's current writable store (the one opened as owner, or the one a takeover returned).
   * Once the erase begins, that store's cached learning state is cleared and the store is retired: it writes nothing
   * more, even if the erase then fails. No other copy in memory is cleared: neither `store` after a takeover nor any
   * other tab's. Refused for the guest dataset, an invalid ID or another account, and (like `raw`) by a read-only or
   * released store, all before anything is touched. Resolves only once both are gone; a storage failure part-way
   * rejects, with nothing rolled back.
   */
  eraseAccountData(accountId: string): Promise<void>;
}

/** Opens a web dataset with its own writer lock, under the same single-writer rules as the guest store. */
export async function openKvDataset({ kv, locks, namespace }: { kv: KvBackend; locks: LockManagerLike | undefined; namespace: Namespace }): Promise<OpenedKvDataset> {
  // Copied before anything is awaited: a later change to the caller's namespace redirects none of this dataset's surfaces.
  const ns: Namespace = Object.freeze({ ...namespace });
  const opened = await openWebStore({ kv, locks, key: ns.kvKey, lock: ns.writerLock });
  // This tab's current store: the one opened now, or the one a takeover makes writable later.
  let current: KvStore = opened.store;
  const dataset: OpenedKvDataset = {
    ...opened,
    raw: rawTarget(ns, () => current),
    journal: journalStorage(ns, () => current),
    eraseAccountData: accountErase(ns, () => current),
  };
  if (opened.whenWritable) {
    dataset.whenWritable = async () => {
      const store = await opened.whenWritable!();
      current = store;
      return store;
    };
  }
  return dataset;
}

export interface OpenedSqlDataset {
  store: Store;
  raw: RawTarget;
  /** The sync journal's document, in the same database and queue as `store`. */
  journal: JournalStorage;
}

/** An account dataset opened for this app run (web or native), with its writer state and its release. */
export interface OpenedAccountDataset {
  store: Store;
  raw: RawTarget;
  journal: JournalStorage;
  access: 'owner' | 'read-only';
  /** Why the dataset is read-only here (shown to the learner). */
  reason?: string;
  release(): void;
  /** Erases this account's own dataset from this device, as OpenedKvDataset.eraseAccountData does; absent where unsupported. */
  eraseAccountData?(accountId: string): Promise<void>;
}

/** Opens a native dataset's SQLite database as a learning store with its raw surface (one store, one queue). */
export async function openSqlDataset(db: SqlDb, namespace: Namespace): Promise<OpenedSqlDataset> {
  const store = new SqlStore(db);
  await store.init();
  return { store, raw: rawTarget(namespace, () => store), journal: journalStorage(namespace, () => store) };
}

/**
 * Copies the guest dataset into an account dataset, only with the learner's affirmative consent. The guest dataset
 * is only read; records the account already has are kept; nothing is written when nothing is missing.
 */
export async function copyGuestToAccount({ from, to, consent }: { from: RawSource; to: RawTarget; consent: GuestCopyConsent | null }): Promise<CopyResult> {
  if (!isConsent(consent)) throw new DatasetError('consent_required');
  if (!isGuest(from.namespace)) throw new DatasetError('cross_account');
  if (isGuest(to.namespace)) throw new DatasetError('guest_read_only');
  const guest = await from.readRaw();
  if (!guest) return { answers: 0, reports: 0 };
  return to.addCopy(guest, consent);
}
