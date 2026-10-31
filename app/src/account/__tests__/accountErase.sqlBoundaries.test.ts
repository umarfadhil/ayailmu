/**
 * @jest-environment node
 */
// Boundaries of erasing an account's local native dataset, on the real openSqlDataset and SqlStore over in-memory
// node:sqlite databases. An empty account A dataset, freshly opened and so without a side-document table, is erased:
// reads answer nothing, its schema version stays exactly as it was, no docs table appears, and the ordinary metadata,
// journal and init() writes that follow are refused without bringing anything in. The native wiring of the shared
// namespace guard refuses, with an Error and without a single write or transaction reaching SQLite, the guest dataset
// asked to erase account A and account A's dataset asked to erase account B, leaving every row exactly as it was. No
// device, server or network; every value is synthetic, and only rows are proven: nothing here is a claim about
// database pages, WAL files or device storage. The shared namespace checks are covered in full by
// accountErase.boundaries.test.ts, and storage faults by accountErase.sqlFailures.test.ts.
import { accountNamespace, GUEST_NAMESPACE, openSqlDataset, type Namespace, type OpenedSqlDataset } from '@/account/datasets';
import type { SqlDb, SqlParam } from '@/storage/sqlDb';
import { SqlStore } from '@/storage/sqlStore';
import { openNodeSqlite, type NodeSqliteDb } from '../../../test/nodeSqliteDb';

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
const META_TEXT = 'opaque metadata of the dataset (fixture)';
const DOC_TEXT = 'opaque journal of the dataset (fixture)';
const LATER_TEXT = 'written after the erase (fixture)';

/** The tables in `db`, read directly from sqlite_master. */
const tablesOf = (db: NodeSqliteDb) => (db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map(({ name }) => name);

/** Every row of every table in `db`, read directly in rowid order, as plain values. */
function rowsOf(db: NodeSqliteDb): Record<string, unknown[]> {
  return JSON.parse(JSON.stringify(Object.fromEntries(tablesOf(db).map((name) => [name, db.raw.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))));
}

/** The technical schema-version rows of `db`'s metadata, read directly. */
const schemaRows = (db: NodeSqliteDb) => (rowsOf(db).meta ?? []).filter((row) => (row as { key?: unknown }).key === 'schema_version');

/** What a dataset answers through its learning store, its raw export and its journal. */
async function surfaces({ store, raw, journal }: OpenedSqlDataset) {
  return {
    learner: await store.getLearner(),
    answers: await store.listAnswers(),
    snapshot: await store.loadSnapshotRaw(),
    reports: await store.listReports(),
    raw: await raw.readRaw(),
    journal: await journal.load(),
  };
}

/** How a promise settled, without the wording of any rejection. */
function settlement(result: PromiseSettledResult<unknown>): string {
  if (result.status === 'fulfilled') return 'fulfilled';
  return result.reason instanceof Error ? 'rejected with an Error' : 'rejected with a non-Error';
}

/**
 * A database as its store sees it: everything passes straight through to the real adapter, and once `arm` is called
 * each write (run, exec) and each transaction is logged. Reads are not.
 */
function recordingDb(real: NodeSqliteDb) {
  let armed = false;
  const calls: string[] = [];
  const log = (call: string) => {
    if (armed) calls.push(call);
  };
  const db: SqlDb = {
    exec: (sql) => {
      log(`exec ${sql.trim()}`);
      return real.exec(sql);
    },
    run: (sql, params) => {
      log(`run ${sql.trim()}`);
      return real.run(sql, params);
    },
    all<T>(sql: string, params?: SqlParam[]) {
      return real.all<T>(sql, params);
    },
    transaction: (fn) => {
      log('transaction');
      return real.transaction(fn);
    },
  };
  return {
    db,
    calls,
    arm() {
      armed = true;
    },
  };
}

it('erases a freshly opened account A dataset that holds nothing and has no side-document table, keeping its schema version', async () => {
  // Catches: an erase that fails without a docs table, or creates one; a schema version removed or changed; a later
  // metadata, journal or init() write that lands or brings in a row or a table; reads that stop answering.
  const db = openNodeSqlite(':memory:');
  try {
    const a = await openSqlDataset(db, accountNamespace(A));
    expect(tablesOf(db)).not.toContain('docs');
    const schemaVersion = schemaRows(db);
    expect(schemaVersion).toHaveLength(1);
    const before = rowsOf(db);

    expect(typeof a.eraseAccountData).toBe('function');
    await a.eraseAccountData(A);

    const empty = { learner: null, answers: [], snapshot: null, reports: [], raw: null, journal: null };
    expect(await surfaces(a)).toEqual(empty);
    expect(schemaRows(db)).toEqual(schemaVersion);
    expect(tablesOf(db)).not.toContain('docs');
    expect(rowsOf(db)).toEqual(before);

    // Ordinary later writes are refused and bring nothing in; reads still answer.
    const later = await Promise.allSettled([a.store.setMeta('later', LATER_TEXT), a.journal.save(LATER_TEXT), a.store.init()]);
    expect(later.map(settlement)).toEqual(['rejected with an Error', 'rejected with an Error', 'rejected with an Error']);
    expect(await surfaces(a)).toEqual(empty);
    expect(schemaRows(db)).toEqual(schemaVersion);
    expect(tablesOf(db)).not.toContain('docs');
    expect(rowsOf(db)).toEqual(before);
  } finally {
    db.close();
  }
});

const REFUSALS: readonly { name: string; namespace: Namespace; eraseId: string }[] = [
  { name: "the guest dataset's erase of account A", namespace: GUEST_NAMESPACE, eraseId: A },
  { name: "account A's dataset's erase of account B", namespace: accountNamespace(A), eraseId: B },
];

it.each(REFUSALS)('refuses $name with an Error, without a single write or transaction reaching SQLite', async ({ namespace, eraseId }) => {
  // Catches: a missing erase mistaken for a refusal; a native erase that ignores the dataset's namespace, or resolves
  // or rejects with anything but an Error; any write or transaction reaching the database; any stored row changed.
  const real = openNodeSqlite(':memory:');
  try {
    const recorder = recordingDb(real);
    const opened = await openSqlDataset(recorder.db, namespace);
    expect(opened.store).toBeInstanceOf(SqlStore);
    const store = opened.store as SqlStore;
    // Seeded through the real store; the guest's public journal refuses writes, so the document goes through saveDoc.
    await store.setMeta('fixture', META_TEXT);
    await store.saveDoc('journal', DOC_TEXT);
    expect([await store.getMeta('fixture'), await store.loadDoc('journal')]).toEqual([META_TEXT, DOC_TEXT]);
    const before = rowsOf(real);
    expect(JSON.stringify(before)).toContain(META_TEXT);
    expect(JSON.stringify(before)).toContain(DOC_TEXT);
    recorder.arm();

    expect(typeof opened.eraseAccountData).toBe('function');
    const outcome = await opened.eraseAccountData(eraseId).then(() => 'resolved instead of rejecting', (reason: unknown) => reason);

    expect(outcome).toBeInstanceOf(Error);
    expect(recorder.calls).toEqual([]);
    expect(rowsOf(real)).toEqual(before);
    // Reads still answer, from the rows as they were.
    expect([await store.getMeta('fixture'), await store.loadDoc('journal')]).toEqual([META_TEXT, DOC_TEXT]);
  } finally {
    real.close();
  }
});
