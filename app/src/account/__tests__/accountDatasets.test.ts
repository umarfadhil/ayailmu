/**
 * @jest-environment node
 */
// Account datasets beside the guest dataset, written before their implementation: the legacy guest names, one
// dataset and writer lock per verified account, and an explicit, nondestructive copy of guest data. The real
// KvStore (over a memory KV backend) and SqlStore (over node:sqlite, the expo-sqlite SQL) run underneath.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  accountNamespace,
  copyGuestToAccount,
  DatasetError,
  GUEST_NAMESPACE,
  kvRawSource,
  openKvDataset,
  openSqlDataset,
  sqlRawSource,
  type DatasetErrorCode,
  type GuestCopyConsent,
  type OpenedKvDataset,
  type RawDataset,
  type RawSource,
  type RawTarget,
} from '@/account/datasets';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import { SqlStore } from '@/storage/sqlStore';
import type { AnswerRecord, Learner, Store } from '@/storage/types';
import { openWebStore, READ_ONLY_OTHER_TAB, WRITER_LOCK, type LockManagerLike } from '@/storage/webStore';
import { openNodeSqlite, type NodeSqliteDb } from '../../../test/nodeSqliteDb';

const ACCOUNT_A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const ACCOUNT_B = '9b7d5e21-0c4f-4a8e-b1d3-2f6a8c0e4b12';
const CONSENT: GuestCopyConsent = { copyGuestData: true, at: '2026-10-18T02:00:00.000Z' };
/** A backslash, built at run time so the escapes in the fixtures stay exactly as written. */
const BS = String.fromCharCode(92);

const GUEST_LEARNER: Learner = {
  learner_id: 'lrn-guest-1',
  created_at: '2026-10-15T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-15T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 20,
  arabic_scale: 1.3,
  screens_seen: ['DEMO-S1', 'DEMO-S4'],
};
/** As another build may have stored it: indented, with a field this build does not know. */
const LEARNER_RAW = '{"display_pref": {"theme": "sepia"},' + JSON.stringify(GUEST_LEARNER, null, 1).slice(1);

function answer(n: number, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    answer_id: `ans-g${n}`,
    learner_id: GUEST_LEARNER.learner_id,
    item_id: `DEMO-M0${n}`,
    content_version: 'demo-synthetic-0.1',
    rules_version: 'pilot-0.1-local',
    app_version: '0.1.0',
    timestamp: `2026-10-15T01:0${n}:00.000Z`,
    local_date: '2026-10-15',
    session_id: 'ses-guest',
    pool: 'PRACT',
    unit: 'A',
    skills: ['LEX-A:W-A3'],
    raw_response: JSON.stringify({ kind: 'typed', text: `  jawaban ${n} ` }),
    auto_score: { meaning: 'correct' },
    outcome: 'correct',
    error_tags: [],
    serious_tag: null,
    hint_used: false,
    help_lines_shown: [],
    first_attempt: true,
    fresh_evidence: true,
    time_on_item_ms: 4200,
    audio_status: null,
    report_flag: false,
    review_status: 'draft',
    synthetic: true,
    ...extra,
  };
}
/** An answer recorded in the account dataset itself. */
const own = (n: number) => answer(n, { answer_id: `ans-a${n}`, session_id: 'ses-account' });

/**
 * Stored by another build: unknown fields, indentation, and escapes and a number form that JSON.stringify would
 * rewrite («é» and «/» escaped, 4.20e1). Re-serializing it changes its bytes, so only an exact copy keeps them.
 */
const EXOTIC_ANSWER = '{"future_field": "caf' + BS + 'u00e9 ' + BS + '/ v0", "score_hint": 4.20e1,' + JSON.stringify(answer(1), null, 1).slice(1);
/** A four-choice timed check with its exposure provenance, as this build stores it. */
const CHECK_ANSWER = JSON.stringify(
  answer(2, {
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    role: 'check',
    presented_options: [
      { id: 'o1', text: 'jujur', position: 0 },
      { id: 'o2', text: 'alim', position: 1 },
    ],
    selected_option_id: 'o2',
    selected_position: 1,
    feedback_deferred: true,
    retention_valid: false,
    exposure: ['guide:DEMO-S4'],
  })
);
const REPORT_RAW = JSON.stringify(
  {
    report_id: 'rep-g1',
    learner_id: 'lrn-guest-1',
    item_id: 'DEMO-P01',
    content_version: 'demo-synthetic-0.1',
    timestamp: '2026-10-15T01:05:00.000Z',
    reason: 'Arab salah',
    text: 'harakat?',
    triage: { by: 'future build' },
  },
  null,
  2
);
/** The opaque active-session snapshot: kept as text, never interpreted. */
const SNAPSHOT_RAW = '{ "version": 2, "session_id": "ses-guest", "index": 3, "phase": "step" }';
const GUEST_META: Record<string, string> = {
  screen_views: JSON.stringify([{ screen_id: 'DEMO-S4', local_date: '2026-10-15', source: 'guide', at: '2026-10-15T01:30:00.000Z' }], null, 1),
  snapshot_archive: JSON.stringify([{ archived_at: '2026-10-15T00:50:00.000Z', reason: 'format-change-v1', raw: '{ "version": 1, "index": 4 }' }]),
  pending_notice: 'format-change',
};
/** The guest dataset, every record exactly as stored. */
const GUEST_RAW: RawDataset = {
  learner: LEARNER_RAW,
  answers: [
    { id: 'ans-g1', json: EXOTIC_ANSWER },
    { id: 'ans-g2', json: CHECK_ANSWER },
  ],
  snapshot: SNAPSHOT_RAW,
  meta: GUEST_META,
  reports: [{ id: 'rep-g1', json: REPORT_RAW }],
};
/** The same guest dataset as an earlier build left it in web storage, spacing and all. */
const GUEST_BLOB =
  '{"schema": 2, "meta": ' +
  JSON.stringify(GUEST_META) +
  ',\n "learner": ' +
  LEARNER_RAW +
  ',\n "answers": [' +
  EXOTIC_ANSWER +
  ', ' +
  CHECK_ANSWER +
  '],\n "snapshot": ' +
  JSON.stringify(SNAPSHOT_RAW) +
  ',\n "reports": [ ' +
  REPORT_RAW +
  ' ]}';

const ACCOUNT_LEARNER: Learner = { ...GUEST_LEARNER, learner_id: 'lrn-account-a', session_minutes: 10, screens_seen: [] };
/** Recorded in account A before any copy, under an answer ID the guest also has. */
const ACCOUNT_OWN_G2 = answer(2, { learner_id: 'lrn-account-a', session_id: 'ses-account', outcome: 'wrong', auto_score: { meaning: 'wrong' } });

/** Starts `run` now and gives its rejection (a synchronous throw counts); the test fails if it resolves. */
function failure(run: () => Promise<unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve) => resolve(run())).then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error
  );
}

function expectDatasetError(error: unknown, code: DatasetErrorCode) {
  expect(error).toBeInstanceOf(DatasetError);
  expect((error as DatasetError).code).toBe(code);
}

/** Lets released locks and queued revocations settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** navigator.locks of one browser profile: exclusive locks by name, ifAvailable, FIFO waiters. */
function namedLocks(): LockManagerLike & { held(name: string): boolean } {
  const holders = new Set<string>();
  const queues = new Map<string, (() => void)[]>();
  return {
    held: (name) => holders.has(name),
    async request(name, options, cb) {
      if (holders.has(name)) {
        if (options.ifAvailable) return cb(null);
        await new Promise<void>((grant) => queues.set(name, [...(queues.get(name) ?? []), grant]));
      } else {
        holders.add(name);
      }
      try {
        return await cb({ name });
      } finally {
        const next = queues.get(name)?.shift();
        if (next) next(); // handed straight to the next waiter
        else holders.delete(name);
      }
    },
  };
}

/** A memory KV backend that counts writes per key and can fail the next write to a key. */
function countingKv() {
  const inner = memoryKv();
  const writes = new Map<string, number>();
  const failing = new Set<string>();
  const kv: KvBackend = {
    getItem: (key) => inner.getItem(key),
    setItem: (key, value) => {
      writes.set(key, (writes.get(key) ?? 0) + 1);
      if (failing.delete(key)) throw new Error('simulated quota failure');
      inner.setItem(key, value);
    },
    removeItem: (key) => {
      writes.set(key, (writes.get(key) ?? 0) + 1);
      inner.removeItem(key);
    },
  };
  return { kv, writes: (key: string) => writes.get(key) ?? 0, failNextWrite: (key: string) => void failing.add(key) };
}

interface OpenedDataset {
  store: Store;
  raw: RawTarget;
}

/** One storage technology: a seeded guest dataset with account datasets beside it. */
interface Harness {
  seedGuest(): Promise<void>;
  /** The guest dataset's stored bytes, and how many writes it has had. */
  guestBytes(): string;
  guestWrites(): number;
  guestSource(): RawSource;
  /** Opens an account dataset as its learning-store owner; a reopen reads afresh from storage. */
  openAccount(accountId: string): Promise<OpenedDataset>;
  reopenAccount(accountId: string): Promise<OpenedDataset>;
  accountBytes(accountId: string): string;
  accountWrites(accountId: string): number;
  /** The next write to the account dataset fails partway through its atomic save. */
  failDuringNextAccountWrite(accountId: string): void;
  cleanup(): void;
}

function webHarness(): Harness {
  const storage = countingKv();
  const locks = namedLocks();
  const opened = new Map<string, OpenedKvDataset>();
  const openAccount = async (accountId: string) => {
    const dataset = await openKvDataset({ kv: storage.kv, locks, namespace: accountNamespace(accountId) });
    expect(dataset.access).toBe('owner');
    opened.set(accountId, dataset);
    return dataset;
  };
  return {
    seedGuest: async () => storage.kv.setItem(GUEST_NAMESPACE.kvKey, GUEST_BLOB),
    guestBytes: () => storage.kv.getItem(GUEST_NAMESPACE.kvKey) ?? '',
    guestWrites: () => storage.writes(GUEST_NAMESPACE.kvKey),
    guestSource: () => kvRawSource(storage.kv, GUEST_NAMESPACE),
    openAccount,
    reopenAccount: async (accountId) => {
      opened.get(accountId)?.release();
      await settle();
      return openAccount(accountId);
    },
    accountBytes: (accountId) => storage.kv.getItem(accountNamespace(accountId).kvKey) ?? '',
    accountWrites: (accountId) => storage.writes(accountNamespace(accountId).kvKey),
    failDuringNextAccountWrite: (accountId) => storage.failNextWrite(accountNamespace(accountId).kvKey),
    cleanup: () => opened.forEach((dataset) => dataset.release()),
  };
}

function nativeHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'aya-datasets-'));
  const handles = new Map<string, NodeSqliteDb>();
  const writes = new Map<string, number>();
  /** Per file: how many more writes succeed before the next one fails. */
  const failAfter = new Map<string, number>();
  const open = (file: string) => {
    const db = openNodeSqlite(join(dir, file), {
      beforeRun: () => {
        writes.set(file, (writes.get(file) ?? 0) + 1);
        const left = failAfter.get(file);
        if (left === undefined) return;
        if (left > 0) {
          failAfter.set(file, left - 1);
          return;
        }
        failAfter.delete(file);
        throw new Error('simulated disk failure');
      },
    });
    handles.set(file, db);
    return db;
  };
  const dump = (file: string) => {
    const db = handles.get(file);
    if (!db) return '';
    return ['SELECT * FROM meta ORDER BY key', 'SELECT * FROM learner', 'SELECT * FROM answers ORDER BY seq', 'SELECT * FROM snapshot', 'SELECT * FROM reports ORDER BY rowid']
      .map((sql) => JSON.stringify(db.raw.prepare(sql).all()))
      .join('\n');
  };
  const guestFile = GUEST_NAMESPACE.sqliteFile;
  const fileOf = (accountId: string) => accountNamespace(accountId).sqliteFile;
  const openAccount = (accountId: string) => openSqlDataset(open(fileOf(accountId)), accountNamespace(accountId));
  return {
    seedGuest: async () => {
      const db = open(guestFile);
      await new SqlStore(db).init(); // the tables, exactly as the app creates them
      const r = db.raw;
      r.prepare('INSERT INTO learner (id, json) VALUES (1, ?)').run(LEARNER_RAW);
      for (const { json } of GUEST_RAW.answers) {
        const a = JSON.parse(json) as AnswerRecord;
        r.prepare('INSERT INTO answers (answer_id, learner_id, item_id, session_id, timestamp, outcome, json) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          a.answer_id,
          a.learner_id,
          a.item_id,
          a.session_id,
          a.timestamp,
          a.outcome,
          json
        );
      }
      r.prepare('INSERT INTO snapshot (id, json) VALUES (1, ?)').run(SNAPSHOT_RAW);
      for (const [key, value] of Object.entries(GUEST_META)) r.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(key, value);
      for (const { id, json } of GUEST_RAW.reports) r.prepare('INSERT INTO reports (report_id, json) VALUES (?, ?)').run(id, json);
    },
    guestBytes: () => dump(guestFile),
    guestWrites: () => writes.get(guestFile) ?? 0,
    guestSource: () => sqlRawSource(handles.get(guestFile)!, GUEST_NAMESPACE),
    openAccount,
    reopenAccount: async (accountId) => {
      handles.get(fileOf(accountId))?.close();
      return openAccount(accountId);
    },
    accountBytes: (accountId) => dump(fileOf(accountId)),
    accountWrites: (accountId) => writes.get(fileOf(accountId)) ?? 0,
    failDuringNextAccountWrite: (accountId) => void failAfter.set(fileOf(accountId), 1),
    cleanup: () => {
      for (const db of handles.values()) {
        try {
          db.close();
        } catch {
          // already closed by a reopen
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('dataset names', () => {
  it('the guest keeps its legacy names; each verified account gets distinct, safe names; nothing but a canonical account UUID is accepted', () => {
    expect(GUEST_NAMESPACE).toEqual({ kvKey: 'arabic-trial-app/v1', writerLock: 'arabic-trial-app/writer', sqliteFile: 'arabic-trial.db' });
    expect(GUEST_NAMESPACE.kvKey).toBe(KvStore.KEY);
    expect(GUEST_NAMESPACE.writerLock).toBe(WRITER_LOCK);
    expect(Object.isFrozen(GUEST_NAMESPACE)).toBe(true);

    const a = accountNamespace(ACCOUNT_A);
    const b = accountNamespace(ACCOUNT_B);
    expect(accountNamespace(ACCOUNT_A)).toEqual(a);
    for (const [ns, id] of [
      [a, ACCOUNT_A],
      [b, ACCOUNT_B],
    ] as const) {
      // Each name carries its own account ID, in characters safe for a storage key, a lock name and a file name.
      expect(ns.kvKey).toMatch(/^arabic-trial-app\/[a-z0-9/-]+$/);
      expect(ns.writerLock).toMatch(/^arabic-trial-app\/[a-z0-9/-]+$/);
      expect(ns.sqliteFile).toMatch(/^[a-z0-9-]+\.db$/);
      for (const name of [ns.kvKey, ns.writerLock, ns.sqliteFile]) expect(name).toContain(id);
      // Never a legacy guest name, nor a key that readers of the guest key would pick up.
      expect(ns.kvKey.startsWith(GUEST_NAMESPACE.kvKey)).toBe(false);
      expect(ns.writerLock).not.toBe(GUEST_NAMESPACE.writerLock);
      expect(ns.sqliteFile).not.toBe(GUEST_NAMESPACE.sqliteFile);
    }
    const names = [GUEST_NAMESPACE, a, b].flatMap((ns) => [ns.kvKey, ns.writerLock, ns.sqliteFile]);
    expect(new Set(names).size).toBe(names.length);

    // Only the verified account ID names a dataset: not an address, an Auth uid, a local learner ID or a path.
    const notAccountIds = [
      '',
      'ani@ayailmu.test',
      'uid-ani',
      'lrn-guest-1',
      '../arabic-trial',
      `${ACCOUNT_A}/../x`,
      ACCOUNT_A.toUpperCase(),
      ` ${ACCOUNT_A}`,
      ACCOUNT_A + String.fromCharCode(10),
    ];
    for (const id of notAccountIds) {
      let refused: unknown = null;
      try {
        accountNamespace(id);
      } catch (error) {
        refused = error;
      }
      expectDatasetError(refused, 'invalid_account');
    }
  });
});

describe.each([
  { name: 'web: KvStore over a KV backend, with Web Locks', make: webHarness },
  { name: 'native: SqlStore over SQLite (node:sqlite, the expo-sqlite SQL)', make: nativeHarness },
])('account datasets ($name)', ({ make }) => {
  let h: Harness;
  beforeEach(() => {
    h = make();
  });
  afterEach(() => h.cleanup());

  it('an opened account dataset shows none of the guest data, and nothing is written without explicit, affirmative consent', async () => {
    await h.seedGuest();
    const guestBytes = h.guestBytes();
    const guestWrites = h.guestWrites();

    // Opening (as after a sign-in) copies, imports and clears nothing.
    const a = await h.openAccount(ACCOUNT_A);
    expect(await a.store.getLearner()).toBeNull();
    expect(await a.store.listAnswers()).toEqual([]);
    expect(await a.store.listReports()).toEqual([]);
    expect(await a.store.loadSnapshotRaw()).toBeNull();
    expect(await a.raw.readRaw()).toBeNull();

    const accountBytes = h.accountBytes(ACCOUNT_A);
    const accountWrites = h.accountWrites(ACCOUNT_A);
    const copy = (await h.guestSource().readRaw())!;
    const notConsent = [null, { copyGuestData: false, at: CONSENT.at }, { copyGuestData: 'yes', at: CONSENT.at }, { at: CONSENT.at }] as unknown as (GuestCopyConsent | null)[];
    for (const consent of notConsent) {
      expectDatasetError(await failure(() => copyGuestToAccount({ from: h.guestSource(), to: a.raw, consent })), 'consent_required');
      expectDatasetError(await failure(() => a.raw.addCopy(copy, consent as GuestCopyConsent)), 'consent_required');
    }
    expect(h.accountWrites(ACCOUNT_A)).toBe(accountWrites);
    expect(h.accountBytes(ACCOUNT_A)).toBe(accountBytes);
    expect(await a.store.listAnswers()).toEqual([]);
    // The guest dataset was only read: not rewritten, not cleared.
    expect(h.guestWrites()).toBe(guestWrites);
    expect(h.guestBytes()).toBe(guestBytes);
  });

  it('an affirmative copy keeps exact answer and report bytes, unknown fields, metadata, exposure and archive, and the snapshot text; the guest is only read; a repeat writes nothing', async () => {
    await h.seedGuest();
    const guestBytes = h.guestBytes();
    const guestWrites = h.guestWrites();
    // The guest export is lossless: every record exactly as stored.
    expect(await h.guestSource().readRaw()).toEqual(GUEST_RAW);

    const a = await h.openAccount(ACCOUNT_A);
    await expect(copyGuestToAccount({ from: h.guestSource(), to: a.raw, consent: CONSENT })).resolves.toEqual({ answers: 2, reports: 1 });

    const copied = (await a.raw.readRaw())!;
    expect({ ...copied, learner: null }).toEqual({ ...GUEST_RAW, learner: null });
    // The learner record is live settings: every field kept, unknown ones too, and the local learner ID unchanged.
    expect(JSON.parse(copied.learner!)).toEqual(JSON.parse(LEARNER_RAW));
    // The account's learning store reads the copies; nothing was renamed to an account or profile ID.
    expect(await a.store.getLearner()).toEqual(JSON.parse(LEARNER_RAW));
    expect(await a.store.listAnswers()).toEqual(GUEST_RAW.answers.map((r) => JSON.parse(r.json)));
    expect(await a.store.listReports()).toEqual([JSON.parse(REPORT_RAW)]);
    expect(await a.store.loadSnapshotRaw()).toBe(SNAPSHOT_RAW);
    for (const [key, value] of Object.entries(GUEST_META)) expect(await a.store.getMeta(key)).toBe(value);

    // Copying again adds nothing and writes nothing.
    const accountBytes = h.accountBytes(ACCOUNT_A);
    const accountWrites = h.accountWrites(ACCOUNT_A);
    await expect(copyGuestToAccount({ from: h.guestSource(), to: a.raw, consent: CONSENT })).resolves.toEqual({ answers: 0, reports: 0 });
    expect(h.accountWrites(ACCOUNT_A)).toBe(accountWrites);
    expect(h.accountBytes(ACCOUNT_A)).toBe(accountBytes);
    // The guest source was never written.
    expect(h.guestWrites()).toBe(guestWrites);
    expect(h.guestBytes()).toBe(guestBytes);
  });

  it('records the account already has win, local learner IDs stay as recorded, and a failed copy changes nothing until a retry completes it', async () => {
    await h.seedGuest();
    const a = await h.openAccount(ACCOUNT_A);
    await a.store.saveLearner(ACCOUNT_LEARNER);
    await a.store.recordAnswer(ACCOUNT_OWN_G2, { session_id: 'ses-account', index: 1 });
    await a.store.setMeta('pending_notice', 'account-notice');
    const before = (await a.raw.readRaw())!;
    expect(before.answers.map((r) => r.id)).toEqual(['ans-g2']);
    const accountBytes = h.accountBytes(ACCOUNT_A);
    const guestBytes = h.guestBytes();

    // Storage fails partway through the copy: neither dataset changes, on disk or in the open store.
    h.failDuringNextAccountWrite(ACCOUNT_A);
    await expect(copyGuestToAccount({ from: h.guestSource(), to: a.raw, consent: CONSENT })).rejects.toThrow(/simulated/);
    expect(h.accountBytes(ACCOUNT_A)).toBe(accountBytes);
    expect(await a.raw.readRaw()).toEqual(before);
    expect(await a.store.listAnswers()).toEqual([ACCOUNT_OWN_G2]);
    expect(h.guestBytes()).toBe(guestBytes);

    // The retry adds only what the account lacks; what it has is kept byte for byte.
    await expect(copyGuestToAccount({ from: h.guestSource(), to: a.raw, consent: CONSENT })).resolves.toEqual({ answers: 1, reports: 1 });
    expect(await a.raw.readRaw()).toEqual({
      learner: before.learner,
      answers: [...before.answers, GUEST_RAW.answers[0]],
      snapshot: before.snapshot,
      meta: { ...GUEST_META, pending_notice: 'account-notice' },
      reports: GUEST_RAW.reports,
    });
    expect((await a.store.listAnswers()).map((x) => [x.answer_id, x.learner_id])).toEqual([
      ['ans-g2', 'lrn-account-a'],
      ['ans-g1', 'lrn-guest-1'],
    ]);
    expect(await a.store.getLearner()).toEqual(ACCOUNT_LEARNER);
    expect(h.guestBytes()).toBe(guestBytes);
  });

  it('saves through the opened owner, during and after a copy, keep every copied record and never normalize its original bytes; exports and inputs are not aliased', async () => {
    await h.seedGuest();
    const a = await h.openAccount(ACCOUNT_A);
    const copy = (await h.guestSource().readRaw())!;

    // An answer save already queued and the copy go through the same writer: neither is lost.
    const [, copied] = await Promise.all([a.store.recordAnswer(own(7), { session_id: 'ses-account', index: 7 }), a.raw.addCopy(copy, CONSENT)]);
    expect(copied).toEqual({ answers: 2, reports: 1 });

    // Later settings, metadata and answer saves (on the web, each rewrites the whole stored blob).
    await a.store.saveLearner({ ...GUEST_LEARNER, session_minutes: 30 });
    await a.store.setMeta('account_note', 'first');
    await a.store.recordAnswer(own(8), { session_id: 'ses-account', index: 8 });

    // Editing the copy input or an export afterwards reaches nothing stored, even across another save.
    const exported = (await a.raw.readRaw())!;
    for (const leaked of [copy, exported]) {
      for (const record of [...leaked.answers, ...leaked.reports]) record.json = '{"tampered":true}';
      leaked.answers.push({ id: 'ans-tampered', json: '{}' });
      leaked.meta.pending_notice = 'tampered';
    }
    await a.store.setMeta('account_note', 'second');

    const expectIntact = async (dataset: OpenedDataset) => {
      const raw = (await dataset.raw.readRaw())!;
      expect(raw.answers.map((r) => r.id).sort()).toEqual(['ans-a7', 'ans-a8', 'ans-g1', 'ans-g2']);
      expect(raw.answers.filter((r) => r.id.startsWith('ans-g'))).toEqual(GUEST_RAW.answers);
      expect(raw.reports).toEqual(GUEST_RAW.reports);
      expect(raw.meta).toEqual({ ...GUEST_META, account_note: 'second' });
      expect(raw.snapshot).toBe(JSON.stringify({ session_id: 'ses-account', index: 8 }));
      expect(JSON.parse(raw.learner!)).toEqual({ ...GUEST_LEARNER, session_minutes: 30 });
      expect((await dataset.store.listAnswers()).map((x) => x.answer_id).sort()).toEqual(['ans-a7', 'ans-a8', 'ans-g1', 'ans-g2']);
    };
    await expectIntact(a);
    // And after reopening: a fresh read of what was stored.
    await expectIntact(await h.reopenAccount(ACCOUNT_A));
  });
});

describe('web account datasets and writer locks', () => {
  it('guest, A and B keep their own keys and writer locks; read-only and released instances cannot write through addCopy; B never sees A or the guest', async () => {
    const storage = countingKv();
    const locks = namedLocks();
    storage.kv.setItem(GUEST_NAMESPACE.kvKey, GUEST_BLOB);
    const nsA = accountNamespace(ACCOUNT_A);
    const nsB = accountNamespace(ACCOUNT_B);
    const guestSource = kvRawSource(storage.kv, GUEST_NAMESPACE);

    // The guest store opens exactly as before; each account dataset has a writer lock of its own.
    const guest = await openWebStore({ kv: storage.kv, locks });
    const a = await openKvDataset({ kv: storage.kv, locks, namespace: nsA });
    const b = await openKvDataset({ kv: storage.kv, locks, namespace: nsB });
    expect([guest.access, a.access, b.access]).toEqual(['owner', 'owner', 'owner']);
    expect([WRITER_LOCK, nsA.writerLock, nsB.writerLock].map((name) => locks.held(name))).toEqual([true, true, true]);

    // A second tab on account A is read-only: no write through its store or its raw surface.
    const a2 = await openKvDataset({ kv: storage.kv, locks, namespace: nsA });
    expect(a2.access).toBe('read-only');
    expect(a2.reason).toBe(READ_ONLY_OTHER_TAB);
    const copy = (await guestSource.readRaw())!;
    await expect(a2.raw.addCopy(copy, CONSENT)).rejects.toThrow(/read-only/i);
    await expect(copyGuestToAccount({ from: guestSource, to: a2.raw, consent: CONSENT })).rejects.toThrow(/read-only/i);
    expect(storage.writes(nsA.kvKey)).toBe(0);

    // The owner copies. B stays empty, and A's records never pass for another account's guest data.
    await expect(copyGuestToAccount({ from: guestSource, to: a.raw, consent: CONSENT })).resolves.toEqual({ answers: 2, reports: 1 });
    expect(await b.store.getLearner()).toBeNull();
    expect(await b.store.listAnswers()).toEqual([]);
    expect(await b.raw.readRaw()).toBeNull();
    expectDatasetError(await failure(() => copyGuestToAccount({ from: kvRawSource(storage.kv, nsA), to: b.raw, consent: CONSENT })), 'cross_account');
    expect(storage.kv.getItem(nsB.kvKey)).toBeNull();

    // A's tab closes: its store is revoked, and its raw surface refuses too, even records A still lacks.
    const more: RawDataset = { ...copy, answers: [...copy.answers, { id: 'ans-g9', json: JSON.stringify(answer(9)) }] };
    a.release();
    await expect(a.raw.addCopy(more, CONSENT)).rejects.toThrow(/read-only/i);
    await expect(a.store.recordAnswer(own(7), null)).rejects.toThrow(/read-only/i);

    // The waiting tab takes over with a fresh read: A's copy is there, and its raw surface now writes.
    const taken = await a2.whenWritable!();
    expect((await taken.listAnswers()).map((x) => x.answer_id)).toEqual(['ans-g1', 'ans-g2']);
    await expect(a2.raw.addCopy(more, CONSENT)).resolves.toEqual({ answers: 1, reports: 0 });

    // An answer and its snapshot are still saved together or not at all.
    storage.failNextWrite(nsA.kvKey);
    await expect(taken.recordAnswer(own(7), { session_id: 'ses-account', index: 7 })).rejects.toThrow(/simulated/);
    expect((await taken.listAnswers()).map((x) => x.answer_id)).toEqual(['ans-g1', 'ans-g2', 'ans-g9']);
    expect(await taken.loadSnapshotRaw()).toBe(SNAPSHOT_RAW);

    // The guest is never a copy target, not even for the tab that owns it, and its bytes were never written.
    guest.release();
    await settle();
    const guestOwner = await openKvDataset({ kv: storage.kv, locks, namespace: GUEST_NAMESPACE });
    expect(guestOwner.access).toBe('owner');
    expectDatasetError(await failure(() => guestOwner.raw.addCopy(copy, CONSENT)), 'guest_read_only');
    expect(storage.kv.getItem(GUEST_NAMESPACE.kvKey)).toBe(GUEST_BLOB);
    expect(storage.writes(GUEST_NAMESPACE.kvKey)).toBe(1); // the seed
    expect(await b.raw.readRaw()).toBeNull();
    for (const dataset of [b, a2, guestOwner]) dataset.release();
  });
});
