// Opt-in pilot answer capture: one truthful AnswerRecord per fresh first choice, made from the trusted catalogue and
// the presentation as stored, saved by the controller as an intent beside that choice in the pilot document, then
// appended to the store under the exact committed document bytes. Records claim nothing the pilot did not measure:
// first attempt, never fresh evidence or retention, duration unmeasured, the source's draft/synthetic provenance, and
// for held-out items no key, explanation or score (pending, feedback deferred). The answer ID is derived from owner,
// content version and presentation, so a replay after a crash is the same record and the store writes it once.
// isPilotAnswer recognizes a record only by rebuilding it exactly from current content, its own marker and the app
// version it recorded. New records carry the app's version; records written earlier keep the version they recorded.
import { APP_VERSION } from '@/config/appVersion';
import type { Pool } from '@/content/schema';
import { localDate } from '@/engine/util';
import type { AnswerRecord, Store } from '@/storage/types';
import { sha256Hex } from '@/sync/sha256';
import { PILOT_CONTENT, validatePilotContent, type PilotItem, type PilotPhase } from './content';
import { isIsoTimestamp, unitAContentFingerprint } from './review';

/** Where the pilot document is stored (the controller re-exports it). */
export const PILOT_META_KEY = 'pilot_unit_a';

const CAPTURE_VERSION = 1;
/** The capture writer's label that format-1 records written before the app version was recorded carry instead. */
const LEGACY_CAPTURE_WRITER = 'unit-a-pilot-capture-1';
/** An explicit app version as recorded: major.minor.patch, with an optional pre-release tag. */
const APP_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const isRecordedVersion = (value: unknown): value is string =>
  typeof value === 'string' && (value === LEGACY_CAPTURE_WRITER || APP_VERSION_PATTERN.test(value));

const POOL: Record<PilotPhase, Pool> = { practice: 'PRACT', transfer: 'TRANS', d7: 'D7', d30: 'D30' };

export interface PilotAnswerInput {
  owner: string;
  learnerId: string;
  presentationId: string;
  itemId: string;
  /** null = "I don't know". */
  optionId: string | null;
  /** The option order exactly as shown. */
  optionOrder: string[];
  /** Local calendar day the first choice was saved, YYYY-MM-DD. */
  day: string;
  /** When the first choice was made, as toISOString writes it. */
  timestamp: string;
}

export interface PilotCaptureMarker {
  version: typeof CAPTURE_VERSION;
  owner: string;
  presentation_id: string;
  phase: PilotPhase;
  content_fingerprint: string;
  duration: 'unmeasured';
}

export type PilotAnswerRecord = AnswerRecord & { pilot_capture: PilotCaptureMarker };

/** The parts of the pilot document a capture is checked against. */
export interface PilotAttemptRef {
  presentationId: string;
  itemId: string;
  optionId: string | null;
}

export interface PilotPresentationRef {
  presentationId: string;
  itemId: string;
  optionOrder: readonly string[];
  answered: string | null;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const hasOwn = (value: Json, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function holds(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

function isCalendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Exact structural equality over JSON values; a key holding undefined still counts as a key. */
function same(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  if (isRecord(a) || isRecord(b)) {
    if (!isRecord(a) || !isRecord(b)) return false;
    const keys = Object.keys(b);
    return Object.keys(a).length === keys.length && keys.every((k) => hasOwn(a, k) && same(a[k], b[k]));
  }
  return a === b;
}

/** The accepted content's fingerprint, or null when the content fails its own validation. Computed once. */
let source: { fingerprint: string } | null | undefined;
function acceptedSource(): { fingerprint: string } | null {
  if (source === undefined) {
    try {
      const problems: unknown = validatePilotContent(PILOT_CONTENT);
      source = Array.isArray(problems) && problems.length === 0 ? { fingerprint: unitAContentFingerprint(PILOT_CONTENT) } : null;
    } catch {
      source = null;
    }
  }
  return source;
}

function isPermutation(order: unknown, item: PilotItem): order is string[] {
  return (
    Array.isArray(order) &&
    order.length === item.options.length &&
    new Set(order).size === order.length &&
    order.every((id) => item.options.some((o) => o.id === id))
  );
}

/** Stable per owner, content version and presentation; never per call or per choice. */
function answerIdOf(owner: string, presentationId: string): string {
  return `pilot-ua-${sha256Hex(JSON.stringify(['pilot-unit-a-answer', CAPTURE_VERSION, owner, PILOT_CONTENT.contentVersion, presentationId]))}`;
}

/** The answer record for one first choice, made by this app version; throws on anything it cannot vouch for. */
export function makePilotAnswer(input: PilotAnswerInput): PilotAnswerRecord {
  return buildPilotAnswer(input, APP_VERSION);
}

function buildPilotAnswer(input: PilotAnswerInput, appVersion: string): PilotAnswerRecord {
  if (!isRecordedVersion(appVersion)) throw new Error('Pilot capture needs an explicit app version.');
  const accepted = acceptedSource();
  if (accepted === null) throw new Error('Pilot content is not accepted; no answer record is made.');
  if (!isRecord(input)) throw new Error('Invalid pilot capture input.');
  const { owner, learnerId, presentationId, itemId, optionId, optionOrder, day, timestamp } = input;
  if (!isText(owner) || !isText(learnerId) || !isText(presentationId)) throw new Error('Pilot capture needs an owner, learner and presentation.');
  const item = PILOT_CONTENT.items.find((i) => i.id === itemId);
  if (item === undefined) throw new Error('Unknown pilot item.');
  if (!(optionId === null || (isText(optionId) && item.options.some((o) => o.id === optionId)))) {
    throw new Error('Unknown option for this pilot item.');
  }
  if (!isPermutation(optionOrder, item)) throw new Error('Pilot option order is not the item\'s options.');
  if (!isCalendarDay(day)) throw new Error('Pilot capture day is not YYYY-MM-DD.');
  if (!isIsoTimestamp(timestamp)) throw new Error('Pilot capture time is not a canonical ISO timestamp.');

  const held = item.phase !== 'practice';
  const chosen = item.options.find((o) => o.id === optionId);
  let outcome: AnswerRecord['outcome'] = 'pending';
  if (!held && chosen === undefined) outcome = 'dont_know';
  else if (!held && chosen !== undefined) outcome = chosen.correct ? 'correct' : 'wrong';
  const text = new Map(item.options.map((o) => [o.id, o.text]));
  return {
    answer_id: answerIdOf(owner, presentationId),
    learner_id: learnerId,
    item_id: item.id,
    content_version: PILOT_CONTENT.contentVersion,
    rules_version: PILOT_CONTENT.policyVersion,
    app_version: appVersion,
    timestamp,
    local_date: day,
    session_id: presentationId,
    pool: POOL[item.phase],
    unit: 'A',
    skills: [],
    raw_response: JSON.stringify(optionId === null ? { kind: 'dont_know' } : { kind: 'choice', option_id: optionId }),
    // A held-out choice is not graded here: grading waits for the block, and the key never enters the record.
    auto_score: held ? {} : { answer: outcome },
    outcome,
    error_tags: [],
    serious_tag: null,
    hint_used: false,
    help_lines_shown: item.glosses.map((g) => g.arabic),
    first_attempt: true,
    fresh_evidence: false,
    time_on_item_ms: 0,
    audio_status: null,
    report_flag: false,
    review_status: item.reviewStatus,
    synthetic: PILOT_CONTENT.synthetic,
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    role: held ? 'check' : 'practice',
    presented_options: optionOrder.map((id, position) => ({ id, text: text.get(id) ?? '', position })),
    selected_option_id: optionId,
    selected_position: optionId === null ? null : optionOrder.indexOf(optionId),
    misconceptions: [],
    ...(held ? { feedback_deferred: true } : {}),
    retention_valid: false,
    pilot_capture: {
      version: CAPTURE_VERSION,
      owner,
      presentation_id: presentationId,
      phase: item.phase,
      content_fingerprint: accepted.fingerprint,
      duration: 'unmeasured',
    },
  };
}

/**
 * Whether `record` is exactly the record makePilotAnswer makes for its own marker and fields (and `owner`, if given),
 * under the app version it recorded: an explicit version, or the legacy capture writer's label. Never rewritten.
 */
export function isPilotAnswer(record: unknown, owner?: string): record is PilotAnswerRecord {
  return holds(() => {
    if (!isRecord(record) || !isRecord(record.pilot_capture) || !Array.isArray(record.presented_options)) return false;
    const marker = record.pilot_capture;
    if (owner !== undefined && marker.owner !== owner) return false;
    if (!isRecordedVersion(record.app_version)) return false;
    const order = record.presented_options.map((o: unknown) => (isRecord(o) ? o.id : undefined));
    const rebuilt = buildPilotAnswer({
      owner: marker.owner as string,
      learnerId: record.learner_id as string,
      presentationId: marker.presentation_id as string,
      itemId: record.item_id as string,
      optionId: record.selected_option_id as string | null,
      optionOrder: order as string[],
      day: record.local_date as string,
      timestamp: record.timestamp as string,
    }, record.app_version as string);
    return same(record, rebuilt);
  });
}

/**
 * Whether `record` is exactly a pilot answer of learner `learnerId` under that learner's own dataset owner
 * ("guest:<id>" or "account:<id>"). Anything else, lookalikes included, is not.
 */
export function isOwnPilotAnswer(record: unknown, learnerId: string): record is PilotAnswerRecord {
  if (!isText(learnerId) || !isPilotAnswer(record)) return false;
  const owner = record.pilot_capture.owner;
  return record.learner_id === learnerId && (owner === `guest:${learnerId}` || owner === `account:${learnerId}`);
}

/**
 * Whether `captures` is a non-empty list of this owner's records, one per presentation, in attempt order (any subset
 * of the attempts: capture may start later), each matching its attempt's item and choice and its presentation's
 * item, shown order and answered day exactly.
 */
export function capturesMatch(
  captures: unknown,
  owner: string,
  attempts: readonly PilotAttemptRef[],
  presentations: readonly PilotPresentationRef[],
): captures is PilotAnswerRecord[] {
  if (!Array.isArray(captures) || captures.length === 0) return false;
  const seen = new Set<string>();
  let from = 0;
  return captures.every((record: unknown) => {
    if (!isPilotAnswer(record, owner)) return false;
    const id = record.pilot_capture.presentation_id;
    if (seen.has(id)) return false;
    seen.add(id);
    const at = attempts.findIndex((a) => a.presentationId === id);
    const shown = presentations.filter((p) => p.presentationId === id);
    const attempt = attempts[at];
    const p = shown[0];
    if (attempt === undefined || p === undefined || at < from || shown.length !== 1) return false;
    if (attempts.filter((a) => a.presentationId === id).length !== 1) return false;
    from = at + 1;
    return (
      attempt.itemId === record.item_id &&
      attempt.optionId === record.selected_option_id &&
      p.itemId === record.item_id &&
      p.answered === record.local_date &&
      same([...p.optionOrder], (record.presented_options ?? []).map((o) => o.id))
    );
  });
}

const DOC_KEYS = [
  'owner', 'schema', 'contentVersion', 'policyVersion', 'attempts', 'current', 'presentations', 'lessons',
] as const;
const OPTIONAL_DOC_KEYS = ['assessments', 'captures'] as const;

const isAttemptRef = (v: unknown): v is PilotAttemptRef =>
  isRecord(v) && isText(v.presentationId) && isText(v.itemId) && (v.optionId === null || isText(v.optionId));

const isPresentationRef = (v: unknown): v is PilotPresentationRef =>
  isRecord(v) &&
  isText(v.presentationId) &&
  isText(v.itemId) &&
  Array.isArray(v.optionOrder) &&
  v.optionOrder.every(isText) &&
  (v.answered === null || isCalendarDay(v.answered));

/** The verified captures stored in `raw`; [] when it has none. Throws, reading only, on anything else. */
function storedCaptures(raw: string, owner: string): PilotAnswerRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('The pilot document is unreadable; nothing was captured.');
  }
  if (!isRecord(value)) throw new Error('The pilot document is malformed; nothing was captured.');
  if (!hasOwn(value, 'captures')) return [];
  if (acceptedSource() === null) throw new Error('Pilot content is not accepted; nothing was captured.');
  if (
    value.schema !== 1 ||
    value.owner !== owner ||
    value.contentVersion !== PILOT_CONTENT.contentVersion ||
    value.policyVersion !== PILOT_CONTENT.policyVersion
  ) {
    throw new Error('The pilot document is not this owner\'s current document; nothing was captured.');
  }
  const doc = value;
  const known = new Set<string>([...DOC_KEYS, ...OPTIONAL_DOC_KEYS]);
  const { attempts, presentations, captures } = doc;
  if (
    !DOC_KEYS.every((k) => hasOwn(doc, k)) ||
    !Object.keys(doc).every((k) => known.has(k)) ||
    !Array.isArray(attempts) ||
    !attempts.every(isAttemptRef) ||
    !Array.isArray(presentations) ||
    !presentations.every(isPresentationRef) ||
    !capturesMatch(captures, owner, attempts as PilotAttemptRef[], presentations as PilotPresentationRef[])
  ) {
    throw new Error('The pilot document\'s captures do not match its first choices; nothing was captured.');
  }
  return captures;
}

/**
 * Whether `raw` passes the controller's own strict reading (shape, coherence, captures) for `owner` on `today`.
 * The controller imports this module, so it is required lazily, only once both modules have initialized.
 */
function controllerAccepts(raw: string, owner: string, today: string): boolean {
  return holds(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { unitAStatus } = require('./controller') as typeof import('./controller');
    return unitAStatus(raw, owner, today) !== null;
  });
}

/**
 * Submits every verified capture in the owner's stored pilot document through the store's queued appendAnswer, each
 * guarded by the exact document bytes read here, the record's learner and `active`; a record already stored writes
 * nothing there, and only that queued check makes it count. Before anything is submitted, a document with captures
 * must pass the controller's own strict reading on `today` (default: the local calendar day). Resolves only once every
 * append check has; the number is how many records the first unqueued read did not show (diagnostic only, never proof
 * of durability or sync). Writes nothing but answers: no snapshot, no metadata, no cursor; the intents stay in the
 * document. Refuses before any read when inactive, and rejects on a malformed, incoherent or foreign document, a
 * conflicting stored answer or a refused append.
 */
export async function drainPilotAnswers(args: {
  store: Pick<Store, 'getMeta'> & Partial<Pick<Store, 'listAnswers' | 'appendAnswer'>>;
  owner: string;
  active: () => boolean;
  /** Local calendar day, YYYY-MM-DD, the document is read on. */
  today?: string;
}): Promise<number> {
  const { store, owner } = args;
  const active = () => holds(() => args.active() === true);
  if (!isText(owner)) throw new Error('Pilot capture needs an owner; nothing was captured.');
  if (!active()) throw new Error('Pilot capture is not active; nothing was captured.');
  const raw = await store.getMeta(PILOT_META_KEY);
  if (raw === null) return 0;
  const records = storedCaptures(raw, owner);
  if (records.length === 0) return 0;
  const today = args.today ?? localDate(Date.now());
  if (!controllerAccepts(raw, owner, today)) {
    throw new Error('The pilot document does not pass the controller\'s reading; nothing was captured.');
  }
  if (typeof store.appendAnswer !== 'function' || typeof store.listAnswers !== 'function') {
    throw new Error('Pilot storage cannot append guarded answers; nothing was captured.');
  }
  // An unqueued read may show rows that are not committed yet: it only counts and spots conflicts early.
  const seen = new Map((await store.listAnswers()).map((a) => [a.answer_id, JSON.stringify(a)]));
  let missing = 0;
  for (const record of records) {
    const existing = seen.get(record.answer_id);
    if (existing !== undefined && existing !== JSON.stringify(record)) {
      throw new Error('A different answer with this pilot answer ID is already stored.');
    }
    if (existing === undefined) missing += 1;
  }
  for (const record of records) {
    if (!active()) throw new Error('Pilot capture is no longer active; the remaining answers stay saved locally.');
    // Identical records too: the queued exact-match no-op is the durability check.
    await store.appendAnswer(record, { metaKey: PILOT_META_KEY, expectedRaw: raw, learnerId: record.learner_id, active });
  }
  return missing;
}
