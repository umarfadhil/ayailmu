/**
 * @jest-environment node
 */
// Erasing the signed-in account's local native dataset, RED (regression-first), one positive case only. The proposed
// eraseAccountData(accountId), on account A's dataset opened by openSqlDataset, removes every row of A's learning
// tables (learner, answers, snapshot, reports), all of its metadata but the technical schema_version, and its sync
// journal document; afterwards the store refuses ordinary metadata and journal writes while its reads keep working,
// and the guest's and account B's databases keep every row exactly. The real openSqlDataset and SqlStore run over
// three separate in-memory node:sqlite databases (A, the guest and B): no device, server or network, and every value
// is synthetic. Only rows are proven gone: nothing here is a claim about database pages, WAL files or the device's
// storage. Refusals, storage faults, controllers and screens need their own proof; this case covers none of them.
import { accountNamespace, GUEST_NAMESPACE, openSqlDataset, type OpenedSqlDataset } from '@/account/datasets';
import type { AnswerRecord, Learner, ReportRecord } from '@/storage/types';
import { openNodeSqlite, type NodeSqliteDb } from '../../../test/nodeSqliteDb';

/** The proposed erase, typed here before OpenedSqlDataset declares it. */
interface ProposedErase {
  eraseAccountData(accountId: string): Promise<void>;
}

const A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const B = '5a7e3c19-8b42-4d6f-9e01-c3b5a2d4f687';
const journalText = (owner: string) => `opaque journal of ${owner} (fixture)`;
const LATER_MARKER = 'written after the erase (fixture)';
const LATER_JOURNAL = 'opaque journal saved after the erase (fixture)';

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

/** What a dataset answers through its learning store, its raw export and its journal. */
async function surfaces({ store, raw, journal }: OpenedSqlDataset) {
  return {
    learner: await store.getLearner(),
    answers: await store.listAnswers(),
    snapshot: await store.loadSnapshotRaw(),
    reports: await store.listReports(),
    meta: [await store.getMeta('pending_notice'), await store.getMeta('account_note')],
    raw: await raw.readRaw(),
    journal: await journal.load(),
  };
}

/** Every row of every table in `db`, exactly as stored, as text. */
function dump(db: NodeSqliteDb): string {
  const tables = db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[];
  return JSON.stringify(tables.map(({ name }) => [name, db.raw.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
}

/** The rows of `table` in `db`, read directly; none when the table is gone. */
function rowsOf(db: NodeSqliteDb, table: string): Record<string, unknown>[] {
  const present = db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).all(table).length > 0;
  return present ? (db.raw.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[]) : [];
}

it("erases account A's own native dataset, every learning row, its metadata and its journal, leaving the guest's and account B's databases exactly as they were", async () => {
  // Catches: a missing erase; a learning row, metadata key or journal document of A left in its database, or emptied
  // only in what the store answers; a later metadata or journal write that lands or brings A's data back; reads that
  // stop working after the erase; any row of the guest's or B's database changed.
  const dbA = openNodeSqlite(':memory:');
  const dbGuest = openNodeSqlite(':memory:');
  const dbB = openNodeSqlite(':memory:');
  try {
    const a = await openSqlDataset(dbA, accountNamespace(A));
    const guest = await openSqlDataset(dbGuest, GUEST_NAMESPACE);
    const b = await openSqlDataset(dbB, accountNamespace(B));
    await seed(a, 'A');
    await seed(guest, 'guest');
    await seed(b, 'B');
    await a.journal.save(journalText('account A'));
    await b.journal.save(journalText('account B'));
    // The guest's journal surface refuses writes, so its document is stored directly, the way SqlStore keeps documents.
    dbGuest.raw.exec('CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);');
    dbGuest.raw.prepare('INSERT INTO docs (name, json) VALUES (?, ?)').run('journal', journalText('the guest'));

    // A holds a full dataset; the guest's and B's are captured as answered and row for row.
    const aBefore = await surfaces(a);
    expect(aBefore).toMatchObject({
      learner: learner('A'),
      answers: [answer('A', 1), answer('A', 2)],
      snapshot: JSON.stringify({ session_id: 'ses-A', index: 2 }),
      reports: [report('A')],
      meta: ['notice for A (fixture)', 'note for A (fixture)'],
      journal: journalText('account A'),
    });
    expect(aBefore.raw).not.toBeNull();
    const othersBefore = { guest: await surfaces(guest), b: await surfaces(b), rows: [dump(dbGuest), dump(dbB)] };

    const erasable = a as OpenedSqlDataset & ProposedErase;
    expect(typeof erasable.eraseAccountData).toBe('function');
    await erasable.eraseAccountData(A);

    const erased = { learner: null, answers: [], snapshot: null, reports: [], meta: [null, null], raw: null, journal: null };
    // What is left of A in its own database, read directly: learning rows, documents, and metadata but the schema version.
    const leftOfA = () => ({
      rows: ['learner', 'answers', 'snapshot', 'reports', 'docs'].map((table) => rowsOf(dbA, table)),
      meta: rowsOf(dbA, 'meta')
        .map((row) => row.key)
        .filter((key) => key !== 'schema_version'),
    });
    expect(await surfaces(a)).toEqual(erased);
    expect(leftOfA()).toEqual({ rows: [[], [], [], [], []], meta: [] });

    // Ordinary later writes are refused and bring nothing back; reads still answer.
    const later = await Promise.allSettled([a.store.setMeta('later', LATER_MARKER), a.journal.save(LATER_JOURNAL)]);
    expect(later.map((result) => result.status === 'rejected' && result.reason instanceof Error)).toEqual([true, true]);
    expect(await surfaces(a)).toEqual(erased);
    expect(leftOfA()).toEqual({ rows: [[], [], [], [], []], meta: [] });

    expect({ guest: await surfaces(guest), b: await surfaces(b), rows: [dump(dbGuest), dump(dbB)] }).toStrictEqual(othersBefore);
  } finally {
    for (const db of [dbA, dbGuest, dbB]) db.close();
  }
});
