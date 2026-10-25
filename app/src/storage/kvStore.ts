import { arrayElements, objectMembers, parseCopy, type CopyResult, type ParsedCopy, type RawDataset, type RawRecord } from './rawRecords';
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
  /**
   * Exact text of the answers and reports copied in from another dataset (an account's copy of guest data). Every
   * later write carries it unchanged, so those original bytes survive the whole-blob serialization of each save.
   */
  originals?: { answers: RawRecord[]; reports: RawRecord[] };
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

/** The exact text of copied answers and reports, by ID. Malformed bookkeeping is refused, never guessed at. */
function originalTexts(blob: Blob): { answers: Map<string, string>; reports: Map<string, string> } {
  const texts = { answers: new Map<string, string>(), reports: new Map<string, string>() };
  const originals: unknown = blob.originals;
  if (originals === undefined) return texts;
  const isList = (v: unknown): v is RawRecord[] => Array.isArray(v) && v.every((r) => isObj(r) && isStr(r.id) && isStr(r.json));
  if (!isObj(originals) || !isList(originals.answers) || !isList(originals.reports)) {
    throw new Error('Stored data is malformed (originals); it was not modified.');
  }
  for (const r of originals.answers) texts.answers.set(r.id, r.json);
  for (const r of originals.reports) texts.reports.set(r.id, r.json);
  return texts;
}

/**
 * The dataset stored under `key`, every record exactly as stored: values are located in the stored text, never
 * re-serialized, and copied answers and reports keep their original text. Null when nothing is stored there.
 * Unreadable or unsupported data is refused. Reads only.
 */
export function readKvRaw(kv: KvBackend, key: string): RawDataset | null {
  const text = kv.getItem(key);
  if (!text) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Stored data is unreadable; it was not modified.');
  }
  const problem = envelopeProblem(parsed);
  if (problem) throw new Error(`Stored data is ${problem}; it was not modified.`);
  const blob = parsed as Blob;
  const originals = originalTexts(blob);
  const members = objectMembers(text);
  const answers = arrayElements(members.get('answers') ?? '[]').map((json, n) => {
    const id = blob.answers[n].answer_id;
    return { id, json: originals.answers.get(id) ?? json };
  });
  const reports = arrayElements(members.get('reports') ?? '[]').map((json, n) => {
    const id = blob.reports[n].report_id;
    return { id, json: originals.reports.get(id) ?? json };
  });
  const learner = blob.learner === null ? null : (members.get('learner') ?? null);
  const meta = { ...(blob.meta ?? {}) };
  if (learner === null && !answers.length && blob.snapshot === null && !Object.keys(meta).length && !reports.length) return null;
  return { learner, answers, snapshot: blob.snapshot, meta, reports };
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
  /** Set once an erase begins here: every later write is refused, so nothing erased is written back. */
  private erased = false;
  private enqueue = createSerialQueue();

  /**
   * `readOnly`: the reason this instance may not write (ENG-R01: another tab owns the web
   * writer lock, or Web Locks is unavailable). Reads work; every write is refused.
   * `key`: where this dataset is stored. The guest dataset by default; an account dataset has its own key.
   */
  constructor(
    private kv: KvBackend,
    private readOnly: string | null = null,
    private readonly key: string = KvStore.KEY
  ) {}

  async init(): Promise<void> {
    const raw = this.kv.getItem(this.key);
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
      this.checkWritable();
      const next = update(this.blob);
      if (!next) return;
      this.persist(next);
    });
  }

  private checkWritable(): void {
    if (this.refused) throw new Error('Storage refused: the stored data was not accepted, so nothing is written.');
    if (this.readOnly) throw new Error(`Storage is read-only: ${this.readOnly}`);
    if (this.erased) throw new Error('Storage retired: an account-data erase began in this store instance, so it refuses every further write.');
  }

  /** One setItem; the in-memory blob changes only after it succeeds. */
  private persist(next: Blob): void {
    const stamped = { ...next, schema: STORAGE_SCHEMA };
    this.kv.setItem(this.key, JSON.stringify(stamped));
    this.blob = stamped;
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

  /**
   * See Store.updateMeta. Holds the queue across the async transform, which sees this blob's freshest value; the
   * guard is checked before it runs and again before the single setItem, and the blob is replaced only after that.
   */
  updateMeta(key: string, transform: (raw: string | null) => Promise<string | null>): Promise<void> {
    return this.enqueue(async () => {
      this.checkWritable();
      const raw = this.blob.meta?.[key] ?? null;
      const out: unknown = await transform(raw);
      if (out !== null && typeof out !== 'string') throw new Error('Metadata update must produce text or null; nothing was written.');
      const next = out as string | null;
      if (next === raw) return;
      this.checkWritable();
      const meta = { ...(this.blob.meta ?? {}) };
      if (next === null) delete meta[key];
      else meta[key] = next;
      this.persist({ ...this.blob, meta });
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

  /**
   * Removes this dataset from storage (reset() only empties it), through the same queue and writer guard as every
   * write: each side document in `docs`, then the main key, so the dataset stays findable until everything beside it
   * is gone. Nothing of its learning state stays cached here, and this instance writes nothing more, so no later write
   * brings any of it back (a retried erase still runs). Resolves only once every one of those keys is absent. Storage
   * has no transaction across keys: a failure part-way rejects, leaving what was not yet removed and rolling nothing back.
   */
  erase(docs: readonly string[]): Promise<void> {
    return this.enqueue(async () => {
      if (this.refused) throw new Error('Storage refused: the stored data was not accepted, so nothing is written.');
      if (this.readOnly) throw new Error(`Storage is read-only: ${this.readOnly}`);
      this.erased = true;
      this.blob = { ...EMPTY, meta: {} };
      const keys = [...docs.map((name) => `${this.key}/${name}`), this.key];
      for (const key of keys) this.kv.removeItem(key);
      const left = keys.filter((key) => this.kv.getItem(key) !== null).length;
      if (left) throw new Error(`Storage was not erased: ${left} of ${keys.length} stored values are still there.`);
    });
  }

  /** Every record exactly as stored (see readKvRaw), after the writes already queued here. */
  readRaw(): Promise<RawDataset | null> {
    return this.enqueue(async () => readKvRaw(this.kv, this.key));
  }

  /** A side document of this dataset (the sync journal), stored beside it under "<key>/<name>". */
  loadDoc(name: string): Promise<string | null> {
    return this.enqueue(async () => this.kv.getItem(`${this.key}/${name}`));
  }

  /** Replaces a side document in one write, through the same queue and writer guard as every other write. */
  saveDoc(name: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      if (this.refused) throw new Error('Storage refused: the stored data was not accepted, so nothing is written.');
      if (this.readOnly) throw new Error(`Storage is read-only: ${this.readOnly}`);
      if (this.erased) throw new Error('Storage retired: an account-data erase began in this store instance, so it refuses every further write.');
      this.kv.setItem(`${this.key}/${name}`, text);
    });
  }

  /**
   * Adds the records this dataset lacks in one write, through the same queue, state and writer guard as every other
   * write. What it already has is kept (answers and reports by ID, its learner, its snapshot, its metadata keys), and
   * a copy that adds nothing writes nothing. Copied answers and reports keep their exact text in `originals`.
   */
  addCopy(copy: RawDataset): Promise<CopyResult> {
    let incoming: ParsedCopy;
    try {
      incoming = parseCopy(copy);
    } catch (e) {
      return Promise.reject(e);
    }
    const added: CopyResult = { answers: 0, reports: 0 };
    return this.commit((b) => {
      originalTexts(b); // refuses malformed bookkeeping before anything is merged
      const kept = b.originals ?? { answers: [], reports: [] };
      const haveAnswers = new Set(b.answers.map((a) => a.answer_id));
      const haveReports = new Set(b.reports.map((r) => r.report_id));
      const answers = incoming.answers.filter((a) => !haveAnswers.has(a.id));
      const reports = incoming.reports.filter((r) => !haveReports.has(r.id));
      const meta = { ...(b.meta ?? {}) };
      const newMeta = incoming.meta.filter(([key]) => !Object.prototype.hasOwnProperty.call(meta, key));
      const learner = b.learner === null && incoming.learner ? incoming.learner.value : null;
      const snapshot = b.snapshot === null ? incoming.snapshot : null;
      if (!answers.length && !reports.length && !newMeta.length && learner === null && snapshot === null) return null;
      for (const [key, value] of newMeta) meta[key] = value;
      added.answers = answers.length;
      added.reports = reports.length;
      return {
        ...b,
        meta,
        learner: learner ?? b.learner,
        answers: [...b.answers, ...answers.map((a) => a.value)],
        snapshot: snapshot ?? b.snapshot,
        reports: [...b.reports, ...reports.map((r) => r.value)],
        originals: {
          answers: [...kept.answers, ...answers.map(({ id, json }) => ({ id, json }))],
          reports: [...kept.reports, ...reports.map(({ id, json }) => ({ id, json }))],
        },
      };
    }).then(() => added);
  }
}
