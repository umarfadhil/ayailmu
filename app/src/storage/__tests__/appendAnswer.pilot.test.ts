/**
 * @jest-environment node
 */
// Contract for the optional Store.appendAnswer(record, guard): one truthful pilot answer appended atomically, only
// while the learner, liveness and exact pilot metadata bytes still hold inside the writer queue (and, on SQLite,
// immediately before commit). The snapshot's exact raw bytes, every metadata key and every report are kept.
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { KvStore, memoryKv } from '@/storage/kvStore';
import type { SqlDb } from '@/storage/sqlDb';
import { SqlStore } from '@/storage/sqlStore';
import type { AnswerRecord, Learner, ReportRecord, Store } from '@/storage/types';
import { openNodeSqlite, type NodeSqliteDb } from '../../../test/nodeSqliteDb';

interface AppendGuard {
  metaKey: string;
  expectedRaw: string;
  learnerId: string;
  active: () => boolean;
}
type AppendingStore = Store & { appendAnswer?: (record: AnswerRecord, guard: AppendGuard) => Promise<void> };

/** Calls the optional method; a store without it fails here, clearly, instead of passing a refusal check. */
function appendAnswer(store: Store, record: AnswerRecord, guard: AppendGuard): Promise<void> {
  const method = (store as AppendingStore).appendAnswer;
  if (typeof method !== 'function') throw new Error('Store.appendAnswer is not implemented by this store.');
  return method.call(store, record, guard);
}

const LEARNER_ID = 'lrn-pilot-synthetic-1';
const OTHER_LEARNER_ID = 'lrn-pilot-synthetic-2';
const META_KEY = 'pilot.synthetic.unit_a';
const META_RAW = '{"v":1,"learner":"lrn-pilot-synthetic-1", "block":"SYN-1","day":"2026-10-27"}';
/** Same JSON value as META_RAW, different bytes: must not match. */
const META_RAW_RESPACED = '{"v":1,"learner":"lrn-pilot-synthetic-1","block":"SYN-1","day":"2026-10-27"}';
const STALE_RAW = '{"v":1,"learner":"lrn-pilot-synthetic-1", "block":"SYN-2","day":"2026-10-27"}';
const OTHER_KEY = 'synthetic.other';
const OTHER_RAW = '{ "kept" : true }';
/** Valid JSON whose bytes a re-serialization would change (spacing, key order, escape). */
const SNAPSHOT_RAW = '{ "session_id":"pilot-ses-1", "phase" : "step",\n  "index": 3, "note":"\\u00e9" }';

const learner: Learner = {
  learner_id: LEARNER_ID,
  created_at: '2026-10-27T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-27T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
};

const report: ReportRecord = {
  report_id: 'pilot-rep-1',
  learner_id: LEARNER_ID,
  item_id: 'SYN-A-00',
  content_version: 'synthetic-pilot-0.1',
  timestamp: '2026-10-27T01:30:00.000Z',
  reason: 'Lainnya',
  text: 'synthetic',
};

/** A v2 recognition-4 answer with synthetic fixture fields. */
function pilotAnswer(n: number, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    answer_id: `pilot-ans-${n}`,
    learner_id: LEARNER_ID,
    item_id: `SYN-A-0${n}`,
    content_version: 'synthetic-pilot-0.1',
    rules_version: 'pilot-0.1-local',
    app_version: '0.1.0',
    timestamp: `2026-10-27T02:0${n}:00.000Z`,
    local_date: '2026-10-27',
    session_id: 'pilot-ses-1',
    pool: 'PRACT',
    unit: 'A',
    skills: ['LEX-A:W-SYN1'],
    raw_response: JSON.stringify({ kind: 'choice', option_id: 'opt-a' }),
    auto_score: { choice: 'correct' },
    outcome: 'correct',
    error_tags: [],
    serious_tag: null,
    hint_used: false,
    help_lines_shown: [],
    first_attempt: true,
    fresh_evidence: true,
    time_on_item_ms: 3100,
    audio_status: null,
    report_flag: false,
    review_status: 'draft',
    synthetic: true,
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    lineage: `syn-lineage-${n}`,
    role: 'practice',
    presented_options: [
      { id: 'opt-a', text: 'pilihan A', position: 0 },
      { id: 'opt-b', text: 'pilihan B', position: 1 },
      { id: 'opt-c', text: 'pilihan C', position: 2 },
      { id: 'opt-d', text: 'pilihan D', position: 3 },
    ],
    selected_option_id: 'opt-a',
    selected_position: 0,
    misconceptions: [],
    feedback_deferred: false,
    ...extra,
  };
}

const guard = (over: Partial<AppendGuard> = {}): AppendGuard => ({
  metaKey: META_KEY,
  expectedRaw: META_RAW,
  learnerId: LEARNER_ID,
  active: () => true,
  ...over,
});

type Opened = {
  store: Store;
  reopen: () => Promise<Store>;
  /** Test-only: the raw persisted bytes, to prove nothing was written. */
  rawDump: () => string;
  /** Test-only: replace the stored snapshot text byte-for-byte (takes effect for stores opened afterwards). */
  setRawSnapshot: (text: string) => void;
  /** Test-only: the next answer write fails (KV: the next setItem; SQLite: the next INSERT into answers). */
  failNextAnswerWrite: () => void;
  /** SQLite only: run `hook` as the next INSERT into answers starts, inside the open transaction. */
  onNextAnswerInsert?: (hook: () => void) => void;
  /** SQLite only: the next transaction fails after its body ran, just before COMMIT. */
  failNextCommit?: () => void;
  cleanup: () => void;
};
type Factory = { name: string; transactional: boolean; open: () => Promise<Opened> };

const factories: Factory[] = [
  {
    name: 'SqlStore (SQLite via node:sqlite)',
    transactional: true,
    open: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'arabic-append-'));
      const file = join(dir, 'trial.db');
      const handles: NodeSqliteDb[] = [];
      let failAnswer = false;
      let failCommit = false;
      let insertHook: (() => void) | null = null;
      const make = async () => {
        const db = openNodeSqlite(file, {
          beforeRun: (sql) => {
            if (!/INTO answers/i.test(sql)) return;
            const hook = insertHook;
            insertHook = null;
            hook?.();
            if (failAnswer) {
              failAnswer = false;
              throw new Error('simulated disk failure');
            }
          },
        });
        handles.push(db);
        const wrapped: SqlDb = {
          ...db,
          transaction: (fn) =>
            db.transaction(async () => {
              await fn();
              if (failCommit) {
                failCommit = false;
                throw new Error('simulated disk failure at commit');
              }
            }),
        };
        const s = new SqlStore(wrapped);
        await s.init();
        return s;
      };
      const store = await make();
      return {
        store,
        reopen: make,
        rawDump: () => {
          const r = handles[0].raw;
          const q = (sql: string) => JSON.stringify(r.prepare(sql).all());
          return [
            q('SELECT * FROM meta ORDER BY key'),
            q('SELECT * FROM learner'),
            q('SELECT * FROM answers ORDER BY seq'),
            q('SELECT * FROM snapshot'),
            q('SELECT * FROM reports'),
          ].join('\n');
        },
        setRawSnapshot: (text) => {
          handles[0].raw.prepare('INSERT OR REPLACE INTO snapshot (id, json) VALUES (1, ?)').run(text);
        },
        failNextAnswerWrite: () => {
          failAnswer = true;
        },
        onNextAnswerInsert: (hook) => {
          insertHook = hook;
        },
        failNextCommit: () => {
          failCommit = true;
        },
        cleanup: () => {
          handles.forEach((h) => h.close());
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: 'KvStore (memoryKv)',
    transactional: false,
    open: async () => {
      const kv = memoryKv();
      let failWrite = false;
      const guarded = {
        getItem: (k: string) => kv.getItem(k),
        removeItem: (k: string) => kv.removeItem(k),
        setItem: (k: string, v: string) => {
          if (failWrite) {
            failWrite = false;
            throw new Error('simulated quota failure');
          }
          kv.setItem(k, v);
        },
      };
      const make = async () => {
        const s = new KvStore(guarded);
        await s.init();
        return s;
      };
      return {
        store: await make(),
        reopen: make,
        rawDump: () => kv.getItem(KvStore.KEY) ?? '',
        setRawSnapshot: (text) => {
          const blob = JSON.parse(kv.getItem(KvStore.KEY)!);
          blob.snapshot = text;
          kv.setItem(KvStore.KEY, JSON.stringify(blob));
        },
        failNextAnswerWrite: () => {
          failWrite = true;
        },
        cleanup: () => undefined,
      };
    },
  },
];

async function readState(store: Store) {
  return {
    learner: await store.getLearner(),
    answers: await store.listAnswers(),
    snapshotRaw: await store.loadSnapshotRaw(),
    pilotMeta: await store.getMeta(META_KEY),
    otherMeta: await store.getMeta(OTHER_KEY),
    archive: await store.getMeta('snapshot_archive'),
    notice: await store.getMeta('pending_notice'),
    reports: await store.listReports(),
  };
}
type State = Awaited<ReturnType<typeof readState>>;

const EMPTY_STATE: State = {
  learner: null,
  answers: [],
  snapshotRaw: null,
  pilotMeta: null,
  otherMeta: null,
  archive: null,
  notice: null,
  reports: [],
};

/** Learner, one earlier answer, an archived snapshot + notice, a report, two metadata keys and exact snapshot bytes. */
async function seeded(ctx: Opened): Promise<Store> {
  const s = ctx.store;
  await s.saveLearner(learner);
  await s.recordAnswer(pilotAnswer(0), { session_id: 'pilot-ses-0', index: 0 });
  await s.archiveSnapshot('synthetic-format-change', { session_id: 'pilot-ses-1', index: 1 }, 'synthetic-notice');
  await s.addReport(report);
  await s.setMeta(OTHER_KEY, OTHER_RAW);
  await s.setMeta(META_KEY, META_RAW);
  ctx.setRawSnapshot(SNAPSHOT_RAW);
  const store = await ctx.reopen();
  expect(await store.loadSnapshotRaw()).toBe(SNAPSHOT_RAW);
  return store;
}

async function capture(ctx: Opened, store: Store) {
  return { dump: ctx.rawDump(), state: await readState(store) };
}

/** Nothing changed: same persisted bytes, same in-memory view, same view after reopening. */
async function expectUntouched(ctx: Opened, store: Store, before: { dump: string; state: State }) {
  expect(ctx.rawDump()).toBe(before.dump);
  expect(await readState(store)).toEqual(before.state);
  expect(await readState(await ctx.reopen())).toEqual(before.state);
}

async function expectRefused(p: Promise<unknown>, message?: RegExp) {
  const outcome = await p.then(
    () => ({ refused: false as const }),
    (error: unknown) => ({ refused: true as const, error })
  );
  if (!outcome.refused) throw new Error('appendAnswer resolved, but it had to refuse.');
  expect(outcome.error).toBeInstanceOf(Error);
  if (message) expect((outcome.error as Error).message).toMatch(message);
}

/** Holds the store's writer queue inside one updateMeta transform (never calling a writer from it). */
function holdWriter(store: Store, key: string, replacement?: string | null) {
  if (!store.updateMeta) throw new Error('Store.updateMeta is required for the writer barrier.');
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const inside = new Promise<void>((r) => (entered = r));
  const done = store.updateMeta(key, async (raw) => {
    entered();
    await gate;
    return replacement === undefined ? raw : replacement;
  });
  return { inside, release, done };
}

function track(p: Promise<unknown>) {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true)
  );
  return () => settled;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

describe.each(factories)('appendAnswer pilot contract — $name', ({ open, transactional }) => {
  let ctx: Opened;
  beforeEach(async () => {
    ctx = await open();
  });
  afterEach(() => ctx.cleanup());

  it('appends one truthful answer that survives reopening, keeping the snapshot bytes, metadata and reports', async () => {
    const store = await seeded(ctx);
    const before = await readState(store);
    const record = pilotAnswer(1);
    await appendAnswer(store, record, guard());
    const expected: State = { ...before, answers: [...before.answers, record] };
    expect(await readState(store)).toEqual(expected);
    const restarted = await ctx.reopen();
    expect(await readState(restarted)).toEqual(expected);
    expect(await restarted.loadSnapshotRaw()).toBe(SNAPSHOT_RAW);
    expect(await restarted.getMeta(META_KEY)).toBe(META_RAW);
  });

  it('a queued append lands after a held writer that changed nothing', async () => {
    const store = await seeded(ctx);
    const before = await readState(store);
    const barrier = holdWriter(store, META_KEY);
    await barrier.inside;
    const pending = appendAnswer(store, pilotAnswer(1), guard());
    const settled = track(pending);
    await tick();
    expect(settled()).toBe(false);
    barrier.release();
    await barrier.done;
    await pending;
    expect(await readState(await ctx.reopen())).toEqual({ ...before, answers: [...before.answers, pilotAnswer(1)] });
  });

  it('an identical duplicate (same answer_id and JSON) is stored once and writes nothing', async () => {
    const store = await seeded(ctx);
    const record = pilotAnswer(1);
    await appendAnswer(store, record, guard());
    const after = await capture(ctx, store);
    await appendAnswer(store, pilotAnswer(1), guard());
    await Promise.all([appendAnswer(store, record, guard()), appendAnswer(store, { ...record }, guard())]);
    await appendAnswer(store, pilotAnswer(0), guard()); // identical to the earlier recorded answer
    await expectUntouched(ctx, store, after);
    expect((await store.listAnswers()).filter((a) => a.answer_id === record.answer_id)).toHaveLength(1);
  });

  it('a conflicting duplicate answer_id is refused, never silently ignored, and changes nothing', async () => {
    const store = await seeded(ctx);
    await appendAnswer(store, pilotAnswer(1), guard());
    const after = await capture(ctx, store);
    const conflicting = pilotAnswer(1, {
      raw_response: JSON.stringify({ kind: 'choice', option_id: 'opt-b' }),
      selected_option_id: 'opt-b',
      selected_position: 1,
    });
    await expectRefused(appendAnswer(store, conflicting, guard()));
    await expectRefused(appendAnswer(store, pilotAnswer(0, { time_on_item_ms: 9999 }), guard()));
    await expectUntouched(ctx, store, after);
  });

  it('refuses a learner mismatch between record, guard and the stored learner', async () => {
    const store = await seeded(ctx);
    const before = await capture(ctx, store);
    await expectRefused(appendAnswer(store, pilotAnswer(1, { learner_id: OTHER_LEARNER_ID }), guard()));
    await expectRefused(appendAnswer(store, pilotAnswer(1), guard({ learnerId: OTHER_LEARNER_ID })));
    await expectRefused(
      appendAnswer(store, pilotAnswer(1, { learner_id: OTHER_LEARNER_ID }), guard({ learnerId: OTHER_LEARNER_ID }))
    );
    await expectUntouched(ctx, store, before);
  });

  it('refuses when no learner is stored', async () => {
    await ctx.store.setMeta(META_KEY, META_RAW);
    const before = await capture(ctx, ctx.store);
    await expectRefused(appendAnswer(ctx.store, pilotAnswer(1), guard()));
    await expectUntouched(ctx, ctx.store, before);
  });

  it('refuses stale or missing pilot metadata, compared by exact raw bytes', async () => {
    const store = await seeded(ctx);
    const before = await capture(ctx, store);
    await expectRefused(appendAnswer(store, pilotAnswer(1), guard({ expectedRaw: STALE_RAW })));
    await expectRefused(appendAnswer(store, pilotAnswer(1), guard({ expectedRaw: META_RAW_RESPACED })));
    await expectRefused(appendAnswer(store, pilotAnswer(1), guard({ metaKey: 'pilot.synthetic.absent' })));
    await expectRefused(appendAnswer(store, pilotAnswer(1), guard({ metaKey: 'pilot.synthetic.absent', expectedRaw: '' })));
    await expectUntouched(ctx, store, before);
  });

  it('refuses when the guard is inactive at call time', async () => {
    const store = await seeded(ctx);
    const before = await capture(ctx, store);
    let asked = 0;
    await expectRefused(
      appendAnswer(
        store,
        pilotAnswer(1),
        guard({
          active: () => {
            asked += 1;
            return false;
          },
        })
      )
    );
    expect(asked).toBeGreaterThan(0);
    await expectUntouched(ctx, store, before);
  });

  it('refuses when the guard turns inactive while the append waits in the writer queue', async () => {
    const store = await seeded(ctx);
    const before = await capture(ctx, store);
    let live = true;
    const barrier = holdWriter(store, META_KEY);
    await barrier.inside;
    const pending = appendAnswer(store, pilotAnswer(1), guard({ active: () => live }));
    const settled = track(pending);
    await tick();
    expect(settled()).toBe(false);
    live = false;
    barrier.release();
    await barrier.done;
    await expectRefused(pending);
    await expectUntouched(ctx, store, before);
  });

  it('refuses when the pilot metadata goes stale while the append waits in the writer queue', async () => {
    const store = await seeded(ctx);
    const before = await readState(store);
    const barrier = holdWriter(store, META_KEY, STALE_RAW);
    await barrier.inside;
    const pending = appendAnswer(store, pilotAnswer(1), guard());
    const settled = track(pending);
    await tick();
    expect(settled()).toBe(false);
    barrier.release();
    await barrier.done;
    await expectRefused(pending);
    const expected: State = { ...before, pilotMeta: STALE_RAW };
    expect(await readState(store)).toEqual(expected);
    expect(await readState(await ctx.reopen())).toEqual(expected);
  });

  it('a reset queued before the append is not undone: nothing is resurrected', async () => {
    const store = await seeded(ctx);
    const barrier = holdWriter(store, OTHER_KEY);
    await barrier.inside;
    const reset = store.reset();
    const pending = appendAnswer(store, pilotAnswer(1), guard());
    const settled = track(pending);
    await tick();
    expect(settled()).toBe(false);
    barrier.release();
    await barrier.done;
    await reset;
    await expectRefused(pending);
    expect(await readState(store)).toEqual(EMPTY_STATE);
    expect(await readState(await ctx.reopen())).toEqual(EMPTY_STATE);
  });

  it('a failed disk write leaves the exact snapshot, metadata and answers, and the store keeps working', async () => {
    const store = await seeded(ctx);
    const before = await capture(ctx, store);
    ctx.failNextAnswerWrite();
    await expectRefused(appendAnswer(store, pilotAnswer(1), guard()), /simulated/);
    await expectUntouched(ctx, store, before);
    await appendAnswer(store, pilotAnswer(1), guard());
    const restarted = await ctx.reopen();
    expect(await readState(restarted)).toEqual({ ...before.state, answers: [...before.state.answers, pilotAnswer(1)] });
  });

  (transactional ? it : it.skip)('SQLite: liveness lost during the answer INSERT rolls back before commit', async () => {
    const store = await seeded(ctx);
    const before = await capture(ctx, store);
    let live = true;
    ctx.onNextAnswerInsert!(() => {
      live = false;
    });
    await expectRefused(appendAnswer(store, pilotAnswer(1), guard({ active: () => live })));
    await expectUntouched(ctx, store, before);
  });

  (transactional ? it : it.skip)('SQLite: a failure at commit after the INSERT leaves no partial answer', async () => {
    const store = await seeded(ctx);
    const before = await capture(ctx, store);
    ctx.failNextCommit!();
    await expectRefused(appendAnswer(store, pilotAnswer(1), guard()), /simulated/);
    await expectUntouched(ctx, store, before);
  });
});
