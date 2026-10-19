// Stored records exactly as stored, and a lossless reader for stored JSON text. Values are located in the text,
// never re-serialized, so an export or a copy keeps their exact bytes: unknown fields, escapes and number forms.
import type { AnswerRecord, Learner, ReportRecord } from './types';
import { answerProblem, learnerProblem, reportProblem } from './validate';

/** One stored record exactly as stored: its ID and its raw JSON text. */
export interface RawRecord {
  id: string;
  json: string;
}

/** A dataset's records exactly as stored, never re-serialized. */
export interface RawDataset {
  learner: string | null;
  answers: RawRecord[];
  /** The opaque session snapshot text, readable or not. */
  snapshot: string | null;
  /** Learner metadata (exposure history, snapshot archive, notices); not the storage schema marker. */
  meta: Record<string, string>;
  reports: RawRecord[];
}

/** How many records a copy added. */
export interface CopyResult {
  answers: number;
  reports: number;
}

/** The SQLite meta key holding the storage format version: bookkeeping, never learner metadata, never copied. */
export const SCHEMA_META_KEY = 'schema_version';

const SPACE = new Set([32, 9, 10, 13]); // space, tab, line feed, carriage return
const QUOTE = 34;
const COMMA = 44;
const COLON = 58;
const OPEN_ARRAY = 91;
const BACKSLASH = 92;
const CLOSE_ARRAY = 93;
const OPEN_OBJECT = 123;
const CLOSE_OBJECT = 125;

const unreadable = () => new Error('Stored data is unreadable; it was not modified.');

function skipSpace(text: string, i: number): number {
  while (SPACE.has(text.charCodeAt(i))) i++;
  return i;
}

/** Just past the string literal starting at i. */
function stringEnd(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    const c = text.charCodeAt(j);
    if (c === BACKSLASH) j++;
    else if (c === QUOTE) return j + 1;
  }
  throw unreadable();
}

/** Just past the value starting at i. Only used on text JSON.parse has accepted, so brackets balance. */
function valueEnd(text: string, i: number): number {
  const first = text.charCodeAt(i);
  if (first === QUOTE) return stringEnd(text, i);
  if (first === OPEN_OBJECT || first === OPEN_ARRAY) {
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const c = text.charCodeAt(j);
      if (c === QUOTE) j = stringEnd(text, j) - 1;
      else if (c === OPEN_OBJECT || c === OPEN_ARRAY) depth++;
      else if (c === CLOSE_OBJECT || c === CLOSE_ARRAY) {
        depth--;
        if (depth === 0) return j + 1;
      }
    }
    throw unreadable();
  }
  // A number or a literal: up to the next delimiter.
  let j = i;
  while (j < text.length) {
    const c = text.charCodeAt(j);
    if (SPACE.has(c) || c === COMMA || c === CLOSE_OBJECT || c === CLOSE_ARRAY) break;
    j++;
  }
  if (j === i) throw unreadable();
  return j;
}

/** Visits each member (key, exact value text) of the object, or each element of the array, that `text` holds. */
function walk(text: string, open: number, close: number, visit: (key: string | null, value: string) => void): void {
  let i = skipSpace(text, 0);
  if (text.charCodeAt(i) !== open) throw unreadable();
  i = skipSpace(text, i + 1);
  if (text.charCodeAt(i) !== close) {
    for (;;) {
      let key: string | null = null;
      if (open === OPEN_OBJECT) {
        if (text.charCodeAt(i) !== QUOTE) throw unreadable();
        const keyEnd = stringEnd(text, i);
        key = JSON.parse(text.slice(i, keyEnd)) as string;
        i = skipSpace(text, keyEnd);
        if (text.charCodeAt(i) !== COLON) throw unreadable();
        i = skipSpace(text, i + 1);
      }
      const end = valueEnd(text, i);
      visit(key, text.slice(i, end));
      i = skipSpace(text, end);
      if (text.charCodeAt(i) !== COMMA) break;
      i = skipSpace(text, i + 1);
    }
    if (text.charCodeAt(i) !== close) throw unreadable();
  }
  if (skipSpace(text, i + 1) !== text.length) throw unreadable();
}

/** Each member of a JSON object text with its value exactly as written; of duplicate keys the last wins, as in JSON.parse. */
export function objectMembers(text: string): Map<string, string> {
  const members = new Map<string, string>();
  walk(text, OPEN_OBJECT, CLOSE_OBJECT, (key, value) => members.set(key as string, value));
  return members;
}

/** Each element of a JSON array text, exactly as written. */
export function arrayElements(text: string): string[] {
  const elements: string[] = [];
  walk(text, OPEN_ARRAY, CLOSE_ARRAY, (_key, value) => elements.push(value));
  return elements;
}

/** A copy's records, each checked and parsed once: a store keeps the text as it is and the parsed value for the engine. */
export interface ParsedCopy {
  learner: { json: string; value: Learner } | null;
  answers: { id: string; json: string; value: AnswerRecord }[];
  snapshot: string | null;
  meta: [string, string][];
  reports: { id: string; json: string; value: ReportRecord }[];
}

const refusedCopy = (what: string) => new Error(`Copy refused: ${what} is malformed; nothing was written.`);

function checked<T>(text: unknown, problem: (value: unknown) => string | null, what: string): T {
  if (typeof text !== 'string') throw refusedCopy(what);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw refusedCopy(what);
  }
  if (value === null || typeof value !== 'object' || problem(value) !== null) throw refusedCopy(what);
  return value as T;
}

function records<T>(list: RawRecord[], problem: (value: unknown) => string | null, idOf: (value: T) => unknown, what: string) {
  const seen = new Set<string>();
  const out: { id: string; json: string; value: T }[] = [];
  for (const record of list) {
    if (typeof record !== 'object' || record === null || typeof record.id !== 'string') throw refusedCopy(what);
    const value = checked<T>(record.json, problem, what);
    if (idOf(value) !== record.id) throw refusedCopy(what);
    if (seen.has(record.id)) continue;
    seen.add(record.id);
    out.push({ id: record.id, json: record.json, value });
  }
  return out;
}

/**
 * Checks a copy before anything is written: every record parses, passes the store's own validation and matches its
 * ID; of duplicate IDs the first is kept. Nothing in the result aliases the input.
 */
export function parseCopy(copy: RawDataset): ParsedCopy {
  if (typeof copy !== 'object' || copy === null || !Array.isArray(copy.answers) || !Array.isArray(copy.reports)) throw refusedCopy('the dataset');
  const learner = copy.learner === null ? null : { json: copy.learner, value: checked<Learner>(copy.learner, learnerProblem, 'the learner') };
  const answers = records<AnswerRecord>(copy.answers, answerProblem, (a) => a.answer_id, 'an answer');
  const reports = records<ReportRecord>(copy.reports, reportProblem, (r) => r.report_id, 'a report');
  if (copy.snapshot !== null && typeof copy.snapshot !== 'string') throw refusedCopy('the snapshot');
  if (typeof copy.meta !== 'object' || copy.meta === null || Array.isArray(copy.meta)) throw refusedCopy('the metadata');
  const meta = Object.entries(copy.meta).filter(([key]) => key !== SCHEMA_META_KEY);
  if (!meta.every(([, value]) => typeof value === 'string')) throw refusedCopy('the metadata');
  return { learner, answers, snapshot: copy.snapshot, meta, reports };
}
