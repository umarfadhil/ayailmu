// Daily session state machine (Trial_App_Spec.md §4, §6). Pure functions over plain-JSON state,
// so the state can be saved as a snapshot and resumed after a restart.
//
// Session v2 (four-choice): every item step carries its option order, generated once when the step
// is queued or inserted and persisted in the snapshot. Reload, retry and resize reuse it.
import type { RulesConfig } from '@/config/rules';
import type { GatedContent } from '@/content/gating';
import { historicalItem } from '@/content/load';
import type { ErrorTag, Item, Pool } from '@/content/schema';
import type { AnswerRecord, StepRole } from '@/storage/types';
import { answeredLineages, isCheckPool, openCheckItems } from './checks';
import { newTeachingBaseline, sameDayExposure, unseenTeaching, type ScreenView } from './exposure';
import { type AttemptLog, daysBetween, isEligibleFresh, lastPracticeDate, pickFocusItem, pickFreshItem } from './freshness';
import { dueReviews, reviewStates } from './reviews';
import { scoreItem, type Outcome, type Response } from './scoring';
import { optionOrder } from './shuffle';
import { localDate, newId } from './util';

export const SESSION_VERSION = 2;
/** Used only for snapshots saved before the per-step cap existed. */
export const DEFAULT_STEP_CAP_MINUTES = 10;

export type ItemStep = {
  kind: 'item';
  item_id: string;
  role: StepRole;
  option_order: string[];
  /** Focus steps: the skill whose serious mistake this question follows up (per step, not per content item). */
  target_skill?: string;
};
export type Step = { kind: 'screen'; screen_id: string } | ItemStep;

export interface FeedbackView {
  /** Timed checks: correctness and key are withheld until after the check block (independent checks). */
  deferred?: boolean;
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
  /** `not_counted`: a timed check answered after same-day teaching exposure (not retention evidence). */
  results: { item_id: string; outcome: Outcome; role: StepRole; not_counted?: true }[];
  /** Attempts made in this session (history is reloaded from the log between sessions). */
  attempts: AttemptLog[];
  /** Skill whose serious mistake each queued focus question follows up. */
  focus_skill: Record<string, string>;
  seen_screens: string[];
  flags: string[];
  /** Active time on review steps (shown → Lanjut, incl. feedback); reviews stop at an item boundary once their share is used. */
  review_ms: number;
  /** Active session time (ms), accumulated per step with a per-step cap so offline gaps are not charged. */
  active_ms?: number;
  /**
   * When the current step's clock last started (shown, answered, or resumed), in ms. `null` while
   * paused: the page was hidden, the app backgrounded or the route left (time then is not charged).
   */
  step_started_at?: number | null;
  /** Active time already checkpointed for the current step (answer part, and feedback read before a pause). */
  pending_step_ms?: number;
  /** Set once when the session reaches 'done'; the summary duration is frozen from then on. */
  completed_at?: number | null;
  /** Per-step active-time cap (minutes) captured at start (rules.max_step_active_minutes). */
  step_cap_minutes?: number;
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
  /** Dated lesson/Guide screen views (teaching provenance for timed checks). */
  screenViews?: ScreenView[];
}

export interface Env {
  content: GatedContent;
  rules: RulesConfig;
  history: AnswerRecord[];
  now: number;
  timeOnItemMs: number;
  hintUsed?: boolean;
  rng?: () => number;
  /** Dated screen views recorded so far (a timed check after a same-day view is not counted). */
  screenViews?: ScreenView[];
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
  // What was actually displayed: the item from the pack of the record's content version (never a
  // successor's revised wording), plus any Arabic option text the record itself preserved.
  const shown =
    (r.content_version === content.content_version ? content.items.find((i) => i.item_id === r.item_id) : undefined) ??
    historicalItem(r.item_id, r.content_version) ??
    historicalItem(r.item_id) ??
    content.items.find((i) => i.item_id === r.item_id);
  const forms = new Set(shown ? displayedForms(shown) : []);
  for (const o of r.presented_options ?? []) if (/[ء-ي]/.test(o.text)) o.text.split(/\s+/).filter(Boolean).forEach((w) => forms.add(w));
  return {
    item_id: r.item_id,
    lineage: r.lineage ?? content.lineage[r.item_id] ?? `id:${r.item_id}`,
    forms: forms.size ? [...forms] : undefined,
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
export function makeItemStep(
  content: GatedContent,
  itemId: string,
  role: StepRole,
  rng: () => number = Math.random,
  targetSkill?: string
): ItemStep {
  const item = findItem(content, itemId);
  const step: ItemStep = { kind: 'item', item_id: itemId, role, option_order: optionOrder((item.options ?? []).map((o) => o.id), rng) };
  if (targetSkill) step.target_skill = targetSkill;
  return step;
}

/** Active item for a logged answer: by ID, else through the immutable lineage registry (legacy IDs). */
export function resolveItem(itemId: string, content: GatedContent, lineage?: string): Item | undefined {
  const direct = content.items.find((i) => i.item_id === itemId);
  if (direct) return direct;
  const lin = lineage ?? content.lineage[itemId];
  return lin ? content.items.find((i) => i.lineage === lin) : undefined;
}

/**
 * Review keys an item exposes: its own review key plus the word keys of the lemmas it relies on
 * (sentence → word). Used to keep a check and a review of the same key off the same day.
 */
export function exposureKeys(item: Item | undefined, content: GatedContent): string[] {
  if (!item) return [];
  const keys = new Set<string>();
  if (item.review_key) keys.add(item.review_key);
  const lemmaWord = new Map<string, string>();
  for (const w of content.items) if (w.format === 'word-meaning' && w.word_id) for (const l of w.requires_taught ?? []) lemmaWord.set(l, w.word_id);
  for (const l of item.requires_taught ?? []) {
    const wid = lemmaWord.get(l);
    if (wid) keys.add(`word:${wid}`);
  }
  if (item.word_id) keys.add(`word:${item.word_id}`);
  return [...keys];
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

  // 1. Due timed checks (2–3 per skill where content allows; never padded). A check stays
  //    independent retention evidence: it is postponed (not consumed) while the teaching it relies
  //    on is unseen (taught today, in the lesson part), was viewed earlier today (session or Guide),
  //    or was first introduced less than the check interval ago (migration baseline).
  const flags: string[] = [];
  const views = a.screenViews ?? [];
  const teachNow: string[] = [];
  const perSkill = new Map<string, number>();
  for (const pool of ['D7', 'D30'] as const) {
    for (const item of a.content.items) {
      if (queue.length >= budget) break;
      if (item.pool !== pool || !open.includes(item.unit as 'A' | 'B')) continue;
      if (!isEligibleFresh(item, ctx, a.content.items)) continue;
      const unseen = unseenTeaching(item, a.content, a.screensSeen);
      const baseline = newTeachingBaseline(item, a.content, views, lastPracticeDate(history, item.unit));
      if (
        unseen.length ||
        sameDayExposure(item, a.content, views, today).length ||
        (baseline && daysBetween(baseline, today) < a.rules.check_days[pool])
      ) {
        flags.push(`check-postponed:${item.item_id}`);
        for (const sc of unseen) if (!teachNow.includes(sc.screen_id)) teachNow.push(sc.screen_id);
        continue;
      }
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
    // No same-day review of a key already exposed today (completed answers, incl. checks) or by a planned check.
    const exposedToday = new Set<string>();
    for (const r of a.history) {
      if (r.local_date !== today) continue;
      for (const k of exposureKeys(resolveItem(r.item_id, a.content, r.lineage), a.content)) exposedToday.add(k);
    }
    for (const q of queue) if (q.kind === 'item') for (const k of exposureKeys(findItem(a.content, q.item_id), a.content)) exposedToday.add(k);
    const due = dueReviews(reviewStates(a.history, a.content, a.rules), today).filter(
      (r) => !exposureKeys(findItem(a.content, r.review_item_id!), a.content).some((k) => exposedToday.has(k))
    );
    for (const r of due.slice(0, reviewCap)) queue.push(makeItemStep(a.content, r.review_item_id!, 'review', rng));
  }

  // 3. Current lesson: unfinished serious-mistake follow-ups first (restored from the durable log,
  //    e.g. when a previous session reached its time limit), then unseen screens of the current
  //    unit, then fresh practice/readiness items.
  const lessonSlots = budget - queue.length;
  const focus_skill: Record<string, string> = {};
  const picked = new Set<string>();
  let used = 0; // queued lesson item steps (a repeated focus item counts every time)
  if (lessonSlots > 0) {
    // A follow-up for a timed-check error reveals that answer's outcome: it waits until no item of that
    // check remains unanswered beyond today's planned block (a split or postponed check keeps it closed).
    const plannedChecks = new Set(queue.filter((q): q is ItemStep => q.kind === 'item' && q.role === 'check').map((q) => q.item_id));
    const answered = answeredLineages(a.history, a.content);
    const heldBack = (o: Obligation) => {
      const r = a.history.find((h) => h.answer_id === o.serious_answer_id);
      const it = r?.role === 'check' ? resolveItem(r.item_id, a.content, r.lineage) : undefined;
      return !!it && isCheckPool(it.pool) && openCheckItems(it.unit, it.pool, answered, a.content).some((i) => !plannedChecks.has(i.item_id));
    };
    for (const o of openObligations(a.history, a.content)) {
      if (used >= lessonSlots) break;
      if (heldBack(o)) continue;
      if (o.needs_focus) {
        const focus = pickFocusItem(a.content.items, o.tag, o.referent, o.unit);
        if (focus) {
          queue.push(makeItemStep(a.content, focus.item_id, 'focus', rng, o.skill));
          used += 1;
        }
      }
      if (o.needs_remed && used < lessonSlots) {
        const remed = pickFreshItem(
          a.content.items.filter((i) => i.unit === o.unit),
          ctx,
          { pools: ['REMED'], skill: o.skill, exclude: picked }
        );
        if (remed) {
          queue.push(makeItemStep(a.content, remed.item_id, 'remed', rng));
          picked.add(remed.item_id);
          used += 1;
        } else if (!flags.includes(`out-of-fresh:${o.skill}`)) flags.push(`out-of-fresh:${o.skill}`);
      }
    }
    for (const sc of a.content.screens) {
      if (sc.unit === unit && !a.screensSeen.includes(sc.screen_id)) queue.push({ kind: 'screen', screen_id: sc.screen_id });
    }
    const take = (items: Item[], pools: Pool[]) => {
      while (used < lessonSlots) {
        const next = pickFreshItem(items, ctx, { pools, exclude: picked });
        if (!next) break;
        picked.add(next.item_id);
        used += 1;
        queue.push(makeItemStep(a.content, next.item_id, 'practice', rng));
      }
    };
    // Readiness work still open in an earlier unit (it only becomes eligible after that unit's
    // last core practice, i.e. after the next unit has opened), then the current unit.
    take(a.content.items.filter((i) => i.unit !== unit && open.includes(i.unit as 'A' | 'B')), ['READY']);
    take(a.content.items.filter((i) => i.unit === unit), ['PRACT', 'READY']);
  }

  // Teaching that postponed checks rely on (e.g. the v0.3 word table for a migrated learner) is
  // taught today; those checks count from this first introduction (newTeachingBaseline).
  for (const id of teachNow) if (!queue.some((q) => q.kind === 'screen' && q.screen_id === id)) queue.push({ kind: 'screen', screen_id: id });

  // Teaching before use (CONTENT-F02, migration): any unseen lesson screen that teaches a form a planned
  // item needs is shown before the first such item — e.g. a v0.2 learner already in Unit B meets the new
  // Unit A word table before a due Unit A check.
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    if (q.kind !== 'item') continue;
    const needs = findItem(a.content, q.item_id).requires_taught ?? [];
    const before = new Set(queue.slice(0, i).filter((x) => x.kind === 'screen').map((x) => (x as { screen_id: string }).screen_id));
    const teach = a.content.screens.filter(
      (sc) => !a.screensSeen.includes(sc.screen_id) && !before.has(sc.screen_id) && (sc.examples ?? []).some((e) => needs.includes(e.arabic))
    );
    if (!teach.length) continue;
    // Move a teaching screen that is already queued later (e.g. by the lesson phase) up to here.
    for (const sc of teach) {
      const later = queue.findIndex((x, j) => j > i && x.kind === 'screen' && x.screen_id === sc.screen_id);
      if (later > -1) queue.splice(later, 1);
    }
    queue.splice(i, 0, ...teach.map((sc) => ({ kind: 'screen' as const, screen_id: sc.screen_id })));
    i += teach.length;
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
    active_ms: 0,
    step_started_at: a.now,
    step_cap_minutes: a.rules.max_step_active_minutes,
    completed_at: queue.length ? null : a.now,
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
  // Per-step target skill; `focus_skill` is read only for snapshots saved before the repair.
  const focusSkill = step.role === 'focus' ? (step.target_skill ?? s.focus_skill[item.item_id]) : undefined;
  const skills = focusSkill ? [focusSkill] : item.skills;
  const isReview = step.role === 'review';
  const mcq = item.type === 'mcq4';
  const order = step.option_order ?? [];
  const optionById = new Map((item.options ?? []).map((o) => [o.id, o]));
  const selected = response.kind === 'choice' ? response.option_id : null;

  // A timed check answered after same-day teaching (a lesson screen in this session or the Guide)
  // is recorded durably as not counted for retention, with its provenance.
  const exposure =
    step.role === 'check'
      ? [
          ...new Set([
            ...sameDayExposure(item, env.content, env.screenViews ?? [], today, new Date(env.now).toISOString()),
            ...sameDayExposure(
              item,
              env.content,
              s.seen_screens.map((screen_id) => ({ screen_id, local_date: s.local_date, source: 'session' as const, at: '' })),
              today
            ),
          ]),
        ].sort()
      : [];

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
    ...(exposure.length ? { retention_valid: false as const, exposure } : {}),
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
      if (focus) inserts.push(makeItemStep(env.content, focus.item_id, 'focus', rng, primary));
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
  // Timed checks: withhold correctness, key and explanations until after the check block, so a later
  // check cannot be answered from an earlier check's feedback (review CONTENT-F03).
  const deferred = step.role === 'check';
  const messages = deferred
    ? [CHECK_SAVED_MESSAGE]
    : score.feedback_ids
        .map((id) => env.content.feedback[id])
        .filter(Boolean)
        .map((t) => fill(t, vars));
  if (deferred) record.feedback_deferred = true;
  // Follow-ups for a check error wait until after the remaining checks in this block, and are not
  // queued at all while items of that check remain beyond this block (split by the time budget, or
  // postponed): the planner restores them once the check is complete.
  let insertAt = s.index + 1;
  if (deferred) while (insertAt < s.queue.length && (s.queue[insertAt] as ItemStep).role === 'check') insertAt += 1;
  if (deferred && inserts.length && isCheckPool(item.pool)) {
    const restOfBlock = new Set(s.queue.slice(s.index + 1, insertAt).map((q) => (q as ItemStep).item_id));
    const answeredNow = new Set([...prior.map((h) => h.lineage ?? `id:${h.item_id}`), lineage]);
    if (openCheckItems(item.unit, item.pool, answeredNow, env.content).some((i) => !restOfBlock.has(i.item_id))) inserts.length = 0;
  }

  return {
    record,
    state: {
      ...s,
      queue: [...s.queue.slice(0, insertAt), ...inserts, ...s.queue.slice(insertAt)],
      phase: 'feedback',
      feedback: {
        ...(deferred ? { deferred: true } : {}),
        item_id: item.item_id,
        outcome: score.outcome,
        messages,
        selected_option_id: selected,
        correct_option_id: deferred ? null : (correct?.id ?? null),
      },
      results: [...s.results, { item_id: item.item_id, outcome: score.outcome, role: step.role, ...(exposure.length ? { not_counted: true as const } : {}) }],
      attempts,
      focus_skill,
      flags,
      // Review time is charged at the item boundary in advance() (shown → Lanjut, incl. feedback).
      review_ms: s.review_ms,
      // The answer part of the step is fixed now; the feedback part restarts here (and on resume).
      pending_step_ms: stepMs(s, env.now),
      step_started_at: env.now,
    },
  };
}

export const CHECK_SAVED_MESSAGE =
  'Jawaban tersimpan. Hasil cek ulang tidak ditampilkan sekarang supaya setiap soal cek tetap berdiri sendiri; jumlahnya ada di ringkasan.';

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
 * Active time of the current step up to `now`: the checkpointed part plus the running part (none
 * while paused), capped per step so an unnoticed gap is never charged beyond the cap (ENG-04/05).
 */
function stepMs(s: SessionState, now: number): number {
  const cap = (s.step_cap_minutes ?? DEFAULT_STEP_CAP_MINUTES) * 60_000;
  const running = s.step_started_at === null ? 0 : Math.max(0, now - (s.step_started_at ?? s.started_at));
  return Math.min((s.pending_step_ms ?? 0) + running, cap);
}

/**
 * Lifecycle checkpoint (page hidden, app backgrounded, route left): the step's active time so far
 * is fixed in `pending_step_ms` and the clock stops, so the time is kept across a close and hidden
 * time is not charged. Returns `s` itself when there is nothing to checkpoint.
 */
export function pauseClock(s: SessionState, now: number): SessionState {
  if (s.phase === 'done' || s.step_started_at === null) return s;
  return { ...s, pending_step_ms: stepMs(s, now), step_started_at: null };
}

/** Restarts a paused step clock (page visible again). A running clock is left as it is. */
export function resumeClock(s: SessionState, now: number): SessionState {
  if (s.phase === 'done' || s.step_started_at !== null) return s;
  return { ...s, step_started_at: now };
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
  // Active time for the step just finished: shown → this boundary (answer + feedback reading),
  // capped per step so time with the app closed is not charged to the session (ENG-04/05).
  const elapsed = stepMs(s, now);
  const active_ms = (s.active_ms ?? 0) + elapsed;
  const review_ms = s.review_ms + (step.kind === 'item' && step.role === 'review' ? elapsed : 0);
  let index = s.index + 1;
  const reviewAllowanceMs = s.budget_minutes * 60_000 * s.review_share;
  while (index < s.queue.length) {
    const q = s.queue[index];
    if (q.kind === 'item' && q.role === 'review' && review_ms >= reviewAllowanceMs) {
      index += 1;
      continue;
    }
    break;
  }
  const overBudget = step.kind === 'item' && active_ms >= s.budget_minutes * 60_000;
  const done = index >= s.queue.length || overBudget;
  return {
    ...s,
    index,
    seen_screens,
    phase: done ? 'done' : 'step',
    feedback: null,
    review_ms,
    active_ms,
    step_started_at: now,
    pending_step_ms: 0,
    completed_at: done ? now : (s.completed_at ?? null),
  };
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
      // Resolve through the immutable lineage registry, so legacy IDs (e.g. DEMO-P01) keep their referent (ENG-01).
      const item = content ? resolveItem(r.item_id, content, r.lineage) : undefined;
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
  /** Checks answered after same-day teaching exposure: recorded, not counted as retention evidence. */
  checks_not_counted: number;
  /** Active minutes (frozen at completion); null for an older snapshot that did not record it. */
  minutes: number | null;
  flags: string[];
}

/**
 * Counts only. Deliberately makes no "learned"/mastery claim; next-due dates come from the review
 * projection. Duration is the recorded active time, so reopening a completed session later never
 * changes it (ENG-05).
 */
export function summarize(s: SessionState, _now?: number): SessionSummary {
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
    checks_not_counted: s.results.filter((r) => r.role === 'check' && r.not_counted).length,
    minutes: typeof s.active_ms === 'number' ? Math.round(s.active_ms / 60_000) : null,
    flags: s.flags,
  };
}
