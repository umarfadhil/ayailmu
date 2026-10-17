// Daily session state machine (Trial_App_Spec.md §4, §6). Pure functions over plain-JSON state,
// so the state can be saved as a snapshot and resumed after a restart.
import type { RulesConfig } from '@/config/rules';
import type { GatedContent } from '@/content/gating';
import type { ErrorTag, Item } from '@/content/schema';
import type { AnswerRecord } from '@/storage/types';
import { type AttemptLog, pickFocusItem, pickFreshItem } from './freshness';
import { scoreItem, type Outcome, type Response } from './scoring';
import { addDays, localDate, newId } from './util';

export type Step =
  | { kind: 'screen'; screen_id: string }
  | { kind: 'item'; item_id: string; role: 'practice' | 'remed' | 'focus' };

export interface FeedbackView {
  item_id: string;
  outcome: Outcome;
  messages: string[];
}

export interface SessionState {
  version: 1;
  session_id: string;
  learner_id: string;
  app_version: string;
  content_version: string;
  rules_version: string;
  started_at: number;
  local_date: string;
  budget_minutes: number;
  queue: Step[];
  index: number;
  phase: 'step' | 'feedback' | 'done';
  feedback: FeedbackView | null;
  results: { item_id: string; outcome: Outcome; role: Extract<Step, { kind: 'item' }>['role'] }[];
  /** Attempts made in this session (history is reloaded from the log between sessions). */
  attempts: AttemptLog[];
  /** Skill whose serious mistake each queued focus question follows up. */
  focus_skill: Record<string, string>;
  seen_screens: string[];
  flags: string[];
}

export interface StartArgs {
  content: GatedContent;
  rules: RulesConfig;
  history: AnswerRecord[];
  learnerId: string;
  now: number;
  budgetMinutes: number;
  screensSeen: string[];
  appVersion: string;
}

export interface Env {
  content: GatedContent;
  rules: RulesConfig;
  history: AnswerRecord[];
  now: number;
  timeOnItemMs: number;
  hintUsed?: boolean;
}

const toAttempt = (r: Pick<AnswerRecord, 'item_id' | 'local_date' | 'pool' | 'skills' | 'unit' | 'first_attempt' | 'hint_used'>): AttemptLog => ({
  item_id: r.item_id,
  local_date: r.local_date,
  pool: r.pool,
  skills: r.skills,
  unit: r.unit,
  first_attempt: r.first_attempt,
  hint_used: r.hint_used,
});

export function startSession(a: StartArgs): SessionState {
  const today = localDate(a.now);
  const queue: Step[] = a.content.screens
    .filter((s) => !a.screensSeen.includes(s.screen_id))
    .map((s) => ({ kind: 'screen', screen_id: s.screen_id }));

  // Planning estimate: about one practice item per minute. The time budget still stops the session.
  const ctx = { today, history: a.history.map(toAttempt), rules: a.rules };
  const picked = new Set<string>();
  while (picked.size < a.budgetMinutes) {
    const next = pickFreshItem(a.content.items, ctx, { pools: ['PRACT'], exclude: picked });
    if (!next) break;
    picked.add(next.item_id);
    queue.push({ kind: 'item', item_id: next.item_id, role: 'practice' });
  }

  return {
    version: 1,
    session_id: newId('ses'),
    learner_id: a.learnerId,
    app_version: a.appVersion,
    content_version: a.content.content_version,
    rules_version: a.rules.rules_version,
    started_at: a.now,
    local_date: today,
    budget_minutes: a.budgetMinutes,
    queue,
    index: 0,
    phase: queue.length ? 'step' : 'done',
    feedback: null,
    results: [],
    attempts: [],
    focus_skill: {},
    seen_screens: [],
    flags: [],
  };
}

export function currentStep(s: SessionState): Step | null {
  return s.phase === 'done' ? null : (s.queue[s.index] ?? null);
}

export function findItem(content: GatedContent, id: string): Item {
  const item = content.items.find((i) => i.item_id === id);
  if (!item) throw new Error(`Item ${id} is not available in this content`);
  return item;
}

function fill(template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/**
 * Scores the current item and returns the new state plus one answer event.
 * Returns record=null (and the same state) if the current step is not an
 * unanswered item, so a double tap can never produce a second answer event.
 */
export function submitAnswer(
  s: SessionState,
  response: Response,
  env: Env
): { state: SessionState; record: AnswerRecord | null } {
  const step = currentStep(s);
  if (s.phase !== 'step' || !step || step.kind !== 'item') return { state: s, record: null };

  const item = findItem(env.content, step.item_id);
  const score = scoreItem(item, response, env.rules);
  const today = localDate(env.now);
  const hint = !!env.hintUsed;
  const seenBefore =
    env.history.some((h) => h.item_id === item.item_id) || s.attempts.some((h) => h.item_id === item.item_id);
  const focusSkill = step.role === 'focus' ? s.focus_skill[item.item_id] : undefined;
  const skills = focusSkill ? [focusSkill] : item.skills;

  const record: AnswerRecord = {
    answer_id: newId('ans'),
    learner_id: s.learner_id,
    item_id: item.item_id,
    content_version: item.content_version,
    rules_version: env.rules.rules_version,
    app_version: s.app_version,
    timestamp: new Date(env.now).toISOString(),
    local_date: today,
    session_id: s.session_id,
    pool: item.pool,
    unit: item.unit,
    skills,
    raw_response: JSON.stringify(response),
    auto_score: score.parts,
    outcome: score.outcome,
    error_tags: score.error_tags,
    serious_tag: step.role === 'focus' ? null : score.serious,
    hint_used: hint,
    help_lines_shown: item.help_lines.map((h) => h.word),
    first_attempt: !seenBefore,
    fresh_evidence: !seenBefore && !hint && item.pool !== 'INSTR' && item.pool !== 'FOCUS',
    time_on_item_ms: Math.max(0, Math.round(env.timeOnItemMs)),
    audio_status: null,
    report_flag: false,
    review_status: item.review_status,
    synthetic: item.item_id.startsWith('DEMO-'),
  };

  // Follow-up after a mistake: focused question (serious only), then a fresh REMED item.
  const attempts = [...s.attempts, toAttempt(record)];
  const inserts: Extract<Step, { kind: 'item' }>[] = [];
  const focus_skill = { ...s.focus_skill };
  const flags = [...s.flags];
  const primary = item.skills[0];
  if (step.role !== 'focus' && score.outcome === 'wrong' && item.type !== 'q-mean' && primary) {
    if (score.serious) {
      const focus = pickFocusItem(env.content.items, score.serious, item.referent);
      if (focus) {
        inserts.push({ kind: 'item', item_id: focus.item_id, role: 'focus' });
        focus_skill[focus.item_id] = primary;
      }
    }
    const queued = new Set(s.queue.filter((q) => q.kind === 'item').map((q) => (q as { item_id: string }).item_id));
    const remed = pickFreshItem(
      env.content.items,
      { today, history: [...env.history.map(toAttempt), ...attempts], rules: env.rules },
      { pools: ['REMED'], skill: primary, exclude: queued }
    );
    if (remed) inserts.push({ kind: 'item', item_id: remed.item_id, role: 'remed' });
    else if (!flags.includes(`out-of-fresh:${primary}`)) flags.push(`out-of-fresh:${primary}`);
  }

  const correctOption = item.options?.find((o) => o.correct)?.text;
  const vars = {
    kalimat: item.arabic,
    model: item.model_answer,
    kata: item.arabic,
    makna: item.word_meaning,
    benar: correctOption,
  };
  const messages = score.feedback_ids
    .map((id) => env.content.feedback[id])
    .filter(Boolean)
    .map((t) => fill(t, vars));

  return {
    record,
    state: {
      ...s,
      queue: [...s.queue.slice(0, s.index + 1), ...inserts, ...s.queue.slice(s.index + 1)],
      phase: 'feedback',
      feedback: { item_id: item.item_id, outcome: score.outcome, messages },
      results: [...s.results, { item_id: item.item_id, outcome: score.outcome, role: step.role }],
      attempts,
      focus_skill,
      flags,
    },
  };
}

/** Moves to the next step. Stops at the time budget, at the end of the current item. */
export function advance(s: SessionState, now: number): SessionState {
  const step = currentStep(s);
  if (!step) return s;
  if (step.kind === 'item' && s.phase !== 'feedback') return s; // must answer first
  const seen_screens =
    step.kind === 'screen' && !s.seen_screens.includes(step.screen_id) ? [...s.seen_screens, step.screen_id] : s.seen_screens;
  const index = s.index + 1;
  const overBudget = step.kind === 'item' && now - s.started_at >= s.budget_minutes * 60_000;
  const done = index >= s.queue.length || overBudget;
  return { ...s, index, seen_screens, phase: done ? 'done' : 'step', feedback: null };
}

/** Serious mistakes still blocking "learned": need a correct focused question AND a correct fresh REMED item. */
export function unresolvedSerious(history: AnswerRecord[]): { skill: string; tag: ErrorTag }[] {
  const open = new Map<string, { tag: ErrorTag; focus: boolean; remed: boolean }>();
  for (const r of history) {
    const skill = r.skills[0];
    if (!skill) continue;
    if (r.serious_tag && r.pool !== 'FOCUS') {
      open.set(skill, { tag: r.serious_tag, focus: false, remed: false });
      continue;
    }
    const o = open.get(skill);
    if (!o || r.outcome !== 'correct') continue;
    if (r.pool === 'FOCUS') o.focus = true;
    if (r.pool === 'REMED' && r.fresh_evidence) o.remed = true;
    if (o.focus && o.remed) open.delete(skill);
  }
  return [...open.entries()].map(([skill, o]) => ({ skill, tag: o.tag }));
}

export interface SessionSummary {
  answered: number;
  correct: number;
  wrong: number;
  pending: number;
  dont_know: number;
  items: string[];
  follow_ups: number;
  minutes: number;
  next_review_date: string;
  flags: string[];
}

/** Counts only. Deliberately makes no "learned"/mastery claim (pilot rules are not evaluated here). */
export function summarize(s: SessionState, rules: RulesConfig, now = s.started_at): SessionSummary {
  const count = (o: Outcome) => s.results.filter((r) => r.outcome === o).length;
  return {
    answered: s.results.length,
    correct: count('correct'),
    wrong: count('wrong'),
    pending: count('pending'),
    dont_know: count('dont_know'),
    items: [...new Set(s.results.filter((r) => r.role !== 'focus').map((r) => r.item_id))],
    follow_ups: s.results.filter((r) => r.role !== 'practice').length,
    minutes: Math.max(0, Math.round((now - s.started_at) / 60_000)),
    next_review_date: addDays(s.local_date, rules.review_spacing_days[0]),
    flags: s.flags,
  };
}
