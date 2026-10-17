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
}

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

export interface Store {
  init(): Promise<void>;
  getLearner(): Promise<Learner | null>;
  saveLearner(learner: Learner): Promise<void>;
  listAnswers(): Promise<AnswerRecord[]>;
  /** Atomically appends the answer (idempotent by answer_id) and saves the session snapshot. */
  recordAnswer(record: AnswerRecord, snapshot: Snapshot | null): Promise<void>;
  saveSnapshot(snapshot: Snapshot | null): Promise<void>;
  /** Returns null for a missing or unreadable snapshot; answers are never affected. */
  loadSnapshot(): Promise<Snapshot | null>;
  addReport(report: ReportRecord): Promise<void>;
  listReports(): Promise<ReportRecord[]>;
  reset(): Promise<void>;
}
