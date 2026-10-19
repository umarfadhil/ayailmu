import { parseCopy, SCHEMA_META_KEY, type CopyResult, type ParsedCopy, type RawDataset } from './rawRecords';
import type { SqlDb } from './sqlDb';
import { answerProblem, learnerProblem } from './validate';
import { createSerialQueue } from './serial';
import { STORAGE_SCHEMA, type AnswerRecord, type ArchivedSnapshot, type Learner, type ReportRecord, type Snapshot, type Store } from './types';

const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS learner (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS answers (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id TEXT NOT NULL UNIQUE,
  learner_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  outcome TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 0,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshot (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT);
CREATE TABLE IF NOT EXISTS reports (report_id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);
`;
const TABLES = ['meta', 'learner', 'answers', 'snapshot', 'reports'];

/**
 * The dataset in `db`, every record exactly as stored: the json columns are returned as they are, never
 * re-serialized. Null when nothing is stored; data from a newer app version or another layout is refused.
 * Reads only, so it is safe on a database this app has not opened for writing.
 */
export async function readSqlRaw(db: SqlDb): Promise<RawDataset | null> {
  const present = new Set((await db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((t) => t.name));
  const found = TABLES.filter((t) => present.has(t));
  if (!found.length) return null;
  if (found.length !== TABLES.length) throw new Error('Stored data is malformed (tables); it was not modified.');
  const version = await db.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [SCHEMA_META_KEY]);
  if (version.length && !(Number(version[0].value) <= STORAGE_SCHEMA)) {
    throw new Error(`Stored data uses an unsupported schema (${version[0].value}); it was not modified.`);
  }
  const learner = await db.all<{ json: string }>('SELECT json FROM learner WHERE id = 1');
  const answers = await db.all<{ answer_id: string; json: string }>('SELECT answer_id, json FROM answers ORDER BY seq');
  const snapshot = await db.all<{ json: string | null }>('SELECT json FROM snapshot WHERE id = 1');
  const meta = await db.all<{ key: string; value: string }>('SELECT key, value FROM meta WHERE key != ? ORDER BY key', [SCHEMA_META_KEY]);
  const reports = await db.all<{ report_id: string; json: string }>('SELECT report_id, json FROM reports ORDER BY rowid');
  const raw: RawDataset = {
    learner: learner.length ? learner[0].json : null,
    answers: answers.map((a) => ({ id: a.answer_id, json: a.json })),
    snapshot: snapshot.length ? snapshot[0].json : null,
    meta: Object.fromEntries(meta.map((m) => [m.key, m.value])),
    reports: reports.map((r) => ({ id: r.report_id, json: r.json })),
  };
  const empty = raw.learner === null && !raw.answers.length && raw.snapshot === null && !meta.length && !raw.reports.length;
  return empty ? null : raw;
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '');

/** SQLite-backed store. Answers carry a `synced` flag for the future upload queue (no backend yet). */
export class SqlStore implements Store {
  private enqueue = createSerialQueue();

  constructor(private db: SqlDb) {}

  async init(): Promise<void> {
    // Refuse data from a newer app version before writing anything.
    const hasMeta = await this.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`);
    if (hasMeta.length) {
      const rows = await this.db.all<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`);
      const stored = rows.length ? Number(rows[0].value) : 0;
      if (!Number.isFinite(stored) || stored > STORAGE_SCHEMA) {
        throw new Error(`Stored data uses an unsupported schema (${rows[0]?.value}); it was not modified.`);
      }
    }
    // ENG-06: refuse stored records the learning projections cannot replay, before any write.
    const hasAnswers = await this.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'answers'`);
    if (hasAnswers.length) {
      for (const row of await this.db.all<{ json: string }>('SELECT json FROM answers ORDER BY seq')) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.json);
        } catch {
          throw new Error('Stored data is malformed (answer JSON); it was not modified.');
        }
        const p = answerProblem(parsed);
        if (p) throw new Error(`Stored data is malformed (answer: ${p}); it was not modified.`);
      }
      for (const row of await this.db.all<{ json: string }>('SELECT json FROM learner')) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(row.json);
        } catch {
          throw new Error('Stored data is malformed (learner JSON); it was not modified.');
        }
        const p = learnerProblem(parsed);
        if (p) throw new Error(`Stored data is malformed (learner: ${p}); it was not modified.`);
      }
    }
    await this.db.exec('PRAGMA journal_mode = WAL;');
    await this.db.exec(MIGRATION_1);
    // v2 adds no tables: metadata (archive, notices) uses the existing meta table.
    await this.db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`, [String(STORAGE_SCHEMA)]);
  }

  async getLearner(): Promise<Learner | null> {
    const rows = await this.db.all<{ json: string }>('SELECT json FROM learner WHERE id = 1');
    return rows.length ? (JSON.parse(rows[0].json) as Learner) : null;
  }

  saveLearner(learner: Learner): Promise<void> {
    return this.enqueue(() =>
      this.db.run('INSERT OR REPLACE INTO learner (id, json) VALUES (1, ?)', [JSON.stringify(learner)])
    );
  }

  async listAnswers(): Promise<AnswerRecord[]> {
    const rows = await this.db.all<{ json: string }>('SELECT json FROM answers ORDER BY seq');
    return rows.map((r) => JSON.parse(r.json) as AnswerRecord);
  }

  recordAnswer(record: AnswerRecord, snapshot: Snapshot | null): Promise<void> {
    return this.enqueue(() =>
      this.db.transaction(async () => {
        const existing = await this.db.all<{ one: number }>('SELECT 1 AS one FROM answers WHERE answer_id = ?', [record.answer_id]);
        if (existing.length) return; // replayed duplicate: no new event, no snapshot rewind
        await this.db.run(
          `INSERT INTO answers (answer_id, learner_id, item_id, session_id, timestamp, outcome, json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            record.answer_id,
            record.learner_id,
            record.item_id,
            record.session_id,
            record.timestamp,
            record.outcome,
            JSON.stringify(record),
          ]
        );
        await this.writeSnapshot(snapshot);
      })
    );
  }

  async loadSnapshotRaw(): Promise<string | null> {
    const rows = await this.db.all<{ json: string | null }>('SELECT json FROM snapshot WHERE id = 1');
    return rows.length ? rows[0].json : null;
  }

  archiveSnapshot(reason: string, replacement: Snapshot | null, notice?: string): Promise<boolean> {
    return this.enqueue(async () => {
      let archived = false;
      await this.db.transaction(async () => {
        const raw = await this.loadSnapshotRaw();
        if (raw !== null) {
          const prev = await this.metaValue('snapshot_archive');
          const list: ArchivedSnapshot[] = prev ? JSON.parse(prev) : [];
          list.push({ archived_at: new Date().toISOString(), reason, raw });
          await this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['snapshot_archive', JSON.stringify(list)]);
          archived = true;
        }
        if (notice) await this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['pending_notice', notice]);
        await this.writeSnapshot(replacement);
      });
      return archived;
    });
  }

  private async metaValue(key: string): Promise<string | null> {
    const rows = await this.db.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return rows.length ? rows[0].value : null;
  }

  getMeta(key: string): Promise<string | null> {
    return this.metaValue(key);
  }

  setMeta(key: string, value: string | null): Promise<void> {
    return this.enqueue(() =>
      value === null
        ? this.db.run('DELETE FROM meta WHERE key = ?', [key])
        : this.db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value])
    );
  }

  saveSnapshot(snapshot: Snapshot | null): Promise<void> {
    return this.enqueue(() => this.writeSnapshot(snapshot));
  }

  private writeSnapshot(snapshot: Snapshot | null): Promise<void> {
    return this.db.run('INSERT OR REPLACE INTO snapshot (id, json) VALUES (1, ?)', [
      snapshot ? JSON.stringify(snapshot) : null,
    ]);
  }

  async loadSnapshot(): Promise<Snapshot | null> {
    const raw = await this.loadSnapshotRaw();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Snapshot) : null;
    } catch {
      return null;
    }
  }

  addReport(report: ReportRecord): Promise<void> {
    return this.enqueue(() =>
      this.db.run('INSERT OR IGNORE INTO reports (report_id, json) VALUES (?, ?)', [report.report_id, JSON.stringify(report)])
    );
  }

  async listReports(): Promise<ReportRecord[]> {
    const rows = await this.db.all<{ json: string }>('SELECT json FROM reports ORDER BY rowid');
    return rows.map((r) => JSON.parse(r.json) as ReportRecord);
  }

  reset(): Promise<void> {
    return this.enqueue(() =>
      this.db.transaction(async () => {
        for (const table of ['learner', 'answers', 'snapshot', 'reports']) {
          await this.db.run(`DELETE FROM ${table}`);
        }
        await this.db.run(`DELETE FROM meta WHERE key != 'schema_version'`);
      })
    );
  }

  /** Every record exactly as stored (see readSqlRaw), after the writes already queued here. */
  readRaw(): Promise<RawDataset | null> {
    return this.enqueue(() => readSqlRaw(this.db));
  }

  /** A side document of this dataset (the sync journal), kept in the same database. */
  loadDoc(name: string): Promise<string | null> {
    return this.enqueue(async () => {
      const table = await this.db.all<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'docs'`);
      if (!table.length) return null;
      const rows = await this.db.all<{ json: string }>('SELECT json FROM docs WHERE name = ?', [name]);
      return rows.length ? rows[0].json : null;
    });
  }

  /** Replaces a side document in one statement, through the same queue as every other write. */
  saveDoc(name: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      await this.db.exec('CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL);');
      await this.db.run('INSERT OR REPLACE INTO docs (name, json) VALUES (?, ?)', [name, text]);
    });
  }

  /**
   * Adds the records this dataset lacks in one transaction, through the same queue as every other write. What it
   * already has is kept (answers and reports by ID, its learner, its snapshot, its metadata keys), copied records
   * are stored with their exact text, and a copy that adds nothing writes nothing.
   */
  addCopy(copy: RawDataset): Promise<CopyResult> {
    let incoming: ParsedCopy;
    try {
      incoming = parseCopy(copy);
    } catch (e) {
      return Promise.reject(e);
    }
    return this.enqueue(async () => {
      const haveAnswers = new Set((await this.db.all<{ answer_id: string }>('SELECT answer_id FROM answers')).map((r) => r.answer_id));
      const haveReports = new Set((await this.db.all<{ report_id: string }>('SELECT report_id FROM reports')).map((r) => r.report_id));
      const haveMeta = new Set((await this.db.all<{ key: string }>('SELECT key FROM meta')).map((r) => r.key));
      const hasLearner = (await this.db.all<{ one: number }>('SELECT 1 AS one FROM learner WHERE id = 1')).length > 0;
      const hasSnapshot = (await this.db.all<{ one: number }>('SELECT 1 AS one FROM snapshot WHERE id = 1 AND json IS NOT NULL')).length > 0;
      const answers = incoming.answers.filter((a) => !haveAnswers.has(a.id));
      const reports = incoming.reports.filter((r) => !haveReports.has(r.id));
      const meta = incoming.meta.filter(([key]) => !haveMeta.has(key));
      const learner = hasLearner ? null : incoming.learner;
      const snapshot = hasSnapshot ? null : incoming.snapshot;
      if (!answers.length && !reports.length && !meta.length && learner === null && snapshot === null) return { answers: 0, reports: 0 };
      await this.db.transaction(async () => {
        if (learner) await this.db.run('INSERT INTO learner (id, json) VALUES (1, ?)', [learner.json]);
        for (const { id, json, value } of answers) {
          await this.db.run(
            `INSERT INTO answers (answer_id, learner_id, item_id, session_id, timestamp, outcome, json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, asText(value.learner_id), value.item_id, asText(value.session_id), value.timestamp, value.outcome, json]
          );
        }
        if (snapshot !== null) await this.db.run('INSERT OR REPLACE INTO snapshot (id, json) VALUES (1, ?)', [snapshot]);
        for (const [key, value] of meta) await this.db.run('INSERT INTO meta (key, value) VALUES (?, ?)', [key, value]);
        for (const { id, json } of reports) await this.db.run('INSERT INTO reports (report_id, json) VALUES (?, ?)', [id, json]);
      });
      return { answers: answers.length, reports: reports.length };
    });
  }
}
