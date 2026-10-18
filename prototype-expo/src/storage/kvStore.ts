import { createSerialQueue } from './serial';
import { answerProblem, learnerProblem, reportProblem } from './validate';
import { STORAGE_SCHEMA, type AnswerRecord, type ArchivedSnapshot, type Learner, type ReportRecord, type Snapshot, type Store } from './types';

export interface KvBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Blob {
  /** Storage format version. v1 blobs have none. Newer than STORAGE_SCHEMA → refused. */
  schema?: number;
  meta?: Record<string, string>;
  learner: Learner | null;
  answers: AnswerRecord[];
  /** Kept as a string so an unreadable snapshot never breaks the answer log. */
  snapshot: string | null;
  reports: ReportRecord[];
}

const EMPTY: Blob = { schema: STORAGE_SCHEMA, meta: {}, learner: null, answers: [], snapshot: null, reports: [] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/**
 * Validates the outer envelope of a stored blob (REV-2). Accepts v1 (no schema/meta) and v2.
 * Returns a description of the first problem, or null when the envelope is acceptable.
 */
export function envelopeProblem(v: unknown): string | null {
  if (!isObj(v)) return 'malformed (not an object)';
  const schema = v.schema;
  if (schema !== undefined && (typeof schema !== 'number' || !Number.isInteger(schema))) return 'malformed (schema)';
  if (typeof schema === 'number' && schema > STORAGE_SCHEMA) return `in an unsupported schema (${schema})`;
  if (typeof schema === 'number' && schema < 1) return 'malformed (schema)';
  for (const k of ['learner', 'answers', 'snapshot', 'reports']) if (!(k in v)) return `malformed (missing ${k})`;
  const lp = learnerProblem(v.learner);
  if (lp) return `malformed (learner ${lp})`;
  if (!Array.isArray(v.answers)) return 'malformed (answers)';
  for (const [n, a] of v.answers.entries()) {
    const p = answerProblem(a);
    if (p) return `malformed (answer ${n}: ${p})`;
  }
  if (!(v.snapshot === null || isStr(v.snapshot))) return 'malformed (snapshot)';
  if (!Array.isArray(v.reports) || v.reports.some((r) => reportProblem(r))) return 'malformed (reports)';
  if (v.meta !== undefined && (!isObj(v.meta) || !Object.values(v.meta).every(isStr))) return 'malformed (meta)';
  return null;
}

export function memoryKv(): KvBackend {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/**
 * Web-preview store: the whole state is one JSON value written with a single
 * setItem, so each save is all-or-nothing. In-memory state changes only after
 * the write succeeds.
 */
export class KvStore implements Store {
  static KEY = 'arabic-trial-app/v1';
  private blob: Blob = EMPTY;
  /** Set when init refused the stored data: every later write is refused too (no overwrite). */
  private refused = false;
  private enqueue = createSerialQueue();

  /**
   * `readOnly`: the reason this instance may not write (ENG-R01: another tab owns the web
   * writer lock, or Web Locks is unavailable). Reads work; every write is refused.
   */
  constructor(
    private kv: KvBackend,
    private readOnly: string | null = null
  ) {}

  async init(): Promise<void> {
    const raw = this.kv.getItem(KvStore.KEY);
    if (!raw) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.refused = true;
      throw new Error('Stored data is unreadable; refusing to overwrite it.');
    }
    const problem = envelopeProblem(parsed);
    if (problem) {
      this.refused = true;
      throw new Error(`Stored data is ${problem}; it was not modified.`);
    }
    const blob = parsed as Blob;
    this.blob = { ...EMPTY, ...blob, meta: { ...(blob.meta ?? {}) } };
  }

  /**
   * Critical section: the next blob is computed from the current blob INSIDE the
   * serial queue, so concurrent writes never base themselves on stale state.
   * One setItem per write keeps each save all-or-nothing; if it throws, the
   * in-memory blob is unchanged (rollback).
   */
  private commit(update: (current: Blob) => Blob | null): Promise<void> {
    return this.enqueue(async () => {
      if (this.refused) throw new Error('Storage refused: the stored data was not accepted, so nothing is written.');
      if (this.readOnly) throw new Error(`Storage is read-only: ${this.readOnly}`);
      const next = update(this.blob);
      if (!next) return;
      const stamped = { ...next, schema: STORAGE_SCHEMA };
      this.kv.setItem(KvStore.KEY, JSON.stringify(stamped));
      this.blob = stamped;
    });
  }

  /**
   * ENG-R01: makes this instance read-only from now on. Queued after any write already in
   * progress, so those land and every later write is refused.
   */
  revoke(reason: string): Promise<void> {
    return this.enqueue(async () => {
      this.readOnly = reason;
    });
  }

  async getLearner() {
    return this.blob.learner;
  }

  saveLearner(learner: Learner) {
    return this.commit((b) => ({ ...b, learner }));
  }

  async listAnswers() {
    return [...this.blob.answers];
  }

  recordAnswer(record: AnswerRecord, snapshot: Snapshot | null) {
    // A replayed duplicate writes nothing: no second event and no snapshot rewind.
    return this.commit((b) =>
      b.answers.some((a) => a.answer_id === record.answer_id)
        ? null
        : { ...b, answers: [...b.answers, record], snapshot: snapshot ? JSON.stringify(snapshot) : null }
    );
  }

  async loadSnapshotRaw(): Promise<string | null> {
    return this.blob.snapshot;
  }

  async archiveSnapshot(reason: string, replacement: Snapshot | null, notice?: string): Promise<boolean> {
    let archived = false;
    await this.commit((b) => {
      const meta = { ...(b.meta ?? {}) };
      if (b.snapshot !== null) {
        const list: ArchivedSnapshot[] = meta.snapshot_archive ? JSON.parse(meta.snapshot_archive) : [];
        list.push({ archived_at: new Date().toISOString(), reason, raw: b.snapshot });
        meta.snapshot_archive = JSON.stringify(list);
        archived = true;
      }
      if (notice) meta.pending_notice = notice;
      return { ...b, meta, snapshot: replacement ? JSON.stringify(replacement) : null };
    });
    return archived;
  }

  async getMeta(key: string): Promise<string | null> {
    return this.blob.meta?.[key] ?? null;
  }

  setMeta(key: string, value: string | null) {
    return this.commit((b) => {
      const meta = { ...(b.meta ?? {}) };
      if (value === null) delete meta[key];
      else meta[key] = value;
      return { ...b, meta };
    });
  }

  saveSnapshot(snapshot: Snapshot | null) {
    return this.commit((b) => ({ ...b, snapshot: snapshot ? JSON.stringify(snapshot) : null }));
  }

  async loadSnapshot(): Promise<Snapshot | null> {
    if (!this.blob.snapshot) return null;
    try {
      const parsed = JSON.parse(this.blob.snapshot);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  addReport(report: ReportRecord) {
    return this.commit((b) =>
      b.reports.some((r) => r.report_id === report.report_id) ? null : { ...b, reports: [...b.reports, report] }
    );
  }

  async listReports() {
    return [...this.blob.reports];
  }

  reset() {
    return this.commit(() => ({ ...EMPTY, meta: {} }));
  }
}
