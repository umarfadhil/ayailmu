// On-device storage contracts (Trial_App_Spec.md §10, §12).
import type { ErrorTag, Pool, ReviewStatus } from '@/content/schema';
import type { Outcome, PartScore } from '@/engine/scoring';

export interface Learner {
  /** Random ID created on the device; no name or email. */
  learner_id: string;
  created_at: string;
  consent_version: string;
  consent_at: string;
  age_confirmed: boolean;
  session_minutes: number;
  /** Arabic text size multiplier (spec §5). */
  arabic_scale: number;
  screens_seen: string[];
}

/** One answer event. Every answer is stored so states can be recomputed offline. */
export interface AnswerRecord {
  answer_id: string;
  learner_id: string;
  item_id: string;
  content_version: string;
  rules_version: string;
  app_version: string;
  timestamp: string;
  local_date: string;
  session_id: string;
  pool: Pool;
  unit: 'ENTRY' | 'A' | 'B';
  skills: string[];
  /** Exactly what was tapped or typed (JSON of the response). */
  raw_response: string;
  auto_score: Record<string, PartScore>;
  outcome: Outcome;
  error_tags: ErrorTag[];
  serious_tag: ErrorTag | null;
  hint_used: boolean;
  help_lines_shown: string[];
  first_attempt: boolean;
  fresh_evidence: boolean;
  /** Analysis only; never used to judge the learner. */
  time_on_item_ms: number;
  audio_status: 'played' | 'failed' | 'unavailable' | null;
  report_flag: boolean;
  review_status: ReviewStatus;
  synthetic: boolean;

  // ---- v2 (four-choice) fields. Absent on v1 records, which are never rewritten. ----
  answer_schema?: 2;
  /** Recognition among four choices. Never typed or constructed evidence. */
  evidence_mode?: 'recognition-4';
  /** Word-form/sentence identity across content versions. */
  lineage?: string;
  /** Why the item was shown: fresh practice, remediation, focus, scheduled review or timed check. */
  role?: StepRole;
  /** The options exactly as shown, in the persisted order. */
  presented_options?: { id: string; text: string; position: number }[];
  selected_option_id?: string | null;
  selected_position?: number | null;
  misconceptions?: ErrorTag[];
  /** Timed check: correctness/key were not shown after the answer (independent checks). */
  feedback_deferred?: boolean;
  /**
   * Timed check answered after the material it relies on was shown the same day (lesson screen or
   * Guide): `false`, with `exposure` provenance ("guide:DEMO-S4"). Not counted as retention evidence.
   */
  retention_valid?: false;
  exposure?: string[];
}

export type StepRole = 'practice' | 'remed' | 'focus' | 'review' | 'check';

export interface ReportRecord {
  report_id: string;
  learner_id: string;
  item_id: string;
  content_version: string;
  timestamp: string;
  reason: string;
  text: string;
}

export type Snapshot = object;

/** Storage format written by this app. Data marked with a newer version is refused, never overwritten. */
export const STORAGE_SCHEMA = 2;

export interface ArchivedSnapshot {
  archived_at: string;
  reason: string;
  raw: string | null;
}

export interface Store {
  init(): Promise<void>;
  getLearner(): Promise<Learner | null>;
  saveLearner(learner: Learner): Promise<void>;
  listAnswers(): Promise<AnswerRecord[]>;
  /**
   * Atomically appends the answer and saves the session snapshot. Idempotent by answer_id: a
   * replayed duplicate writes nothing (it never rewinds a newer snapshot).
   */
  recordAnswer(record: AnswerRecord, snapshot: Snapshot | null): Promise<void>;
  saveSnapshot(snapshot: Snapshot | null): Promise<void>;
  /** Returns null for a missing or unreadable snapshot; answers are never affected. */
  loadSnapshot(): Promise<Snapshot | null>;
  /** Raw stored snapshot text (even if unreadable), or null when there is none. */
  loadSnapshotRaw(): Promise<string | null>;
  /**
   * One atomic operation: append the current snapshot (raw, byte-for-byte) to the
   * `snapshot_archive` metadata list, install `replacement` (or clear), and optionally set a
   * pending learner notice. A failure leaves everything as it was. Returns whether a snapshot
   * was archived.
   */
  archiveSnapshot(reason: string, replacement: Snapshot | null, notice?: string): Promise<boolean>;
  getMeta(key: string): Promise<string | null>;
  setMeta(key: string, value: string | null): Promise<void>;
  addReport(report: ReportRecord): Promise<void>;
  listReports(): Promise<ReportRecord[]>;
  reset(): Promise<void>;
}
