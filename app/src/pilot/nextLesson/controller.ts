// Next lesson (U-C nominal definiteness) controller, core and practice path: a learner whose own Unit A document
// qualifies (unitAStatus, read fresh inside every operation) sees the draft's four teaching screens in order, then
// its six practice tasks in content order. Each display is recorded before it is shown, as one store.updateMeta of
// this controller's own versioned document under NEXT_LESSON_META_KEY, sequenced on the store's shared pilot
// queue; Unit A records are only read. A presentation's option order is shuffled once and persisted, so a reload
// or reopened store resumes the exact same question whatever its randomness. A first choice (or "don't know") is
// saved with its day before its feedback is shown and is never replaced; only an explicit next leaves feedback.
// After the last practice feedback the learner awaits transfer until the day after the last help day; transfer
// itself is not implemented yet and blocks. Every day teaching, a question or feedback is displayed is kept in
// `helpDays`. Anything unknown, foreign, stale or inconsistent blocks without being rewritten; IO and write errors
// reject and publish nothing.
import { NOMINAL_DEFINITENESS } from '@/content/increments/nominal-definiteness/content';
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
  | { readonly kind: 'blocked'; readonly reason: string };

export interface NextLessonOptions {
  store: Store;
  owner: string;
  mode: 'developer-demo';
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
  dispose(): void;
}

const SCHEMA = 1;
const SCREEN_COUNT = 4;
const PRACTICE_COUNT = 6;
const OPTION_COUNT = 4;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---- Plan over the draft ----

interface Plan {
  contentVersion: string;
  screens: readonly IncrementScreen[];
  /** The practice items in content order; presentation i always asks practice[i]. */
  practice: readonly IncrementItem[];
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
    const screens = content.lessons.flatMap((lesson) => lesson.screens);
    const practice = content.items.filter((item) => item.phase === 'practice');
    if (screens.length !== SCREEN_COUNT || !screens.every((s) => isText(s.screen_id))) return null;
    if (new Set(screens.map((s) => s.screen_id)).size !== screens.length) return null;
    if (practice.length !== PRACTICE_COUNT || !practice.every(soundItem)) return null;
    if (new Set(practice.map((item) => item.item_id)).size !== practice.length) return null;
    if (!isText(content.content_version)) return null;
    return { contentVersion: content.content_version, screens, practice };
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

interface NextDoc {
  owner: string;
  schema: typeof SCHEMA;
  contentVersion: string;
  screens: ScreenExposure[];
  presentations: Presentation[];
  attempts: Attempt[];
  current: Current | null;
  /** Distinct days with teaching, a question or feedback displayed, ascending. Observations only. */
  helpDays: string[];
}

const DOC_KEYS = [
  'owner', 'schema', 'contentVersion', 'screens', 'presentations', 'attempts', 'current', 'helpDays',
] as const;

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

const isListOf = <T>(value: unknown, guard: (v: unknown) => v is T): value is T[] =>
  Array.isArray(value) && value.every(guard);

/**
 * A state this controller could have written: screens in order, then practice presentations in content order,
 * each answered once before the next exists, with current on the last one until its feedback is left after the
 * final practice task.
 */
function coherent(doc: NextDoc, plan: Plan): boolean {
  const { screens, presentations, attempts, current, helpDays } = doc;
  if (screens.length > plan.screens.length || presentations.length > plan.practice.length) return false;
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
      const item = plan.practice[index];
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
  const last = presentations[presentations.length - 1];
  const finished = last !== undefined && last.answered !== null && presentations.length === plan.practice.length;
  const currentOk =
    current === null
      ? last === undefined || finished
      : last !== undefined &&
        current.presentationId === last.presentationId &&
        current.itemId === last.itemId &&
        current.day === last.shown;
  const displayDays = [
    ...screens.flatMap((s) => s.shown),
    ...presentations.flatMap((p) => (p.answered === null ? [p.shown] : [p.shown, p.answered])),
  ];
  return screensOk && presentationsOk && currentOk && displayDays.every((day) => helpDays.includes(day));
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
    !exactly(value, DOC_KEYS) ||
    !isListOf(value.screens, isScreenExposure) ||
    !isListOf(value.presentations, isPresentation) ||
    !isListOf(value.attempts, isAttempt) ||
    !(value.current === null || isCurrent(value.current)) ||
    !isDayList(value.helpDays)
  ) {
    return 'corrupt';
  }
  const doc = value as unknown as NextDoc;
  if (doc.helpDays.some((day) => day > today)) return 'future-day';
  return coherent(doc, plan) ? doc : 'corrupt';
}

// ---- Transitions and views ----

interface Change {
  doc: NextDoc;
  view: NextLessonView;
}

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
}

/** The current presentation with its practice item and saved first choice, or null when none is on display. */
function displayed(doc: NextDoc, plan: Plan): Displayed | null {
  const { current } = doc;
  if (current === null) return null;
  const index = doc.presentations.findIndex((x) => x.presentationId === current.presentationId);
  const presentation = doc.presentations[index];
  const item = plan.practice[index];
  if (presentation === undefined || item === undefined) throw new Error('Next lesson state lost its current presentation.');
  return { index, presentation, item, attempt: doc.attempts[index] };
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

/** Whitelisted fields only: no keys, feedback, solution or reviewer metadata. */
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
    help_lines: item.help_lines.map((h) => ({ word: h.word, meaning: h.meaning })),
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

/**
 * Records the next displayable thing (screen exposure, the current question or feedback, or a new presentation)
 * and today's help day. Awaiting transfer displays nothing and records nothing.
 */
function settle(doc: NextDoc, today: string, plan: Plan, random: () => number): Change {
  const index = screenAt(doc);
  const screen = plan.screens[index];
  if (screen !== undefined) {
    return { doc: withHelpDay(withScreenShown(doc, index, screen.screen_id, today), today), view: { kind: 'screen', screen } };
  }
  const shown = displayed(doc, plan);
  if (shown !== null) {
    const { presentation, item, attempt } = shown;
    const view = attempt === undefined ? questionView(presentation, item) : feedbackView(presentation, item, attempt.optionId);
    return { doc: withHelpDay(doc, today), view };
  }
  const item = plan.practice[doc.presentations.length];
  if (item === undefined) {
    const lastHelp = doc.helpDays[doc.helpDays.length - 1];
    if (lastHelp === undefined) throw new Error('Next lesson practice finished without a help day.');
    const until = dayAfter(lastHelp);
    return { doc, view: today < until ? { kind: 'awaiting-transfer', until } : blocked('not-implemented') };
  }
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
  return { doc: withHelpDay(presented, today), view: questionView(presentation, item) };
}

/** Saves the first choice for the displayed question before its feedback; replays only that same choice. */
function recordAnswer(doc: NextDoc, today: string, plan: Plan, presentationId: unknown, optionId: unknown): Change {
  if (!isText(presentationId) || !(optionId === null || isText(optionId))) return { doc, view: blocked('invalid-answer') };
  const shown = displayed(doc, plan);
  if (shown === null || shown.presentation.presentationId !== presentationId) return { doc, view: blocked('stale') };
  const { index, presentation, item, attempt } = shown;
  if (attempt !== undefined) {
    // The same choice again shows its feedback again; any other choice never replaces the first.
    if (attempt.optionId !== optionId) return { doc, view: blocked('answered') };
    return { doc: withHelpDay(doc, today), view: feedbackView(presentation, item, optionId) };
  }
  if (optionId !== null && !presentation.optionOrder.includes(optionId)) return { doc, view: blocked('invalid-option') };
  const saved: NextDoc = {
    ...doc,
    presentations: doc.presentations.map((p, i) => (i === index ? { ...p, answered: today } : p)),
    attempts: [...doc.attempts, { presentationId, itemId: item.item_id, optionId }],
  };
  return { doc: withHelpDay(saved, today), view: feedbackView(presentation, item, optionId) };
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
  const { store, owner, mode, random } = options;
  const plan = buildPlan();
  const enqueue = pilotQueueFor(store);
  let disposed = false;
  /** Set once an operation has seen this owner's document stored; it going missing later blocks. */
  let bound = false;

  function gate(): string | null {
    if (disposed) return 'disposed';
    if (options.store !== store || options.owner !== owner) return 'owner';
    if (!holds(() => options.active() === true)) return 'inactive';
    if (!holds(() => options.consented() === true)) return 'consent';
    if (mode !== 'developer-demo') return 'mode';
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

  function run(step: (doc: NextDoc, today: string, plan: Plan) => Change): Promise<NextLessonView> {
    return enqueue(async () => {
      const early = gate();
      if (early !== null || plan === null || store.updateMeta === undefined) return blocked(early ?? 'content');
      const day = readToday();
      if (day === null) return blocked('today');
      const ready = plan;
      const recheck = (): string | null => gate() ?? (readToday() === day ? null : 'today');

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
        if (unitAStatus(unitA, owner, day)?.qualified !== true) {
          outcome.view = blocked('not-qualified');
          return raw;
        }
        if (raw === null && bound) {
          outcome.view = blocked('owner');
          return raw;
        }
        const parsed = parseDoc(raw, owner, day, ready);
        if (typeof parsed === 'string') {
          outcome.view = blocked(parsed);
          return raw;
        }
        const change = step(parsed, day, ready);
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

  return {
    /** Shows where the learner is; records the screen exposure, display or new presentation before showing it. */
    load: () => run((doc, today, p) => settle(doc, today, p, random)),

    /**
     * Completes a displayed screen, or leaves displayed feedback, and shows what follows. An unanswered question
     * cannot be skipped.
     */
    next: () =>
      run((doc, today, p) => {
        const index = screenAt(doc);
        const screen = p.screens[index];
        const exposure = doc.screens[index];
        if (screen !== undefined) {
          // A screen never displayed is shown first, not completed unseen.
          if (exposure === undefined) return settle(doc, today, p, random);
          const shown = withScreenShown(doc, index, screen.screen_id, today);
          const done = shown.screens.map((s, i) => (i === index ? { ...s, completed: today } : s));
          return settle({ ...shown, screens: done }, today, p, random);
        }
        if (displayed(doc, p)?.attempt === undefined) return settle(doc, today, p, random);
        // The feedback being left was on display today, even without a load today: record that before clearing.
        return settle({ ...withHelpDay(doc, today), current: null }, today, p, random);
      }),

    /** Saves the first choice for the displayed question, then shows its feedback. Stale or invalid answers block. */
    answer: (presentationId, optionId) => run((doc, today, p) => recordAnswer(doc, today, p, presentationId, optionId)),

    dispose: () => {
      disposed = true;
    },
  };
}
