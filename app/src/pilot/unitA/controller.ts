// Unit A pilot controller: reference lesson -> each fresh reference practice item once -> agreement lesson ->
// each fresh agreement practice item once, with immediate feedback after the first choice is durable. Practice
// here is correctness practice, not retention. Once both constructs reach the practice family threshold, and
// only on a later day than any teaching or practice that the injected assistance check reports unassisted, each
// held-out transfer item is offered once, with grading deferred until the block closes. A closed block reports
// progress: a provisional anchor only when canAdvanceUnitA accepts its practice and independent transfer first
// choices (delayed answers never move it). An anchored block then offers each reserved d7 item once from
// anchor + 7 and each d30 item once from anchor + 30, d7 first, never on a day with the learner's teaching,
// practice or an earlier phase's check, nor on a day the assistance check reports assisted. A closed delayed
// block reports descriptive counts only; nothing here claims mastery, a pass or an unlock.
// State is one versioned document under PILOT_META_KEY, read, transitioned and written as one
// store.updateMeta operation on that store's write queue (the same queue as reset); a store without
// updateMeta is refused. Assistance is read inside that same operation, so a reset is ordered around it.
// Once a controller has seen its own document, that document going missing (a reset) blocks it rather than
// starting over. Attempts stay the exact { presentationId, itemId, optionId } first choices; presentation
// context (day, option order, answered day), dated lesson exposure and, for held-out items, the assistance
// read when shown and when answered live beside them in the same document and join by presentationId in
// attempt order. Independence is derived from that context, never stored as a verdict. Anything unknown,
// newer, foreign or inconsistent blocks without being rewritten; IO, assistance and write errors reject and
// leave the last durable state answerable.
// With opt-in capture, each fresh first choice also saves its answer record (an intent) in the same write, and
// after each operation the document's verified intents are appended to the store under its exact bytes. Older
// attempts are never captured afterwards; a failed append leaves the choice and its intent for a later operation.
import { starterBetaBuild, type LearningBetaEnv } from '@/config/learningBeta';
import type { PrivateBetaEnv } from '@/config/privateBeta';
import { newId } from '@/engine/util';
import { createSerialQueue } from '@/storage/serial';
import type { AnswerRecord, Store } from '@/storage/types';
import { capturesMatch, drainPilotAnswers, makePilotAnswer, PILOT_META_KEY } from './capture';
import {
  PILOT_CONTENT,
  validatePilotContent,
  type PilotConstruct,
  type PilotGloss,
  type PilotItem,
  type PilotLesson,
  type PilotOption,
  type PilotPhase,
} from './content';
import { canAdvanceUnitA, type PilotEvidence } from './evidence';
import { starterReviewAccess } from './review';

export { PILOT_META_KEY };

const SCHEMA = 1;
const CONSTRUCTS: readonly PilotConstruct[] = ['reference', 'agreement'];
const MIN_PRACTICE_FAMILIES = 2;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
/**
 * Evidence day for a held-out first choice that was not independent. The evaluator treats a non-calendar day as
 * an invalid first attempt: it still consumes its family, so no later event can count in its place.
 */
const NOT_INDEPENDENT = 'not-independent';

export type PilotMode = 'developer-demo' | 'tester';
/** Held-out phases: each one block of reserved items, offered once each, in this order after practice. */
export type PilotHeldPhase = Exclude<PilotPhase, 'practice'>;
export type PilotDelayedPhase = Extract<PilotPhase, 'd7' | 'd30'>;

/**
 * Descriptive counts over a closed delayed block: raw first choices, those matching the key, and those whose
 * recorded context was independent (shown and answered the same day, no assistance read either time) whatever
 * the choice. Not a pass, mastery or unlock.
 */
export interface PilotDelayedCounts {
  answered: number;
  correct: number;
  valid: number;
}

/** Opt-in answer capture for one learner. */
export interface PilotCaptureOptions {
  /** Must be the store's learner; checked before a first choice is saved. */
  learnerId: string;
  /** The first-choice time, as toISOString writes it; anything else refuses the answer before it is saved. */
  now: () => string;
  /** Capture liveness (e.g. the account session); false blocks every operation like `active`. */
  active: () => boolean;
}

export type PilotCaptureStatus = 'off' | 'saved' | 'pending';

export interface PilotControllerOptions {
  /** Capture also needs getLearner, listAnswers and appendAnswer; without them a captured answer is refused. */
  store: Pick<Store, 'getMeta' | 'setMeta' | 'updateMeta'> & Partial<Pick<Store, 'getLearner' | 'listAnswers' | 'appendAnswer'>>;
  owner: string;
  mode: PilotMode;
  /** Local calendar day, YYYY-MM-DD. */
  today: () => string;
  readOnly: () => boolean;
  active: () => boolean;
  /**
   * Whether the learner had teaching or other help on `day`. Read before a held-out item is shown and again
   * when it is answered; correctness practice never needs it. A rejection or non-boolean refuses that step.
   */
  assistedToday: (day: string) => Promise<boolean>;
  /** Used only to shuffle the option order of a new presentation. */
  random: () => number;
  /** 'tester' only: the private beta or learning beta environment, validated on every operation; anything invalid blocks 'mode'. */
  betaEnv?: PrivateBetaEnv & LearningBetaEnv;
  /** 'tester' only: the starter review, re-checked against the exact content on every operation; else 'review'. */
  starterReview?: unknown;
  /** Absent: nothing is captured and the document keeps its exact keys. */
  capture?: PilotCaptureOptions;
}

export type PilotBlockReason =
  | 'disposed'
  | 'inactive'
  | 'mode'
  | 'review'
  | 'read-only'
  | 'content'
  | 'owner'
  | 'today'
  | 'schema'
  | 'version'
  | 'future-day'
  | 'corrupt';

export interface PilotChoice {
  id: string;
  text: string;
}

export interface PilotExplainedChoice extends PilotChoice {
  explanation: string;
}

export interface PilotConstructSummary {
  construct: PilotConstruct;
  correctFamilies: number;
  required: number;
}

export type PilotView =
  | { kind: 'blocked'; reason: PilotBlockReason }
  | { kind: 'lesson'; lesson: PilotLesson }
  | {
      kind: 'question';
      presentationId: string;
      itemId: string;
      phase: PilotPhase;
      prompt: string;
      arabic: string;
      glosses: PilotGloss[];
      options: PilotChoice[];
    }
  | {
      kind: 'feedback';
      presentationId: string;
      itemId: string;
      outcome: 'correct' | 'wrong' | 'dont-know';
      selected: PilotExplainedChoice | null;
      keyed: PilotExplainedChoice;
    }
  /** A held-out answer is saved; nothing about its correctness is shown until the block closes. */
  | {
      kind: 'assessment-feedback';
      presentationId: string;
      phase: PilotHeldPhase;
      deferred: true;
      answered: number;
      total: number;
    }
  /** Practice is done; held-out items open on a later, unassisted day (`until` is the earliest). */
  | { kind: 'awaiting-transfer'; constructs: PilotConstructSummary[]; until: string }
  | { kind: 'insufficient'; constructs: PilotConstructSummary[] }
  /** The transfer block is closed and nothing is open today. Delayed counts stay null until that block closes. */
  | {
      kind: 'progress';
      provisional: boolean;
      /** The day the qualifying transfer block closed; never moved by delayed answers. */
      anchorDay: string | null;
      /** Original due day of the next delayed block (anchor + 7 or + 30); null when none is left. */
      nextDue: string | null;
      delayed: { d7: PilotDelayedCounts | null; d30: PilotDelayedCounts | null };
      /** The delayed block still to finish: answers saved so far and the earliest day it may continue. */
      upcoming: { phase: PilotDelayedPhase; answered: number; total: number; availableOn: string } | null;
    };

interface Attempt {
  presentationId: string;
  itemId: string;
  optionId: string | null;
}

interface Current {
  presentationId: string;
  itemId: string;
  day: string;
}

interface Presentation {
  presentationId: string;
  itemId: string;
  shown: string;
  optionOrder: string[];
  answered: string | null;
}

interface LessonExposure {
  lessonId: string;
  /** Every day the lesson was displayed, ascending. Exposure only, never practice evidence. */
  shown: string[];
  completed: string | null;
}

/** Context of one held-out presentation, in presentation order. Observations only, not a verdict. */
interface Assessment {
  presentationId: string;
  /** Assistance read just before display; a held-out item is shown only when this was false. */
  assistedWhenShown: false;
  /** Assistance read when the first choice was saved; null until then. */
  assistedWhenAnswered: boolean | null;
}

interface PilotDoc {
  owner: string;
  schema: typeof SCHEMA;
  contentVersion: string;
  policyVersion: string;
  attempts: Attempt[];
  current: Current | null;
  presentations: Presentation[];
  lessons: LessonExposure[];
  /** Absent until the first held-out item is shown, so practice-only documents keep their exact bytes. */
  assessments?: Assessment[];
  /**
   * Absent until the first captured first choice. Each is exactly the answer record of one attempt, saved with it,
   * in attempt order; attempts made without capture have none and never get one later.
   */
  captures?: AnswerRecord[];
}

const DOC_KEYS = [
  'owner', 'schema', 'contentVersion', 'policyVersion', 'attempts', 'current', 'presentations', 'lessons',
] as const;
const ASSESSED_DOC_KEYS = [...DOC_KEYS, 'assessments'] as const;
const CAPTURED_DOC_KEYS = [...DOC_KEYS, 'captures'] as const;
const ASSESSED_CAPTURED_DOC_KEYS = [...DOC_KEYS, 'assessments', 'captures'] as const;

// ---- Plan over the catalogue ----

interface Step {
  lesson: PilotLesson;
  items: readonly PilotItem[];
}

interface Block {
  phase: PilotHeldPhase;
  /** Index in `sequence`, and so in stored presentations, of the block's first item. */
  from: number;
  items: readonly PilotItem[];
  /** Days after the anchor the block falls due; null for transfer, which follows practice instead. */
  dueAfter: number | null;
}

const HELD: readonly { phase: PilotHeldPhase; dueAfter: number | null }[] = [
  { phase: 'transfer', dueAfter: null },
  { phase: 'd7', dueAfter: 7 },
  { phase: 'd30', dueAfter: 30 },
];

interface Plan {
  steps: readonly Step[];
  /** Practice items in the order they are offered. */
  order: readonly PilotItem[];
  /** Held-out blocks (transfer, d7, d30) in the order they are offered, after all practice. */
  blocks: readonly Block[];
  /** Every item a presentation may hold, index-aligned with stored presentations. */
  sequence: readonly PilotItem[];
  byId: ReadonlyMap<string, PilotItem>;
  stepOf: ReadonlyMap<string, number>;
  /** Answered presentations needed before lesson k may open. */
  opensAfter: readonly number[];
}

function contentAccepted(): boolean {
  try {
    // validatePilotContent returns the list of problems: only an empty list accepts the content.
    const problems: unknown = validatePilotContent(PILOT_CONTENT);
    return Array.isArray(problems) && problems.length === 0;
  } catch {
    return false;
  }
}

const keyOf = (item: PilotItem): PilotOption | undefined => item.options.find((o) => o.correct);

const wellFormed = (item: PilotItem, lessonId: string): boolean =>
  item.lessonId === lessonId &&
  item.options.length === 4 &&
  item.options.filter((o) => o.correct).length === 1 &&
  new Set(item.options.map((o) => o.id)).size === item.options.length;

/** Alternates the constructs' lists, round by round. */
function interleave(lists: readonly (readonly PilotItem[])[]): PilotItem[] {
  const out: PilotItem[] = [];
  const rounds = Math.max(0, ...lists.map((l) => l.length));
  for (let n = 0; n < rounds; n += 1) {
    for (const items of lists) {
      const item = items[n];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

function buildPlan(): Plan | null {
  if (!contentAccepted()) return null;
  const steps: Step[] = [];
  // Per construct, its reserved items for each held-out phase, in HELD order.
  const held: PilotItem[][][] = [];
  for (const construct of CONSTRUCTS) {
    const lesson = PILOT_CONTENT.lessons.find((l) => l.construct === construct);
    if (lesson === undefined) return null;
    const ofPhase = (phase: PilotPhase) =>
      PILOT_CONTENT.items.filter((i) => i.construct === construct && i.phase === phase);
    const items = ofPhase('practice');
    const reserved = HELD.map((h) => ofPhase(h.phase));
    const practiced = new Set(items.map((i) => i.family));
    const usable =
      items.length > 0 &&
      reserved.every((r) => r.length > 0) &&
      [...items, ...reserved.flatMap((r) => r)].every((i) => wellFormed(i, lesson.id)) &&
      (reserved[0] ?? []).every((i) => !practiced.has(i.family));
    if (!usable) return null;
    steps.push({ lesson, items });
    held.push(reserved);
  }
  const order = steps.flatMap((s) => s.items);
  // Each held-out block alternates constructs, each family once within the block.
  let from = order.length;
  const blocks = HELD.map(({ phase, dueAfter }, k): Block => {
    const items = interleave(held.map((r) => r[k] ?? []));
    const block = { phase, from, items, dueAfter };
    from += items.length;
    return block;
  });
  if (blocks.some((b) => new Set(b.items.map((i) => i.family)).size !== b.items.length)) return null;
  const sequence = [...order, ...blocks.flatMap((b) => b.items)];
  if (new Set(sequence.map((i) => i.id)).size !== sequence.length) return null;
  const stepOf = new Map<string, number>();
  const opensAfter: number[] = [];
  let before = 0;
  steps.forEach((step, index) => {
    opensAfter.push(before);
    before += step.items.length;
    step.items.forEach((i) => stepOf.set(i.id, index));
  });
  return { steps, order, blocks, sequence, byId: new Map(sequence.map((i) => [i.id, i])), stepOf, opensAfter };
}

const PLAN = buildPlan();

// ---- Strict reading of the stored document ----

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactly(value: unknown, keys: readonly string[]): value is Json {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((k) => Object.prototype.hasOwnProperty.call(value, k))
  );
}

const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

// Arithmetic check, so 2027-02-29 or 2027-01-32 is rejected, not rolled over.
function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DAY_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return date >= 1 && date <= (monthLengths[month - 1] ?? 0);
}

/** The calendar day `days` after a valid `day`. */
function addDays(day: string, days: number): string {
  const match = DAY_PATTERN.exec(day);
  if (match === null) throw new Error('Pilot day is not YYYY-MM-DD.');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return date.toISOString().slice(0, 10);
}

const isAttempt = (v: unknown): v is Attempt =>
  exactly(v, ['presentationId', 'itemId', 'optionId']) &&
  isText(v.presentationId) &&
  isText(v.itemId) &&
  (v.optionId === null || isText(v.optionId));

const isCurrent = (v: unknown): v is Current =>
  exactly(v, ['presentationId', 'itemId', 'day']) && isText(v.presentationId) && isText(v.itemId) && isCalendarDay(v.day);

const isPresentation = (v: unknown): v is Presentation =>
  exactly(v, ['presentationId', 'itemId', 'shown', 'optionOrder', 'answered']) &&
  isText(v.presentationId) &&
  isText(v.itemId) &&
  isCalendarDay(v.shown) &&
  Array.isArray(v.optionOrder) &&
  v.optionOrder.every(isText) &&
  (v.answered === null || isCalendarDay(v.answered));

const isLessonExposure = (v: unknown): v is LessonExposure =>
  exactly(v, ['lessonId', 'shown', 'completed']) &&
  isText(v.lessonId) &&
  Array.isArray(v.shown) &&
  v.shown.length > 0 &&
  v.shown.every(isCalendarDay) &&
  (v.completed === null || isCalendarDay(v.completed));

const isAssessment = (v: unknown): v is Assessment =>
  exactly(v, ['presentationId', 'assistedWhenShown', 'assistedWhenAnswered']) &&
  isText(v.presentationId) &&
  v.assistedWhenShown === false &&
  (v.assistedWhenAnswered === null || typeof v.assistedWhenAnswered === 'boolean');

const isListOf = <T>(value: unknown, guard: (v: unknown) => v is T): value is T[] =>
  Array.isArray(value) && value.every(guard);

function daysOf(doc: PilotDoc): string[] {
  return [
    ...(doc.current ? [doc.current.day] : []),
    ...doc.presentations.flatMap((p) => (p.answered === null ? [p.shown] : [p.shown, p.answered])),
    ...doc.lessons.flatMap((l) => (l.completed === null ? l.shown : [...l.shown, l.completed])),
  ];
}

/** Lesson and practice days in the only order the controller produces them. */
function teachingDays(doc: PilotDoc, plan: Plan): string[] {
  const days: string[] = [];
  let from = 0;
  doc.lessons.forEach((exposure, index) => {
    days.push(...exposure.shown);
    if (exposure.completed !== null) days.push(exposure.completed);
    const count = plan.steps[index]?.items.length ?? 0;
    for (const p of doc.presentations.slice(from, from + count)) {
      days.push(p.shown);
      if (p.answered !== null) days.push(p.answered);
    }
    from += count;
  });
  return days;
}

const heldOut = (doc: PilotDoc, plan: Plan): Presentation[] => doc.presentations.slice(plan.order.length);

const blockAt = (plan: Plan, index: number): Block | undefined =>
  plan.blocks.find((b) => index >= b.from && index < b.from + b.items.length);
const shownIn = (doc: PilotDoc, block: Block): Presentation[] =>
  doc.presentations.slice(block.from, block.from + block.items.length);
const answeredIn = (doc: PilotDoc, block: Block): number =>
  shownIn(doc, block).filter((p) => p.answered !== null).length;
const isClosed = (doc: PilotDoc, block: Block): boolean => answeredIn(doc, block) === block.items.length;
/** Whether `count` presentations end a held-out block exactly. */
const endsBlock = (plan: Plan, count: number): boolean => plan.blocks.some((b) => b.from + b.items.length === count);
const isDelayedPhase = (phase: PilotHeldPhase): phase is PilotDelayedPhase => phase === 'd7' || phase === 'd30';

/** Shown and answered the same day, with no assistance read either time. Derived context, never stored. */
const independent = (p: Presentation, a: Assessment | undefined): boolean =>
  a !== undefined && a.assistedWhenShown === false && a.assistedWhenAnswered === false && p.answered === p.shown;

const contextOf = (doc: PilotDoc): Map<string, Assessment> =>
  new Map((doc.assessments ?? []).map((a) => [a.presentationId, a]));

/** The latest teaching, practice or held-out day before presentation `index`. */
function lastDayBefore(doc: PilotDoc, plan: Plan, index: number): string | undefined {
  const days = [
    ...teachingDays(doc, plan),
    ...doc.presentations.slice(plan.order.length, index).flatMap((p) => (p.answered === null ? [p.shown] : [p.shown, p.answered])),
  ];
  return days.reduce<string | undefined>((latest, day) => (latest === undefined || day > latest ? day : latest), undefined);
}

/** The day the transfer block closed, when the shared evaluator accepts practice and transfer evidence alone. */
function anchorOf(doc: PilotDoc, plan: Plan): string | null {
  const transfer = plan.blocks[0];
  if (transfer === undefined || !isClosed(doc, transfer)) return null;
  const closedOn = shownIn(doc, transfer)[transfer.items.length - 1]?.answered ?? null;
  return closedOn !== null && canAdvanceUnitA(evidenceOf(doc, plan)) ? closedOn : null;
}

interface Opening {
  block: Block;
  phase: PilotDelayedPhase;
  /** anchor + the block's offset, whenever earlier blocks actually ran. */
  due: string;
  /** The due day, or the day after the latest earlier-phase activity if later: two blocks never share a day. */
  earliest: string;
}

/** The delayed block still to finish after an anchored transfer block, or null when none is left. */
function openingOf(doc: PilotDoc, plan: Plan, anchor: string): Opening | null {
  const answered = doc.presentations.filter((p) => p.answered !== null).length;
  const block = blockAt(plan, answered);
  if (block === undefined || block.dueAfter === null || !isDelayedPhase(block.phase)) return null;
  const due = addDays(anchor, block.dueAfter);
  const prior = lastDayBefore(doc, plan, block.from);
  const after = prior === undefined ? due : addDays(prior, 1);
  return { block, phase: block.phase, due, earliest: after > due ? after : due };
}

function isPermutation(order: readonly string[], options: readonly PilotOption[]): boolean {
  return (
    order.length === options.length &&
    new Set(order).size === order.length &&
    order.every((id) => options.some((o) => o.id === id))
  );
}

function practiceSummary(doc: PilotDoc, plan: Plan): PilotConstructSummary[] {
  return plan.steps.map(({ lesson, items }) => {
    const families = new Set<string>();
    for (const attempt of doc.attempts) {
      const item = items.find((i) => i.id === attempt.itemId);
      if (item !== undefined && attempt.optionId !== null && keyOf(item)?.id === attempt.optionId) families.add(item.family);
    }
    return { construct: lesson.construct, correctFamilies: families.size, required: MIN_PRACTICE_FAMILIES };
  });
}

const practiceMet = (constructs: readonly PilotConstructSummary[]): boolean =>
  constructs.every((c) => c.correctFamilies >= c.required);

/** The document must be a state this controller could have written, step by step, over the plan. */
function coherent(doc: PilotDoc, plan: Plan): boolean {
  const { presentations, attempts, lessons, current, assessments } = doc;
  if (lessons.length > plan.steps.length || presentations.length > plan.sequence.length) return false;
  const answered = presentations.filter((p) => p.answered !== null);
  const block = heldOut(doc, plan);

  const lessonsOk = lessons.every((exposure, index) => {
    const step = plan.steps[index];
    const last = exposure.shown[exposure.shown.length - 1];
    return (
      step !== undefined &&
      last !== undefined &&
      exposure.lessonId === step.lesson.id &&
      exposure.shown.every((day, i) => i === 0 || (exposure.shown[i - 1] ?? '') < day) &&
      // Completing a lesson displays it that day, so completion is always its last shown day.
      (exposure.completed === null ? index === lessons.length - 1 : exposure.completed === last) &&
      answered.length >= (plan.opensAfter[index] ?? Infinity)
    );
  });
  const allTaught = lessons.length === plan.steps.length && lessons.every((l) => l.completed !== null);

  const seen = new Set<string>();
  const presentationsOk = presentations.every((p, index) => {
    const item = plan.sequence[index];
    if (item === undefined || p.itemId !== item.id || seen.has(p.presentationId)) return false;
    seen.add(p.presentationId);
    const step = plan.stepOf.get(item.id);
    const opened = step === undefined ? allTaught : (lessons[step]?.completed ?? null) !== null;
    return (
      opened &&
      isPermutation(p.optionOrder, item.options) &&
      (p.answered === null ? index === presentations.length - 1 : p.answered >= p.shown)
    );
  });

  // One timeline: lessons and practice in plan order, then held-out items, never going back a day.
  const taught = teachingDays(doc, plan);
  const timeline = [...taught, ...block.flatMap((p) => (p.answered === null ? [p.shown] : [p.shown, p.answered]))];
  const chronological = timeline.every((day, i) => i === 0 || (timeline[i - 1] ?? '') <= day);
  const lastTaught = taught[taught.length - 1];
  const blockOk =
    block.length === 0 ||
    (practiceMet(practiceSummary(doc, plan)) && lastTaught !== undefined && block.every((p) => p.shown > lastTaught));

  const assessmentsOk =
    assessments === undefined
      ? block.length === 0
      : block.length > 0 &&
        assessments.length === block.length &&
        assessments.every((a, index) => {
          const p = block[index];
          return (
            p !== undefined &&
            a.presentationId === p.presentationId &&
            (a.assistedWhenAnswered === null) === (p.answered === null)
          );
        });

  const attemptsOk =
    attempts.length === answered.length &&
    attempts.every((a, index) => {
      const p = answered[index];
      const item = plan.byId.get(a.itemId);
      return (
        p !== undefined &&
        item !== undefined &&
        a.presentationId === p.presentationId &&
        a.itemId === p.itemId &&
        (a.optionId === null || item.options.some((o) => o.id === a.optionId))
      );
    });

  const last = presentations[presentations.length - 1];
  const lastHeldOut = presentations.length > plan.order.length;
  const currentOk =
    current === null
      ? last === undefined || last.answered !== null
      : last !== undefined &&
        current.presentationId === last.presentationId &&
        current.itemId === last.itemId &&
        current.day === last.shown &&
        (lastHeldOut
          ? // The last answer of a held-out block closes that block and clears current.
            !(endsBlock(plan, presentations.length) && last.answered !== null)
          : plan.stepOf.get(last.itemId) === lessons.length - 1);

  // A delayed block opens only after an anchored transfer block, on or after its due day and strictly after
  // every earlier phase's day. Index alignment already orders the phases and closes each earlier block.
  const delayedOk = () => {
    const anchor = anchorOf(doc, plan);
    return plan.blocks.every((b) => {
      const first = shownIn(doc, b)[0];
      if (first === undefined || b.dueAfter === null) return true;
      const prior = lastDayBefore(doc, plan, b.from);
      return anchor !== null && prior !== undefined && first.shown >= addDays(anchor, b.dueAfter) && first.shown > prior;
    });
  };

  return (
    lessonsOk && presentationsOk && chronological && blockOk && assessmentsOk && attemptsOk && currentOk && holds(delayedOk)
  );
}

function emptyDoc(owner: string): PilotDoc {
  return {
    owner,
    schema: SCHEMA,
    contentVersion: PILOT_CONTENT.contentVersion,
    policyVersion: PILOT_CONTENT.policyVersion,
    attempts: [],
    current: null,
    presentations: [],
    lessons: [],
  };
}

function parseDoc(raw: string | null, owner: string, today: string, plan: Plan): PilotDoc | PilotBlockReason {
  if (raw === null) return emptyDoc(owner);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'corrupt';
  }
  if (!isRecord(value)) return 'corrupt';
  if (value.schema !== SCHEMA) return 'schema';
  if (value.owner !== owner) return 'owner';
  if (value.contentVersion !== PILOT_CONTENT.contentVersion || value.policyVersion !== PILOT_CONTENT.policyVersion) {
    return 'version';
  }
  if (
    ![DOC_KEYS, ASSESSED_DOC_KEYS, CAPTURED_DOC_KEYS, ASSESSED_CAPTURED_DOC_KEYS].some((keys) => exactly(value, keys)) ||
    !isListOf(value.attempts, isAttempt) ||
    !isListOf(value.presentations, isPresentation) ||
    !isListOf(value.lessons, isLessonExposure) ||
    !(value.current === null || isCurrent(value.current)) ||
    !(value.assessments === undefined || isListOf(value.assessments, isAssessment))
  ) {
    return 'corrupt';
  }
  const doc = value as unknown as PilotDoc;
  if (daysOf(doc).some((day) => day > today)) return 'future-day';
  if (!coherent(doc, plan)) return 'corrupt';
  // Captures, when present, must each be exactly the record of its own attempt and presentation, in attempt order.
  if (doc.captures !== undefined && !holds(() => capturesMatch(doc.captures, owner, doc.attempts, doc.presentations))) {
    return 'corrupt';
  }
  return doc;
}

// ---- Position, transitions and views ----

type Position =
  | { kind: 'lesson'; index: number; step: Step }
  | { kind: 'practice'; item: PilotItem }
  | { kind: 'transfer'; item: PilotItem }
  | { kind: 'delayed'; item: PilotItem; anchor: string }
  | { kind: 'question'; presentation: Presentation; item: PilotItem }
  | { kind: 'feedback'; item: PilotItem; attempt: Attempt }
  | { kind: 'insufficient' }
  | { kind: 'closed' };

/** Reads whether the learner was assisted on a day; rejects on anything but a boolean. */
type Assisted = (day: string) => Promise<boolean>;

function locate(doc: PilotDoc, plan: Plan): Position {
  const { current } = doc;
  if (current !== null) {
    const presentation = doc.presentations.find((p) => p.presentationId === current.presentationId);
    const item = plan.byId.get(current.itemId);
    if (presentation === undefined || item === undefined) throw new Error('Pilot state lost its current presentation.');
    const attempt = doc.attempts.find((a) => a.presentationId === current.presentationId);
    return attempt ? { kind: 'feedback', item, attempt } : { kind: 'question', presentation, item };
  }
  const presented = new Set(doc.presentations.map((p) => p.itemId));
  for (const [index, step] of plan.steps.entries()) {
    const exposure = doc.lessons[index];
    if (exposure === undefined || exposure.completed === null) return { kind: 'lesson', index, step };
    const item = step.items.find((i) => !presented.has(i.id));
    if (item !== undefined) return { kind: 'practice', item };
  }
  if (!practiceMet(practiceSummary(doc, plan))) return { kind: 'insufficient' };
  // Presentations are index-aligned with the plan, so the next held-out item follows those already shown.
  const next = doc.presentations.length;
  const item = plan.sequence[next];
  const block = blockAt(plan, next);
  if (item === undefined || block === undefined) return { kind: 'closed' };
  if (block.dueAfter === null) return { kind: 'transfer', item };
  // Delayed checks follow only a closed transfer block that the evaluator accepted.
  const anchor = anchorOf(doc, plan);
  return anchor === null ? { kind: 'closed' } : { kind: 'delayed', item, anchor };
}

function withLessonShown(doc: PilotDoc, index: number, lessonId: string, today: string): PilotDoc {
  const existing = doc.lessons[index];
  if (existing?.shown.includes(today)) return doc;
  const exposure = existing
    ? { ...existing, shown: [...existing.shown, today] }
    : { lessonId, shown: [today], completed: null };
  return { ...doc, lessons: [...doc.lessons.slice(0, index), exposure] };
}

function withLessonCompleted(doc: PilotDoc, index: number, lessonId: string, today: string): PilotDoc {
  const shown = withLessonShown(doc, index, lessonId, today);
  const exposure = shown.lessons[index];
  if (exposure === undefined) throw new Error('Pilot lesson exposure missing.');
  return { ...shown, lessons: [...shown.lessons.slice(0, index), { ...exposure, completed: today }] };
}

function shuffled(ids: readonly string[], random: () => number): string[] {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const r = random();
    if (typeof r !== 'number' || !(r >= 0 && r < 1)) throw new Error('random() must return a number in [0, 1).');
    const j = Math.floor(r * (i + 1));
    const swap = order[i] as string;
    order[i] = order[j] as string;
    order[j] = swap;
  }
  return order;
}

function questionView(presentation: Presentation, item: PilotItem): PilotView {
  const text = new Map(item.options.map((o) => [o.id, o.text]));
  return {
    kind: 'question',
    presentationId: presentation.presentationId,
    itemId: item.id,
    phase: item.phase,
    prompt: item.prompt,
    arabic: item.arabic,
    glosses: item.glosses.map((g) => ({ arabic: g.arabic, meaning: g.meaning })),
    options: presentation.optionOrder.map((id) => ({ id, text: text.get(id) ?? '' })),
  };
}

const explain = (o: PilotOption): PilotExplainedChoice => ({ id: o.id, text: o.text, explanation: o.feedback });

function feedbackView(item: PilotItem, attempt: Attempt): PilotView {
  const keyed = keyOf(item);
  if (keyed === undefined) throw new Error(`Pilot item ${item.id} has no keyed option.`);
  const chosen = item.options.find((o) => o.id === attempt.optionId);
  let outcome: 'correct' | 'wrong' | 'dont-know' = 'dont-know';
  if (chosen !== undefined) outcome = chosen.correct ? 'correct' : 'wrong';
  return {
    kind: 'feedback',
    presentationId: attempt.presentationId,
    itemId: item.id,
    outcome,
    selected: chosen === undefined ? null : explain(chosen),
    keyed: explain(keyed),
  };
}

/** A saved held-out answer: progress through its block only, nothing about correctness. */
function deferredView(doc: PilotDoc, plan: Plan, presentationId: string): PilotView {
  const block = blockAt(plan, doc.presentations.findIndex((p) => p.presentationId === presentationId));
  if (block === undefined) throw new Error('Pilot held-out answer lost its block.');
  return {
    kind: 'assessment-feedback',
    presentationId,
    phase: block.phase,
    deferred: true,
    answered: answeredIn(doc, block),
    total: block.items.length,
  };
}

const answeredView = (doc: PilotDoc, plan: Plan, item: PilotItem, attempt: Attempt): PilotView =>
  item.phase === 'practice' ? feedbackView(item, attempt) : deferredView(doc, plan, attempt.presentationId);

/**
 * Every practice and transfer first choice in attempt order, joined to the trusted catalogue and its
 * presentation context; delayed answers are never evidence for the anchor. A transfer choice counts on its day
 * only if it was shown and answered the same day, unassisted both times; otherwise it keeps its family with a
 * non-calendar day, so nothing later can count in its place.
 */
function evidenceOf(doc: PilotDoc, plan: Plan): PilotEvidence[] {
  const presentations = new Map(doc.presentations.map((p) => [p.presentationId, p]));
  const context = contextOf(doc);
  return doc.attempts.flatMap((attempt): PilotEvidence[] => {
    const item = plan.byId.get(attempt.itemId);
    const p = presentations.get(attempt.presentationId);
    if (item === undefined || p === undefined || p.answered === null) throw new Error('Pilot attempt lost its presentation.');
    if (item.phase !== 'practice' && item.phase !== 'transfer') return [];
    const chosen = item.options.find((o) => o.id === attempt.optionId);
    let outcome: PilotEvidence['outcome'] = 'dont-know';
    if (chosen !== undefined) outcome = chosen.correct ? 'correct' : 'wrong';
    let day = p.answered;
    if (item.phase === 'transfer' && !independent(p, context.get(attempt.presentationId))) day = NOT_INDEPENDENT;
    return [
      {
        id: attempt.presentationId,
        construct: item.construct,
        family: item.family,
        kind: item.phase === 'practice' ? 'practice' : 'transfer',
        outcome,
        day,
      },
    ];
  });
}

/** Descriptive counts over a closed delayed block; null until its last answer is saved. */
function countsOf(doc: PilotDoc, plan: Plan, phase: PilotDelayedPhase): PilotDelayedCounts | null {
  const block = plan.blocks.find((b) => b.phase === phase);
  if (block === undefined || !isClosed(doc, block)) return null;
  const context = contextOf(doc);
  const counts: PilotDelayedCounts = { answered: 0, correct: 0, valid: 0 };
  for (const p of shownIn(doc, block)) {
    const item = plan.byId.get(p.itemId);
    const attempt = doc.attempts.find((a) => a.presentationId === p.presentationId);
    if (item === undefined || attempt === undefined) throw new Error('Pilot delayed answer lost its attempt.');
    counts.answered += 1;
    if (attempt.optionId !== null && keyOf(item)?.id === attempt.optionId) counts.correct += 1;
    if (independent(p, context.get(p.presentationId))) counts.valid += 1;
  }
  return counts;
}

/**
 * A closed transfer block, anchored on the day it closed only when the shared evaluator accepts it, with any
 * closed delayed counts. `notBefore` is set when today's assistance read held the next delayed item back.
 */
function progressView(doc: PilotDoc, plan: Plan, notBefore?: string): PilotView {
  const anchorDay = anchorOf(doc, plan);
  const open = anchorDay === null ? null : openingOf(doc, plan, anchorDay);
  return {
    kind: 'progress',
    provisional: anchorDay !== null,
    anchorDay,
    nextDue: open?.due ?? null,
    delayed: anchorDay === null ? { d7: null, d30: null } : { d7: countsOf(doc, plan, 'd7'), d30: countsOf(doc, plan, 'd30') },
    upcoming:
      open === null
        ? null
        : {
            phase: open.phase,
            answered: answeredIn(doc, open.block),
            total: open.block.items.length,
            availableOn: notBefore !== undefined && notBefore > open.earliest ? notBefore : open.earliest,
          },
  };
}

interface Change {
  doc: PilotDoc;
  view: PilotView;
}

function present(doc: PilotDoc, item: PilotItem, today: string, random: () => number): Change & { presentationId: string } {
  const presentation: Presentation = {
    // A fresh nonce, persisted once with the presentation: unique across owners and stores.
    presentationId: newId('ua-pres'),
    itemId: item.id,
    shown: today,
    optionOrder: shuffled(item.options.map((o) => o.id), random),
    answered: null,
  };
  return {
    doc: {
      ...doc,
      presentations: [...doc.presentations, presentation],
      current: { presentationId: presentation.presentationId, itemId: item.id, day: today },
    },
    view: questionView(presentation, item),
    presentationId: presentation.presentationId,
  };
}

/** A new held-out presentation with the unassisted read that allowed it recorded beside it. */
function presentHeld(doc: PilotDoc, item: PilotItem, today: string, random: () => number): Change {
  const shown = present(doc, item, today, random);
  const context: Assessment = { presentationId: shown.presentationId, assistedWhenShown: false, assistedWhenAnswered: null };
  return { doc: { ...shown.doc, assessments: [...(doc.assessments ?? []), context] }, view: shown.view };
}

/** Makes the next displayable thing durable-ready: records lesson exposure or a new presentation. */
async function settle(doc: PilotDoc, today: string, random: () => number, plan: Plan, assisted: Assisted): Promise<Change> {
  const at = locate(doc, plan);
  switch (at.kind) {
    case 'lesson':
      return {
        doc: withLessonShown(doc, at.index, at.step.lesson.id, today),
        view: { kind: 'lesson', lesson: at.step.lesson },
      };
    case 'practice': {
      const shown = present(doc, at.item, today, random);
      return { doc: shown.doc, view: shown.view };
    }
    case 'transfer': {
      const taught = teachingDays(doc, plan);
      const lastTaught = taught[taught.length - 1];
      if (lastTaught === undefined) throw new Error('Pilot transfer reached without teaching.');
      const awaiting = (until: string): Change => ({
        doc,
        view: { kind: 'awaiting-transfer', constructs: practiceSummary(doc, plan), until },
      });
      // Nothing held-out is read, shown or consumed on a day with the learner's own teaching or practice.
      const earliest = addDays(lastTaught, 1);
      if (today < earliest) return awaiting(earliest);
      if (await assisted(today)) return awaiting(addDays(today, 1));
      return presentHeld(doc, at.item, today, random);
    }
    case 'delayed': {
      const open = openingOf(doc, plan, at.anchor);
      if (open === null) throw new Error('Pilot delayed check reached without its block.');
      // Nothing delayed is read, shown or consumed before its due day, on a day an earlier phase used, or on an
      // assisted day; its own block's earlier answers today do not hold it back.
      if (today < open.earliest) return { doc, view: progressView(doc, plan) };
      if (await assisted(today)) return { doc, view: progressView(doc, plan, addDays(today, 1)) };
      return presentHeld(doc, at.item, today, random);
    }
    case 'question':
      return { doc, view: questionView(at.presentation, at.item) };
    case 'feedback':
      return { doc, view: answeredView(doc, plan, at.item, at.attempt) };
    case 'insufficient':
      return { doc, view: { kind: 'insufficient', constructs: practiceSummary(doc, plan) } };
    case 'closed':
      return { doc, view: progressView(doc, plan) };
  }
}

// ---- Controller ----

const queues = new WeakMap<object, ReturnType<typeof createSerialQueue>>();

function queueFor(store: object): ReturnType<typeof createSerialQueue> {
  let queue = queues.get(store);
  if (queue === undefined) {
    queue = createSerialQueue();
    queues.set(store, queue);
  }
  return queue;
}

/** The serial write queue a store's pilot controllers share, for sequencing other controllers on that store. */
export const pilotQueueFor = queueFor;

/**
 * Whether `raw` is this owner's own Unit A document with an anchored transfer block, through the same strict
 * reading and shared evaluator as the controller, plus its distinct activity days. Pure: no store, assistance,
 * randomness or write, so it never opens a delayed check. Null for anything the controller would block on.
 */
export function unitAStatus(raw: string | null, owner: string, today: string): { qualified: boolean; days: string[] } | null {
  if (!isText(owner) || !isCalendarDay(today) || PLAN === null) return null;
  const plan = PLAN;
  try {
    const doc = parseDoc(raw, owner, today, plan);
    if (typeof doc === 'string') return null;
    return { qualified: anchorOf(doc, plan) !== null, days: [...new Set(daysOf(doc))].sort() };
  } catch {
    return null;
  }
}

const blocked = (reason: PilotBlockReason): PilotView => ({ kind: 'blocked', reason });

function holds(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

export function createPilotController(options: PilotControllerOptions) {
  const { store, owner, mode, random, capture } = options;
  const enqueue = queueFor(store);
  let disposed = false;
  /** Set once a successful operation has seen this owner's document stored. */
  let bound = false;
  /** Whether the last capture drain appended every saved intent; pending until one has. */
  let captured: Exclude<PilotCaptureStatus, 'off'> = 'pending';

  /** Every check but capture liveness, which only gates what this controller starts. */
  function baseGate(): PilotBlockReason | null {
    if (disposed) return 'disposed';
    if (!holds(() => options.active() === true)) return 'inactive';
    if (mode === 'tester') {
      if (!holds(() => starterBetaBuild(options.betaEnv) === true)) return 'mode';
      if (!holds(() => starterReviewAccess(options.starterReview).allowed === true)) return 'review';
    } else if (mode !== 'developer-demo') {
      return 'mode';
    }
    if (!holds(() => options.readOnly() === false)) return 'read-only';
    if (PLAN === null) return 'content';
    if (!isText(owner)) return 'owner';
    return null;
  }

  function gate(): PilotBlockReason | null {
    const base = baseGate();
    if (base !== null) return base;
    // An opted-in controller never saves a first choice it could not also capture.
    if (capture !== undefined && !holds(() => capture.active() === true)) return 'inactive';
    return null;
  }

  /** Refuses a captured answer, before anything is written, unless the store can take it for this learner. */
  async function captureReady(): Promise<void> {
    if (capture === undefined) return;
    if (!isText(capture.learnerId)) throw new Error('Pilot capture has no learner; nothing was saved.');
    if (typeof store.getLearner !== 'function' || typeof store.listAnswers !== 'function' || typeof store.appendAnswer !== 'function') {
      throw new Error('Pilot storage cannot capture answers; nothing was saved.');
    }
    const learner = await store.getLearner();
    if (learner?.learner_id !== capture.learnerId) throw new Error('Pilot capture is for another learner; nothing was saved.');
  }

  /** Appends the stored document's intents; a failure leaves them saved locally for the next operation. */
  async function drain(): Promise<void> {
    try {
      await drainPilotAnswers({ store, owner, active: () => gate() === null });
      captured = 'saved';
    } catch {
      captured = 'pending';
    }
  }

  // Reads only: it runs inside the queued update, so it must never call a queued store writer.
  const assisted: Assisted = async (day) => {
    const value: unknown = await options.assistedToday(day);
    if (typeof value !== 'boolean') throw new Error('Pilot assistance check did not answer true or false.');
    return value;
  };

  function run(
    step: (doc: PilotDoc, today: string, plan: Plan) => Change | Promise<Change>,
    prepare?: () => Promise<void>,
  ): Promise<PilotView> {
    return enqueue(async () => {
      const early = gate();
      if (early !== null || PLAN === null) return blocked(early ?? 'content');
      let today: unknown;
      try {
        today = options.today();
      } catch {
        return blocked('today');
      }
      if (!isCalendarDay(today)) return blocked('today');
      // Never a separate get then set: that could write an old document back after a reset.
      if (typeof store.updateMeta !== 'function') throw new Error('Pilot storage has no atomic metadata update; nothing was read or written.');
      const day = today;
      const plan = PLAN;
      // Store reads outside the update, so none of them waits behind it.
      if (prepare !== undefined) await prepare();

      // Filled by the transform, which returns `raw` itself whenever nothing may be written.
      const outcome: { view: PilotView | null; own: boolean } = { view: null, own: false };
      await store.updateMeta(PILOT_META_KEY, async (raw) => {
        const afterRead = gate();
        if (afterRead !== null) {
          outcome.view = blocked(afterRead);
          return raw;
        }
        if (raw === null && bound) {
          outcome.view = blocked('owner');
          return raw;
        }
        const parsed = parseDoc(raw, owner, day, plan);
        if (typeof parsed === 'string') {
          outcome.view = blocked(parsed);
          return raw;
        }
        const change = await step(parsed, day, plan);
        // A step may have awaited the assistance read: check again before using or writing its result.
        const afterStep = gate();
        if (afterStep !== null) {
          outcome.view = blocked(afterStep);
          return raw;
        }
        const next = JSON.stringify(change.doc);
        if (next === JSON.stringify(parsed)) {
          outcome.own = raw !== null;
          outcome.view = change.view;
          return raw;
        }
        outcome.own = true;
        outcome.view = change.view;
        return next;
      });
      // Reached only when the read and any write succeeded.
      if (outcome.own) bound = true;
      const afterWrite = gate();
      if (afterWrite !== null) return blocked(afterWrite);
      if (outcome.view === null) throw new Error('Pilot update finished without a view.');
      // Only a document this operation read as this owner's own is drained, after its update has resolved.
      if (capture !== undefined && outcome.view.kind !== 'blocked') {
        await drain();
        // A lost capture leaves the saved choice and its view; anything else still blocks.
        const afterDrain = baseGate();
        if (afterDrain !== null) return blocked(afterDrain);
      }
      return outcome.view;
    });
  }

  return {
    /** Shows where the learner is; records lesson exposure or a new presentation before displaying it. */
    load(): Promise<PilotView> {
      return run((doc, today, plan) => settle(doc, today, random, plan, assisted));
    },

    /** Leaves a lesson or feedback for what follows. An unanswered question cannot be skipped. */
    next(): Promise<PilotView> {
      return run((doc, today, plan) => {
        const at = locate(doc, plan);
        let moved = doc;
        if (at.kind === 'lesson') moved = withLessonCompleted(doc, at.index, at.step.lesson.id, today);
        else if (at.kind === 'feedback') moved = { ...doc, current: null };
        return settle(moved, today, random, plan, assisted);
      });
    },

    /**
     * Records the first choice (null = "I don't know") for the current presentation. Practice gets feedback; a
     * held-out answer saves the assistance read with it and stays ungraded until the last one closes the block.
     */
    answer(presentationId: string, optionId: string | null): Promise<PilotView> {
      if (!isText(presentationId) || !(optionId === null || isText(optionId))) {
        return Promise.reject(new Error('Invalid pilot answer.'));
      }
      return run(async (doc, today, plan) => {
        const at = locate(doc, plan);
        if (at.kind === 'feedback' && at.attempt.presentationId === presentationId) {
          if (at.attempt.optionId === optionId) return { doc, view: answeredView(doc, plan, at.item, at.attempt) };
          throw new Error('This presentation already has its first answer.');
        }
        if (at.kind !== 'question' || at.presentation.presentationId !== presentationId) {
          throw new Error('Not the presentation on screen.');
        }
        if (optionId !== null && !at.item.options.some((o) => o.id === optionId)) {
          throw new Error('Unknown option for this presentation.');
        }
        const attempt: Attempt = { presentationId, itemId: at.item.id, optionId };
        // Made before anything is written: a bad learner or time refuses the choice itself.
        const intent =
          capture === undefined
            ? null
            : makePilotAnswer({
                owner,
                learnerId: capture.learnerId,
                presentationId,
                itemId: at.item.id,
                optionId,
                optionOrder: [...at.presentation.optionOrder],
                day: today,
                timestamp: capture.now(),
              });
        const answered: PilotDoc = {
          ...doc,
          attempts: [...doc.attempts, attempt],
          presentations: doc.presentations.map((p) =>
            p.presentationId === presentationId ? { ...p, answered: today } : p,
          ),
          ...(intent === null ? {} : { captures: [...(doc.captures ?? []), intent] }),
        };
        if (at.item.phase === 'practice') return { doc: answered, view: feedbackView(at.item, attempt) };
        // A later day or assistance after display keeps the raw choice; independence is derived from this context.
        const help = await assisted(today);
        const marked: PilotDoc = {
          ...answered,
          assessments: (doc.assessments ?? []).map((a) =>
            a.presentationId === presentationId ? { ...a, assistedWhenAnswered: help } : a,
          ),
        };
        // The last answer of a held-out block closes it directly: there is no deferred screen left to leave.
        if (endsBlock(plan, marked.presentations.length)) {
          const closed: PilotDoc = { ...marked, current: null };
          return { doc: closed, view: progressView(closed, plan) };
        }
        return { doc: marked, view: deferredView(marked, plan, presentationId) };
      }, captureReady);
    },

    /** 'off' without capture; else whether the last drain appended every saved intent ('pending' until one has). */
    captureStatus(): PilotCaptureStatus {
      return capture === undefined ? 'off' : captured;
    },

    dispose(): void {
      disposed = true;
    },
  };
}
