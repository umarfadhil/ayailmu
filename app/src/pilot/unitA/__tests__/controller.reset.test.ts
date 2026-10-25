/**
 * @jest-environment node
 */
// Unit A pilot controller vs. store reset: the pilot document's read/modify/write must be one operation on the
// store's own write queue (the planned optional Store.updateMeta), so a reset can never be followed by an old
// controller writing its document back. Real KvStore (memory backend) and real SqlStore (in-memory Node SQLite),
// synthetic data only, no mocks. Local engineering only — not device behaviour or any backend.
import { KvStore, memoryKv } from '@/storage/kvStore';
import { SqlStore } from '@/storage/sqlStore';
import type { Learner, Store } from '@/storage/types';
import { openNodeSqlite } from '../../../../test/nodeSqliteDb';
import { PILOT_CONTENT } from '../content';
import { createPilotController, PILOT_META_KEY, type PilotView } from '../controller';

type Options = Parameters<typeof createPilotController>[0];
type Controller = ReturnType<typeof createPilotController>;
type Question = Extract<PilotView, { kind: 'question' }>;
/** Planned additive Store API: the transform runs on the store's write queue; only a changed result is written. */
type UpdateMeta = (key: string, transform: (raw: string | null) => Promise<string | null>) => Promise<void>;
type MetaStore = Store & { updateMeta?: UpdateMeta };

interface Harness {
  store: MetaStore;
  /** Metadata as a freshly opened store over the same backend sees it. */
  persisted(key: string): Promise<string | null>;
  reopen(): Promise<Store>;
  close(): void;
}

const DAY = '2026-01-01';
const OWNER = 'pilot-test-owner';
const OWNER_B = 'pilot-test-owner-b';
const LEARNER: Learner = {
  learner_id: 'synthetic-reset-learner',
  created_at: '2026-01-01T00:00:00.000Z',
  consent_version: 'synthetic',
  consent_at: '2026-01-01T00:00:00.000Z',
  age_confirmed: true,
  session_minutes: 10,
  arabic_scale: 1,
  screens_seen: [],
};

const ADAPTERS: [string, () => Promise<Harness>][] = [
  ['KvStore', async () => {
    const kv = memoryKv();
    const store = new KvStore(kv);
    await store.init();
    const reopen = async () => {
      const fresh = new KvStore(kv);
      await fresh.init();
      return fresh;
    };
    return { store, reopen, persisted: async (key) => (await reopen()).getMeta(key), close: () => {} };
  }],
  ['SqlStore', async () => {
    const db = openNodeSqlite(':memory:');
    try {
      const store = new SqlStore(db);
      await store.init();
      // Reads go straight to the database; no init, so the probe writes nothing.
      const reopen = async () => new SqlStore(db);
      return { store, reopen, persisted: async (key) => (await reopen()).getMeta(key), close: () => db.close() };
    } catch (e) {
      db.close();
      throw e;
    }
  }],
];

const make = (store: Store, over: Partial<Options> = {}): Controller =>
  createPilotController({
    store, owner: OWNER, mode: 'developer-demo', today: () => DAY, readOnly: () => false,
    active: () => true, assistedToday: async () => false, random: Math.random, ...over,
  });

function item(id: string) {
  const found = PILOT_CONTENT.items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown item ${id}`);
  return found;
}
const optionWhere = (q: Question, correct: boolean) => item(q.itemId).options.find((o) => o.correct === correct)?.id ?? '';

async function firstQuestion(c: Controller): Promise<Question> {
  let view = await c.load();
  for (let step = 0; view.kind === 'lesson' && step < 3; step += 1) view = await c.next();
  expect(view.kind).toBe('question');
  return view as Question;
}

async function expectRefused(pending: Promise<PilotView>): Promise<void> {
  const view = await pending.catch(() => null);
  expect(view?.kind ?? 'rejected').toMatch(/^(blocked|rejected)$/);
}

function updateMetaOf(store: MetaStore): UpdateMeta {
  expect(typeof store.updateMeta).toBe('function');
  return (store.updateMeta as UpdateMeta).bind(store);
}

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function within<T>(pending: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${what} did not settle (deadlock?)`)), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe.each(ADAPTERS)('Unit A pilot vs. reset over a real %s', (_, open) => {
  it('an answer racing a reset leaves no pilot metadata, learner or progress behind', async () => {
    const h = await open();
    try {
      const { store } = h;
      const c = make(store);
      const q = await firstQuestion(c);
      await store.saveLearner(LEARNER);
      await store.setMeta('legacy_sentinel', 'keep-me');
      expect(JSON.parse((await h.persisted(PILOT_META_KEY)) ?? 'null')?.current?.presentationId).toBe(q.presentationId);

      const answered = c.answer(q.presentationId, optionWhere(q, true));
      const reset = store.reset();
      const [a, r] = await Promise.allSettled([answered, reset]);
      expect(r.status).toBe('fulfilled');
      // Reset may win (blocked or rejected) or lose (feedback, then wiped); either way nothing survives it.
      expect(['feedback', 'blocked', 'rejected']).toContain(a.status === 'fulfilled' ? a.value.kind : 'rejected');
      await turn();

      const fresh = await h.reopen();
      expect(await fresh.getMeta(PILOT_META_KEY)).toBeNull();
      expect(await fresh.getMeta('legacy_sentinel')).toBeNull();
      expect(await fresh.getLearner()).toBeNull();
      expect(await store.getMeta(PILOT_META_KEY)).toBeNull();
    } finally {
      h.close();
    }
  });

  it('after a reset the old controller cannot recreate its document; a new owner starts and keeps its own', async () => {
    const h = await open();
    try {
      const { store } = h;
      const a = make(store, { active: () => true });
      const qa = await firstQuestion(a);
      await store.reset();

      await expectRefused(a.load());
      await expectRefused(a.next());
      expect(await h.persisted(PILOT_META_KEY)).toBeNull();

      const b = make(store, { owner: OWNER_B, active: () => true });
      const qb = await firstQuestion(b);
      expect(qb.presentationId).not.toBe(qa.presentationId);
      const docB = await h.persisted(PILOT_META_KEY);
      expect(JSON.parse(docB ?? 'null')).toMatchObject({ owner: OWNER_B, attempts: [], current: { presentationId: qb.presentationId } });

      await expectRefused(a.load());
      await expectRefused(a.next());
      await expectRefused(a.answer(qa.presentationId, optionWhere(qa, true)));
      expect(await h.persisted(PILOT_META_KEY)).toBe(docB);
    } finally {
      h.close();
    }
  });

  it('updateMeta holds the write queue across its async transform, which may read the same store', async () => {
    const h = await open();
    let release = () => {};
    try {
      const { store } = h;
      await store.setMeta(PILOT_META_KEY, 'before');
      await store.setMeta('unrelated', 'u');
      const update = updateMetaOf(store);
      const hold = new Promise<void>((resolve) => (release = resolve));
      let markRead = () => {};
      const read = new Promise<void>((resolve) => (markRead = resolve));
      const seen: unknown[] = [];

      const updated = update(PILOT_META_KEY, async (raw) => {
        seen.push(raw, await store.getMeta(PILOT_META_KEY), (await store.listAnswers()).length);
        markRead();
        await hold;
        return 'after';
      });
      await within(read, 'reads inside the transform');

      let resetDone = false;
      const reset = store.reset().then(() => {
        resetDone = true;
      });
      for (let i = 0; i < 3; i += 1) await turn();
      expect(resetDone).toBe(false);
      expect(await h.persisted(PILOT_META_KEY)).toBe('before');
      expect(await h.persisted('unrelated')).toBe('u');

      release();
      await within(Promise.all([updated, reset]), 'update and reset');
      expect(seen).toEqual(['before', 'before', 0]);
      expect(await h.persisted(PILOT_META_KEY)).toBeNull();
      expect(await h.persisted('unrelated')).toBeNull();
      expect(await store.getMeta(PILOT_META_KEY)).toBeNull();
    } finally {
      release();
      h.close();
    }
  });

  it('a throwing transform changes nothing and leaves the queue usable', async () => {
    const h = await open();
    try {
      const { store } = h;
      await store.setMeta(PILOT_META_KEY, 'prior');
      await store.setMeta('unrelated', 'keep');
      const update = updateMetaOf(store);

      await expect(
        within(update(PILOT_META_KEY, async () => {
          await turn();
          throw new Error('transform failed');
        }), 'failing update'),
      ).rejects.toThrow('transform failed');
      expect(await h.persisted(PILOT_META_KEY)).toBe('prior');
      expect(await h.persisted('unrelated')).toBe('keep');
      expect(await store.getMeta(PILOT_META_KEY)).toBe('prior');

      await within(store.setMeta('unrelated', 'next'), 'next setMeta');
      expect(await h.persisted('unrelated')).toBe('next');
      await within(update(PILOT_META_KEY, async (raw) => `${raw}+1`), 'next update');
      expect(await h.persisted(PILOT_META_KEY)).toBe('prior+1');
    } finally {
      h.close();
    }
  });
});
