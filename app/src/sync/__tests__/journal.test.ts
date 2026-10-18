/**
 * @jest-environment node
 */
// The durable sync journal of an account dataset, written before its implementation and run over the real KvStore and
// SqlStore account datasets. The network is a test model of the local API (test/fakeAccountApi.ts) whose hashes and
// receipts come from an independent reference; sign-in, the verified session and the API adapter are the app's own.
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { EnabledAccountConfig } from '@/account/config';
import {
  accountNamespace,
  copyGuestToAccount,
  GUEST_NAMESPACE,
  kvRawSource,
  openKvDataset,
  openSqlDataset,
  sqlRawSource,
  type GuestCopyConsent,
  type JournalStorage,
  type OpenedKvDataset,
} from '@/account/datasets';
import { createAccountSession } from '@/account/session';
import { createApiClient } from '@/api/client';
import { createEmulatorAuth } from '@/auth/emulatorAuth';
import type { KvBackend } from '@/storage/kvStore';
import { SqlStore } from '@/storage/sqlStore';
import type { AnswerRecord, Learner, Store } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { openJournal, type JournalDataset, type LinkChoice, type SyncConnection } from '@/sync/journal';
import { FAKE_API, FAKE_EMULATOR, fakeAccountApi, type FakeAccountApi, type FakeUser, type SentRequest } from '../../../test/fakeAccountApi';
import { openNodeSqlite, type NodeSqliteDb } from '../../../test/nodeSqliteDb';
import { referenceIdsChecksum, referenceSemanticSha256 } from '../../../test/referenceCjson';

const ACCOUNT_A = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const ACCOUNT_B = '9b7d5e21-0c4f-4a8e-b1d3-2f6a8c0e4b12';
const ANI: FakeUser = { email: 'ani@ayailmu.test', password: 'pw-ani-local-1', uid: 'uid-ani', token: 'id-token-ani-77aa', accountId: ACCOUNT_A };
const BUDI: FakeUser = { email: 'budi@ayailmu.test', password: 'pw-budi-local-2', uid: 'uid-budi', token: 'id-token-budi-88bb', accountId: ACCOUNT_B };
const CONFIG: EnabledAccountConfig = { enabled: true, apiBaseUrl: FAKE_API, authEmulatorUrl: FAKE_EMULATOR, projectId: 'demo-ayailmu' };
const NOW = Date.UTC(2026, 9, 18, 3, 0, 0);
const APP_VERSION = '0.2.0';
const COPY_CONSENT: GuestCopyConsent = { copyGuestData: true, at: '2026-10-18T02:00:00.000Z' };
const PROFILE_CONSENT = { version: 'demo-consent-0.1', at: '2026-10-18T02:05:00.000Z' };
const NEW_PROFILE: LinkChoice = { kind: 'new-profile', consent: PROFILE_CONSENT };
/** The same choice made again later, with a newer consent: a frozen import must not pick it up. */
const NEW_PROFILE_LATER: LinkChoice = { kind: 'new-profile', consent: { version: 'demo-consent-0.2', at: '2026-10-18T04:00:00.000Z' } };
/** A backslash, built at run time so the escapes in the fixtures stay exactly as written. */
const BS = String.fromCharCode(92);

const GUEST_LEARNER: Learner = {
  learner_id: 'lrn-guest-1',
  created_at: '2026-10-18T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-18T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 20,
  arabic_scale: 1.3,
  screens_seen: [],
};
const ACCOUNT_LEARNER: Learner = { ...GUEST_LEARNER, learner_id: 'lrn-acct-a', session_minutes: 10, arabic_scale: 1 };

function answer(n: number, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    answer_id: `ans-g${n}`,
    learner_id: GUEST_LEARNER.learner_id,
    item_id: `A3-M0${n}`,
    content_version: 'demo-synthetic-0.3',
    rules_version: 'pilot-0.3-local',
    app_version: APP_VERSION,
    timestamp: `2026-10-18T01:0${n}:00.000Z`,
    local_date: '2026-10-18',
    session_id: 'ses-guest',
    pool: 'PRACT',
    unit: 'A',
    skills: ['LEX-A:W-A3'],
    raw_response: JSON.stringify({ kind: 'choice', option_id: 'k' }),
    auto_score: { answer: 'correct' },
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
/** An answer the account dataset records itself. */
const own = (n: number, extra: Partial<AnswerRecord> = {}) => answer(n, { answer_id: `ans-a${n}`, session_id: 'ses-acct', ...extra });
const SNAPSHOT_MARKER = 'LOCAL-ONLY-SNAPSHOT-7f3a';
const snapshot = (index: number) => ({ session_id: 'ses-acct', index, marker: SNAPSHOT_MARKER });

/** Stored by another build: spacing, escapes and a field this build does not know (integers only, so the reference applies). */
const SPACED_ANSWER = `{"future_field": "caf${BS}u00e9 ${BS}/ v0",${JSON.stringify(answer(1), null, 1).slice(1)}`;
/** A four-choice timed check whose own payload carries its exposure provenance. */
const CHECK_ANSWER = JSON.stringify(
  answer(2, {
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    lineage: 'A:sentence:check-2',
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
const SNAPSHOT_RAW = JSON.stringify({ version: 2, session_id: 'ses-guest', index: 3, phase: 'step', marker: SNAPSHOT_MARKER });
const GUEST_META: Record<string, string> = {
  screen_views: JSON.stringify([{ screen_id: 'DEMO-S4', local_date: '2026-10-18', source: 'guide', at: '2026-10-18T01:30:00.000Z' }]),
  snapshot_archive: JSON.stringify([{ archived_at: '2026-10-18T00:50:00.000Z', reason: 'format-change-v1', raw: SNAPSHOT_RAW }]),
  pending_notice: 'format-change',
};
/** The guest dataset as an earlier build left it in web storage. */
const GUEST_BLOB = `{"schema":2,"meta":${JSON.stringify(GUEST_META)},"learner":${JSON.stringify(GUEST_LEARNER)},"answers":[${SPACED_ANSWER},${CHECK_ANSWER}],"snapshot":${JSON.stringify(SNAPSHOT_RAW)},"reports":[]}`;

/** Envelope v1 around an answer's exact text, as another device would send it. */
function envelopeAround(payload: string, installId: string): string {
  const p = JSON.parse(payload) as AnswerRecord;
  return (
    `{"envelope_version":1,"event_id":${JSON.stringify(p.answer_id)},"kind":"answer","schema":"expo.answer_record","schema_version":${p.answer_schema ?? 1},` +
    `"curriculum":{"family":"expo-trial-arabic","track":"arab","content_version":${JSON.stringify(p.content_version)},"rules_version":${JSON.stringify(p.rules_version)}},` +
    `"source":{"app":"expo","install_id":${JSON.stringify(installId)},"app_version":"0.2.0","local_profile_id":${JSON.stringify(p.learner_id)}},"payload":${payload}}`
  );
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function until(ready: () => boolean) {
  for (let i = 0; i < 100 && !ready(); i++) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(ready()).toBe(true);
}

/** Resolves like `p`, or fails clearly when `p` is still waiting after 2 s (e.g. held behind a network wait). */
async function within<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`still waiting after 2 s: ${what}`)), 2000)))]);
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a JSON document holds `needle` as one of its string values; the journal's own layout is not assumed. */
function holdsString(doc: string, needle: string): boolean {
  const walk = (v: unknown): boolean =>
    typeof v === 'string' ? v === needle : Array.isArray(v) ? v.some(walk) : typeof v === 'object' && v !== null ? Object.values(v).some(walk) : false;
  try {
    return walk(JSON.parse(doc));
  } catch {
    return doc.includes(needle);
  }
}

/** The journal document storage, watched: every text saved, and a failure injected into the next save. */
function watched(storage: JournalStorage) {
  const saved: string[] = [];
  let failNext = false;
  const wrapped: JournalStorage = {
    load: () => storage.load(),
    save: async (text) => {
      if (failNext) {
        failNext = false;
        throw new Error('simulated journal storage failure');
      }
      await storage.save(text);
      saved.push(text);
    },
  };
  return { storage: wrapped, saved, failNextSave: () => void (failNext = true) };
}

/** The learning store, except that the next saveLearner fails as if the app stopped right there. */
function failingSaveLearner(store: Store): Store {
  let failed = false;
  return new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'saveLearner' && !failed) {
        return async () => {
          failed = true;
          throw new Error('simulated stop before the learner record was saved');
        };
      }
      const value = Reflect.get(target, prop, receiver) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Signs `user` in through the app's own emulator sign-in, session and API adapter, on the fake network. */
async function connect(api: FakeAccountApi, user: FakeUser): Promise<SyncConnection> {
  const auth = createEmulatorAuth({ config: CONFIG, fetch: api.fetch, now: () => NOW });
  const client = createApiClient({ baseUrl: CONFIG.apiBaseUrl, fetch: api.fetch });
  const session = createAccountSession({ auth, api: client });
  await auth.signIn(user.email, user.password);
  await session.verify();
  return { auth, session, api: client };
}

const isImport = (r: SentRequest) => r.method === 'POST' && r.path === '/v1/imports';
const isUpload = (r: SentRequest) => r.method === 'POST' && /^\/v1\/profiles\/[^/]+\/events$/.test(r.path);
const isPull = (r: SentRequest) => r.method === 'GET' && /^\/v1\/profiles\/[^/]+\/events$/.test(r.path);
const isPatch = (r: SentRequest) => r.method === 'PATCH';
const writes = (api: FakeAccountApi) => api.sent.filter((r) => r.method !== 'GET');
const ids = (body: string) => (JSON.parse(body) as { events: { event_id: string }[] }).events.map((e) => e.event_id);

interface Harness {
  /** Opens account A's dataset as its owner, with the guest data copied in (after its own learner, when asked). */
  open(options?: { accountLearnerFirst?: boolean }): Promise<JournalDataset>;
  /** Closes and reopens the dataset: a fresh read of what was stored, as after an app restart. */
  reopen(): Promise<JournalDataset>;
  /** Every stored value (all keys, or all tables of both databases) as text. */
  everything(): string;
  cleanup(): void;
}

function webHarness(): Harness {
  const data = new Map<string, string>();
  const kv: KvBackend = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
  const locks: LockManagerLike = { request: (_name, _options, cb) => Promise.resolve(cb({})) };
  const namespace = accountNamespace(ACCOUNT_A);
  let opened: OpenedKvDataset | null = null;
  const dataset = (o: OpenedKvDataset): JournalDataset => ({ store: o.store, raw: o.raw, journal: o.journal });
  return {
    async open({ accountLearnerFirst = false } = {}) {
      kv.setItem(GUEST_NAMESPACE.kvKey, GUEST_BLOB);
      opened = await openKvDataset({ kv, locks, namespace });
      if (accountLearnerFirst) await opened.store.saveLearner(ACCOUNT_LEARNER);
      await copyGuestToAccount({ from: kvRawSource(kv, GUEST_NAMESPACE), to: opened.raw, consent: COPY_CONSENT });
      return dataset(opened);
    },
    async reopen() {
      opened?.release();
      await settle();
      opened = await openKvDataset({ kv, locks, namespace });
      return dataset(opened);
    },
    everything: () => JSON.stringify([...data.entries()]),
    cleanup: () => opened?.release(),
  };
}

function nativeHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'aya-journal-'));
  const namespace = accountNamespace(ACCOUNT_A);
  const handles: NodeSqliteDb[] = [];
  let guest: NodeSqliteDb | null = null;
  let account: NodeSqliteDb | null = null;
  const open = (file: string) => {
    const db = openNodeSqlite(join(dir, file));
    handles.push(db);
    return db;
  };
  const dump = (db: NodeSqliteDb) =>
    (db.raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as unknown as { name: string }[])
      .map(({ name }) => `${name}:${JSON.stringify(db.raw.prepare(`SELECT * FROM "${name}"`).all())}`)
      .join('\n');
  return {
    async open({ accountLearnerFirst = false } = {}) {
      guest = open(GUEST_NAMESPACE.sqliteFile);
      await new SqlStore(guest).init(); // the tables, exactly as the app creates them
      const r = guest.raw;
      r.prepare('INSERT INTO learner (id, json) VALUES (1, ?)').run(JSON.stringify(GUEST_LEARNER));
      for (const json of [SPACED_ANSWER, CHECK_ANSWER]) {
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
      account = open(namespace.sqliteFile);
      const d = await openSqlDataset(account, namespace);
      if (accountLearnerFirst) await d.store.saveLearner(ACCOUNT_LEARNER);
      await copyGuestToAccount({ from: sqlRawSource(guest, GUEST_NAMESPACE), to: d.raw, consent: COPY_CONSENT });
      return d;
    },
    async reopen() {
      account?.close();
      account = open(namespace.sqliteFile);
      return openSqlDataset(account, namespace);
    },
    everything: () =>
      [guest, account]
        .filter((db): db is NodeSqliteDb => db !== null)
        .map(dump)
        .join('\n'),
    cleanup: () => {
      for (const db of handles) {
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

describe.each([
  { name: 'web (KvStore, Web Locks)', make: webHarness },
  { name: 'native (SqlStore over node:sqlite)', make: nativeHarness },
])('sync journal over the $name account dataset', ({ make }) => {
  let h: Harness;
  beforeEach(() => {
    h = make();
  });
  afterEach(() => h.cleanup());

  it('captures saved answers as immutable envelopes, saves the frozen import before sending it, sends nothing when storage fails and never holds the learning store while waiting', async () => {
    const d = await h.open();
    const api = fakeAccountApi([ANI]);
    const conn = await connect(api, ANI);
    const w = watched(d.journal);
    const journal = await openJournal({ dataset: { ...d, journal: w.storage }, accountId: ACCOUNT_A, appVersion: APP_VERSION, limits: { importEvents: 2, batchEvents: 1 } });

    // An answer the store saved but the journal never queued (the app stopped in between) is picked up by reconcile.
    await d.store.recordAnswer(own(5), snapshot(5));
    expect(await journal.reconcile()).toBe(3);
    expect(await journal.reconcile()).toBe(0);
    const raw = (await d.raw.readRaw())!;
    const view = journal.view();
    expect(view.installId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    expect(view.originals.map((o) => o.eventId)).toEqual(raw.answers.map((a) => a.id));
    for (const a of raw.answers) {
      const o = view.originals.find((x) => x.eventId === a.id)!;
      const payload = JSON.parse(a.json) as AnswerRecord;
      // The stored text itself is the payload, byte for byte; the envelope repeats the record's own claims.
      expect(o.envelope.includes(`"payload":${a.json}`)).toBe(true);
      expect(JSON.parse(o.envelope)).toEqual({
        envelope_version: 1,
        event_id: a.id,
        kind: 'answer',
        schema: 'expo.answer_record',
        schema_version: payload.answer_schema ?? 1,
        curriculum: { family: 'expo-trial-arabic', track: 'arab', content_version: payload.content_version, rules_version: payload.rules_version },
        source: { app: 'expo', install_id: view.installId, app_version: APP_VERSION, local_profile_id: payload.learner_id },
        payload,
      });
      expect(o).toMatchObject({ learnerId: payload.learner_id, semanticSha256: referenceSemanticSha256(o.envelope), acked: false, blocked: null });
    }

    // Storage fails while the import would be frozen: nothing is sent and nothing changes.
    w.failNextSave();
    await expect(journal.sync(conn, NEW_PROFILE)).rejects.toThrow('simulated journal storage failure');
    expect(writes(api)).toEqual([]);
    expect(journal.view()).toEqual(view);

    // The import is saved, exactly as sent, before it leaves; while it waits, the store and the journal keep working.
    let frozenBeforeSending = false;
    api.hooks.beforeImport = (body) => {
      frozenBeforeSending = w.saved.some((doc) => holdsString(doc, body));
    };
    const gate = api.hold('import');
    const syncing = journal.sync(conn, NEW_PROFILE);
    await until(() => api.sent.some(isImport));
    await within(d.store.recordAnswer(own(6), snapshot(6)), 'saving an answer while the import waits');
    expect(await within(journal.reconcile(), 'reconciling while the import waits')).toBe(1);
    gate.release();
    const report = await syncing;

    expect(frozenBeforeSending).toBe(true);
    const imports = api.sent.filter(isImport);
    expect(imports).toHaveLength(1);
    // Within the import limit (2 here) the oldest originals of that moment; the rest go up once the link is saved.
    expect(ids(imports[0].body)).toEqual(['ans-g1', 'ans-g2']);
    for (const o of view.originals.slice(0, 2)) expect(imports[0].body.includes(o.envelope)).toBe(true);
    const envelopeOf = (id: string) => journal.view().originals.find((o) => o.eventId === id)!.envelope;
    expect(api.sent.filter(isUpload).map((r) => r.body)).toEqual([`{"events":[${envelopeOf('ans-a5')}]}`, `{"events":[${envelopeOf('ans-a6')}]}`]);
    expect(report).toMatchObject({ linked: ['lrn-guest-1'], replayed: false, stored: 4, identical: 0, conflicts: [], pending: 0 });
    expect(journal.view().originals.every((o) => o.acked)).toBe(true);
    const profile = api.profileOf(ACCOUNT_A)!;
    expect(journal.view().profileId).toBe(profile.profileId);
    for (const a of (await d.raw.readRaw())!.answers) expect(profile.events.find((e) => e.eventId === a.id)!.payload).toBe(a.json);
  });

  it('retries a lost import byte for byte after a reopen and offline changes, acknowledges only a verified receipt, then uploads later answers and preferences separately; conflicts stay pending', async () => {
    let d = await h.open();
    const api = fakeAccountApi([ANI]);
    const conn = await connect(api, ANI);
    let journal = await openJournal({ dataset: d, accountId: ACCOUNT_A, appVersion: APP_VERSION });
    await journal.reconcile();

    // The server commits the import, but its response is lost.
    api.loseNext('import');
    await expect(journal.sync(conn, NEW_PROFILE)).rejects.toMatchObject({ code: 'network' });
    expect(api.committedImports(ACCOUNT_A)).toBe(1);
    const frozen = api.sent.filter(isImport)[0].body;
    const importId = (JSON.parse(frozen) as { import_id: string }).import_id;
    expect(importId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
    expect(ids(frozen)).toEqual(['ans-g1', 'ans-g2']);

    // Reopened and offline: a new answer (which also moves the session snapshot), a preference, a newer consent.
    d = await h.reopen();
    journal = await openJournal({ dataset: d, accountId: ACCOUNT_A, appVersion: APP_VERSION });
    expect(journal.view()).toMatchObject({ profileId: null, sources: [{ learnerId: 'lrn-guest-1', importId, frozen, linked: false }] });
    api.setOffline(true);
    await d.store.recordAnswer(own(7), snapshot(7));
    await journal.reconcile();
    await journal.setPreference('session_minutes', 25);
    await expect(journal.sync(conn, NEW_PROFILE_LATER)).rejects.toMatchObject({ code: 'network' });
    api.setOffline(false);
    expect(api.sent.filter(isImport).map((r) => r.body)).toEqual([frozen, frozen]);

    // Receipts that do not answer the frozen request acknowledge, link and upload nothing.
    const tampered: [string, (r: Record<string, unknown>) => Record<string, unknown>][] = [
      ['another import ID', (r) => ({ ...r, import_id: 'imp-someone-else' })],
      ['counts that leave an event out', (r) => ({ ...r, stored: Number(r.stored) - 1 })],
      ['a checksum over other IDs', (r) => ({ ...r, event_ids_sha256: referenceIdsChecksum(['ans-g1']) })],
      ['a replay that claims a first commit', (r) => ({ ...r, replayed: false })],
    ];
    for (const [what, rewrite] of tampered) {
      api.rewriteNextReceipt(rewrite);
      await expect(journal.sync(conn, NEW_PROFILE_LATER)).rejects.toMatchObject({ code: 'unverified_receipt' });
      expect({ what, body: api.sent.filter(isImport).at(-1)!.body }).toEqual({ what, body: frozen });
      expect({ what, uploads: api.sent.filter(isUpload).length, profile: journal.view().profileId, acked: journal.view().originals.filter((o) => o.acked).length }).toEqual({
        what,
        uploads: 0,
        profile: null,
        acked: 0,
      });
    }

    // The verified replay links; the later answer follows in its own upload; the preference goes out on its own.
    const report = await journal.sync(conn, NEW_PROFILE_LATER);
    expect(report).toMatchObject({ linked: ['lrn-guest-1'], replayed: true, conflicts: [], pending: 0 });
    expect(api.sent.filter(isImport).every((r) => r.body === frozen)).toBe(true);
    expect(api.sent.filter(isUpload).map((r) => ids(r.body))).toEqual([['ans-a7']]);
    const profile = api.profileOf(ACCOUNT_A)!;
    // Created as frozen: the consent and settings of that moment, never the later ones.
    expect(profile.consent).toEqual(PROFILE_CONSENT);
    expect(profile.settings).toEqual({ session_minutes: 20, arabic_scale: 1.3 });
    expect(await journal.pushPreferences(conn)).toBe('sent');
    const [patch] = api.sent.filter(isPatch);
    expect(patch).toMatchObject({ path: `/v1/profiles/${profile.profileId}`, headers: { 'if-match': '"r1"', 'content-type': 'application/merge-patch+json' } });
    expect(JSON.parse(patch.body)).toEqual({ settings: { session_minutes: 25 } });

    // An answer whose server copy differs stays pending with its original kept.
    await d.store.recordAnswer(own(8), snapshot(8));
    await journal.reconcile();
    api.seedEvent(profile.profileId, envelopeAround(JSON.stringify(own(8, { outcome: 'wrong', auto_score: { answer: 'wrong' } })), 'inst-other-device'));
    expect(await journal.sync(conn, null)).toMatchObject({ conflicts: ['ans-a8'], pending: 1 });
    const a8 = journal.view().originals.find((o) => o.eventId === 'ans-a8')!;
    expect(a8.acked).toBe(false);
    expect(journal.view().conflicts).toEqual(['ans-a8']);
    // Upload results that do not answer every event acknowledge nothing.
    await d.store.recordAnswer(own(9), snapshot(9));
    await journal.reconcile();
    api.rewriteNextResults((results) => results.slice(1));
    await expect(journal.sync(conn, null)).rejects.toMatchObject({ code: 'bad_response' });
    expect(journal.view().originals.find((o) => o.eventId === 'ans-a9')!.acked).toBe(false);
    expect(journal.view().originals.map((o) => o.eventId)).toEqual(['ans-g1', 'ans-g2', 'ans-a7', 'ans-a8', 'ans-a9']);
    expect(journal.view().originals.find((o) => o.eventId === 'ans-a8')!.envelope).toBe(a8.envelope);
  });

  it('links each local learner with its own import and never rewrites learner IDs; a foreign profile, another account or a sign-out stops sending and drops late results', async () => {
    const d = await h.open({ accountLearnerFirst: true });
    await d.store.recordAnswer(own(5, { learner_id: ACCOUNT_LEARNER.learner_id }), snapshot(5));
    const api = fakeAccountApi([ANI, BUDI]);
    const ani = await connect(api, ANI);
    const journal = await openJournal({ dataset: d, accountId: ACCOUNT_A, appVersion: APP_VERSION });
    expect(await journal.reconcile()).toBe(3);

    // A profile the account does not own, or another signed-in account: refused before anything is sent.
    await expect(journal.sync(ani, { kind: 'own-profile', profileId: '5d3c2b1a-0f9e-4d8c-b7a6-958473625140' })).rejects.toMatchObject({ code: 'not_own_profile' });
    const budi = await connect(api, BUDI);
    await expect(journal.sync(budi, NEW_PROFILE)).rejects.toMatchObject({ code: 'account_mismatch' });
    expect(writes(api)).toEqual([]);

    // One import per local learner: the copied guest answers keep the guest learner, the account learner's its own.
    const report = await journal.sync(ani, NEW_PROFILE);
    const pid = api.profileOf(ACCOUNT_A)!.profileId;
    const bodies = api.sent.filter(isImport).map((r) => r.body);
    type ImportBody = { source: { local_profile_id: string }; target: { profile_id?: string; new_profile?: unknown }; events: { source: { local_profile_id: string }; payload: { learner_id: string } }[] };
    const imports = bodies.map((b) => JSON.parse(b) as ImportBody);
    expect(imports.map((b) => b.source.local_profile_id).sort()).toEqual(['lrn-acct-a', 'lrn-guest-1']);
    expect(imports.filter((b) => b.target.new_profile !== undefined)).toHaveLength(1);
    expect(imports.filter((b) => b.target.profile_id === pid)).toHaveLength(1);
    for (const b of imports) for (const e of b.events) expect([e.source.local_profile_id, e.payload.learner_id]).toEqual([b.source.local_profile_id, b.source.local_profile_id]);
    for (const a of (await d.raw.readRaw())!.answers) {
      const carrying = bodies.filter((b) => b.includes(`"payload":${a.json}`));
      expect(carrying).toHaveLength(1);
      expect((JSON.parse(carrying[0]) as ImportBody).source.local_profile_id).toBe((JSON.parse(a.json) as AnswerRecord).learner_id);
    }
    expect([...report.linked].sort()).toEqual(['lrn-acct-a', 'lrn-guest-1']);
    expect(journal.view().profileId).toBe(pid);
    expect((await d.store.getLearner())!.learner_id).toBe(ACCOUNT_LEARNER.learner_id);

    // Signed out while an upload waits: its late result is dropped, and nothing more is sent.
    await d.store.recordAnswer(own(6, { learner_id: ACCOUNT_LEARNER.learner_id }), snapshot(6));
    await journal.reconcile();
    const gate = api.hold('events');
    const syncing = journal.sync(ani, null);
    await until(() => api.sent.some(isUpload));
    ani.auth.signOut();
    gate.release();
    await expect(syncing).rejects.toMatchObject({ code: 'signed_out' });
    expect(journal.view().originals.find((o) => o.eventId === 'ans-a6')!.acked).toBe(false);
    const count = api.sent.length;
    await expect(journal.sync(ani, null)).rejects.toMatchObject({ code: 'account_mismatch' });
    expect(api.sent).toHaveLength(count);
    // Signed in again: the server had stored it, so the retry is acknowledged as identical.
    await ani.auth.signIn(ANI.email, ANI.password);
    await ani.session.verify();
    expect(await journal.sync(ani, null)).toMatchObject({ identical: 1, pending: 0 });
  });

  it('pulls only the Expo family page by page with exact payload text and its next_after cursor; nothing pulled reaches the learning store; account progress stays factual', async () => {
    const d = await h.open();
    const api = fakeAccountApi([ANI], { pageSize: 2 });
    const conn = await connect(api, ANI);
    let journal = await openJournal({ dataset: d, accountId: ACCOUNT_A, appVersion: APP_VERSION });
    await journal.reconcile();
    await journal.sync(conn, NEW_PROFILE);
    // The device's own answers come back in its family's pages but stay originals, never remote answers.
    expect(journal.view()).toMatchObject({ remote: [], cursor: 2 });
    const pid = api.profileOf(ACCOUNT_A)!.profileId;

    // Another install adds three answers (one with spacing and an escape, one whose synthetic flag is not a boolean);
    // an Android device then adds one of its own family, which raises high_seq but is never pulled.
    const other = { learner_id: 'lrn-other-1' };
    const remotePayloads = [
      `{"note": "caf${BS}u00e9",${JSON.stringify(answer(1, { ...other, answer_id: 'ans-r1' }), null, 2).slice(1)}`,
      JSON.stringify(answer(2, { ...other, answer_id: 'ans-r2', synthetic: 'yes' as unknown as boolean })),
      JSON.stringify(answer(3, { ...other, answer_id: 'ans-r3' })),
    ];
    const seqs = remotePayloads.map((p) => api.seedEvent(pid, envelopeAround(p, 'inst-other-device')));
    api.seedEvent(pid, readFileSync(join(__dirname, '..', '..', '..', 'test', 'fixtures', 'envelopes', 'kotlin-v1-arab-type-in-hinted.envelope.json'), 'utf8').trim());
    const learningBefore = { answers: await d.store.listAnswers(), snapshot: await d.store.loadSnapshotRaw(), views: await d.store.getMeta('screen_views') };

    // The second page of the next pull claims high_seq as its cursor: refused, and only the first page is kept.
    api.corruptPullPage(2);
    await expect(journal.sync(conn, null)).rejects.toMatchObject({ code: 'bad_response' });
    const d2 = await h.reopen();
    journal = await openJournal({ dataset: d2, accountId: ACCOUNT_A, appVersion: APP_VERSION });
    expect(journal.view().remote.map((r) => r.eventId)).toEqual(['ans-r1', 'ans-r2']);
    expect(journal.view().cursor).toBe(seqs[1]);

    // The next sync continues from the saved cursor; the cursor follows next_after, never high_seq.
    expect((await journal.sync(conn, null)).pulled).toBe(1);
    const pulls = api.sent.filter(isPull).map((r) => new URLSearchParams(r.query));
    expect(pulls.every((q) => q.get('family') === 'expo-trial-arabic')).toBe(true);
    expect(pulls.at(-1)!.get('after')).toBe(String(seqs[1]));
    expect(journal.view().cursor).toBe(seqs[2]);
    expect(api.profileOf(ACCOUNT_A)!.events.length).toBeGreaterThan(seqs[2]);
    expect(journal.view().remote).toEqual(
      remotePayloads.map((payload, i) => ({ seq: seqs[i], eventId: `ans-r${i + 1}`, installId: 'inst-other-device', learnerId: 'lrn-other-1', payload }))
    );
    // Nothing pulled reached the learning store, its session snapshot or its exposure ledger.
    expect({ answers: await d2.store.listAnswers(), snapshot: await d2.store.loadSnapshotRaw(), views: await d2.store.getMeta('screen_views') }).toEqual(learningBefore);

    // The account's factual counts as the server states them: nothing inferred, unknown kept apart from false.
    expect(await journal.readProgress(conn)).toEqual({
      profileId: pid,
      family: 'expo-trial-arabic',
      asOfSeq: api.profileOf(ACCOUNT_A)!.events.length,
      events: 5,
      excludedUnregistered: 0,
      learned: 'not_assessed_by_server',
      retention: 'not_assessed_by_server',
      provenance: {
        synthetic: { true: 4, false: 0, absent: 0, unknown: 1 },
        feedbackDeferred: { true: 1, false: 0, absent: 4, unknown: 0 },
        hintUsed: { true: 0, false: 5, absent: 0, unknown: 0 },
        retentionValidFalse: 1,
      },
    });
  });

  it('pushes only changed supported preferences with If-Match; a stale base waits for an explicit choice; intent survives a stop; nothing secret or local-only is stored or sent', async () => {
    const logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    try {
      let d = await h.open();
      const api = fakeAccountApi([ANI]);
      const conn = await connect(api, ANI);
      let journal = await openJournal({ dataset: d, accountId: ACCOUNT_A, appVersion: APP_VERSION });
      await journal.reconcile();
      await journal.sync(conn, NEW_PROFILE);
      const pid = api.profileOf(ACCOUNT_A)!.profileId;
      // A new profile carries only the supported settings of the learner at that moment.
      expect((JSON.parse(api.sent.filter(isImport)[0].body) as { target: unknown }).target).toEqual({
        new_profile: { kind: 'adult', settings: { session_minutes: 20, arabic_scale: 1.3 }, consent: PROFILE_CONSENT },
      });
      expect(journal.view().base).toEqual({ revision: 1, settings: { session_minutes: 20, arabic_scale: 1.3 } });
      expect(await journal.pushPreferences(conn)).toBe('nothing');
      expect(api.sent.filter(isPatch)).toEqual([]);

      // Another device sets a setting this app does not edit; then this device changes its session length.
      api.patchFromOtherDevice(pid, { instruction_lang: 'en' });
      await journal.setPreference('session_minutes', 30);
      expect((await d.store.getLearner())!.session_minutes).toBe(30);
      expect(await journal.pushPreferences(conn)).toBe('conflict');
      expect(journal.view()).toMatchObject({
        base: { revision: 1 },
        changed: { session_minutes: 30 },
        preferenceConflict: { revision: 2, settings: { instruction_lang: 'en', session_minutes: 20, arabic_scale: 1.3 } },
      });
      // No silent retry or merge: until the learner chooses, nothing more is sent.
      expect(await journal.pushPreferences(conn)).toBe('conflict');
      expect(api.sent.filter(isPatch).map((r) => r.headers['if-match'])).toEqual(['"r1"']);

      // Keep this device's value: only the changed member goes out against the new revision; the other setting survives.
      await journal.resolvePreferences('keep-local');
      expect(await journal.pushPreferences(conn)).toBe('sent');
      const kept = api.sent.filter(isPatch).at(-1)!;
      expect([kept.headers['if-match'], JSON.parse(kept.body)]).toEqual(['"r2"', { settings: { session_minutes: 30 } }]);
      expect(api.profileOf(ACCOUNT_A)!.settings).toEqual({ instruction_lang: 'en', session_minutes: 30, arabic_scale: 1.3 });
      expect(journal.view()).toMatchObject({ base: { revision: 3 }, changed: {}, preferenceConflict: null });

      // Take the account's value: the learner record follows it, and nothing is sent.
      api.patchFromOtherDevice(pid, { arabic_scale: 1.6 });
      await journal.setPreference('arabic_scale', 1);
      expect(await journal.pushPreferences(conn)).toBe('conflict');
      await journal.resolvePreferences('use-server');
      expect((await d.store.getLearner())!.arabic_scale).toBe(1.6);
      const patches = api.sent.filter(isPatch).length;
      expect(await journal.pushPreferences(conn)).toBe('nothing');
      expect(api.sent.filter(isPatch)).toHaveLength(patches);

      // A stop between saving the intent and saving the learner record loses nothing: reopening restores both.
      const stopping = await openJournal({ dataset: { ...d, store: failingSaveLearner(d.store) }, accountId: ACCOUNT_A, appVersion: APP_VERSION });
      await expect(stopping.setPreference('session_minutes', 45)).rejects.toThrow('simulated stop');
      d = await h.reopen();
      journal = await openJournal({ dataset: d, accountId: ACCOUNT_A, appVersion: APP_VERSION });
      expect(journal.view().changed).toEqual({ session_minutes: 45 });
      expect((await d.store.getLearner())!.session_minutes).toBe(45);
      expect(await journal.pushPreferences(conn)).toBe('sent');
      expect(JSON.parse(api.sent.filter(isPatch).at(-1)!.body)).toEqual({ settings: { session_minutes: 45 } });

      // Nothing secret or local-only is stored or sent; answer provenance stays inside its own payload.
      const stored = h.everything();
      for (const secret of [ANI.token, ANI.password, ANI.email, `refresh-${ANI.uid}`, 'Bearer ']) expect(stored).not.toContain(secret);
      const bodies = api.sent.map((r) => r.body).join('\n');
      for (const local of [SNAPSHOT_MARKER, 'screen_views', 'snapshot_archive']) expect(bodies).not.toContain(local);
      expect(api.sent.filter(isImport)[0].body.includes(`"payload":${CHECK_ANSWER}`)).toBe(true);
      expect(CHECK_ANSWER).toContain('"exposure":["guide:DEMO-S4"]');
      expect(api.sent.every((r) => r.bearer && !/token/i.test(r.query))).toBe(true);
      expect(logs.map((s) => s.mock.calls.length)).toEqual([0, 0, 0, 0, 0]);
    } finally {
      logs.forEach((s) => s.mockRestore());
    }
  });
});
