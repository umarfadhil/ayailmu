// The durable sync journal of one account dataset: the TypeScript counterpart of backend/internal/journal for the
// Expo family only. One document beside the dataset holds the install ID; the originals (each saved answer's exact
// raw text wrapped in envelope v1, never deleted) and which the server acknowledged; one frozen import per local
// learner source (its import ID and exact request text, saved before it is first sent and resent byte for byte); the
// linked profile and its settings base; the preferences the learner changed; the pull cursor; and other devices'
// answers with their exact payload text. Tokens, passwords and addresses are never stored; session snapshots and
// exposure ledgers stay in the learning store and are never sent. Network waits never hold the learning store's
// writer, and nothing pulled ever reaches the learning store.
import type { JournalStorage, RawTarget } from '@/account/datasets';
import { isCanonicalUuid } from '@/account/ids';
import type { AccountSession, VerifiedAccount } from '@/account/session';
import { ApiError, problemCode, type ApiClient, type ApiReply, type ApiRequest } from '@/api/client';
import type { ConnectionAuth } from '@/auth/types';
import { newId } from '@/engine/util';
import { createSerialQueue } from '@/storage/serial';
import type { Learner, Store } from '@/storage/types';
import { CjsonError, decodeJson, eventIdsSha256, memberOf, semanticSha256, type JsonNode } from './cjson';
import { utf8Bytes } from './sha256';

/** The only family this client records, links and pulls. */
export const EXPO_FAMILY = 'expo-trial-arabic';

/** The server's limits (Backend_Local_Contract §5 to §7). Tests may lower them. */
export interface SyncLimits {
  importEvents: number;
  importBytes: number;
  batchEvents: number;
  batchBytes: number;
  pullLimit: number;
}

export const SERVER_LIMITS: SyncLimits = Object.freeze({
  importEvents: 10000,
  importBytes: 16 * 1024 * 1024,
  batchEvents: 500,
  batchBytes: 4 * 1024 * 1024,
  pullLimit: 500,
});

/** What a journal needs of its account dataset (the owner): the learning store, its raw surface and its document. */
export interface JournalDataset {
  store: Store;
  raw: RawTarget;
  journal: JournalStorage;
}

/** The signed-in connection a sync runs on. Every request goes through auth.authorized, so a sign-out or a newer sign-in drops it. */
export interface SyncConnection {
  auth: ConnectionAuth;
  session: AccountSession;
  api: ApiClient;
}

export interface ProfileConsent {
  version: string;
  at: string;
}

/** How an unlinked dataset links: a new adult profile (with the learner's explicit consent), or one of the account's own profiles. */
export type LinkChoice = { kind: 'new-profile'; consent: ProfileConsent } | { kind: 'own-profile'; profileId: string };

/** The preferences this app lets the learner change; the server's other settings are never sent. */
export type PreferenceField = 'session_minutes' | 'arabic_scale';

export interface JournalOriginal {
  eventId: string;
  learnerId: string;
  /** Envelope v1 around the saved answer's exact raw text. */
  envelope: string;
  semanticSha256: string;
  acked: boolean;
  /** Why this original can never be sent (it stays stored), or null. */
  blocked: string | null;
}

/** One local learner of the dataset and its link: its own import, never another learner's. */
export interface JournalSource {
  learnerId: string;
  importId: string | null;
  /** The exact import request text, kept until a verified receipt or a refusal that proves nothing was written. */
  frozen: string | null;
  linked: boolean;
}

/** An answer pulled from another device, kept apart from the learning store. */
export interface RemoteAnswer {
  seq: number;
  eventId: string;
  installId: string;
  learnerId: string;
  /** The payload exactly as the server returned it. */
  payload: string;
}

export interface SettingsDoc {
  revision: number;
  /** The server's settings as returned, members this app does not edit included. */
  settings: Record<string, unknown>;
}

/** A copy of the journal's state, for the UI and for checks. */
export interface JournalView {
  accountId: string;
  installId: string;
  profileId: string | null;
  sources: JournalSource[];
  originals: JournalOriginal[];
  cursor: number;
  remote: RemoteAnswer[];
  base: SettingsDoc | null;
  /** Preferences the learner changed since the base, with the values chosen. */
  changed: Partial<Record<PreferenceField, number>>;
  /** A push refused as stale: the server's current revision and settings, kept until the learner chooses. */
  preferenceConflict: SettingsDoc | null;
  /** Answers whose stored server copy differs; they stay pending. */
  conflicts: string[];
}

export interface SyncReport {
  /** Learner sources linked by this sync. */
  linked: string[];
  /** A linking import was answered as a replay: an earlier attempt had committed. */
  replayed: boolean;
  stored: number;
  identical: number;
  conflicts: string[];
  /** Originals still not acknowledged after this sync. */
  pending: number;
  pulled: number;
}

export interface TruthCounts {
  true: number;
  false: number;
  absent: number;
  unknown: number;
}

/** The server's factual counts for the Expo family (GET /v1/profiles/{pid}/progress); nothing is inferred. */
export interface AccountProgress {
  profileId: string;
  family: string;
  asOfSeq: number;
  events: number;
  excludedUnregistered: number;
  /** The server's statuses verbatim, e.g. "not_assessed_by_server". */
  learned: string;
  retention: string;
  provenance: {
    synthetic: TruthCounts;
    feedbackDeferred: TruthCounts;
    hintUsed: TruthCounts;
    retentionValidFalse: number;
  };
}

export type SyncErrorCode =
  /** No verified account, or another account than the dataset's. Nothing was sent. */
  | 'account_mismatch'
  /** The profile to link is not one of the signed-in account's own. Nothing was sent. */
  | 'not_own_profile'
  /** The dataset is not linked and no link was chosen. */
  | 'not_linked'
  /** The import receipt does not answer the frozen request; nothing was acknowledged or linked. */
  | 'unverified_receipt'
  /** A reply does not match the request; nothing from it was kept. */
  | 'bad_response'
  /** The server refused the request. */
  | 'refused';

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    /** The HTTP status for refused and bad replies, else 0. */
    readonly status: number = 0,
    /** The server's stable problem code for a refusal, else null. */
    readonly problem: string | null = null
  ) {
    super(`Sync stopped: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'SyncError';
  }
}

export type PreferencePush = 'sent' | 'nothing' | 'conflict';

export interface SyncJournal {
  view(): JournalView;
  /** Adds every saved answer of the dataset the journal does not hold yet, e.g. after a stop between saving and queueing. Returns how many. */
  reconcile(): Promise<number>;
  /** One manual sync: link each local learner source (frozen imports), upload later answers, pull the family's new answers. */
  sync(conn: SyncConnection, link: LinkChoice | null): Promise<SyncReport>;
  /** Records a preference change: the intent is saved first, then the learner record. */
  setPreference(field: PreferenceField, value: number): Promise<void>;
  /** Sends the changed preferences as a conditional merge patch; a stale base gives a conflict, never a merge or a retry. */
  pushPreferences(conn: SyncConnection): Promise<PreferencePush>;
  /** Resolves a preference conflict explicitly: keep this device's values, or take the account's. */
  resolvePreferences(choice: 'keep-local' | 'use-server'): Promise<void>;
  /** The linked profile's factual counts for the Expo family. */
  readProgress(conn: SyncConnection): Promise<AccountProgress>;
}

export interface JournalOptions {
  dataset: JournalDataset;
  /** The verified account this dataset belongs to; every sync checks the signed-in account against it. */
  accountId: string;
  /** The installed app version, sent as envelope transport metadata (never part of the semantic hash). */
  appVersion: string;
  limits?: Partial<SyncLimits>;
}

// ---------------------------------------------------------------------------------------------------------------
// The stored document.

const FORMAT = 'aya-journal-1';
const PREFERENCES: readonly PreferenceField[] = ['session_minutes', 'arabic_scale'];
const MAX_PAYLOAD_BYTES = 64 * 1024;
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NUL = String.fromCharCode(0);

interface OriginalRecord {
  eventId: string;
  learnerId: string;
  envelope: string;
  hash: string;
  acked: boolean;
  blocked: string | null;
}

interface SourceRecord {
  learnerId: string;
  importId: string | null;
  frozen: string | null;
  /** The event IDs the frozen import carries, in its order. */
  members: string[];
  /** The profile the frozen import links to, or null when it creates one. */
  target: string | null;
  linked: boolean;
}

interface JournalDoc {
  format: typeof FORMAT;
  accountId: string;
  installId: string;
  profileId: string | null;
  originals: OriginalRecord[];
  sources: SourceRecord[];
  base: SettingsDoc | null;
  changed: Partial<Record<PreferenceField, number>>;
  conflict: SettingsDoc | null;
  cursor: number;
  remote: RemoteAnswer[];
  conflicts: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const byteLength = (s: string) => utf8Bytes(s).length;
const idText = (v: unknown): v is string => typeof v === 'string' && v !== '' && byteLength(v) <= 128 && !v.includes(NUL);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function validPreference(field: PreferenceField, value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  return field === 'session_minutes' ? Number.isInteger(value) && value >= 1 && value <= 240 : value >= 0.8 && value <= 2.0;
}

function freshDoc(accountId: string): JournalDoc {
  return { format: FORMAT, accountId, installId: newId('inst'), profileId: null, originals: [], sources: [], base: null, changed: {}, conflict: null, cursor: 0, remote: [], conflicts: [] };
}

/** A stored document of this account, or a refusal: an unreadable or foreign journal is never overwritten. */
function parseDoc(text: string, accountId: string): JournalDoc {
  let d: unknown;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('The sync journal is unreadable; it was not modified.');
  }
  if (!isRecord(d) || d.format !== FORMAT || !Array.isArray(d.originals) || !Array.isArray(d.sources) || !Array.isArray(d.remote) || !isCount(d.cursor)) {
    throw new Error('The sync journal is unreadable; it was not modified.');
  }
  if (d.accountId !== accountId) throw new Error('The sync journal belongs to another account; it was not modified.');
  return d as unknown as JournalDoc;
}

function realDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
}

/**
 * Wraps one saved answer, its exact raw text, in envelope v1. A record the server would refuse is kept as a blocked
 * original (never sent, never deleted) instead of being rewritten.
 */
function captureOriginal(answerJson: string, installId: string, appVersion: string): OriginalRecord {
  let p: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(answerJson);
    if (isRecord(v)) p = v;
  } catch {
    p = null;
  }
  const eventId = typeof p?.answer_id === 'string' ? p.answer_id : '';
  const learnerId = typeof p?.learner_id === 'string' ? p.learner_id : '';
  const blocked = (code: string, envelope = ''): OriginalRecord => ({ eventId, learnerId, envelope, hash: '', acked: false, blocked: code });
  if (!p) return blocked('invalid_json');
  if (!EVENT_ID.test(eventId)) return blocked('invalid_event_id');
  if (!idText(learnerId)) return blocked('invalid_source');
  const contentVersion = p.content_version;
  const rulesVersion = p.rules_version;
  if (typeof contentVersion !== 'string' || contentVersion === '' || contentVersion.includes(NUL)) return blocked('curriculum_mismatch');
  if (typeof rulesVersion !== 'string' || rulesVersion === '' || rulesVersion.includes(NUL)) return blocked('curriculum_mismatch');
  let schemaVersion = 1;
  if ('answer_schema' in p) {
    if (p.answer_schema !== 2) return blocked('schema_version_mismatch');
    schemaVersion = 2;
  }
  if (schemaVersion === 2 ? p.evidence_mode !== 'recognition-4' : 'evidence_mode' in p) return blocked('schema_version_mismatch');
  if (typeof p.timestamp !== 'string' || !TIMESTAMP.test(p.timestamp)) return blocked('invalid_timestamp');
  if (typeof p.local_date !== 'string' || !realDate(p.local_date)) return blocked('invalid_local_date');
  if (byteLength(answerJson) > MAX_PAYLOAD_BYTES) return blocked('payload_too_large');
  const envelope =
    `{"envelope_version":1,"event_id":${JSON.stringify(eventId)},"kind":"answer","schema":"expo.answer_record","schema_version":${schemaVersion},` +
    `"curriculum":{"family":"${EXPO_FAMILY}","track":"arab","content_version":${JSON.stringify(contentVersion)},"rules_version":${JSON.stringify(rulesVersion)}},` +
    `"source":{"app":"expo","install_id":${JSON.stringify(installId)},"app_version":${JSON.stringify(appVersion)},"local_profile_id":${JSON.stringify(learnerId)}},` +
    `"payload":${answerJson}}`;
  try {
    return { eventId, learnerId, envelope, hash: semanticSha256(envelope), acked: false, blocked: null };
  } catch (e) {
    return blocked(e instanceof CjsonError ? e.code : 'invalid_json', envelope);
  }
}

/** A refusal that proves nothing was written, so a new import may replace the frozen one (import_id_reused does not). */
function nothingWritten(status: number, code: string | null): boolean {
  if (status === 400 || status === 404 || status === 413 || status === 422) return true;
  return status === 409 && code !== 'import_id_reused';
}

/** A profile document's revision and settings, when it is the linked profile's. */
function settingsDocOf(doc: unknown, profileId: string): SettingsDoc | null {
  if (!isRecord(doc) || typeof doc.profile_id !== 'string' || doc.profile_id.toLowerCase() !== profileId) return null;
  if (typeof doc.revision !== 'number' || !Number.isSafeInteger(doc.revision) || doc.revision < 1) return null;
  const settings = doc.settings ?? {};
  if (!isRecord(settings)) return null;
  return { revision: doc.revision, settings: clone(settings) };
}

function truthCounts(v: unknown): TruthCounts | null {
  if (!isRecord(v) || !isCount(v.true) || !isCount(v.false) || !isCount(v.absent) || !isCount(v.unknown)) return null;
  return { true: v.true, false: v.false, absent: v.absent, unknown: v.unknown };
}

interface PulledEvent {
  seq: number;
  eventId: string;
  kind: string;
  family: string;
  app: string;
  installId: string;
  learnerId: string;
  payload: string;
}

/** A pull page read strictly, each payload kept as its exact text. Null when the page is not well formed. */
function pageOf(text: string): { events: PulledEvent[]; nextAfter: number; hasMore: boolean } | null {
  let root: JsonNode;
  try {
    root = decodeJson(text);
  } catch {
    return null;
  }
  const events = memberOf(root, 'events');
  const next = memberOf(root, 'next_after');
  const more = memberOf(root, 'has_more');
  if (root.kind !== 'object' || events?.kind !== 'array' || next?.kind !== 'number' || more?.kind !== 'bool') return null;
  const int = (n: JsonNode) => {
    const v = Number(text.slice(n.start, n.end));
    return Number.isSafeInteger(v) ? v : NaN;
  };
  const str = (n: JsonNode | undefined) => (n?.kind === 'string' ? (n.text ?? '') : '');
  const out: PulledEvent[] = [];
  for (const e of events.items ?? []) {
    const seq = memberOf(e, 'seq');
    const payload = memberOf(e, 'payload');
    const curriculum = memberOf(e, 'curriculum');
    const source = memberOf(e, 'source');
    if (e.kind !== 'object' || seq?.kind !== 'number' || payload?.kind !== 'object' || curriculum?.kind !== 'object' || source?.kind !== 'object') return null;
    out.push({
      seq: int(seq),
      eventId: str(memberOf(e, 'event_id')),
      kind: str(memberOf(e, 'kind')),
      family: str(memberOf(curriculum, 'family')),
      app: str(memberOf(source, 'app')),
      installId: str(memberOf(source, 'install_id')),
      learnerId: str(memberOf(source, 'local_profile_id')),
      payload: text.slice(payload.start, payload.end),
    });
  }
  const nextAfter = int(next);
  if (Number.isNaN(nextAfter) || out.some((e) => Number.isNaN(e.seq))) return null;
  return { events: out, nextAfter, hasMore: more.bool === true };
}

// ---------------------------------------------------------------------------------------------------------------
// The journal.

/** Opens (or creates) the journal of an account dataset. */
export async function openJournal(options: JournalOptions): Promise<SyncJournal> {
  const { dataset, accountId, appVersion } = options;
  if (!isCanonicalUuid(accountId)) throw new Error('openJournal needs the verified account ID.');
  const limits: SyncLimits = { ...SERVER_LIMITS, ...(options.limits ?? {}) };
  const stored = await dataset.journal.load();
  let doc: JournalDoc = stored === null ? freshDoc(accountId) : parseDoc(stored, accountId);
  /** Short state changes, one at a time: never held across a network wait. */
  const commits = createSerialQueue();
  /** Syncs and pushes, one at a time. */
  const runs = createSerialQueue();

  /** Applies `update` to a copy of the state and saves it; only a successful save makes it current. */
  const commit = (update: (d: JournalDoc) => boolean) =>
    commits(async () => {
      const next = clone(doc);
      if (!update(next)) return;
      await dataset.journal.save(JSON.stringify(next));
      doc = next;
    });

  /** The connection's verified account, which must be this dataset's. */
  const verifiedFor = (conn: SyncConnection): VerifiedAccount => {
    const v = conn.session.current();
    if (!v || v.accountId !== accountId) throw new SyncError('account_mismatch');
    return v;
  };

  /** One request on the current sign-in. A sign-out or newer sign-in drops it; an API 401 ends the sign-in. */
  const call = async (conn: SyncConnection, req: Omit<ApiRequest, 'token' | 'signal'>): Promise<ApiReply> => {
    verifiedFor(conn);
    const reply = await conn.auth.authorized(async (token, signal) => {
      const r = await conn.api.request({ ...req, token, signal });
      if (r.status === 401) throw new ApiError(401, problemCode(r.text) ?? 'unauthenticated');
      return r;
    });
    verifiedFor(conn); // a result is only ever used for this dataset's account
    return reply;
  };

  const refused = (reply: ApiReply) => new SyncError('refused', reply.status, problemCode(reply.text));

  // A pending preference intent survives a stop before the learner record was saved: it is applied again on open.
  try {
    const learner = await dataset.store.getLearner();
    const patch: Partial<Learner> = {};
    for (const field of PREFERENCES) {
      const value = doc.changed[field];
      if (learner && value !== undefined && learner[field] !== value) patch[field] = value;
    }
    if (learner && Object.keys(patch).length) await dataset.store.saveLearner({ ...learner, ...patch });
  } catch {
    // A read-only dataset keeps the intent in the journal until a writable open.
  }

  async function reconcile(): Promise<number> {
    const raw = await dataset.raw.readRaw();
    const learner = await dataset.store.getLearner();
    let added = 0;
    await commit((d) => {
      added = 0;
      const known = new Set(d.originals.map((o) => o.eventId));
      for (const a of raw?.answers ?? []) {
        if (known.has(a.id)) continue;
        d.originals.push(captureOriginal(a.json, d.installId, appVersion));
        known.add(a.id);
        added += 1;
      }
      let changed = added > 0;
      const learners = [...d.originals.filter((o) => !o.blocked).map((o) => o.learnerId), ...(learner ? [learner.learner_id] : [])];
      for (const learnerId of learners) {
        if (learnerId && !d.sources.some((s) => s.learnerId === learnerId)) {
          d.sources.push({ learnerId, importId: null, frozen: null, members: [], target: null, linked: false });
          changed = true;
        }
      }
      return changed;
    });
    return added;
  }

  /** Freezes the import of one learner source: its ID and exact request text are saved before it is first sent. */
  async function freeze(learnerId: string, link: LinkChoice | null, verified: VerifiedAccount): Promise<void> {
    let target: Record<string, unknown>;
    let targetId: string | null;
    if (doc.profileId) {
      target = { profile_id: doc.profileId };
      targetId = doc.profileId;
    } else if (!link) {
      throw new SyncError('not_linked');
    } else if (link.kind === 'own-profile') {
      const id = link.profileId.toLowerCase();
      if (!verified.profiles.some((p) => p.profileId === id)) throw new SyncError('not_own_profile');
      target = { profile_id: id };
      targetId = id;
    } else {
      if (!idText(link.consent?.version) || typeof link.consent.at !== 'string' || Number.isNaN(Date.parse(link.consent.at))) {
        throw new Error('A new profile needs the learner\'s consent version and time.');
      }
      const learner = await dataset.store.getLearner();
      const settings: Record<string, number> = {};
      for (const field of PREFERENCES) if (learner && validPreference(field, learner[field])) settings[field] = learner[field];
      target = { new_profile: { kind: 'adult', settings, consent: { version: link.consent.version, at: link.consent.at } } };
      targetId = null;
    }
    const importId = newId('imp');
    await commit((d) => {
      const s = d.sources.find((x) => x.learnerId === learnerId);
      if (!s || s.linked || s.frozen !== null) return false;
      const head = `{"import_id":${JSON.stringify(importId)},"source":{"app":"expo","install_id":${JSON.stringify(d.installId)},"local_profile_id":${JSON.stringify(learnerId)}},"target":${JSON.stringify(target)},"events":[`;
      const members: OriginalRecord[] = [];
      let bytes = byteLength(head) + 2;
      for (const o of d.originals) {
        if (o.learnerId !== learnerId || o.acked || o.blocked) continue;
        const size = byteLength(o.envelope);
        if (members.length === limits.importEvents || (members.length > 0 && bytes + 1 + size > limits.importBytes)) break;
        members.push(o);
        bytes += size + 1;
      }
      s.importId = importId;
      s.frozen = `${head}${members.map((o) => o.envelope).join(',')}]}`;
      s.members = members.map((o) => o.eventId);
      s.target = targetId;
      return true;
    });
  }

  /** Sends one source's frozen import, unchanged, and links it only on a receipt that answers exactly that request. */
  async function sendFrozen(conn: SyncConnection, learnerId: string, report: SyncReport): Promise<void> {
    const s = doc.sources.find((x) => x.learnerId === learnerId);
    if (!s || s.frozen === null || s.importId === null) return;
    const frozen: string = s.frozen;
    const importId: string = s.importId;
    const members = [...s.members];
    const expected = s.target ?? doc.profileId;
    const reply = await call(conn, { method: 'POST', path: '/v1/imports', body: frozen, contentType: 'application/json' });
    if (reply.status !== 200 && reply.status !== 201) {
      const code = problemCode(reply.text);
      if (nothingWritten(reply.status, code)) {
        await commit((d) => {
          const x = d.sources.find((y) => y.learnerId === learnerId);
          if (!x || x.importId !== importId) return false;
          x.importId = null;
          x.frozen = null;
          x.members = [];
          x.target = null;
          return true;
        });
      }
      throw new SyncError('refused', reply.status, code);
    }
    let r: unknown;
    try {
      r = JSON.parse(reply.text);
    } catch {
      r = null;
    }
    const profile = isRecord(r) && typeof r.profile_id === 'string' ? r.profile_id.toLowerCase() : '';
    const verified =
      isRecord(r) &&
      r.import_id === importId &&
      r.replayed === (reply.status === 200) &&
      isCount(r.stored) &&
      isCount(r.identical) &&
      r.stored + r.identical === members.length &&
      r.event_ids_sha256 === eventIdsSha256(members) &&
      isCanonicalUuid(profile) &&
      (expected === null || profile === expected);
    if (!verified || !isRecord(r)) throw new SyncError('unverified_receipt', reply.status);
    const stored = r.stored as number;
    const identical = r.identical as number;
    await commit((d) => {
      const x = d.sources.find((y) => y.learnerId === learnerId);
      if (!x || x.importId !== importId || x.linked) return false;
      const acked = new Set(members);
      for (const o of d.originals) if (o.learnerId === learnerId && acked.has(o.eventId)) o.acked = true;
      x.linked = true;
      x.frozen = null;
      d.profileId = profile;
      d.conflicts = d.conflicts.filter((id) => !acked.has(id));
      return true;
    });
    report.linked.push(learnerId);
    report.replayed = report.replayed || r.replayed === true;
    report.stored += stored;
    report.identical += identical;
  }

  async function linkSources(conn: SyncConnection, link: LinkChoice | null, verified: VerifiedAccount, report: SyncReport): Promise<void> {
    for (;;) {
      const pending = doc.sources.filter((s) => !s.linked);
      if (!pending.length) return;
      // A frozen import goes first, unchanged, whatever was recorded or chosen since.
      const source = pending.find((s) => s.frozen !== null) ?? pending[0];
      if (source.frozen === null) await freeze(source.learnerId, link, verified);
      await sendFrozen(conn, source.learnerId, report);
    }
  }

  /** Reads the linked profile once: its revision and settings become the base of later pushes. */
  async function fetchBase(conn: SyncConnection): Promise<void> {
    const profileId = doc.profileId!;
    const reply = await call(conn, { method: 'GET', path: `/v1/profiles/${profileId}` });
    if (reply.status !== 200) throw refused(reply);
    let body: unknown;
    try {
      body = JSON.parse(reply.text);
    } catch {
      body = null;
    }
    const base = settingsDocOf(body, profileId);
    if (!base) throw new SyncError('bad_response', reply.status);
    await commit((d) => {
      if (d.base) return false;
      d.base = base;
      return true;
    });
  }

  /** Uploads the linked sources' later originals, exact bytes, acknowledging each only by its own result and hash. */
  async function upload(conn: SyncConnection, report: SyncReport): Promise<void> {
    const tried = new Set<string>();
    for (;;) {
      const linked = new Set(doc.sources.filter((s) => s.linked).map((s) => s.learnerId));
      const batch: OriginalRecord[] = [];
      let bytes = 13;
      for (const o of doc.originals) {
        if (o.acked || o.blocked || tried.has(o.eventId) || !linked.has(o.learnerId)) continue;
        const size = byteLength(o.envelope);
        if (batch.length === limits.batchEvents || (batch.length > 0 && bytes + 1 + size > limits.batchBytes)) break;
        batch.push(o);
        bytes += size + 1;
      }
      if (!batch.length) return;
      for (const o of batch) tried.add(o.eventId);
      const reply = await call(conn, {
        method: 'POST',
        path: `/v1/profiles/${doc.profileId}/events`,
        body: `{"events":[${batch.map((o) => o.envelope).join(',')}]}`,
        contentType: 'application/json',
      });
      if (reply.status !== 200) throw refused(reply);
      let parsed: unknown;
      try {
        parsed = (JSON.parse(reply.text) as { results?: unknown }).results;
      } catch {
        parsed = null;
      }
      if (!Array.isArray(parsed) || parsed.length !== batch.length) throw new SyncError('bad_response', reply.status);
      const results: unknown[] = parsed;
      const acked: string[] = [];
      const conflicts: string[] = [];
      let stored = 0;
      let identical = 0;
      batch.forEach((o, k) => {
        const res: unknown = results[k];
        if (!isRecord(res) || res.index !== k || res.event_id !== o.eventId) throw new SyncError('bad_response', reply.status);
        const sameHash = res.semantic_sha256 === o.hash;
        if (res.result === 'stored' && res.status === 201 && sameHash) {
          acked.push(o.eventId);
          stored += 1;
        } else if (res.result === 'identical' && res.status === 200 && sameHash) {
          acked.push(o.eventId);
          identical += 1;
        } else if (res.result === 'conflict') {
          conflicts.push(o.eventId);
        }
      });
      await commit((d) => {
        const ack = new Set(acked);
        for (const o of d.originals) if (ack.has(o.eventId)) o.acked = true;
        const next = [...new Set([...d.conflicts.filter((id) => !ack.has(id)), ...conflicts])];
        const changed = acked.length > 0 || next.join(' ') !== d.conflicts.join(' ');
        d.conflicts = next;
        return changed;
      });
      report.stored += stored;
      report.identical += identical;
    }
  }

  /** Pulls the Expo family from the cursor; each page is saved with its next_after before the next one is asked for. */
  async function pull(conn: SyncConnection, report: SyncReport): Promise<void> {
    for (;;) {
      const cursor = doc.cursor;
      const reply = await call(conn, { method: 'GET', path: `/v1/profiles/${doc.profileId}/events?after=${cursor}&limit=${limits.pullLimit}&family=${EXPO_FAMILY}` });
      if (reply.status !== 200) throw refused(reply);
      const page = pageOf(reply.text);
      if (!page) throw new SyncError('bad_response', reply.status);
      const own = new Set(doc.sources.map((s) => s.learnerId));
      const seenSeq = new Set(doc.remote.map((r) => r.seq));
      const seenKey = new Set(doc.remote.map((r) => `${r.installId} ${r.learnerId} ${r.eventId}`));
      const fresh: RemoteAnswer[] = [];
      let last = cursor;
      for (const e of page.events) {
        if (e.seq <= last || e.eventId === '' || e.kind !== 'answer' || e.family !== EXPO_FAMILY || e.app !== 'expo' || !e.payload.startsWith('{')) {
          throw new SyncError('bad_response', reply.status);
        }
        last = e.seq;
        const key = `${e.installId} ${e.learnerId} ${e.eventId}`;
        if ((e.installId === doc.installId && own.has(e.learnerId)) || seenSeq.has(e.seq) || seenKey.has(key)) continue;
        seenSeq.add(e.seq);
        seenKey.add(key);
        fresh.push({ seq: e.seq, eventId: e.eventId, installId: e.installId, learnerId: e.learnerId, payload: e.payload });
      }
      // The cursor follows next_after (the last seq of this family's page), never high_seq.
      if (page.nextAfter !== last || (page.hasMore && page.events.length === 0)) throw new SyncError('bad_response', reply.status);
      await commit((d) => {
        if (d.cursor !== cursor) return false;
        d.remote.push(...fresh);
        d.cursor = last;
        return last !== cursor || fresh.length > 0;
      });
      report.pulled += fresh.length;
      if (!page.hasMore) return;
    }
  }

  async function push(conn: SyncConnection): Promise<PreferencePush> {
    if (!doc.profileId) throw new SyncError('not_linked');
    const profileId = doc.profileId;
    if (doc.conflict) return 'conflict'; // nothing is retried or merged until the learner chooses
    if (!doc.base) await fetchBase(conn);
    const base = doc.base!;
    const patch: Record<string, number> = {};
    for (const field of PREFERENCES) {
      const value = doc.changed[field];
      if (value !== undefined && base.settings[field] !== value) patch[field] = value;
    }
    if (!Object.keys(patch).length) {
      if (Object.keys(doc.changed).length) {
        await commit((d) => {
          d.changed = {};
          return true;
        });
      }
      return 'nothing';
    }
    const reply = await call(conn, {
      method: 'PATCH',
      path: `/v1/profiles/${profileId}`,
      body: JSON.stringify({ settings: patch }),
      contentType: 'application/merge-patch+json',
      ifMatch: `"r${base.revision}"`,
    });
    let body: unknown;
    try {
      body = JSON.parse(reply.text);
    } catch {
      body = null;
    }
    if (reply.status === 200) {
      const next = settingsDocOf(body, profileId);
      if (!next) throw new SyncError('bad_response', reply.status);
      await commit((d) => {
        d.base = next;
        for (const field of PREFERENCES) if (d.changed[field] !== undefined && next.settings[field] === d.changed[field]) delete d.changed[field];
        return true;
      });
      return 'sent';
    }
    if (reply.status === 412) {
      const current = settingsDocOf(isRecord(body) ? body.current : null, profileId);
      if (!current) throw new SyncError('bad_response', reply.status);
      await commit((d) => {
        d.conflict = current;
        return true;
      });
      return 'conflict';
    }
    throw refused(reply);
  }

  return {
    view(): JournalView {
      const d = clone(doc);
      return {
        accountId: d.accountId,
        installId: d.installId,
        profileId: d.profileId,
        sources: d.sources.map(({ learnerId, importId, frozen, linked }) => ({ learnerId, importId, frozen, linked })),
        originals: d.originals.map(({ eventId, learnerId, envelope, hash, acked, blocked }) => ({ eventId, learnerId, envelope, semanticSha256: hash, acked, blocked })),
        cursor: d.cursor,
        remote: d.remote,
        base: d.base,
        changed: d.changed,
        preferenceConflict: d.conflict,
        conflicts: d.conflicts,
      };
    },

    reconcile,

    sync(conn, link) {
      try {
        verifiedFor(conn);
      } catch (e) {
        return Promise.reject(e);
      }
      return runs(async () => {
        const report: SyncReport = { linked: [], replayed: false, stored: 0, identical: 0, conflicts: [], pending: 0, pulled: 0 };
        await reconcile();
        const verified = verifiedFor(conn);
        await linkSources(conn, link, verified, report);
        if (!doc.profileId) throw new SyncError('not_linked');
        if (!doc.base) await fetchBase(conn);
        await upload(conn, report);
        await pull(conn, report);
        report.conflicts = [...doc.conflicts];
        report.pending = doc.originals.filter((o) => !o.acked && !o.blocked).length;
        return report;
      });
    },

    async setPreference(field, value) {
      if (!PREFERENCES.includes(field) || !validPreference(field, value)) throw new Error('Not a supported preference value.');
      // The intent first: a stop before the learner record is saved loses nothing (it is applied again on open).
      await commit((d) => {
        d.changed[field] = value;
        return true;
      });
      const learner = await dataset.store.getLearner();
      if (learner && learner[field] !== value) {
        const next: Learner = { ...learner };
        next[field] = value;
        await dataset.store.saveLearner(next);
      }
    },

    pushPreferences(conn) {
      try {
        verifiedFor(conn);
      } catch (e) {
        return Promise.reject(e);
      }
      return runs(() => push(conn));
    },

    async resolvePreferences(choice) {
      const conflict = doc.conflict;
      if (!conflict) return;
      if (choice === 'keep-local') {
        // The account's revision becomes the base; the next push sends exactly what this device still changes.
        await commit((d) => {
          if (!d.conflict) return false;
          d.base = d.conflict;
          d.conflict = null;
          return true;
        });
        return;
      }
      // The account's values become this device's: nothing remains to send.
      await commit((d) => {
        if (!d.conflict) return false;
        d.base = d.conflict;
        d.conflict = null;
        d.changed = {};
        return true;
      });
      const learner = await dataset.store.getLearner();
      if (!learner) return;
      const patch: Partial<Learner> = {};
      for (const field of PREFERENCES) {
        const value = conflict.settings[field];
        if (validPreference(field, value) && learner[field] !== value) patch[field] = value;
      }
      if (Object.keys(patch).length) await dataset.store.saveLearner({ ...learner, ...patch });
    },

    async readProgress(conn) {
      verifiedFor(conn);
      if (!doc.profileId) throw new SyncError('not_linked');
      const profileId = doc.profileId;
      const reply = await call(conn, { method: 'GET', path: `/v1/profiles/${profileId}/progress?family=${EXPO_FAMILY}` });
      if (reply.status !== 200) throw refused(reply);
      let p: unknown;
      try {
        p = JSON.parse(reply.text);
      } catch {
        p = null;
      }
      if (!isRecord(p) || typeof p.profile_id !== 'string' || p.profile_id.toLowerCase() !== profileId || p.family !== EXPO_FAMILY) {
        throw new SyncError('bad_response', reply.status);
      }
      const learned = isRecord(p.learned) ? p.learned.status : undefined;
      const retention = isRecord(p.retention) ? p.retention.status : undefined;
      const provenance = isRecord(p.provenance) ? p.provenance : {};
      const synthetic = truthCounts(provenance.synthetic);
      const feedbackDeferred = truthCounts(provenance.feedback_deferred);
      const hintUsed = truthCounts(provenance.hint_used);
      const retentionValidFalse = provenance.retention_valid_false;
      if (
        !isCount(p.as_of_seq) ||
        !isCount(p.events) ||
        !isCount(p.excluded_unregistered) ||
        typeof learned !== 'string' ||
        typeof retention !== 'string' ||
        !synthetic ||
        !feedbackDeferred ||
        !hintUsed ||
        !isCount(retentionValidFalse)
      ) {
        throw new SyncError('bad_response', reply.status);
      }
      return {
        profileId,
        family: EXPO_FAMILY,
        asOfSeq: p.as_of_seq,
        events: p.events,
        excludedUnregistered: p.excluded_unregistered,
        learned,
        retention,
        provenance: { synthetic, feedbackDeferred, hintUsed, retentionValidFalse },
      };
    },
  };
}
