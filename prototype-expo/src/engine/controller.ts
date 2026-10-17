// Connects the pure session engine to storage. The UI only sees a new state
// after the matching write has succeeded, so a lost write never looks saved.
import type { RulesConfig } from '@/config/rules';
import type { GatedContent } from '@/content/gating';
import type { AnswerRecord, Learner, Store } from '@/storage/types';
import type { Response } from './scoring';
import { advance, submitAnswer, type SessionState } from './session';

export type SaveResult = 'saved' | 'ignored' | 'failed';

export interface ControllerArgs {
  store: Store;
  content: GatedContent;
  rules: RulesConfig;
  learner: Learner;
  history: AnswerRecord[];
  state: SessionState;
  clock?: () => number;
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

  constructor(a: ControllerArgs) {
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

/** Validates a stored snapshot against the current content; returns null if it cannot be resumed. */
export function restoreSnapshot(raw: unknown, content: GatedContent): SessionState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Partial<SessionState>;
  if (s.version !== 1 || !Array.isArray(s.queue) || typeof s.index !== 'number' || typeof s.session_id !== 'string') {
    return null;
  }
  if (s.content_version !== content.content_version) return null;
  const itemIds = new Set(content.items.map((i) => i.item_id));
  const screenIds = new Set(content.screens.map((x) => x.screen_id));
  const ok = s.queue.every((q) => (q.kind === 'item' ? itemIds.has(q.item_id) : screenIds.has(q.screen_id)));
  return ok ? (s as SessionState) : null;
}
