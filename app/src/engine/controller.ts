// Connects the pure session engine to storage. The UI only sees a new state
// after the matching write has succeeded, so a lost write never looks saved.
import type { RulesConfig } from '@/config/rules';
import type { GatedContent } from '@/content/gating';
import type { AnswerRecord, Learner, Store } from '@/storage/types';
import type { Response } from './scoring';
import { advance, SESSION_VERSION, startSession, submitAnswer, type SessionState } from './session';
import { isPermutation } from './shuffle';

export type SaveResult = 'saved' | 'ignored' | 'failed';

export interface ControllerArgs {
  store: Store;
  content: GatedContent;
  rules: RulesConfig;
  learner: Learner;
  history: AnswerRecord[];
  state: SessionState;
  clock?: () => number;
  rng?: () => number;
}

export class SessionController {
  state: SessionState;
  learner: Learner;
  history: AnswerRecord[];
  error: string | null = null;
  private busy = false;
  private store: Store;
  private content: GatedContent;
  private rules: RulesConfig;
  private clock: () => number;
  private rng: () => number;

  constructor(a: ControllerArgs) {
    this.rng = a.rng ?? Math.random;
    this.store = a.store;
    this.content = a.content;
    this.rules = a.rules;
    this.learner = a.learner;
    this.history = a.history;
    this.state = a.state;
    this.clock = a.clock ?? Date.now;
  }

  get isBusy() {
    return this.busy;
  }

  private async guarded(task: () => Promise<'saved' | 'ignored'>): Promise<SaveResult> {
    if (this.busy) return 'ignored';
    this.busy = true;
    try {
      const r = await task();
      if (r === 'saved') this.error = null;
      return r;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return 'failed';
    } finally {
      this.busy = false;
    }
  }

  /** One answer event per item: re-entrant or repeated submits are ignored. */
  submit(response: Response, timeOnItemMs: number, hintUsed = false): Promise<SaveResult> {
    return this.guarded(async () => {
      const r = submitAnswer(this.state, response, {
        content: this.content,
        rules: this.rules,
        history: this.history,
        now: this.clock(),
        timeOnItemMs,
        hintUsed,
        rng: this.rng,
      });
      if (!r.record) return 'ignored';
      await this.store.recordAnswer(r.record, r.state); // atomic: answer + snapshot
      this.history = [...this.history, r.record];
      this.state = r.state;
      return 'saved';
    });
  }

  next(): Promise<SaveResult> {
    return this.guarded(async () => {
      const next = advance(this.state, this.clock());
      if (next === this.state) return 'ignored';
      const newScreens = next.seen_screens.filter((id) => !this.learner.screens_seen.includes(id));
      const learner = newScreens.length
        ? { ...this.learner, screens_seen: [...this.learner.screens_seen, ...newScreens] }
        : this.learner;
      if (learner !== this.learner) await this.store.saveLearner(learner);
      await this.store.saveSnapshot(next);
      this.learner = learner;
      this.state = next;
      return 'saved';
    });
  }
}

const ROLES = new Set(['practice', 'remed', 'focus', 'review', 'check']);
const OUTCOMES = new Set(['correct', 'wrong', 'pending', 'dont_know']);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isDate = (v: unknown) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Complete runtime shape check for a v2 session snapshot (REV-1). Anything else is unreadable. */
function isWellFormedState(v: unknown): boolean {
  if (!isObj(v)) return false;
  for (const k of ['session_id', 'learner_id', 'app_version', 'content_version', 'rules_version']) if (!isStr(v[k])) return false;
  if (!isNum(v.started_at) || !isDate(v.local_date)) return false;
  if (!isNum(v.budget_minutes) || !Number.isInteger(v.budget_minutes) || v.budget_minutes <= 0) return false;
  if (!isNum(v.review_ms) || v.review_ms < 0 || !isNum(v.review_share) || v.review_share < 0 || v.review_share > 1) return false;
  const queue = v.queue;
  if (!Array.isArray(queue)) return false;
  for (const q of queue) {
    if (!isObj(q)) return false;
    if (q.kind === 'screen') {
      if (!isStr(q.screen_id)) return false;
    } else if (q.kind === 'item') {
      // An absent or wrong option order is judged by the exact-permutation check (invalid-order).
      if (!isStr(q.item_id) || !ROLES.has(q.role as string) || !(q.option_order === undefined || isStrArr(q.option_order))) return false;
    } else return false;
  }
  const phase = v.phase;
  if (phase !== 'step' && phase !== 'feedback' && phase !== 'done') return false;
  const index = v.index;
  if (!isNum(index) || !Number.isInteger(index) || index < 0 || index > queue.length) return false;
  if (phase !== 'done' && index >= queue.length) return false;
  const current = queue[index] as Record<string, unknown> | undefined;
  if (phase === 'feedback') {
    const fb = v.feedback;
    if (!isObj(fb) || !current || current.kind !== 'item' || fb.item_id !== current.item_id) return false;
    if (!OUTCOMES.has(fb.outcome as string) || !isStrArr(fb.messages)) return false;
    if (!(fb.selected_option_id === null || isStr(fb.selected_option_id))) return false;
    if (!(fb.correct_option_id === null || isStr(fb.correct_option_id))) return false;
  } else if (v.feedback !== null) return false;
  if (!Array.isArray(v.results) || !v.results.every((r) => isObj(r) && isStr(r.item_id) && OUTCOMES.has(r.outcome as string) && ROLES.has(r.role as string))) {
    return false;
  }
  if (!Array.isArray(v.attempts) || !v.attempts.every((a) => isObj(a) && isStr(a.item_id) && isDate(a.local_date))) return false;
  if (!isObj(v.focus_skill) || !Object.values(v.focus_skill).every(isStr)) return false;
  if (!isStrArr(v.seen_screens) || !isStrArr(v.flags)) return false;
  return true;
}

export type SnapshotStatus =
  | { kind: 'none' }
  | { kind: 'ok'; state: SessionState }
  | { kind: 'legacy' }
  | { kind: 'unreadable' }
  | { kind: 'future'; version: unknown }
  | { kind: 'content-changed' }
  | { kind: 'invalid-order' };

/**
 * Classifies a stored snapshot (raw text) against the current content. Only 'ok' can be resumed.
 * A saved option order must be an exact permutation of the item's current options; otherwise the
 * snapshot is set aside rather than graded with a different order.
 */
export function classifySnapshot(raw: string | null, content: GatedContent): SnapshotStatus {
  if (raw === null) return { kind: 'none' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'unreadable' };
  }
  if (!parsed || typeof parsed !== 'object') return { kind: 'unreadable' };
  const s = parsed as Omit<Partial<SessionState>, 'version'> & { version?: unknown };
  if (typeof s.version === 'number' && s.version > SESSION_VERSION) return { kind: 'future', version: s.version };
  if (s.version === 1) return { kind: 'legacy' };
  if (s.version !== SESSION_VERSION || !isWellFormedState(parsed)) return { kind: 'unreadable' };
  if (s.content_version !== content.content_version) return { kind: 'content-changed' };
  const items = new Map(content.items.map((i) => [i.item_id, i]));
  const screenIds = new Set(content.screens.map((x) => x.screen_id));
  for (const q of s.queue!) {
    if (q.kind === 'screen') {
      if (!screenIds.has(q.screen_id)) return { kind: 'content-changed' };
      continue;
    }
    const item = items.get(q.item_id);
    if (!item) return { kind: 'content-changed' };
    if (!isPermutation(q.option_order, (item.options ?? []).map((o) => o.id))) return { kind: 'invalid-order' };
  }
  return { kind: 'ok', state: s as unknown as SessionState };
}

/** Validates a stored snapshot against the current content; returns null if it cannot be resumed. */
export function restoreSnapshot(raw: unknown, content: GatedContent): SessionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = classifySnapshot(JSON.stringify(raw), content);
  return status.kind === 'ok' ? status.state : null;
}

const ARCHIVE_REASON: Partial<Record<SnapshotStatus['kind'], { reason: string; notice: string }>> = {
  legacy: { reason: 'format-change-v1', notice: 'format-change' },
  unreadable: { reason: 'unreadable-snapshot', notice: 'snapshot-unreadable' },
  'content-changed': { reason: 'content-version-change', notice: 'format-change' },
  'invalid-order': { reason: 'invalid-option-order', notice: 'order-invalid' },
};

export type Prepared =
  | { kind: 'resume'; state: SessionState; learner: Learner; history: AnswerRecord[] }
  | { kind: 'new'; state: SessionState; learner: Learner; history: AnswerRecord[]; notice?: string }
  | { kind: 'nothing-due'; learner: Learner; history: AnswerRecord[]; notice?: string }
  | { kind: 'refused'; reason: string };

/**
 * Opens the session to show: resume a valid in-progress snapshot, or plan a new one.
 * - An incompatible snapshot (v1 typed format, unreadable, other content version, invalid option
 *   order) is archived byte-for-byte in the same atomic write that installs the new session.
 * - A snapshot from a future app version is refused with no write.
 * - The new session is persisted before it is shown. With nothing to do, nothing is written, so
 *   the last real summary is never replaced by an empty session.
 */
export async function prepareSession(a: {
  store: Store;
  content: GatedContent;
  rules: RulesConfig;
  now: number;
  appVersion: string;
  rng?: () => number;
}): Promise<Prepared> {
  const learner = await a.store.getLearner();
  if (!learner) throw new Error('No learner: consent and setup come first');
  const history = await a.store.listAnswers();
  const status = classifySnapshot(await a.store.loadSnapshotRaw(), a.content);
  if (status.kind === 'future') {
    return { kind: 'refused', reason: `Sesi tersimpan berasal dari versi aplikasi yang lebih baru (${String(status.version)}).` };
  }
  if (status.kind === 'ok' && status.state.phase !== 'done') return { kind: 'resume', state: status.state, learner, history };

  const state = startSession({
    content: a.content,
    rules: a.rules,
    history,
    learnerId: learner.learner_id,
    now: a.now,
    budgetMinutes: learner.session_minutes,
    screensSeen: learner.screens_seen,
    appVersion: a.appVersion,
    rng: a.rng,
  });
  const archive = ARCHIVE_REASON[status.kind];
  if (state.phase === 'done') {
    if (archive) await a.store.archiveSnapshot(archive.reason, null, archive.notice);
    return { kind: 'nothing-due', learner, history, notice: archive?.notice };
  }
  if (archive) await a.store.archiveSnapshot(archive.reason, state, archive.notice);
  else await a.store.saveSnapshot(state);
  return { kind: 'new', state, learner, history, notice: archive?.notice };
}
