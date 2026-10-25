// Unit A pilot controller, initial slice: reference lesson -> each fresh reference practice item once
// -> agreement lesson -> each fresh agreement practice item once, with immediate feedback after the
// first choice is durable. Practice here is correctness practice, not retention. Transfer and delayed
// checks belong to a later slice, so the end state is at most "awaiting-transfer", never a pass.
// State is one versioned document under PILOT_META_KEY, read, transitioned and written as one
// store.updateMeta operation on that store's write queue (the same queue as reset); a store without
// updateMeta is refused. Once a controller has seen its own document, that document going missing
// (a reset) blocks it rather than starting over. Attempts stay the exact
// { presentationId, itemId, optionId } first choices; presentation context (day, option order,
// answered day) and dated lesson exposure live beside them in the same document and join by
// presentationId in attempt order. Anything unknown, newer, foreign or inconsistent blocks without
// being rewritten; IO and write errors reject and leave the last durable state answerable.
import { newId } from '@/engine/util';
import { createSerialQueue } from '@/storage/serial';
import type { Store } from '@/storage/types';
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

export const PILOT_META_KEY = 'pilot_unit_a';

const SCHEMA = 1;
const CONSTRUCTS: readonly PilotConstruct[] = ['reference', 'agreement'];
const MIN_PRACTICE_FAMILIES = 2;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export type PilotMode = 'developer-demo' | 'tester';

export interface PilotControllerOptions {
  store: Pick<Store, 'getMeta' | 'setMeta' | 'updateMeta'>;
  owner: string;
  mode: PilotMode;
  /** Local calendar day, YYYY-MM-DD. */
  today: () => string;
  readOnly: () => boolean;
  active: () => boolean;
  /** Consulted before assessment items once that slice exists; correctness practice never needs it. */
  assistedToday: () => Promise<boolean>;
  /** Used only to shuffle the option order of a new presentation. */
  random: () => number;
}

export type PilotBlockReason =
  | 'disposed'
  | 'inactive'
  | 'mode'
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
  | { kind: 'awaiting-transfer'; constructs: PilotConstructSummary[] }
  | { kind: 'insufficient'; constructs: PilotConstructSummary[] };

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

interface PilotDoc {
  owner: string;
  schema: typeof SCHEMA;
  contentVersion: string;
  policyVersion: string;
  attempts: Attempt[];
  current: Current | null;
  presentations: Presentation[];
  lessons: LessonExposure[];
}

const DOC_KEYS = [
  'owner', 'schema', 'contentVersion', 'policyVersion', 'attempts', 'current', 'presentations', 'lessons',
] as const;

// ---- Plan over the catalogue ----

interface Step {
  lesson: PilotLesson;
  items: readonly PilotItem[];
}

interface Plan {
  steps: readonly Step[];
  /** Practice items in the order they are offered. */
  order: readonly PilotItem[];
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

function buildPlan(): Plan | null {
  if (!contentAccepted()) return null;
  const steps: Step[] = [];
  for (const construct of CONSTRUCTS) {
    const lesson = PILOT_CONTENT.lessons.find((l) => l.construct === construct);
    const items = PILOT_CONTENT.items.filter((i) => i.construct === construct && i.phase === 'practice');
    const usable =
      lesson !== undefined &&
      items.length > 0 &&
      items.every(
        (i) =>
          i.lessonId === lesson.id &&
          i.options.length === 4 &&
          i.options.filter((o) => o.correct).length === 1 &&
          new Set(i.options.map((o) => o.id)).size === i.options.length,
      );
    if (!usable) return null;
    steps.push({ lesson, items });
  }
  const order = steps.flatMap((s) => s.items);
  if (new Set(order.map((i) => i.id)).size !== order.length) return null;
  const stepOf = new Map<string, number>();
  const opensAfter: number[] = [];
  let before = 0;
  steps.forEach((step, index) => {
    opensAfter.push(before);
    before += step.items.length;
    step.items.forEach((i) => stepOf.set(i.id, index));
  });
  return { steps, order, byId: new Map(order.map((i) => [i.id, i])), stepOf, opensAfter };
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

const isListOf = <T>(value: unknown, guard: (v: unknown) => v is T): value is T[] =>
  Array.isArray(value) && value.every(guard);

function daysOf(doc: PilotDoc): string[] {
  return [
    ...(doc.current ? [doc.current.day] : []),
    ...doc.presentations.flatMap((p) => (p.answered === null ? [p.shown] : [p.shown, p.answered])),
    ...doc.lessons.flatMap((l) => (l.completed === null ? l.shown : [...l.shown, l.completed])),
  ];
}

function isPermutation(order: readonly string[], options: readonly PilotOption[]): boolean {
  return (
    order.length === options.length &&
    new Set(order).size === order.length &&
    order.every((id) => options.some((o) => o.id === id))
  );
}

/** The document must be a state this controller could have written, step by step, over the plan. */
function coherent(doc: PilotDoc, plan: Plan): boolean {
  const { presentations, attempts, lessons, current } = doc;
  if (lessons.length > plan.steps.length || presentations.length > plan.order.length) return false;
  const answered = presentations.filter((p) => p.answered !== null);

  const lessonsOk = lessons.every((exposure, index) => {
    const step = plan.steps[index];
    const first = exposure.shown[0];
    return (
      step !== undefined &&
      first !== undefined &&
      exposure.lessonId === step.lesson.id &&
      exposure.shown.every((day, i) => i === 0 || (exposure.shown[i - 1] ?? '') < day) &&
      (exposure.completed === null ? index === lessons.length - 1 : exposure.completed >= first) &&
      answered.length >= (plan.opensAfter[index] ?? Infinity)
    );
  });

  const seen = new Set<string>();
  const presentationsOk = presentations.every((p, index) => {
    const item = plan.order[index];
    if (item === undefined || p.itemId !== item.id || seen.has(p.presentationId)) return false;
    seen.add(p.presentationId);
    const lesson = lessons[plan.stepOf.get(item.id) ?? -1];
    return (
      lesson !== undefined &&
      lesson.completed !== null &&
      lesson.completed <= p.shown &&
      isPermutation(p.optionOrder, item.options) &&
      (p.answered === null ? index === presentations.length - 1 : p.answered >= p.shown)
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
  const currentOk =
    current === null
      ? last === undefined || last.answered !== null
      : last !== undefined &&
        current.presentationId === last.presentationId &&
        current.itemId === last.itemId &&
        current.day === last.shown &&
        plan.stepOf.get(last.itemId) === lessons.length - 1;

  return lessonsOk && presentationsOk && attemptsOk && currentOk;
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
    !exactly(value, DOC_KEYS) ||
    !isListOf(value.attempts, isAttempt) ||
    !isListOf(value.presentations, isPresentation) ||
    !isListOf(value.lessons, isLessonExposure) ||
    !(value.current === null || isCurrent(value.current))
  ) {
    return 'corrupt';
  }
  const doc = value as unknown as PilotDoc;
  if (daysOf(doc).some((day) => day > today)) return 'future-day';
  return coherent(doc, plan) ? doc : 'corrupt';
}

// ---- Position, transitions and views ----

type Position =
  | { kind: 'lesson'; index: number; step: Step }
  | { kind: 'practice'; item: PilotItem }
  | { kind: 'question'; presentation: Presentation; item: PilotItem }
  | { kind: 'feedback'; item: PilotItem; attempt: Attempt }
  | { kind: 'end' };

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
  return { kind: 'end' };
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

function summaryView(doc: PilotDoc, plan: Plan): PilotView {
  const constructs = plan.steps.map(({ lesson, items }) => {
    const families = new Set<string>();
    for (const attempt of doc.attempts) {
      const item = items.find((i) => i.id === attempt.itemId);
      if (item !== undefined && attempt.optionId !== null && keyOf(item)?.id === attempt.optionId) families.add(item.family);
    }
    return { construct: lesson.construct, correctFamilies: families.size, required: MIN_PRACTICE_FAMILIES };
  });
  return constructs.every((c) => c.correctFamilies >= c.required)
    ? { kind: 'awaiting-transfer', constructs }
    : { kind: 'insufficient', constructs };
}

interface Change {
  doc: PilotDoc;
  view: PilotView;
}

/** Makes the next displayable thing durable-ready: records lesson exposure or a new presentation. */
function settle(doc: PilotDoc, today: string, random: () => number, plan: Plan): Change {
  const at = locate(doc, plan);
  switch (at.kind) {
    case 'lesson':
      return {
        doc: withLessonShown(doc, at.index, at.step.lesson.id, today),
        view: { kind: 'lesson', lesson: at.step.lesson },
      };
    case 'practice': {
      const presentation: Presentation = {
        // A fresh nonce, persisted once with the presentation: unique across owners and stores.
        presentationId: newId('ua-pres'),
        itemId: at.item.id,
        shown: today,
        optionOrder: shuffled(at.item.options.map((o) => o.id), random),
        answered: null,
      };
      return {
        doc: {
          ...doc,
          presentations: [...doc.presentations, presentation],
          current: { presentationId: presentation.presentationId, itemId: at.item.id, day: today },
        },
        view: questionView(presentation, at.item),
      };
    }
    case 'question':
      return { doc, view: questionView(at.presentation, at.item) };
    case 'feedback':
      return { doc, view: feedbackView(at.item, at.attempt) };
    case 'end':
      return { doc, view: summaryView(doc, plan) };
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

const blocked = (reason: PilotBlockReason): PilotView => ({ kind: 'blocked', reason });

function holds(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

export function createPilotController(options: PilotControllerOptions) {
  const { store, owner, mode, random } = options;
  const enqueue = queueFor(store);
  let disposed = false;
  /** Set once a successful operation has seen this owner's document stored. */
  let bound = false;

  function gate(): PilotBlockReason | null {
    if (disposed) return 'disposed';
    if (!holds(() => options.active() === true)) return 'inactive';
    if (mode !== 'developer-demo') return 'mode';
    if (!holds(() => options.readOnly() === false)) return 'read-only';
    if (PLAN === null) return 'content';
    if (!isText(owner)) return 'owner';
    return null;
  }

  function run(step: (doc: PilotDoc, today: string, plan: Plan) => Change): Promise<PilotView> {
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
        const change = step(parsed, day, plan);
        const next = JSON.stringify(change.doc);
        if (next === JSON.stringify(parsed)) {
          outcome.own = raw !== null;
          outcome.view = change.view;
          return raw;
        }
        const beforeWrite = gate();
        if (beforeWrite !== null) {
          outcome.view = blocked(beforeWrite);
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
      return outcome.view;
    });
  }

  return {
    /** Shows where the learner is; records lesson exposure or a new presentation before displaying it. */
    load(): Promise<PilotView> {
      return run((doc, today, plan) => settle(doc, today, random, plan));
    },

    /** Leaves a lesson or feedback for what follows. An unanswered question cannot be skipped. */
    next(): Promise<PilotView> {
      return run((doc, today, plan) => {
        const at = locate(doc, plan);
        let moved = doc;
        if (at.kind === 'lesson') moved = withLessonCompleted(doc, at.index, at.step.lesson.id, today);
        else if (at.kind === 'feedback') moved = { ...doc, current: null };
        return settle(moved, today, random, plan);
      });
    },

    /** Records the first choice (null = "I don't know") for the current presentation, then feedback. */
    answer(presentationId: string, optionId: string | null): Promise<PilotView> {
      if (!isText(presentationId) || !(optionId === null || isText(optionId))) {
        return Promise.reject(new Error('Invalid pilot answer.'));
      }
      return run((doc, today, plan) => {
        const at = locate(doc, plan);
        if (at.kind === 'feedback' && at.attempt.presentationId === presentationId) {
          if (at.attempt.optionId === optionId) return { doc, view: feedbackView(at.item, at.attempt) };
          throw new Error('This presentation already has its first answer.');
        }
        if (at.kind !== 'question' || at.presentation.presentationId !== presentationId) {
          throw new Error('Not the presentation on screen.');
        }
        if (optionId !== null && !at.item.options.some((o) => o.id === optionId)) {
          throw new Error('Unknown option for this presentation.');
        }
        const attempt: Attempt = { presentationId, itemId: at.item.id, optionId };
        return {
          doc: {
            ...doc,
            attempts: [...doc.attempts, attempt],
            presentations: doc.presentations.map((p) =>
              p.presentationId === presentationId ? { ...p, answered: today } : p,
            ),
          },
          view: feedbackView(at.item, attempt),
        };
      });
    },

    dispose(): void {
      disposed = true;
    },
  };
}
