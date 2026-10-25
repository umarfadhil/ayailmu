// Next lesson (U-C nominal definiteness) controller: a learner whose own Unit A document qualifies (unitAStatus,
// read fresh inside every operation) sees the draft's four teaching screens in order, then its six practice tasks
// in content order, then its four reserved transfer tasks in content order. Each display is recorded before it is
// shown, as one store.updateMeta of this controller's own versioned document under NEXT_LESSON_META_KEY, sequenced
// on the store's shared pilot queue; Unit A records are only read. A presentation's option order is shuffled once
// and persisted, so a reload or reopened store resumes the exact same question whatever its randomness. A first
// choice (or "don't know") is saved with its day before anything follows and is never replaced; only an explicit
// next moves on. After the last practice feedback is left the learner awaits transfer until a day after every help
// day on which neither the injected assistance check nor the learner's own Unit A activity reports help; each new
// transfer task needs that unassisted read. Transfer is shown without help lines, keys or feedback; each first
// choice is saved with the assistance read at answer time beside it, acknowledged without grading, and the fourth
// closes the block with descriptive counts only (valid when shown and answered the same day, unassisted both
// times). Every day teaching, a practice question or its feedback is displayed is kept in `helpDays`; transfer
// never is. Anything unknown, foreign, stale or inconsistent blocks without being rewritten; IO, assistance and
// write errors reject and publish nothing. Nothing here claims mastery, an unlock or retention.
import { NOMINAL_DEFINITENESS, validateNominalDefiniteness } from '@/content/increments/nominal-definiteness/content';
import type { HelpLine } from '@/content/schema';
import type {
  IncrementItem,
  IncrementOption,
  IncrementPhase,
  IncrementScreen,
  TaskFormat,
} from '@/content/increments/nominal-definiteness/schema';
import { newId } from '@/engine/util';
import { PILOT_META_KEY, pilotQueueFor, unitAStatus } from '@/pilot/unitA/controller';
import type { Store } from '@/storage/types';

export const NEXT_LESSON_META_KEY = 'pilot_next_nominal_definiteness';

export interface NextLessonChoice {
  readonly id: string;
  readonly text: string;
  readonly arabic?: boolean;
}

/** An option with its own feedback from the draft, shown only after the first choice is saved. */
export interface NextLessonExplainedChoice {
  readonly id: string;
  readonly text: string;
  readonly explanation: string;
}

export type NextLessonView =
  | { readonly kind: 'screen'; readonly screen: IncrementScreen }
  | {
      readonly kind: 'question';
      readonly presentationId: string;
      readonly itemId: string;
      readonly phase: IncrementPhase;
      readonly format: TaskFormat;
      readonly stem: string;
      readonly prompt: string;
      readonly help_lines: readonly HelpLine[];
      readonly options: readonly NextLessonChoice[];
    }
  | {
      readonly kind: 'feedback';
      readonly presentationId: string;
      readonly itemId: string;
      readonly outcome: 'correct' | 'wrong' | 'dont-know';
      readonly selected: NextLessonExplainedChoice | null;
      readonly keyed: NextLessonExplainedChoice;
    }
  | { readonly kind: 'awaiting-transfer'; readonly until: string }
  /** A saved transfer first choice, ungraded until the block closes. */
  | { readonly kind: 'assessment-feedback'; readonly presentationId: string; readonly itemId: string; readonly deferred: true }
  | { readonly kind: 'closed'; readonly counts: { readonly answered: number; readonly correct: number; readonly valid: number } }
  | { readonly kind: 'blocked'; readonly reason: string };

export interface NextLessonOptions {
  store: Store;
  owner: string;
  mode: 'developer-demo' | 'tester';
  today: () => string;
  readOnly: () => boolean;
  active: () => boolean;
  consented: () => boolean;
  assistedToday: (day: string) => Promise<boolean>;
  random: () => number;
}

export interface NextLessonController {
  load(): Promise<NextLessonView>;
  next(): Promise<NextLessonView>;
  answer(presentationId: string, optionId: string | null): Promise<NextLessonView>;
  /**
   * Route Back: records today as a help day only for teaching, a practice question or its feedback already on
   * display; never settles, advances, answers or presents anything, and publishes no view.
   */
  pause(): Promise<void>;
  dispose(): void;
}

const SCHEMA = 1;
const SCREEN_COUNT = 4;
const PRACTICE_COUNT = 6;
const TRANSFER_COUNT = 4;
const OPTION_COUNT = 4;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---- Plan over the draft ----

interface Plan {
  contentVersion: string;
  screens: readonly IncrementScreen[];
  practice: readonly IncrementItem[];
  /** The reserved transfer items in content order, offered once each after practice. */
  transfer: readonly IncrementItem[];
  /** Practice then transfer; presentation i always asks sequence[i]. */
  sequence: readonly IncrementItem[];
}

/** Four distinct options, each with its own feedback, exactly one keyed. */
function soundItem(item: IncrementItem): boolean {
  const ids = item.options.map((o) => o.id);
  return (
    isText(item.item_id) &&
    ids.length === OPTION_COUNT &&
    new Set(ids).size === OPTION_COUNT &&
    item.options.every((o) => isText(o.id) && isText(o.feedback)) &&
    item.options.filter((o) => o.correct).length === 1
  );
}

function buildPlan(): Plan | null {
  try {
    const content = NOMINAL_DEFINITENESS;
    // The draft's own validator returns its problems: only an empty list accepts the content.
    const problems: unknown = validateNominalDefiniteness(content);
    if (!Array.isArray(problems) || problems.length !== 0) return null;
    const screens = content.lessons.flatMap((lesson) => lesson.screens);
    const practice = content.items.filter((item) => item.phase === 'practice');
    const transfer = content.items.filter((item) => item.phase === 'transfer');
    if (screens.length !== SCREEN_COUNT || !screens.every((s) => isText(s.screen_id))) return null;
    if (new Set(screens.map((s) => s.screen_id)).size !== screens.length) return null;
    if (practice.length !== PRACTICE_COUNT || !practice.every(soundItem)) return null;
    if (transfer.length !== TRANSFER_COUNT || !transfer.every(soundItem)) return null;
    const sequence = [...practice, ...transfer];
    if (new Set(sequence.map((item) => item.item_id)).size !== sequence.length) return null;
    if (!isText(content.content_version)) return null;
    return { contentVersion: content.content_version, screens, practice, transfer, sequence };
  } catch {
    return null;
  }
}

// ---- Stored document ----

interface ScreenExposure {
  screenId: string;
  /** Every day the screen was displayed, ascending. */
  shown: string[];
  completed: string | null;
}

interface Presentation {
  presentationId: string;
  itemId: string;
  /** First display day; never moved by a later reload. */
  shown: string;
  optionOrder: string[];
  /** Day the first choice was saved; never moved by a replay. */
  answered: string | null;
}

/** The raw first choice for presentations[i], at attempts[i]; null is "don't know". */
interface Attempt {
  presentationId: string;
  itemId: string;
  optionId: string | null;
}

/** The presentation on display (its question, or its feedback once answered); `day` is its first display day. */
interface Current {
  presentationId: string;
  itemId: string;
  day: string;
}

/** Context of one transfer presentation, in presentation order. Observations only, not a verdict. */
interface Assessment {
  presentationId: string;
  /** Assistance read just before display; a transfer item is shown only when this was false. */
  assistedWhenShown: false;
  /** Assistance read when the first choice was saved; null until then. */
  assistedWhenAnswered: boolean | null;
}

interface NextDoc {
  owner: string;
  schema: typeof SCHEMA;
  contentVersion: string;
  screens: ScreenExposure[];
  presentations: Presentation[];
  attempts: Attempt[];
  current: Current | null;
  /** Distinct days with teaching, a practice question or its feedback displayed, ascending. Observations only. */
  helpDays: string[];
  /** Absent until the first transfer item is shown, so teaching and practice documents keep their exact bytes. */
  assessments?: Assessment[];
}

const DOC_KEYS = [
  'owner', 'schema', 'contentVersion', 'screens', 'presentations', 'attempts', 'current', 'helpDays',
] as const;
const ASSESSED_DOC_KEYS = [...DOC_KEYS, 'assessments'] as const;

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

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

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

/** The following calendar day of a valid day. */
function dayAfter(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(0);
  // setUTCFullYear, unlike Date.UTC, keeps years below 100 literal.
  next.setUTCFullYear(year, month - 1, date + 1);
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  return `${pad(next.getUTCFullYear(), 4)}-${pad(next.getUTCMonth() + 1, 2)}-${pad(next.getUTCDate(), 2)}`;
}

const ascending = (days: readonly string[]): boolean => days.every((day, i) => i === 0 || (days[i - 1] ?? '') < day);

const isDayList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isCalendarDay) && ascending(v);

const isScreenExposure = (v: unknown): v is ScreenExposure =>
  exactly(v, ['screenId', 'shown', 'completed']) &&
  isText(v.screenId) &&
  isDayList(v.shown) &&
  v.shown.length > 0 &&
  (v.completed === null || isCalendarDay(v.completed));

const isPresentation = (v: unknown): v is Presentation =>
  exactly(v, ['presentationId', 'itemId', 'shown', 'optionOrder', 'answered']) &&
  isText(v.presentationId) &&
  isText(v.itemId) &&
  isCalendarDay(v.shown) &&
  Array.isArray(v.optionOrder) &&
  v.optionOrder.every(isText) &&
  (v.answered === null || isCalendarDay(v.answered));

const isAttempt = (v: unknown): v is Attempt =>
  exactly(v, ['presentationId', 'itemId', 'optionId']) &&
  isText(v.presentationId) &&
  isText(v.itemId) &&
  (v.optionId === null || isText(v.optionId));

const isCurrent = (v: unknown): v is Current =>
  exactly(v, ['presentationId', 'itemId', 'day']) && isText(v.presentationId) && isText(v.itemId) && isCalendarDay(v.day);

const isAssessment = (v: unknown): v is Assessment =>
  exactly(v, ['presentationId', 'assistedWhenShown', 'assistedWhenAnswered']) &&
  isText(v.presentationId) &&
  v.assistedWhenShown === false &&
  (v.assistedWhenAnswered === null || typeof v.assistedWhenAnswered === 'boolean');

const isListOf = <T>(value: unknown, guard: (v: unknown) => v is T): value is T[] =>
  Array.isArray(value) && value.every(guard);

const presentationDays = (presentations: readonly Presentation[]): string[] =>
  presentations.flatMap((p) => (p.answered === null ? [p.shown] : [p.shown, p.answered]));

/**
 * A state this controller could have written: screens in order, then practice and transfer presentations in
 * content order, each answered once before the next exists, with current on the last one until it is left. Transfer
 * starts strictly after every help day, carries one assessment context per presentation, and its last answer closes
 * the block.
 */
function coherent(doc: NextDoc, plan: Plan): boolean {
  const { screens, presentations, attempts, current, helpDays, assessments } = doc;
  if (screens.length > plan.screens.length || presentations.length > plan.sequence.length) return false;
  if (attempts.length > presentations.length) return false;
  if (new Set(presentations.map((p) => p.presentationId)).size !== presentations.length) return false;
  const screensOk = screens.every((exposure, index) => {
    const last = exposure.shown[exposure.shown.length - 1];
    return (
      exposure.screenId === plan.screens[index]?.screen_id &&
      // Completing a screen displays it that day, so completion is always its last shown day.
      (exposure.completed === null ? index === screens.length - 1 : exposure.completed === last) &&
      (index === 0 || (screens[index - 1]?.completed ?? '') <= (exposure.shown[0] ?? ''))
    );
  });
  const taught = screens.length === plan.screens.length && screens.every((s) => s.completed !== null);
  const presentationsOk =
    (presentations.length === 0 || taught) &&
    presentations.every((p, index) => {
      const item = plan.sequence[index];
      if (item === undefined || p.itemId !== item.item_id) return false;
      const ids = item.options.map((o) => o.id);
      // Each presentation follows the end of teaching, or the previous presentation's answer.
      const after = index === 0 ? screens[screens.length - 1]?.completed : presentations[index - 1]?.answered;
      const attempt = attempts[index];
      return (
        p.optionOrder.length === ids.length &&
        new Set(p.optionOrder).size === ids.length &&
        p.optionOrder.every((id) => ids.includes(id)) &&
        typeof after === 'string' &&
        p.shown >= after &&
        (attempt === undefined
          ? p.answered === null && index === presentations.length - 1
          : p.answered !== null &&
            p.answered >= p.shown &&
            attempt.presentationId === p.presentationId &&
            attempt.itemId === p.itemId &&
            (attempt.optionId === null || ids.includes(attempt.optionId)))
      );
    });
  const held = presentations.slice(plan.practice.length);
  const lastHelp = helpDays[helpDays.length - 1];
  const heldOk = held.length === 0 || (lastHelp !== undefined && (held[0]?.shown ?? '') > lastHelp);
  const assessmentsOk =
    assessments === undefined
      ? held.length === 0
      : held.length > 0 &&
        assessments.length === held.length &&
        assessments.every((a, index) => {
          const p = held[index];
          return p !== undefined && a.presentationId === p.presentationId && (a.assistedWhenAnswered === null) === (p.answered === null);
        });
  const last = presentations[presentations.length - 1];
  const currentOk =
    current === null
      ? last === undefined || (last.answered !== null && presentations.length >= plan.practice.length)
      : last !== undefined &&
        current.presentationId === last.presentationId &&
        current.itemId === last.itemId &&
        current.day === last.shown &&
        // The last transfer answer closes the block and clears current.
        !(presentations.length === plan.sequence.length && last.answered !== null);
  const displayDays = [
    ...screens.flatMap((s) => s.shown),
    ...presentationDays(presentations.slice(0, plan.practice.length)),
  ];
  return (
    screensOk &&
    presentationsOk &&
    heldOk &&
    assessmentsOk &&
    currentOk &&
    displayDays.every((day) => helpDays.includes(day))
  );
}

function emptyDoc(owner: string, plan: Plan): NextDoc {
  return {
    owner,
    schema: SCHEMA,
    contentVersion: plan.contentVersion,
    screens: [],
    presentations: [],
    attempts: [],
    current: null,
    helpDays: [],
  };
}

function parseDoc(raw: string | null, owner: string, today: string, plan: Plan): NextDoc | string {
  if (raw === null) return emptyDoc(owner, plan);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return 'corrupt';
  }
  if (!isRecord(value)) return 'corrupt';
  if (value.schema !== SCHEMA) return 'schema';
  if (value.owner !== owner) return 'owner';
  if (value.contentVersion !== plan.contentVersion) return 'version';
  if (
    !(exactly(value, DOC_KEYS) || exactly(value, ASSESSED_DOC_KEYS)) ||
    !isListOf(value.screens, isScreenExposure) ||
    !isListOf(value.presentations, isPresentation) ||
    !isListOf(value.attempts, isAttempt) ||
    !(value.current === null || isCurrent(value.current)) ||
    !isDayList(value.helpDays) ||
    !(value.assessments === undefined || isListOf(value.assessments, isAssessment))
  ) {
    return 'corrupt';
  }
  const doc = value as unknown as NextDoc;
  if ([...doc.helpDays, ...presentationDays(doc.presentations)].some((day) => day > today)) return 'future-day';
  return coherent(doc, plan) ? doc : 'corrupt';
}

/**
 * The days this owner's stored document says the next lesson displayed teaching, practice or its feedback, as of
 * `today`, through the same strict parser the controller uses; null for anything unknown, foreign, future or
 * inconsistent. Read only: no load, settle or qualification check, so observed help stays visible whether or not
 * Unit A still qualifies.
 */
export function nextLessonHelpDays(raw: string | null, owner: string, today: string): string[] | null {
  try {
    const plan = buildPlan();
    if (plan === null || !isText(owner) || !isCalendarDay(today)) return null;
    const parsed = parseDoc(raw, owner, today, plan);
    return typeof parsed === 'string' ? null : [...parsed.helpDays];
  } catch {
    return null;
  }
}

// ---- Transitions and views ----

interface Change {
  doc: NextDoc;
  view: NextLessonView;
}

/** Whether the learner had other help today; rejects on anything but a boolean. */
type Assisted = () => Promise<boolean>;

const blocked = (reason: string): NextLessonView => ({ kind: 'blocked', reason });

/** Index of the screen still to finish, or the screen count once all are completed. */
const screenAt = (doc: NextDoc): number => {
  const open = doc.screens.findIndex((s) => s.completed === null);
  return open === -1 ? doc.screens.length : open;
};

interface Displayed {
  index: number;
  presentation: Presentation;
  item: IncrementItem;
  attempt: Attempt | undefined;
  transfer: boolean;
}

/** The current presentation with its item and saved first choice, or null when none is on display. */
function displayed(doc: NextDoc, plan: Plan): Displayed | null {
  const { current } = doc;
  if (current === null) return null;
  const index = doc.presentations.findIndex((x) => x.presentationId === current.presentationId);
  const presentation = doc.presentations[index];
  const item = plan.sequence[index];
  if (presentation === undefined || item === undefined) throw new Error('Next lesson state lost its current presentation.');
  return { index, presentation, item, attempt: doc.attempts[index], transfer: index >= plan.practice.length };
}

function withHelpDay(doc: NextDoc, today: string): NextDoc {
  return doc.helpDays.includes(today) ? doc : { ...doc, helpDays: [...doc.helpDays, today].sort() };
}

function withScreenShown(doc: NextDoc, index: number, screenId: string, today: string): NextDoc {
  const existing = doc.screens[index];
  if (existing?.shown.includes(today)) return doc;
  const exposure = existing ? { ...existing, shown: [...existing.shown, today] } : { screenId, shown: [today], completed: null };
  return { ...doc, screens: [...doc.screens.slice(0, index), exposure] };
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

/** Whitelisted fields only: no keys, feedback, solution or reviewer metadata, and no help lines for transfer. */
function questionView(p: Presentation, item: IncrementItem): NextLessonView {
  const byId = new Map(item.options.map((o) => [o.id, o]));
  return {
    kind: 'question',
    presentationId: p.presentationId,
    itemId: item.item_id,
    phase: item.phase,
    format: item.format,
    stem: item.stem,
    prompt: item.prompt,
    help_lines: item.phase === 'transfer' ? [] : item.help_lines.map((h) => ({ word: h.word, meaning: h.meaning })),
    options: p.optionOrder.map((id): NextLessonChoice => {
      const o = byId.get(id);
      if (o === undefined) throw new Error('Next lesson presentation lost an option.');
      return o.arabic === undefined ? { id: o.id, text: o.text } : { id: o.id, text: o.text, arabic: o.arabic };
    }),
  };
}

const explained = (o: IncrementOption): NextLessonExplainedChoice => ({ id: o.id, text: o.text, explanation: o.feedback });

/** Graded from the draft: the saved choice's own correctness and feedback, and the keyed option's. */
function feedbackView(p: Presentation, item: IncrementItem, optionId: string | null): NextLessonView {
  const keyed = item.options.find((o) => o.correct);
  const selected = optionId === null ? null : item.options.find((o) => o.id === optionId);
  if (keyed === undefined || selected === undefined) throw new Error('Next lesson feedback lost an option.');
  const graded = { kind: 'feedback', presentationId: p.presentationId, itemId: item.item_id } as const;
  if (selected === null) return { ...graded, outcome: 'dont-know', selected: null, keyed: explained(keyed) };
  return { ...graded, outcome: selected.correct ? 'correct' : 'wrong', selected: explained(selected), keyed: explained(keyed) };
}

/** A saved transfer first choice: nothing about its correctness until the block closes. */
const deferredView = (p: Presentation): NextLessonView => ({
  kind: 'assessment-feedback',
  presentationId: p.presentationId,
  itemId: p.itemId,
  deferred: true,
});

/**
 * Descriptive counts over the transfer first choices only: answered, matching the key, and valid (shown and answered
 * the same day, unassisted both times) whatever the choice. Not a pass, mastery or unlock.
 */
function closedView(doc: NextDoc, plan: Plan): NextLessonView {
  const counts = { answered: 0, correct: 0, valid: 0 };
  doc.presentations.slice(plan.practice.length).forEach((p, i) => {
    const attempt = doc.attempts[plan.practice.length + i];
    const item = plan.transfer[i];
    const context = doc.assessments?.[i];
    if (attempt === undefined || item === undefined || context === undefined) throw new Error('Next lesson transfer lost an answer.');
    counts.answered += 1;
    if (attempt.optionId !== null && item.options.find((o) => o.correct)?.id === attempt.optionId) counts.correct += 1;
    if (context.assistedWhenShown === false && context.assistedWhenAnswered === false && p.answered === p.shown) counts.valid += 1;
  });
  return { kind: 'closed', counts };
}

/** A new presentation of `item` with its option order, made current. */
function present(doc: NextDoc, item: IncrementItem, today: string, random: () => number): Change & { presentation: Presentation } {
  const presentation: Presentation = {
    presentationId: newId('uc-pres'),
    itemId: item.item_id,
    shown: today,
    optionOrder: shuffled(item.options.map((o) => o.id), random),
    answered: null,
  };
  const presented: NextDoc = {
    ...doc,
    presentations: [...doc.presentations, presentation],
    current: { presentationId: presentation.presentationId, itemId: presentation.itemId, day: today },
  };
  return { doc: presented, view: questionView(presentation, item), presentation };
}

/**
 * Records the next displayable thing (screen exposure, the current question or feedback, or a new presentation)
 * and, for teaching and practice, today's help day. Awaiting transfer displays nothing and records nothing; a new
 * transfer task is shown only after today's unassisted read, recorded beside it.
 */
async function settle(doc: NextDoc, today: string, plan: Plan, random: () => number, assisted: Assisted): Promise<Change> {
  const index = screenAt(doc);
  const screen = plan.screens[index];
  if (screen !== undefined) {
    return { doc: withHelpDay(withScreenShown(doc, index, screen.screen_id, today), today), view: { kind: 'screen', screen } };
  }
  const shown = displayed(doc, plan);
  if (shown !== null) {
    const { presentation, item, attempt, transfer } = shown;
    if (transfer) return { doc, view: attempt === undefined ? questionView(presentation, item) : deferredView(presentation) };
    const view = attempt === undefined ? questionView(presentation, item) : feedbackView(presentation, item, attempt.optionId);
    return { doc: withHelpDay(doc, today), view };
  }
  const item = plan.sequence[doc.presentations.length];
  if (item === undefined) return { doc, view: closedView(doc, plan) };
  if (doc.presentations.length < plan.practice.length) {
    const presented = present(doc, item, today, random);
    return { doc: withHelpDay(presented.doc, today), view: presented.view };
  }
  const lastHelp = doc.helpDays[doc.helpDays.length - 1];
  if (lastHelp === undefined) throw new Error('Next lesson practice finished without a help day.');
  const until = dayAfter(lastHelp);
  if (today < until) return { doc, view: { kind: 'awaiting-transfer', until } };
  // Nothing held-out is stored or shown on a day with other help; it waits for the next day.
  if (await assisted()) return { doc, view: { kind: 'awaiting-transfer', until: dayAfter(today) } };
  const presented = present(doc, item, today, random);
  const context: Assessment = { presentationId: presented.presentation.presentationId, assistedWhenShown: false, assistedWhenAnswered: null };
  return { doc: { ...presented.doc, assessments: [...(doc.assessments ?? []), context] }, view: presented.view };
}

/**
 * Saves the first choice for the displayed question before its feedback or acknowledgement; replays only that same
 * choice. A transfer choice keeps today's assistance read beside it, and the last one closes the block.
 */
async function recordAnswer(
  doc: NextDoc,
  today: string,
  plan: Plan,
  presentationId: unknown,
  optionId: unknown,
  assisted: Assisted,
): Promise<Change> {
  if (!isText(presentationId) || !(optionId === null || isText(optionId))) return { doc, view: blocked('invalid-answer') };
  const shown = displayed(doc, plan);
  if (shown === null) {
    // A closed block repeats its counts for the same closing choice and is never retaken.
    const last = doc.presentations[doc.presentations.length - 1];
    const replay =
      doc.presentations.length === plan.sequence.length &&
      last?.presentationId === presentationId &&
      doc.attempts[doc.attempts.length - 1]?.optionId === optionId;
    return { doc, view: replay ? closedView(doc, plan) : blocked('stale') };
  }
  if (shown.presentation.presentationId !== presentationId) return { doc, view: blocked('stale') };
  const { index, presentation, item, attempt, transfer } = shown;
  if (attempt !== undefined) {
    // The same choice again shows its feedback again; any other choice never replaces the first.
    if (attempt.optionId !== optionId) return { doc, view: blocked('answered') };
    if (transfer) return { doc, view: deferredView(presentation) };
    return { doc: withHelpDay(doc, today), view: feedbackView(presentation, item, optionId) };
  }
  if (optionId !== null && !presentation.optionOrder.includes(optionId)) return { doc, view: blocked('invalid-option') };
  const saved: NextDoc = {
    ...doc,
    presentations: doc.presentations.map((p, i) => (i === index ? { ...p, answered: today } : p)),
    attempts: [...doc.attempts, { presentationId, itemId: item.item_id, optionId }],
  };
  if (!transfer) return { doc: withHelpDay(saved, today), view: feedbackView(presentation, item, optionId) };
  // A late or assisted choice is still kept; whether it counts is derived from this context when the block closes.
  const help = await assisted();
  const marked: NextDoc = {
    ...saved,
    assessments: (doc.assessments ?? []).map((a) => (a.presentationId === presentationId ? { ...a, assistedWhenAnswered: help } : a)),
  };
  if (index < plan.sequence.length - 1) return { doc: marked, view: deferredView(presentation) };
  const closed: NextDoc = { ...marked, current: null };
  return { doc: closed, view: closedView(closed, plan) };
}

/** Teaching, a practice question or its feedback: the displays a pause may record as help. */
const isHelpView = (view: NextLessonView): boolean =>
  view.kind === 'screen' || view.kind === 'feedback' || (view.kind === 'question' && view.phase === 'practice');

/**
 * Route Back: today's help day (and screen exposure) only while `observed` is still exactly what the stored document
 * has on display; anything else is left as is. Never settles, completes, answers or presents.
 */
function withPause(doc: NextDoc, plan: Plan, observed: NextLessonView, today: string): NextDoc {
  if (observed.kind === 'screen') {
    const index = screenAt(doc);
    const screenId = plan.screens[index]?.screen_id;
    if (screenId === undefined || screenId !== observed.screen.screen_id || doc.screens[index] === undefined) return doc;
    return withHelpDay(withScreenShown(doc, index, screenId, today), today);
  }
  if (observed.kind !== 'question' && observed.kind !== 'feedback') return doc;
  const shown = displayed(doc, plan);
  if (
    shown === null ||
    shown.transfer ||
    shown.presentation.presentationId !== observed.presentationId ||
    shown.item.item_id !== observed.itemId
  ) {
    return doc;
  }
  const same =
    observed.kind === 'question'
      ? shown.attempt === undefined
      : shown.attempt !== undefined && shown.attempt.optionId === (observed.selected?.id ?? null);
  return same ? withHelpDay(doc, today) : doc;
}

// ---- Controller ----

function holds(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

export function createNextLessonController(options: NextLessonOptions): NextLessonController {
  const { store, owner, random } = options;
  const plan = buildPlan();
  const enqueue = pilotQueueFor(store);
  let disposed = false;
  /** Set once an operation has seen this owner's document stored; it going missing later blocks. */
  let bound = false;
  /** The last view an operation here returned; a pause records help only for this, never for anything unshown. */
  let onDisplay: NextLessonView | null = null;

  /** `allowInactive` is only for a pause already authorized while active, so it may finish after the route blurs. */
  function gate(allowInactive = false): string | null {
    if (disposed) return 'disposed';
    if (options.store !== store || options.owner !== owner) return 'owner';
    if (!allowInactive && !holds(() => options.active() === true)) return 'inactive';
    if (!holds(() => options.consented() === true)) return 'consent';
    if (!holds(() => options.mode === 'developer-demo')) return 'mode';
    if (!holds(() => options.readOnly() === false)) return 'read-only';
    if (plan === null) return 'content';
    if (!isText(owner)) return 'owner';
    if (typeof store.updateMeta !== 'function') return 'storage';
    return null;
  }

  function readToday(): string | null {
    try {
      const day: unknown = options.today();
      return isCalendarDay(day) ? day : null;
    } catch {
      return null;
    }
  }

  function run(
    step: (doc: NextDoc, today: string, plan: Plan, assisted: Assisted) => Change | Promise<Change>,
    paused?: { day: string },
  ): Promise<NextLessonView> {
    const allowInactive = paused !== undefined;
    return enqueue(async () => {
      const early = gate(allowInactive);
      if (early !== null || plan === null || store.updateMeta === undefined) return blocked(early ?? 'content');
      const day = readToday();
      if (day === null || (paused !== undefined && paused.day !== day)) return blocked('today');
      const ready = plan;
      const recheck = (): string | null => gate(allowInactive) ?? (readToday() === day ? null : 'today');

      const outcome: { view: NextLessonView | null; own: boolean } = { view: null, own: false };
      await store.updateMeta(NEXT_LESSON_META_KEY, async (raw) => {
        const afterRead = recheck();
        if (afterRead !== null) {
          outcome.view = blocked(afterRead);
          return raw;
        }
        // Fresh Unit A state on every operation; nothing about qualification is cached or stored here.
        const unitA = await store.getMeta(PILOT_META_KEY);
        const afterUnitA = recheck();
        if (afterUnitA !== null) {
          outcome.view = blocked(afterUnitA);
          return raw;
        }
        const status = unitAStatus(unitA, owner, day);
        if (status?.qualified !== true) {
          outcome.view = blocked('not-qualified');
          return raw;
        }
        const unitADays = status.days;
        if (raw === null && bound) {
          outcome.view = blocked('owner');
          return raw;
        }
        const parsed = parseDoc(raw, owner, day, ready);
        if (typeof parsed === 'string') {
          outcome.view = blocked(parsed);
          return raw;
        }
        // Reads only, inside this update: a rejection or anything but a boolean rejects the operation unwritten.
        const assisted: Assisted = async () => {
          const value: unknown = await options.assistedToday(day);
          if (typeof value !== 'boolean') throw new Error('Next lesson assistance check did not answer true or false.');
          // The learner's own Unit A activity today is help whatever the caller reports.
          return value || unitADays.includes(day);
        };
        const change = await step(parsed, day, ready, assisted);
        // A step may have awaited the assistance read: check again before using or writing its result.
        const afterStep = recheck();
        if (afterStep !== null) {
          outcome.view = blocked(afterStep);
          return raw;
        }
        const next = JSON.stringify(change.doc);
        outcome.view = change.view;
        if (next === JSON.stringify(parsed)) {
          outcome.own = raw !== null;
          return raw;
        }
        outcome.own = true;
        return next;
      });
      // Reached only when the read and any write succeeded.
      if (outcome.own) bound = true;
      const afterWrite = recheck();
      if (afterWrite !== null) return blocked(afterWrite);
      if (outcome.view === null) throw new Error('Next lesson update finished without a view.');
      return outcome.view;
    });
  }

  /** Remembers what an operation returned for display; a blocked view displays nothing a pause could record. */
  const tracked = (pending: Promise<NextLessonView>): Promise<NextLessonView> =>
    pending.then((view) => {
      onDisplay = view.kind === 'blocked' ? null : view;
      return view;
    });

  return {
    /** Shows where the learner is; records the screen exposure, display or new presentation before showing it. */
    load: () => tracked(run((doc, today, p, assisted) => settle(doc, today, p, random, assisted))),

    /**
     * Completes a displayed screen, or leaves displayed feedback or a transfer acknowledgement, and shows what
     * follows. An unanswered question cannot be skipped.
     */
    next: () =>
      tracked(run((doc, today, p, assisted) => {
        const index = screenAt(doc);
        const screen = p.screens[index];
        const exposure = doc.screens[index];
        if (screen !== undefined) {
          // A screen never displayed is shown first, not completed unseen.
          if (exposure === undefined) return settle(doc, today, p, random, assisted);
          const shown = withScreenShown(doc, index, screen.screen_id, today);
          const done = shown.screens.map((s, i) => (i === index ? { ...s, completed: today } : s));
          return settle({ ...shown, screens: done }, today, p, random, assisted);
        }
        const shown = displayed(doc, p);
        if (shown === null || shown.attempt === undefined) return settle(doc, today, p, random, assisted);
        // Practice feedback being left was on display today, even without a load today: record that before clearing.
        // A transfer acknowledgement is never help.
        const left = shown.transfer ? doc : withHelpDay(doc, today);
        return settle({ ...left, current: null }, today, p, random, assisted);
      })),

    /** Saves the first choice for the displayed question, then shows what follows it. Stale or invalid answers block. */
    answer: (presentationId, optionId) =>
      tracked(run((doc, today, p, assisted) => recordAnswer(doc, today, p, presentationId, optionId, assisted))),

    // Authorized now, with every guard including active, for what is on display today; only this queued pause may
    // then finish after the route blurs. Nothing on display, or not authorized now, records nothing.
    pause: () => {
      const observed = onDisplay;
      const day = readToday();
      if (gate() !== null || day === null || observed === null || !isHelpView(observed)) return Promise.resolve();
      return run((doc, today, p) => ({ doc: withPause(doc, p, observed, today), view: observed }), { day }).then(
        () => undefined,
      );
    },

    dispose: () => {
      disposed = true;
    },
  };
}
