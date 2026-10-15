/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { KvStore, memoryKv } from '@/storage/kvStore';
import { SqlStore } from '@/storage/sqlStore';
import type { AnswerRecord, Learner, ReportRecord, Store } from '@/storage/types';
import { openNodeSqlite, type NodeSqliteDb } from '../../../test/nodeSqliteDb';

const learner: Learner = {
  learner_id: 'lrn-test-1',
  created_at: '2026-10-15T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-15T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
};

function answer(n: number, extra: Partial<AnswerRecord> = {}): AnswerRecord {
  return {
    answer_id: `ans-${n}`,
    learner_id: learner.learner_id,
    item_id: `DEMO-M0${n}`,
    content_version: 'demo-synthetic-0.1',
    rules_version: 'pilot-0.1-local',
    app_version: '0.1.0',
    timestamp: `2026-10-15T01:0${n}:00.000Z`,
    local_date: '2026-10-15',
    session_id: 'ses-1',
    pool: 'PRACT',
    unit: 'A',
    skills: ['LEX-A:W-A3'],
    raw_response: JSON.stringify({ kind: 'typed', text: `jawaban ${n}` }),
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

const snapshot = (index: number) => ({
  session_id: 'ses-1',
  content_version: 'demo-synthetic-0.1',
  index,
  phase: 'step',
});

type Opened = {
  store: Store;
  reopen: () => Promise<Store>;
  /** Test-only: damage the stored snapshot through the underlying adapter. */
  corruptSnapshot: () => void;
  /** Test-only: make the next snapshot write fail inside the atomic save. */
  failNextSnapshotWrite: () => void;
  /** Test-only: mark the stored data as written by a future, unsupported app version. */
  setFutureSchema: () => void;
  /** Test-only: the raw persisted bytes, to prove nothing was overwritten. */
  rawDump: () => string;
  /** Test-only: replace stored data with what the v1 app wrote (no schema marker, v1 snapshot). */
  seedLegacyV1: (d: { learner: Learner; answers: AnswerRecord[]; snapshot: object; reports: ReportRecord[] }) => void;
  cleanup: () => void;
};
type Factory = { name: string; open: () => Promise<Opened> };

const factories: Factory[] = [
  {
    name: 'SqlStore (SQLite via node:sqlite, same SQL as expo-sqlite)',
    open: async () => {
      const dir = mkdtempSync(join(tmpdir(), 'arabic-trial-'));
      const file = join(dir, 'trial.db');
      const handles: NodeSqliteDb[] = [];
      let failSnapshot = false;
      const make = async () => {
        const db = openNodeSqlite(file, {
          beforeRun: (sql) => {
            if (failSnapshot && /INTO snapshot/i.test(sql)) {
              failSnapshot = false;
              throw new Error('simulated disk failure');
            }
          },
        });
        handles.push(db);
        const s = new SqlStore(db);
        await s.init();
        return s;
      };
      const store = await make();
      return {
        store,
        reopen: make,
        corruptSnapshot: () => handles[0].raw.exec(`UPDATE snapshot SET json = '{not json' WHERE id = 1`),
        failNextSnapshotWrite: () => {
          failSnapshot = true;
        },
        setFutureSchema: () => handles[0].raw.exec(`UPDATE meta SET value = '99' WHERE key = 'schema_version'`),
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
        seedLegacyV1: (d) => {
          const r = handles[0].raw;
          r.exec(`DELETE FROM learner; DELETE FROM answers; DELETE FROM snapshot; DELETE FROM reports; DELETE FROM meta;`);
          r.prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', '1')`).run();
          r.prepare('INSERT INTO learner (id, json) VALUES (1, ?)').run(JSON.stringify(d.learner));
          for (const a of d.answers) {
            r.prepare(
              'INSERT INTO answers (answer_id, learner_id, item_id, session_id, timestamp, outcome, json) VALUES (?, ?, ?, ?, ?, ?, ?)'
            ).run(a.answer_id, a.learner_id, a.item_id, a.session_id, a.timestamp, a.outcome, JSON.stringify(a));
          }
          r.prepare('INSERT INTO snapshot (id, json) VALUES (1, ?)').run(JSON.stringify(d.snapshot));
          for (const rep of d.reports) r.prepare('INSERT INTO reports (report_id, json) VALUES (?, ?)').run(rep.report_id, JSON.stringify(rep));
        },
        cleanup: () => {
          handles.forEach((h) => h.close());
          rmSync(dir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: 'KvStore (web preview)',
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
        corruptSnapshot: () => {
          const key = KvStore.KEY;
          const blob = JSON.parse(kv.getItem(key)!);
          blob.snapshot = '{not json';
          kv.setItem(key, JSON.stringify(blob));
        },
        failNextSnapshotWrite: () => {
          failWrite = true;
        },
        setFutureSchema: () => {
          const blob = JSON.parse(kv.getItem(KvStore.KEY) ?? '{}');
          blob.schema = 99;
          kv.setItem(KvStore.KEY, JSON.stringify(blob));
        },
        rawDump: () => kv.getItem(KvStore.KEY) ?? '',
        seedLegacyV1: (d) =>
          kv.setItem(
            KvStore.KEY,
            JSON.stringify({ learner: d.learner, answers: d.answers, snapshot: JSON.stringify(d.snapshot), reports: d.reports })
          ),
        cleanup: () => undefined,
      };
    },
  },
];

describe.each(factories)('$name', ({ open }) => {
  let ctx: Opened;
  beforeEach(async () => {
    ctx = await open();
  });
  afterEach(() => ctx.cleanup());

  it('starts empty', async () => {
    expect(await ctx.store.getLearner()).toBeNull();
    expect(await ctx.store.listAnswers()).toEqual([]);
    expect(await ctx.store.loadSnapshot()).toBeNull();
  });

  it('persists learner, answers (all spec §10 fields) and snapshot across a restart', async () => {
    await ctx.store.saveLearner(learner);
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    await ctx.store.recordAnswer(answer(2, { outcome: 'pending', auto_score: { meaning: 'pending' } }), snapshot(2));

    const restarted = await ctx.reopen();
    expect(await restarted.getLearner()).toEqual(learner);
    const answers = await restarted.listAnswers();
    expect(answers).toEqual([answer(1), answer(2, { outcome: 'pending', auto_score: { meaning: 'pending' } })]);
    expect(await restarted.loadSnapshot()).toEqual(snapshot(2));
  });

  it('keeps raw typed text exactly as typed', async () => {
    const raw = JSON.stringify({ kind: 'typed', text: '  Dia  orangnya JUJUR!! ' });
    await ctx.store.recordAnswer(answer(1, { raw_response: raw }), snapshot(1));
    const [a] = await (await ctx.reopen()).listAnswers();
    expect(a.raw_response).toBe(raw);
  });

  it('a corrupt snapshot is dropped without losing answers', async () => {
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    ctx.corruptSnapshot();
    const restarted = await ctx.reopen();
    expect(await restarted.loadSnapshot()).toBeNull();
    expect((await restarted.listAnswers()).length).toBe(1);
  });

  it('a failed atomic save rolls back: neither the answer nor the snapshot is half-written', async () => {
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    ctx.failNextSnapshotWrite();
    await expect(ctx.store.recordAnswer(answer(2), snapshot(2))).rejects.toThrow(/simulated/);
    const restarted = await ctx.reopen();
    expect((await restarted.listAnswers()).map((a) => a.answer_id)).toEqual(['ans-1']);
    expect(await restarted.loadSnapshot()).toEqual(snapshot(1));
    // and the store keeps working afterwards
    await restarted.recordAnswer(answer(2), snapshot(2));
    expect((await restarted.listAnswers()).length).toBe(2);
  });

  // Regression from independent review: concurrent writes must not drop events.
  it('concurrent answer writes keep every event', async () => {
    await Promise.all([ctx.store.recordAnswer(answer(1), snapshot(1)), ctx.store.recordAnswer(answer(2), snapshot(2))]);
    const restarted = await ctx.reopen();
    expect((await restarted.listAnswers()).map((a) => a.answer_id).sort()).toEqual(['ans-1', 'ans-2']);
  });

  it('a concurrent answer and report both persist', async () => {
    await Promise.all([
      ctx.store.recordAnswer(answer(1), snapshot(1)),
      ctx.store.addReport({
        report_id: 'rep-x',
        learner_id: learner.learner_id,
        item_id: 'DEMO-P01',
        content_version: 'demo-synthetic-0.1',
        timestamp: '2026-10-15T01:00:00.000Z',
        reason: 'Lainnya',
        text: '',
      }),
      ctx.store.saveLearner(learner),
    ]);
    const restarted = await ctx.reopen();
    expect((await restarted.listAnswers()).map((a) => a.answer_id)).toEqual(['ans-1']);
    expect((await restarted.listReports()).map((r) => r.report_id)).toEqual(['rep-x']);
    expect(await restarted.getLearner()).toEqual(learner);
  });

  it('concurrent duplicate writes of the same answer store it once', async () => {
    await Promise.all([ctx.store.recordAnswer(answer(1), snapshot(1)), ctx.store.recordAnswer(answer(1), snapshot(1))]);
    expect((await (await ctx.reopen()).listAnswers()).length).toBe(1);
  });

  it('answer IDs are unique: a replayed write does not duplicate the log', async () => {
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    expect((await ctx.store.listAnswers()).length).toBe(1);
  });

  it('stores «Laporkan soal» reports', async () => {
    await ctx.store.addReport({
      report_id: 'rep-1',
      learner_id: learner.learner_id,
      item_id: 'DEMO-P01',
      content_version: 'demo-synthetic-0.1',
      timestamp: '2026-10-15T01:00:00.000Z',
      reason: 'Arab salah',
      text: 'harakat?',
    });
    expect((await (await ctx.reopen()).listReports()).map((r) => r.report_id)).toEqual(['rep-1']);
  });

  it('reset clears everything', async () => {
    await ctx.store.saveLearner(learner);
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    await ctx.store.reset();
    const restarted = await ctx.reopen();
    expect(await restarted.getLearner()).toBeNull();
    expect(await restarted.listAnswers()).toEqual([]);
    expect(await restarted.loadSnapshot()).toBeNull();
  });

  // ---- four-choice slice: metadata, atomic archive, future-schema refusal, idempotent replay ----
  it('metadata persists across a restart', async () => {
    expect(await ctx.store.getMeta('x')).toBeNull();
    await ctx.store.setMeta('x', 'hello');
    expect(await (await ctx.reopen()).getMeta('x')).toBe('hello');
  });

  it('archiveSnapshot atomically keeps the exact old snapshot and installs the replacement', async () => {
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    const replacement = { ...snapshot(0), session_id: 'ses-2', version: 2 };
    expect(await ctx.store.archiveSnapshot('format-change-v1', replacement, 'format-change')).toBe(true);
    const restarted = await ctx.reopen();
    expect(await restarted.loadSnapshot()).toEqual(replacement);
    const archive = JSON.parse((await restarted.getMeta('snapshot_archive'))!);
    expect(archive).toHaveLength(1);
    expect(archive[0].reason).toBe('format-change-v1');
    expect(JSON.parse(archive[0].raw)).toEqual(snapshot(1));
    expect(await restarted.getMeta('pending_notice')).toBe('format-change');
    expect(await restarted.listAnswers()).toEqual([answer(1)]);
  });

  it('archives an unreadable snapshot byte-for-byte', async () => {
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    ctx.corruptSnapshot();
    const restarted = await ctx.reopen();
    expect(await restarted.loadSnapshotRaw()).toBe('{not json');
    await restarted.archiveSnapshot('unreadable-snapshot', null);
    const archive = JSON.parse((await restarted.getMeta('snapshot_archive'))!);
    expect(archive[0].raw).toBe('{not json');
    expect(await restarted.loadSnapshotRaw()).toBeNull();
  });

  it('a failed archive leaves the previous saved state intact (rollback)', async () => {
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    const before = ctx.rawDump();
    ctx.failNextSnapshotWrite();
    await expect(ctx.store.archiveSnapshot('format-change-v1', snapshot(9))).rejects.toThrow(/simulated/);
    expect(ctx.rawDump()).toBe(before);
    const restarted = await ctx.reopen();
    expect(await restarted.loadSnapshot()).toEqual(snapshot(1));
    expect(await restarted.getMeta('snapshot_archive')).toBeNull();
  });

  it('a replayed duplicate answer never rewinds a newer snapshot', async () => {
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    await ctx.store.recordAnswer(answer(2), snapshot(2));
    await ctx.store.recordAnswer(answer(1), snapshot(1)); // replay of an old event
    const restarted = await ctx.reopen();
    expect(await restarted.loadSnapshot()).toEqual(snapshot(2));
    expect((await restarted.listAnswers()).map((a) => a.answer_id)).toEqual(['ans-1', 'ans-2']);
  });

  it('refuses data written by an unsupported future version without overwriting it', async () => {
    await ctx.store.saveLearner(learner);
    await ctx.store.recordAnswer(answer(1), snapshot(1));
    ctx.setFutureSchema();
    const before = ctx.rawDump();
    await expect(ctx.reopen()).rejects.toThrow(/unsupported/i);
    expect(ctx.rawDump()).toBe(before);
  });

  it('reads realistic v1 data unchanged: raw answers, scores, learner, settings, reports', async () => {
    const legacyTyped = answer(1, {
      item_id: 'DEMO-P01',
      skills: ['NOM-01', 'LEX-P3'],
      raw_response: JSON.stringify({ kind: 'typed', text: '  Dia BERIMAN!! ', ref: 'perempuan' }),
      auto_score: { who: 'correct', description: 'correct', describes: 'correct' },
    });
    const legacyPending = answer(2, {
      item_id: 'DEMO-M02',
      raw_response: JSON.stringify({ kind: 'typed', text: 'alim' }),
      auto_score: { meaning: 'pending' },
      outcome: 'pending',
    });
    const report: ReportRecord = {
      report_id: 'rep-v1',
      learner_id: learner.learner_id,
      item_id: 'DEMO-P01',
      content_version: 'demo-synthetic-0.1',
      timestamp: '2026-10-15T01:00:00.000Z',
      reason: 'Lainnya',
      text: 'x',
    };
    const settings = { ...learner, session_minutes: 20, arabic_scale: 1.3, screens_seen: ['DEMO-S1', 'DEMO-S2', 'DEMO-S3'] };
    const v1snap = { version: 1, session_id: 'ses-1', content_version: 'demo-synthetic-0.1', index: 4, phase: 'step', queue: [] };
    ctx.seedLegacyV1({ learner: settings, answers: [legacyTyped, legacyPending], snapshot: v1snap, reports: [report] });
    const restarted = await ctx.reopen();
    expect(await restarted.listAnswers()).toEqual([legacyTyped, legacyPending]);
    expect(await restarted.getLearner()).toEqual(settings);
    expect(await restarted.listReports()).toEqual([report]);
    expect(await restarted.loadSnapshot()).toEqual(v1snap);
  });

  it('review schedule and progress are rebuilt identically by replay after reopening', async () => {
    const { reviewStates } = jest.requireActual('@/engine/reviews');
    const { progress } = jest.requireActual('@/engine/progress');
    const { gateContent } = jest.requireActual('@/content/gating');
    const { activePack } = jest.requireActual('@/content/load');
    const { loadRules } = jest.requireActual('@/config/rules');
    const content = gateContent(activePack, 'developer-demo');
    const rules = loadRules('developer-demo');
    const v2 = (n: number, item_id: string, local_date: string, role: string) =>
      answer(n, {
        answer_id: `v2-${n}`,
        item_id,
        local_date,
        timestamp: `${local_date}T02:00:0${n}.000Z`,
        role: role as AnswerRecord['role'],
        pool: role === 'review' ? 'REVIEW' : 'PRACT',
        lineage: content.items.find((i: { item_id: string }) => i.item_id === item_id).lineage,
        evidence_mode: 'recognition-4',
        answer_schema: 2,
      });
    await ctx.store.recordAnswer(v2(1, 'A2-M01', '2027-01-01', 'practice'), snapshot(1));
    await ctx.store.recordAnswer(v2(2, 'A2-M01', '2027-01-02', 'review'), snapshot(2));
    const before = await ctx.store.listAnswers();
    const restarted = await ctx.reopen();
    const after = await restarted.listAnswers();
    expect([...reviewStates(after, content, rules).values()]).toEqual([...reviewStates(before, content, rules).values()]);
    expect(reviewStates(after, content, rules).get('word:W-A3')).toMatchObject({ level: 1, due: '2027-01-05' });
    expect(progress(after, content, rules, '2027-01-03', [])).toEqual(progress(before, content, rules, '2027-01-03', []));
  });

  it('REV-1: a malformed current snapshot is archived as unreadable and atomically replaced by a new session', async () => {
    const { prepareSession } = jest.requireActual('@/engine/controller');
    const { startSession } = jest.requireActual('@/engine/session');
    const { gateContent } = jest.requireActual('@/content/gating');
    const { activePack } = jest.requireActual('@/content/load');
    const { loadRules } = jest.requireActual('@/config/rules');
    const content = gateContent(activePack, 'developer-demo');
    const rules = loadRules('developer-demo');
    await ctx.store.saveLearner(learner);
    const now = new Date('2026-10-16T09:00:00+07:00').getTime();
    const good = startSession({ content, rules, history: [], learnerId: learner.learner_id, now, budgetMinutes: 15, screensSeen: [], appVersion: '0.2.0', rng: () => 0 });
    const broken = { ...good, index: 999 };
    await ctx.store.saveSnapshot(broken);
    const r = await prepareSession({ store: ctx.store, content, rules, now, appVersion: '0.2.0', rng: () => 0 });
    expect(r.kind).toBe('new');
    const restarted = await ctx.reopen();
    const archive = JSON.parse((await restarted.getMeta('snapshot_archive'))!);
    expect(archive[0].reason).toBe('unreadable-snapshot');
    expect(JSON.parse(archive[0].raw)).toEqual(broken);
    expect(await restarted.loadSnapshot()).toEqual(r.state);
    expect(await restarted.getMeta('pending_notice')).toBe('snapshot-unreadable');
  });
});
