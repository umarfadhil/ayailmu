// Regression tests for the guarded side-document save (saveDocGuarded) on the real KvStore and SqlStore.
// The method is not implemented yet, so every case first fails with "saveDocGuarded is missing".
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { openNodeSqlite, type NodeSqliteDb } from '../../../test/nodeSqliteDb';
import { KvStore, memoryKv, type KvBackend } from '../kvStore';
import type { SqlParam } from '../sqlDb';
import { SqlStore } from '../sqlStore';
import type { Learner } from '../types';

type GuardedSave = (name: string, text: string, active: () => boolean) => Promise<boolean>;

/** The method under test, looked up without a type dependency on it; a clear failure while it is missing. */
function guardedSave(store: object): GuardedSave {
  const save = (store as { saveDocGuarded?: GuardedSave }).saveDocGuarded;
  if (typeof save !== 'function') throw new Error(`saveDocGuarded is missing on ${store.constructor.name}`);
  return save.bind(store);
}

const LEARNER: Learner = {
  learner_id: 'learner-1',
  created_at: '2026-10-28T00:00:00.000Z',
  consent_version: 'v1',
  consent_at: '2026-10-28T00:00:00.000Z',
  age_confirmed: true,
  session_minutes: 10,
  arabic_scale: 1,
  screens_seen: ['welcome'],
};

describe('guarded document save: KvStore', () => {
  const DOC = `${KvStore.KEY}/journal`;

  async function openKv(kv: KvBackend) {
    const store = new KvStore(kv);
    await store.init();
    return store;
  }

  it('saves while active and survives a reopen; a guard lost while queued returns false and keeps the old document and main blob', async () => {
    const kv = memoryKv();
    const store = await openKv(kv);
    await store.saveLearner(LEARNER);

    await expect(guardedSave(store)('journal', 'old', () => true)).resolves.toBe(true);
    expect(kv.getItem(DOC)).toBe('old');
    expect(await (await openKv(kv)).loadDoc('journal')).toBe('old');

    const main = kv.getItem(KvStore.KEY);
    let live = true;
    const blocker = store.saveDoc('other', 'x'); // keeps the guarded save waiting in the queue
    const queued = guardedSave(store)('journal', 'new', () => live);
    live = false;
    await blocker;
    await expect(queued).resolves.toBe(false);
    expect(kv.getItem(DOC)).toBe('old');
    expect(kv.getItem(KvStore.KEY)).toBe(main);
    expect(await (await openKv(kv)).getLearner()).toEqual(LEARNER);

    // A storage failure is an error, not a refusal: it rejects and leaves the old document.
    const broken = await openKv({
      ...kv,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    });
    await expect(guardedSave(broken)('journal', 'new', () => true)).rejects.toThrow('quota exceeded');
    expect(kv.getItem(DOC)).toBe('old');
  });

  it('refuses with false and writes nothing when the guard throws or returns anything but true', async () => {
    const kv = memoryKv();
    const store = await openKv(kv);
    await store.saveLearner(LEARNER);
    await store.saveDoc('journal', 'old');
    const main = kv.getItem(KvStore.KEY);

    const guards: Array<() => boolean> = [
      () => {
        throw new Error('guard failed');
      },
      () => 1 as unknown as boolean,
      () => 'true' as unknown as boolean,
      () => ({}) as unknown as boolean,
      () => undefined as unknown as boolean,
    ];
    for (const guard of guards) {
      await expect(guardedSave(store)('journal', 'new', guard)).resolves.toBe(false);
      await expect(guardedSave(store)('fresh', 'new', guard)).resolves.toBe(false);
    }
    expect(kv.getItem(DOC)).toBe('old');
    expect(kv.getItem(`${KvStore.KEY}/fresh`)).toBeNull();
    expect(kv.getItem(KvStore.KEY)).toBe(main);
  });
});

describe('guarded document save: SqlStore', () => {
  let dir = '';
  const opened: NodeSqliteDb[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guarded-docs-'));
  });

  afterEach(() => {
    for (const db of opened.splice(0)) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** A new connection and store on the same synthetic fixture database file. */
  async function openSql() {
    const db = openNodeSqlite(path.join(dir, 'fixture.db'));
    opened.push(db);
    const store = new SqlStore(db);
    await store.init();
    return { db, store };
  }

  const storedDoc = (db: NodeSqliteDb, name: string) =>
    (db.raw.prepare('SELECT json FROM docs WHERE name = ?').get(name) as { json: string } | undefined)?.json ?? null;

  it('saves while active and survives a reopen; a guard lost while queued returns false and keeps the old document', async () => {
    const { db, store } = await openSql();
    await store.saveLearner(LEARNER);

    await expect(guardedSave(store)('journal', 'old', () => true)).resolves.toBe(true);
    expect(storedDoc(db, 'journal')).toBe('old');
    expect(await (await openSql()).store.loadDoc('journal')).toBe('old');

    let live = true;
    const blocker = store.saveDoc('other', 'x'); // keeps the guarded save waiting in the queue
    const queued = guardedSave(store)('journal', 'new', () => live);
    live = false;
    await blocker;
    await expect(queued).resolves.toBe(false);
    expect(storedDoc(db, 'journal')).toBe('old');
    expect(await store.getLearner()).toEqual(LEARNER);
  });

  it('rolls the document back and returns false when the guard is lost after the document INSERT ran', async () => {
    const { db, store } = await openSql();
    await store.saveDoc('journal', 'old');

    let live = true;
    const run = db.run.bind(db);
    db.run = async (sql: string, params?: SqlParam[]) => {
      await run(sql, params);
      if (/^\s*INSERT\b[\s\S]*\bdocs\b/i.test(sql) && params?.includes('new')) live = false;
    };

    await expect(guardedSave(store)('journal', 'new', () => live)).resolves.toBe(false);
    expect(live).toBe(false); // the guard really was lost after the INSERT, not before it
    expect(storedDoc(db, 'journal')).toBe('old');
    expect(await (await openSql()).store.loadDoc('journal')).toBe('old');
  });
});
