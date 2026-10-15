// Daily session state machine (Trial_App_Spec.md §4, §6). Pure functions over plain-JSON state,
// so the state can be saved as a snapshot and resumed after a restart.
//
// Session v2 (four-choice): every item step carries its option order, generated once when the step
// is queued or inserted and persisted in the snapshot. Reload, retry and resize reuse it.
import type { RulesConfig } from '@/config/rules';
import type { GatedContent } from '@/content/gating';
import type { ErrorTag, Item, Pool } from '@/content/schema';
import type { AnswerRecord, StepRole } from '@/storage/types';
import { type AttemptLog, isEligibleFresh, pickFocusItem, pickFreshItem } from './freshness';
import { dueReviews, reviewStates } from './reviews';
import { scoreItem, type Outcome, type Response } from './scoring';
import { optionOrder } from './shuffle';
import { localDate, newId } from './util';

export const SESSION_VERSION = 2;

export type ItemStep = { kind: 'item'; item_id: string; role: StepRole; option_order: string[] };
export type Step = { kind: 'screen'; screen_id: string } | ItemStep;

export interface FeedbackView {
  item_id: string;
  outcome: Outcome;
  messages: string[];
  /** Selected option and the key, for showing the result on the tiles. */
  selected_option_id: string | null;
  correct_option_id: string | null;
}

export interface SessionState {
  version: 2;
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
  results: { item_id: string; outcome: Outcome; role: StepRole }[];
  /** Attempts made in this session (history is reloaded from the log between sessions). */
  attempts: AttemptLog[];
  /** Skill whose serious mistake each queued focus question follows up. */
  focus_skill: Record<string, string>;
  seen_screens: string[];
  flags: string[];
  /** Time spent on review steps (ms): reviews stop at an item boundary once their share is used. */
  review_ms: number;
  /** review_share_max captured at session start, so a config change mid-session does not alter it. */
  review_share: number;
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
  rng?: () => number;
}

export interface Env {
  content: GatedContent;
  rules: RulesConfig;
  history: AnswerRecord[];
  now: number;
  timeOnItemMs: number;
  hintUsed?: boolean;
  rng?: () => number;
}

export function findItem(content: GatedContent, id: string): Item {
  const item = content.items.find((i) => i.item_id === id);
  if (!item) throw new Error(`Item ${id} is not available in this content`);
  return item;
}

/** Arabic forms an item displays (stem, help words, Arabic options). */
export function displayedForms(item: Item): string[] {
  const forms = new Set<string>(item.forms ?? []);
  const add = (t: string) => t.split(/[\s.,:«»]+/).filter(Boolean).forEach((w) => /[ء-ي]/.test(w) && forms.add(w));
  add(item.arabic);
  item.help_lines.forEach((h) => add(h.word));
  (item.options ?? []).filter((o) => o.arabic).forEach((o) => add(o.text));
  return [...forms];
}

/** Attempt summary of a logged answer, with lineage resolved across content versions. */
export function toAttempt(r: AnswerRecord, content: GatedContent): AttemptLog {
  const item = content.items.find((i) => i.item_id === r.item_id);
  return {
    item_id: r.item_id,
    lineage: r.lineage ?? content.lineage[r.item_id] ?? `id:${r.item_id}`,
    forms: item ? displayedForms(item) : undefined,
    role: r.role,
    local_date: r.local_date,
    pool: r.pool,
    skills: r.skills,
    unit: r.unit,
    first_attempt: r.first_attempt,
    hint_used: r.hint_used,
  };
}

/** A queued/inserted item step with its option order generated once (never at render). */
export function makeItemStep(content: GatedContent, itemId: string, role: StepRole, rng: () => number = Math.random): ItemStep {
  const item = findItem(content, itemId);
  return { kind: 'item', item_id: itemId, role, option_order: optionOrder((item.options ?? []).map((o) => o.id), rng) };
}

/** Units whose lesson is open, in order. A later unit starts after the previous unit's core work (practice progression, not mastery). */
export function openUnits(content: GatedContent, rules: RulesConfig, history: AttemptLog[], screensSeen: string[]): ('A' | 'B')[] {
  const open: ('A' | 'B')[] = [];
  const attempted = new Set(history.map((h) => h.lineage));
  for (const unit of rules.unit_order) {
    open.push(unit);
    const screensDone = content.screens.filter((s) => s.unit === unit).every((s) => screensSeen.includes(s.screen_id));
    const coreDone = content.items
      .filter((i) => i.unit === unit && i.pool === 'PRACT')
      .every((i) => attempted.has(i.lineage ?? `id:${i.item_id}`));
    if (!(screensDone && coreDone)) break;
  }
  return open;
}

/** The unit currently being taught: the last open unit. */
export function currentUnit(content: GatedContent, rules: RulesConfig, history: AttemptLog[], screensSeen: string[]): 'A' | 'B' {
  const open = openUnits(content, rules, history, screensSeen);
  return open[open.length - 1];
}

/**
 * Plans a session (spec §6): due D7/D30 checks first, then due reviews (at most
 * floor(budget × review_share_max) slots), then the current lesson (unseen screens, fresh
 * PRACT/READY). About one item per minute; the time budget still stops the session.
 */
export function startSession(a: StartArgs): SessionState {
  const rng = a.rng ?? Math.random;
  const today = localDate(a.now);
  const history = a.history.map((r) => toAttempt(r, a.content));
  const open = openUnits(a.content, a.rules, history, a.screensSeen);
  const unit = open[open.length - 1];
  const ctx = { today, history, rules: a.rules };
  const budget = a.budgetMinutes;
  const queue: Step[] = [];

  // 1. Due timed checks (2–3 per skill where content allows; never padded).
  const perSkill = new Map<string, number>();
  for (const pool of ['D7', 'D30'] as const) {
    for (const item of a.content.items) {
      if (queue.length >= budget) break;
      if (item.pool !== pool || !open.includes(item.unit as 'A' | 'B')) continue;
      if (!isEligibleFresh(item, ctx, a.content.items)) continue;
      const capKey = `${pool}:${item.skills[0] ?? item.item_id}`; // 2–3 items per skill per check
      const count = perSkill.get(capKey) ?? 0;
      if (count >= a.rules.checks_per_skill_max) continue;
      perSkill.set(capKey, count + 1);
      queue.push(makeItemStep(a.content, item.item_id, 'check', rng));
    }
  }

  // 2. Due reviews, capped by the review share of the session.
  const reviewCap = Math.min(Math.floor(budget * a.rules.review_share_max), budget - queue.length);
  if (reviewCap > 0) {
    const due = dueReviews(reviewStates(a.history, a.content, a.rules), today).slice(0, reviewCap);
    for (const r of due) queue.push(makeItemStep(a.content, r.review_item_id!, 'review', rng));
  }

  // 3. Current lesson: unfinished serious-mistake follow-ups first (restored from the durable log,
  //    e.g. when a previous session reached its time limit), then unseen screens of the current
  //    unit, then fresh practice/readiness items.
  const lessonSlots = budget - queue.length;
  const focus_skill: Record<string, string> = {};
  const flags: string[] = [];
  const picked = new Set<string>();
  if (lessonSlots > 0) {
    for (const o of openObligations(a.history, a.content)) {
      if (picked.size >= lessonSlots) break;
      if (o.needs_focus) {
        const focus = pickFocusItem(a.content.items, o.tag, o.referent, o.unit);
        if (focus) {
          queue.push(makeItemStep(a.content, focus.item_id, 'focus', rng));
          focus_skill[focus.item_id] = o.skill;
          picked.add(focus.item_id);
        }
      }
      if (o.needs_remed && picked.size < lessonSlots) {
        const remed = pickFreshItem(
          a.content.items.filter((i) => i.unit === o.unit),
          ctx,
          { pools: ['REMED'], skill: o.skill, exclude: picked }
        );
        if (remed) {
          queue.push(makeItemStep(a.content, remed.item_id, 'remed', rng));
          picked.add(remed.item_id);
        } else if (!flags.includes(`out-of-fresh:${o.skill}`)) flags.push(`out-of-fresh:${o.skill}`);
      }
    }
    for (const sc of a.content.screens) {
      if (sc.unit === unit && !a.screensSeen.includes(sc.screen_id)) queue.push({ kind: 'screen', screen_id: sc.screen_id });
    }
    const take = (items: Item[], pools: Pool[]) => {
      while (picked.size < lessonSlots) {
        const next = pickFreshItem(items, ctx, { pools, exclude: picked });
        if (!next) break;
        picked.add(next.item_id);
        queue.push(makeItemStep(a.content, next.item_id, 'practice', rng));
      }
    };
    // Readiness work still open in an earlier unit (it only becomes eligible after that unit's
    // last core practice, i.e. after the next unit has opened), then the current unit.
    take(a.content.items.filter((i) => i.unit !== unit && open.includes(i.unit as 'A' | 'B')), ['READY']);
    take(a.content.items.filter((i) => i.unit === unit), ['PRACT', 'READY']);
  }

  return {
    version: 2,
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
    focus_skill,
    seen_screens: [],
    flags,
    review_ms: 0,
    review_share: a.rules.review_share_max,
  };
}

export function currentStep(s: SessionState): Step | null {
  return s.phase === 'done' ? null : (s.queue[s.index] ?? null);
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

  const rng = env.rng ?? Math.random;
  const item = findItem(env.content, step.item_id);
  const score = scoreItem(item, response, env.rules);
  const today = localDate(env.now);
  const hint = !!env.hintUsed;
  const lineage = item.lineage ?? env.content.lineage[item.item_id] ?? `id:${item.item_id}`;
  const prior = [...env.history.map((r) => toAttempt(r, env.content)), ...s.attempts];
  const seenBefore = prior.some((h) => h.item_id === item.item_id || (!!h.lineage && h.lineage === lineage));
  const focusSkill = step.role === 'focus' ? s.focus_skill[item.item_id] : undefined;
  const skills = focusSkill ? [focusSkill] : item.skills;
  const isReview = step.role === 'review';
  const mcq = item.type === 'mcq4';
  const order = step.option_order ?? [];
  const optionById = new Map((item.options ?? []).map((o) => [o.id, o]));
  const selected = response.kind === 'choice' ? response.option_id : null;

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
    pool: isReview ? 'REVIEW' : item.pool,
    unit: item.unit,
    skills,
    raw_response: JSON.stringify(response),
    auto_score: score.parts,
    outcome: score.outcome,
    error_tags: score.error_tags,
    serious_tag: step.role === 'focus' ? null : score.serious,
    hint_used: hint,
    help_lines_shown: item.help_lines.map((h) => h.word),
    first_attempt: !seenBefore && !isReview,
    fresh_evidence:
      !seenBefore && !isReview && !hint && !item.practice_only && item.pool !== 'INSTR' && item.pool !== 'FOCUS',
    time_on_item_ms: Math.max(0, Math.round(env.timeOnItemMs)),
    audio_status: null,
    report_flag: false,
    review_status: item.review_status,
    // Authoritative pack flag, never inferred from the item ID.
    synthetic: env.content.synthetic,
    ...(mcq
      ? {
          answer_schema: 2 as const,
          evidence_mode: 'recognition-4' as const,
          lineage,
          role: step.role,
          presented_options: order.map((id, position) => ({ id, text: optionById.get(id)?.text ?? '', position })),
          selected_option_id: selected,
          selected_position: selected === null ? null : order.indexOf(selected),
          misconceptions: score.error_tags,
        }
      : {}),
  };

  // Follow-up after a mistake: focused question (serious only), then a fresh REMED item, both in the item's own unit.
  const attempts = [...s.attempts, toAttempt(record, env.content)];
  const inserts: ItemStep[] = [];
  const focus_skill = { ...s.focus_skill };
  const flags = [...s.flags];
  const primary = item.skills[0];
  const isWordItem = item.type === 'q-mean' || item.format === 'word-meaning';
  if (step.role !== 'focus' && score.outcome === 'wrong' && !isWordItem && !item.practice_only && primary) {
    if (score.serious) {
      const focus = pickFocusItem(env.content.items, score.serious, item.referent, item.unit);
      if (focus) {
        inserts.push(makeItemStep(env.content, focus.item_id, 'focus', rng));
        focus_skill[focus.item_id] = primary;
      }
    }
    const queued = new Set(s.queue.filter((q): q is ItemStep => q.kind === 'item').map((q) => q.item_id));
    const remed = pickFresh(env, today, [...prior, attempts[attempts.length - 1]], primary, item.unit, queued);
    if (remed) inserts.push(makeItemStep(env.content, remed.item_id, 'remed', rng));
    else if (!flags.includes(`out-of-fresh:${primary}`)) flags.push(`out-of-fresh:${primary}`);
  }

  const correct = item.options?.find((o) => o.correct);
  const chosen = selected ? optionById.get(selected) : undefined;
  const vars = {
    kalimat: item.arabic,
    model: item.model_answer ?? correct?.text,
    kata: item.arabic,
    makna: item.word_meaning,
    benar: correct?.text,
    pilihan: chosen?.text,
    target: item.target,
    target_gender: item.referent,
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
      feedback: {
        item_id: item.item_id,
        outcome: score.outcome,
        messages,
        selected_option_id: selected,
        correct_option_id: correct?.id ?? null,
      },
      results: [...s.results, { item_id: item.item_id, outcome: score.outcome, role: step.role }],
      attempts,
      focus_skill,
      flags,
      review_ms: s.review_ms + (isReview ? Math.max(0, Math.round(env.timeOnItemMs)) : 0),
    },
  };
}

function pickFresh(
  env: Env,
  today: string,
  history: AttemptLog[],
  skill: string,
  unit: Item['unit'],
  exclude: Set<string>
): Item | null {
  return pickFreshItem(
    env.content.items.filter((i) => i.unit === unit),
    { today, history, rules: env.rules },
    { pools: ['REMED'], skill, exclude }
  );
}

/**
 * Moves to the next step. Stops at the time budget, at the end of the current item. Review
 * steps are skipped at an item boundary once their time share (review_share_max) is used up.
 */
export function advance(s: SessionState, now: number): SessionState {
  const step = currentStep(s);
  if (!step) return s;
  if (step.kind === 'item' && s.phase !== 'feedback') return s; // must answer first
  const seen_screens =
    step.kind === 'screen' && !s.seen_screens.includes(step.screen_id) ? [...s.seen_screens, step.screen_id] : s.seen_screens;
  let index = s.index + 1;
  const reviewAllowanceMs = s.budget_minutes * 60_000 * s.review_share;
  while (index < s.queue.length) {
    const q = s.queue[index];
    if (q.kind === 'item' && q.role === 'review' && s.review_ms >= reviewAllowanceMs) {
      index += 1;
      continue;
    }
    break;
  }
  const overBudget = step.kind === 'item' && now - s.started_at >= s.budget_minutes * 60_000;
  const done = index >= s.queue.length || overBudget;
  return { ...s, index, seen_screens, phase: done ? 'done' : 'step', feedback: null };
}

/** An unresolved serious mistake and which follow-ups it still needs (spec §7, lessons §2.8). */
export interface Obligation {
  skill: string;
  tag: ErrorTag;
  unit: Item['unit'];
  referent?: Item['referent'];
  needs_focus: boolean;
  needs_remed: boolean;
  serious_answer_id: string;
}

/**
 * Rebuilt from the durable log: a serious mistake stays open until a correct focused question
 * AND a correct fresh REMED answer on the same skill follow it. Reviews or ordinary practice
 * never resolve it; a newer serious mistake on the same skill restarts the obligation.
 */
export function openObligations(history: AnswerRecord[], content?: GatedContent): Obligation[] {
  const open = new Map<string, Obligation>();
  for (const r of history) {
    const skill = r.skills?.[0];
    if (!skill) continue;
    const isFocus = r.pool === 'FOCUS' || r.role === 'focus';
    if (r.serious_tag && !isFocus) {
      const item = content?.items.find((i) => i.item_id === r.item_id);
      open.set(skill, {
        skill,
        tag: r.serious_tag,
        unit: r.unit,
        referent: item?.referent,
        needs_focus: true,
        needs_remed: true,
        serious_answer_id: r.answer_id,
      });
      continue;
    }
    const o = open.get(skill);
    if (!o || r.outcome !== 'correct') continue;
    if (isFocus) o.needs_focus = false;
    if (r.pool === 'REMED' && r.fresh_evidence) o.needs_remed = false;
    if (!o.needs_focus && !o.needs_remed) open.delete(skill);
  }
  return [...open.values()];
}

/** Serious mistakes still blocking "learned": need a correct focused question AND a correct fresh REMED item. */
export function unresolvedSerious(history: AnswerRecord[]): { skill: string; tag: ErrorTag }[] {
  return openObligations(history).map((o) => ({ skill: o.skill, tag: o.tag }));
}

export interface SessionSummary {
  answered: number;
  correct: number;
  wrong: number;
  pending: number;
  dont_know: number;
  items: string[];
  follow_ups: number;
  reviews: number;
  checks: number;
  minutes: number;
  flags: string[];
}

/** Counts only. Deliberately makes no "learned"/mastery claim; next-due dates come from the review projection. */
export function summarize(s: SessionState, now = s.started_at): SessionSummary {
  const count = (o: Outcome) => s.results.filter((r) => r.outcome === o).length;
  return {
    answered: s.results.length,
    correct: count('correct'),
    wrong: count('wrong'),
    pending: count('pending'),
    dont_know: count('dont_know'),
    items: [...new Set(s.results.filter((r) => r.role !== 'focus').map((r) => r.item_id))],
    follow_ups: s.results.filter((r) => r.role === 'focus' || r.role === 'remed').length,
    reviews: s.results.filter((r) => r.role === 'review').length,
    checks: s.results.filter((r) => r.role === 'check').length,
    minutes: Math.max(0, Math.round((now - s.started_at) / 60_000)),
    flags: s.flags,
  };
}
