/**
 * @jest-environment node
 */
// A failed erase of the signed-in account's local native dataset, and its retry on the same opened owner: one
// parameterized case, two faults injected into the DELETE statements that reach account A's database, whatever their
// table or order (the second one throws; the first one is silently skipped). A write queued before eraseAccountData(A)
// lands first; the erase rejects with an Error, and the real node:sqlite transaction rolls A's database back to exactly
// the rows it held at the first DELETE, which SqlStore then reads as they are. The ordinary writes queued behind the
// erase, the init() called right after it, and every ordinary mutation path tried while the store stays retired reject
// with an Error without reaching the database, while reads keep working. Once the fault is repaired, the same owner's
// retry leaves no learning row, document or metadata key but the schema version, and the store still refuses writes.
// The guest's and account B's databases keep every row exactly. The real openSqlDataset and SqlStore run over three
// in-memory databases, A's seen through a pass-through wrapper of its writes: no device, server or network, every value
// is synthetic, and nothing here is a claim about database pages, WAL files or device storage.
import { accountNamespace, GUEST_NAMESPACE, openSqlDataset, type OpenedSqlDataset } from '@/account/datasets';
import { parseCopy } from '@/storage/rawRecords';
import type { SqlDb, SqlParam } from '@/storage/sqlDb';
import { SqlStore } from '@/storage/sqlStore';
import type { AnswerRecord, Learner, ReportRecord } from '@/storage/types';
import { openNodeSqlite, type NodeSqliteDb } from '../../../test/nodeSqliteDb';

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
const journalText = (owner: string) => `opaque journal of ${owner} (fixture)`;
/** A side document of account A besides its journal. */
const EXTRA_DOC = 'extra-fixture-doc';
const EXTRA_TEXT = 'opaque extra document of account A (fixture)';
const BEFORE_MARKER = 'written just before the erase (fixture)';
const LATE_MARKER = 'written after the erase began (fixture)';
const LATE_TEXT = 'opaque text saved after the erase began (fixture)';

const learner = (who: string): Learner => ({
  learner_id: `lrn-${who}`,
  created_at: '2026-10-20T08:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-20T08:00:00.000Z',
  age_confirmed: true,
  session_minutes: 10,
  arabic_scale: 1,
  screens_seen: ['DEMO-S1'],
});

const answer = (who: string, n: number): AnswerRecord => ({
  answer_id: `ans-${who}-${n}`,
  learner_id: `lrn-${who}`,
  item_id: `DEMO-M0${n}`,
  content_version: 'demo-synthetic-0.1',
  rules_version: 'pilot-0.1-local',
  app_version: '0.1.0',
  timestamp: `2026-10-20T08:0${n}:00.000Z`,
  local_date: '2026-10-20',
  session_id: `ses-${who}`,
  pool: 'PRACT',
  unit: 'A',
  skills: ['LEX-A:W-A3'],
  raw_response: JSON.stringify({ kind: 'typed', text: `jawaban ${n}` }),
  auto_score: { meaning: 'correct' },
  outcome: 'correct',
  error_tags: [],
  serious_tag: null,
  hint_used: false,
  help_lines_shown: [],
  first_attempt: true,
  fresh_evidence: true,
  time_on_item_ms: 4200,
  audio_status: null,
  report_flag: false,
  review_status: 'draft',
  synthetic: true,
});

const report = (who: string): ReportRecord => ({
  report_id: `rep-${who}`,
  learner_id: `lrn-${who}`,
  item_id: 'DEMO-P01',
  content_version: 'demo-synthetic-0.1',
  timestamp: '2026-10-20T08:05:00.000Z',
  reason: 'Arab salah',
  text: `harakat? (${who})`,
});

/** Seeds a dataset through its own learning store: a learner, two answers and their snapshot, a report, two metadata keys. */
async function seed({ store }: OpenedSqlDataset, who: string) {
  await store.saveLearner(learner(who));
  await store.recordAnswer(answer(who, 1), { session_id: `ses-${who}`, index: 1 });
  await store.recordAnswer(answer(who, 2), { session_id: `ses-${who}`, index: 2 });
  await store.addReport(report(who));
  await store.setMeta('pending_notice', `notice for ${who} (fixture)`);
  await store.setMeta('account_note', `note for ${who} (fixture)`);
}

/** A fault in the DELETE statements that reach account A's database, counted as they come, whatever their table. */
type Fault = 'second throws' | 'first skipped';

const MODES: readonly { name: string; fault: Fault }[] = [
  { name: 'the second DELETE throws', fault: 'second throws' },
  { name: 'the first DELETE is silently skipped', fault: 'first skipped' },
];

/** Every row of every table in `db`, read directly in rowid order, as plain values. */
function rowsOf(db: NodeSqliteDb): Record<string, unknown[]> {
  const tables = db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[];
  return JSON.parse(JSON.stringify(Object.fromEntries(tables.map(({ name }) => [name, db.raw.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]))));
}

/** What of a dataset `rows` hold: its learning rows and documents, and its metadata keys but the schema version. */
function personal(rows: Record<string, unknown[]> | undefined) {
  return {
    learning: ['learner', 'answers', 'snapshot', 'reports', 'docs'].map((table) => rows?.[table] ?? []),
    meta: (rows?.meta ?? []).map((row) => (row as { key?: unknown }).key).filter((key) => key !== 'schema_version'),
  };
}

/**
 * Account A's database as its store sees it: reads and transactions go straight to the real adapter, and so does every
 * write until `arm` injects a fault, which lasts until `repair`. DELETE statements are counted as they come, whatever
 * their table: 'second throws' fails the second, 'first skipped' returns from the first without running it. Once
 * armed, every row is captured at the first DELETE, before anything is deleted, and every other write is logged.
 */
function faultyDb(real: NodeSqliteDb) {
  let fault: Fault | null = null;
  let armed = false;
  let deletes = 0;
  const seen: { fired: boolean; rowsAtFirstDelete?: Record<string, unknown[]>; otherWrites: string[] } = { fired: false, otherWrites: [] };
  /** Whether a write is to run: false when the fault skips it; throws when the fault fails it. */
  const passes = (sql: string, params: SqlParam[] = []): boolean => {
    if (!armed) return true;
    if (!/^\s*DELETE\b/i.test(sql)) {
      seen.otherWrites.push(`${sql.trim()} ${JSON.stringify(params)}`);
      return true;
    }
    deletes += 1;
    if (deletes === 1) seen.rowsAtFirstDelete = rowsOf(real);
    if (fault === 'first skipped' && deletes === 1) {
      seen.fired = true;
      return false;
    }
    if (fault === 'second throws' && deletes === 2) {
      seen.fired = true;
      throw new Error('Injected DELETE fault (fixture)');
    }
    return true;
  };
  const db: SqlDb = {
    async exec(sql) {
      if (passes(sql)) await real.exec(sql);
    },
    async run(sql, params) {
      if (passes(sql, params)) await real.run(sql, params);
    },
    all<T>(sql: string, params?: SqlParam[]) {
      return real.all<T>(sql, params);
    },
    transaction: (fn) => real.transaction(fn),
  };
  return {
    db,
    seen,
    arm(injected: Fault) {
      fault = injected;
      armed = true;
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

it.each(MODES)("keeps account A's native dataset whole and its store retired when $name, and the same owner's retry then erases it", async ({ fault }) => {
  // Catches: an erase that reports success over a fault, or whose transaction leaves A partly deleted; a write queued
  // before it that never reached storage; a write queued behind it, an init() called right after it, or any ordinary
  // mutation while retired that resolves or reaches the database; reads that stop answering, or answer what is not
  // stored; a retry that is refused or leaves a row, document or metadata key; a guest or account B row changed.
  const realA = openNodeSqlite(':memory:');
  const dbGuest = openNodeSqlite(':memory:');
  const dbB = openNodeSqlite(':memory:');
  try {
    const wrapper = faultyDb(realA);
    const a = await openSqlDataset(wrapper.db, accountNamespace(A));
    const guest = await openSqlDataset(dbGuest, GUEST_NAMESPACE);
    const b = await openSqlDataset(dbB, accountNamespace(B));
    expect(a.store).toBeInstanceOf(SqlStore);
    const store = a.store as SqlStore;
    await seed(a, 'A');
    await seed(guest, 'guest');
    await seed(b, 'B');
    await a.journal.save(journalText('account A'));
    await store.saveDoc(EXTRA_DOC, EXTRA_TEXT);
    await b.journal.save(journalText('account B'));
    // The guest's journal surface refuses writes, so its document is stored directly, the way SqlStore keeps documents.
    dbGuest.raw.exec('CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);');
    dbGuest.raw.prepare('INSERT INTO docs (name, json) VALUES (?, ?)').run('journal', journalText('the guest'));
    // A real copy of A's dataset, valid input for addCopy, so that its refusal later cannot be a parse failure.
    const copy = (await a.raw.readRaw())!;
    expect(copy).not.toBeNull();
    expect(() => parseCopy(copy)).not.toThrow();
    const othersBefore = [rowsOf(dbGuest), rowsOf(dbB)];
    wrapper.arm(fault);

    // One pipeline: a write queued before the erase, the erase, two ordinary writes queued behind it, and init() called
    // right after it, every promise handled from the start.
    const pipeline = await Promise.allSettled([
      a.store.setMeta('before', BEFORE_MARKER),
      a.eraseAccountData(A),
      a.store.setMeta('late', LATE_MARKER),
      a.journal.save(LATE_TEXT),
      a.store.init(),
    ]);
    expect(pipeline.map(settlement)).toEqual(['fulfilled', 'rejected with an Error', 'rejected with an Error', 'rejected with an Error', 'rejected with an Error']);
    expect(wrapper.seen.fired).toBe(true);
    // At the first DELETE, before anything was deleted, A held the earlier write and a row in every table erased.
    const atFirstDelete = wrapper.seen.rowsAtFirstDelete;
    expect(atFirstDelete?.meta).toContainEqual({ key: 'before', value: BEFORE_MARKER });
    expect(personal(atFirstDelete).learning.map((rows) => rows.length > 0)).toEqual([true, true, true, true, true]);
    // Rolled back by the real transaction, even past a DELETE that ran: every row exactly as at the first DELETE.
    expect(rowsOf(realA)).toEqual(atFirstDelete);

    // Still retired: every ordinary mutation path refuses a valid input, and A's database is left as it is.
    const paths: [string, () => Promise<unknown>][] = [
      ['init', () => a.store.init()],
      ['saveLearner', () => a.store.saveLearner(learner('A'))],
      ['recordAnswer', () => a.store.recordAnswer(answer('A', 3), { session_id: 'ses-A', index: 3 })],
      ['archiveSnapshot', () => a.store.archiveSnapshot('fixture reason', { session_id: 'ses-A', index: 4 }, 'fixture notice')],
      ['saveSnapshot', () => a.store.saveSnapshot({ session_id: 'ses-A', index: 5 })],
      ['addReport', () => a.store.addReport(report('A-2'))],
      ['setMeta', () => a.store.setMeta('while retired', LATE_MARKER)],
      ['reset', () => a.store.reset()],
      ['saveDoc', () => store.saveDoc(EXTRA_DOC, LATE_TEXT)],
      ['journal.save', () => a.journal.save(LATE_TEXT)],
      ['addCopy', () => store.addCopy(copy)],
    ];
    const retired = await Promise.allSettled(paths.map(([, call]) => call()));
    expect(retired.map((result, n) => [paths[n][0], settlement(result)])).toEqual(paths.map(([name]) => [name, 'rejected with an Error']));
    expect(rowsOf(realA)).toEqual(atFirstDelete);
    // Reads keep answering, from the rows as they are: no emptied view of a dataset that is still stored.
    expect(await a.raw.readRaw()).toEqual({ ...copy, meta: { ...copy.meta, before: BEFORE_MARKER } });
    expect([await a.journal.load(), await store.loadDoc(EXTRA_DOC)]).toEqual([journalText('account A'), EXTRA_TEXT]);

    // Repaired, the same owner retries: no learning row, document or metadata key but the schema version is left.
    wrapper.repair();
    await expect(a.eraseAccountData(A)).resolves.toBeUndefined();
    const erased = { learning: [[], [], [], [], []], meta: [] };
    expect([await a.raw.readRaw(), await a.journal.load(), await store.loadDoc(EXTRA_DOC)]).toEqual([null, null, null]);
    expect(personal(rowsOf(realA))).toEqual(erased);
    const afterRetry = await Promise.allSettled([a.store.setMeta('after retry', LATE_MARKER), a.journal.save(LATE_TEXT)]);
    expect(afterRetry.map(settlement)).toEqual(['rejected with an Error', 'rejected with an Error']);
    expect(personal(rowsOf(realA))).toEqual(erased);

    // Once armed, nothing but the earlier write and the erases' DELETE statements reached A's database.
    expect(wrapper.seen.otherWrites).toEqual([expect.stringContaining(BEFORE_MARKER)]);
    expect([rowsOf(dbGuest), rowsOf(dbB)]).toEqual(othersBefore);
  } finally {
    for (const db of [realA, dbGuest, dbB]) db.close();
  }
});
