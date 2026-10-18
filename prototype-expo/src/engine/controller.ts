// Connects the pure session engine to storage. The UI only sees a new state
// after the matching write has succeeded, so a lost write never looks saved.
import type { RulesConfig } from '@/config/rules';
import type { GatedContent } from '@/content/gating';
import type { AnswerRecord, Learner, Store } from '@/storage/types';
import type { Response } from './scoring';
import { loadScreenViews, recordScreenView } from './exposure';
import { advance, currentStep, pauseClock, resumeClock, SESSION_VERSION, startSession, submitAnswer, type SessionState } from './session';
import { isPermutation } from './shuffle';
import { localDate } from './util';

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
  private visible = true;
  /** When the page was hidden while a save was in flight; applied as soon as that save settles. */
  private hiddenAt: number | null = null;
  private afterBusy: (() => void)[] = [];
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
      // A pause requested during the save: stop the clock at the moment of hiding. If the page is
      // visible again already, restart it now, so the hidden interval is never charged.
      if (this.hiddenAt !== null && this.visible) {
        this.state = resumeClock(pauseClock(this.state, this.hiddenAt), this.clock());
        this.hiddenAt = null;
      }
      for (const run of this.afterBusy.splice(0)) run();
    }
  }

  /** One answer event per item: re-entrant or repeated submits are ignored. */
  submit(response: Response, timeOnItemMs: number, hintUsed = false): Promise<SaveResult> {
    return this.guarded(async () => {
      // Fresh read: a Guide view recorded since the session was planned must mark a timed check.
      const step = currentStep(this.state);
      const screenViews = step?.kind === 'item' && step.role === 'check' ? await loadScreenViews(this.store) : [];
      const r = submitAnswer(this.state, response, {
        screenViews,
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

  /**
   * Lifecycle checkpoint (ENG-04): persists the current step's active time and stops its clock.
   * 'ignored' when already paused (no double charge) or finished.
   */
  pause(): Promise<SaveResult> {
    this.visible = false;
    if (this.busy) {
      // An answer or step is still being saved: keep the intent and checkpoint right after it.
      if (this.hiddenAt === null) this.hiddenAt = this.clock();
      return new Promise((resolve) => this.afterBusy.push(() => (this.visible ? resolve('ignored') : void this.pause().then(resolve))));
    }
    const at = this.hiddenAt ?? this.clock();
    this.hiddenAt = null;
    return this.guarded(async () => {
      const next = pauseClock(this.state, at);
      if (next === this.state) return 'ignored';
      await this.store.saveSnapshot(next);
      // Shown again while the checkpoint was saving: the clock restarts from now.
      this.state = this.visible ? resumeClock(next, this.clock()) : next;
      return 'saved';
    });
  }

  /** Restarts the step clock after a pause (in memory; the saved snapshot stays paused until the next save). */
  resume(): void {
    this.visible = true;
    // While a save is in flight the state is replaced when it settles; the finally block restarts the clock.
    if (!this.busy) this.state = resumeClock(this.state, this.clock());
  }

  next(): Promise<SaveResult> {
    return this.guarded(async () => {
      const now = this.clock();
      const next = advance(this.state, now);
      if (next === this.state) return 'ignored';
      // A lesson screen the learner moves past is dated teaching provenance (append-only).
      const step = currentStep(this.state);
      if (step?.kind === 'screen') {
        await recordScreenView(this.store, { screen_id: step.screen_id, local_date: localDate(now), source: 'session', at: new Date(now).toISOString() });
      }
      // Merge new seen screens into the CURRENT stored learner: settings saved meanwhile on another
      // (retained) route must not be overwritten by this controller's older copy.
      let learner = this.learner;
      const newScreens = next.seen_screens.filter((id) => !this.learner.screens_seen.includes(id));
      if (newScreens.length) {
        const current = (await this.store.getLearner()) ?? this.learner;
        if (current.learner_id !== this.learner.learner_id) throw new Error('The stored learner changed; the session was not saved.');
        learner = { ...current, screens_seen: [...current.screens_seen, ...newScreens.filter((id) => !current.screens_seen.includes(id))] };
        await this.store.saveLearner(learner);
      }
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
  // Timing fields added by the 2026-10-16 repair: optional so earlier v2 snapshots stay readable.
  if (v.active_ms !== undefined && (!isNum(v.active_ms) || v.active_ms < 0)) return false;
  if (v.step_started_at !== undefined && v.step_started_at !== null && !isNum(v.step_started_at)) return false;
  if (v.pending_step_ms !== undefined && (!isNum(v.pending_step_ms) || v.pending_step_ms < 0)) return false;
  if (v.completed_at !== undefined && v.completed_at !== null && !isNum(v.completed_at)) return false;
  if (v.step_cap_minutes !== undefined && (!isNum(v.step_cap_minutes) || v.step_cap_minutes <= 0)) return false;
  const queue = v.queue;
  if (!Array.isArray(queue)) return false;
  for (const q of queue) {
    if (!isObj(q)) return false;
    if (q.kind === 'screen') {
      if (!isStr(q.screen_id)) return false;
    } else if (q.kind === 'item') {
      // An absent or wrong option order is judged by the exact-permutation check (invalid-order).
      if (!isStr(q.item_id) || !ROLES.has(q.role as string) || !(q.option_order === undefined || isStrArr(q.option_order))) return false;
      if (q.target_skill !== undefined && !isStr(q.target_skill)) return false;
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
    if (fb.deferred !== undefined && typeof fb.deferred !== 'boolean') return false;
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
  // Cross-day policy (ENG-05): a session left unfinished on an earlier day is not resumed with its
  // stale queue/budget. It is archived intact; open serious-error follow-ups are restored from the
  // answer log in today's plan, and no offline time is charged.
  const rollover = status.kind === 'ok' && status.state.phase !== 'done' && status.state.local_date < localDate(a.now);
  if (status.kind === 'ok' && status.state.phase !== 'done' && !rollover) {
    // Same-day resume: restart the step clock, so time with the app closed is never charged as active time.
    return { kind: 'resume', state: { ...status.state, step_started_at: a.now }, learner, history };
  }

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
    screenViews: await loadScreenViews(a.store),
  });
  const archive = rollover ? { reason: 'day-rollover', notice: 'day-rollover' } : ARCHIVE_REASON[status.kind];
  if (state.phase === 'done') {
    if (archive) await a.store.archiveSnapshot(archive.reason, null, archive.notice);
    return { kind: 'nothing-due', learner, history, notice: archive?.notice };
  }
  if (archive) await a.store.archiveSnapshot(archive.reason, state, archive.notice);
  else await a.store.saveSnapshot(state);
  return { kind: 'new', state, learner, history, notice: archive?.notice };
}
