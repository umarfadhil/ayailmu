/**
 * @jest-environment node
 */
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { KvStore, memoryKv } from '@/storage/kvStore';
import { SqlStore } from '@/storage/sqlStore';
import type { AnswerRecord, Learner, Store } from '@/storage/types';
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
});
