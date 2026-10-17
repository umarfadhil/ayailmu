import type { SqlDb } from './sqlDb';
import { createSerialQueue } from './serial';
import type { AnswerRecord, Learner, ReportRecord, Snapshot, Store } from './types';

const SCHEMA_VERSION = 1;

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

/** SQLite-backed store. Answers carry a `synced` flag for the future upload queue (no backend yet). */
export class SqlStore implements Store {
  private enqueue = createSerialQueue();

  constructor(private db: SqlDb) {}

  async init(): Promise<void> {
    await this.db.exec('PRAGMA journal_mode = WAL;');
    await this.db.exec(MIGRATION_1);
    await this.db.run(`INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)`, [String(SCHEMA_VERSION)]);
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
        await this.db.run(
          `INSERT OR IGNORE INTO answers (answer_id, learner_id, item_id, session_id, timestamp, outcome, json)
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

  saveSnapshot(snapshot: Snapshot | null): Promise<void> {
    return this.enqueue(() => this.writeSnapshot(snapshot));
  }

  private writeSnapshot(snapshot: Snapshot | null): Promise<void> {
    return this.db.run('INSERT OR REPLACE INTO snapshot (id, json) VALUES (1, ?)', [
      snapshot ? JSON.stringify(snapshot) : null,
    ]);
  }

  async loadSnapshot(): Promise<Snapshot | null> {
    const rows = await this.db.all<{ json: string | null }>('SELECT json FROM snapshot WHERE id = 1');
    if (!rows.length || !rows[0].json) return null;
    try {
      const parsed = JSON.parse(rows[0].json);
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
      })
    );
  }
}
