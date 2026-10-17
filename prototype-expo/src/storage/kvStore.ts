import { createSerialQueue } from './serial';
import type { AnswerRecord, Learner, ReportRecord, Snapshot, Store } from './types';

export interface KvBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface Blob {
  learner: Learner | null;
  answers: AnswerRecord[];
  /** Kept as a string so an unreadable snapshot never breaks the answer log. */
  snapshot: string | null;
  reports: ReportRecord[];
}

const EMPTY: Blob = { learner: null, answers: [], snapshot: null, reports: [] };

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
  private enqueue = createSerialQueue();

  constructor(private kv: KvBackend) {}

  async init(): Promise<void> {
    const raw = this.kv.getItem(KvStore.KEY);
    if (!raw) return;
    try {
      this.blob = { ...EMPTY, ...(JSON.parse(raw) as Blob) };
    } catch {
      throw new Error('Stored data is unreadable; refusing to overwrite it.');
    }
  }

  /**
   * Critical section: the next blob is computed from the current blob INSIDE the
   * serial queue, so concurrent writes never base themselves on stale state.
   * One setItem per write keeps each save all-or-nothing; if it throws, the
   * in-memory blob is unchanged (rollback).
   */
  private commit(update: (current: Blob) => Blob | null): Promise<void> {
    return this.enqueue(async () => {
      const next = update(this.blob);
      if (!next) return;
      this.kv.setItem(KvStore.KEY, JSON.stringify(next));
      this.blob = next;
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
    return this.commit((b) => ({
      ...b,
      answers: b.answers.some((a) => a.answer_id === record.answer_id) ? b.answers : [...b.answers, record],
      snapshot: snapshot ? JSON.stringify(snapshot) : null,
    }));
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
    return this.commit(() => EMPTY);
  }
}
