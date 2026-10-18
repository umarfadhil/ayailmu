// ENG-R01: two browser tabs must not overwrite each other's answers, settings or reports.
import { KvStore, memoryKv } from '@/storage/kvStore';
import type { AnswerRecord, Learner, ReportRecord } from '@/storage/types';
import { bindPageLifecycle, openWebStore, type LockManagerLike, type PageLifecycleTarget } from '@/storage/webStore';

/** In-memory model of navigator.locks with exclusive locks, ifAvailable and FIFO waiting (shared by "tabs"). */
function fakeLocks(): LockManagerLike & { held: () => boolean } {
  let holder: object | null = null;
  const waiting: (() => void)[] = [];
  const grant = () => {
    if (holder || !waiting.length) return;
    waiting.shift()!();
  };
  return {
    held: () => !!holder,
    async request(_name, options, cb) {
      if (options.ifAvailable && holder) return cb(null);
      if (holder) await new Promise<void>((r) => waiting.push(r));
      const lock = {};
      holder = lock;
      try {
        return await cb(lock);
      } finally {
        holder = null;
        grant();
      }
    },
  };
}

const learner: Learner = {
  learner_id: 'lrn',
  created_at: '2026-10-16T00:00:00.000Z',
  consent_version: 'c',
  consent_at: '2026-10-16T00:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
};
const answer = (id: string): AnswerRecord =>
  ({
    answer_id: id,
    learner_id: 'lrn',
    item_id: 'A3-M01',
    timestamp: '2026-10-16T02:00:00.000Z',
    local_date: '2026-10-16',
    pool: 'PRACT',
    unit: 'A',
    skills: ['LEX-A:W-A3'],
    outcome: 'correct',
    raw_response: '{}',
  }) as AnswerRecord;
const report = (id: string): ReportRecord => ({ report_id: id, learner_id: 'lrn', item_id: 'A3-M01', content_version: 'v', timestamp: 't', reason: 'r', text: '' });

describe('web single-writer boundary (Web Locks)', () => {
  it('a second tab is read-only: its writes are refused and the owner’s data is intact', async () => {
    const kv = memoryKv();
    const locks = fakeLocks();
    const a = await openWebStore({ kv, locks });
    const b = await openWebStore({ kv, locks });
    expect(a.access).toBe('owner');
    expect(b.access).toBe('read-only');
    await a.store.saveLearner(learner);
    await a.store.recordAnswer(answer('tab-a'), { version: 2 });
    await expect(b.store.recordAnswer(answer('tab-b'), { version: 2 })).rejects.toThrow(/read-only|another tab/i);
    await expect(b.store.saveLearner({ ...learner, session_minutes: 20 })).rejects.toThrow(/read-only|another tab/i);
    await expect(b.store.addReport(report('rb'))).rejects.toThrow(/read-only|another tab/i);
    const fresh = new KvStore(kv);
    await fresh.init();
    expect((await fresh.listAnswers()).map((x) => x.answer_id)).toEqual(['tab-a']);
    expect((await fresh.getLearner())!.session_minutes).toBe(15);
  });

  it('the waiting tab takes over only after the owner closes, re-reads storage, and both tabs’ answers survive', async () => {
    const kv = memoryKv();
    const locks = fakeLocks();
    const a = await openWebStore({ kv, locks });
    const b = await openWebStore({ kv, locks });
    let taken = false;
    const takeover = b.whenWritable!().then((s) => {
      taken = true;
      return s;
    });
    await a.store.recordAnswer(answer('tab-a'), null);
    await Promise.resolve();
    expect(taken).toBe(false); // never steals an active owner
    a.release();
    const bWritable = await takeover;
    expect((await bWritable.listAnswers()).map((x) => x.answer_id)).toEqual(['tab-a']); // fresh read, not a stale cache
    await bWritable.recordAnswer(answer('tab-b'), null);
    await bWritable.addReport(report('rb'));
    const fresh = new KvStore(kv);
    await fresh.init();
    expect((await fresh.listAnswers()).map((x) => x.answer_id)).toEqual(['tab-a', 'tab-b']);
    expect((await fresh.listReports()).map((r) => r.report_id)).toEqual(['rb']);
  });

  it('without the Web Locks API the store is read-only (no unsafe concurrent writing)', async () => {
    const kv = memoryKv();
    const opened = await openWebStore({ kv, locks: undefined });
    expect(opened.access).toBe('read-only');
    expect(opened.reason).toMatch(/locks/i);
    await expect(opened.store.saveLearner(learner)).rejects.toThrow(/read-only/i);
    expect(kv.getItem(KvStore.KEY)).toBeNull();
  });

  it('releasing ownership revokes the old writable store: writes queued before release land, later ones are refused', async () => {
    const kv = memoryKv();
    const locks = fakeLocks();
    const a = await openWebStore({ kv, locks });
    const queued = a.store.recordAnswer(answer('before-release'), null);
    a.release();
    await queued;
    await expect(a.store.recordAnswer(answer('after-release'), null)).rejects.toThrow(/read-only/i);
    await expect(a.store.reset()).rejects.toThrow(/read-only/i);
    const b = await openWebStore({ kv, locks });
    expect(b.access).toBe('owner');
    expect((await b.store.listAnswers()).map((x) => x.answer_id)).toEqual(['before-release']);
  });

  it('a taken-over store is revoked too when that tab releases', async () => {
    const kv = memoryKv();
    const locks = fakeLocks();
    const a = await openWebStore({ kv, locks });
    const b = await openWebStore({ kv, locks });
    const pending = b.whenWritable!();
    a.release();
    const bw = await pending;
    b.release();
    await expect(bw.recordAnswer(answer('late'), null)).rejects.toThrow(/read-only/i);
  });

  it('pagehide (reload, close, back/forward cache) hands the lock over; a restored page cannot keep writing and reloads', async () => {
    const kv = memoryKv();
    const locks = fakeLocks();
    const listeners = new Map<string, ((e: { persisted?: boolean }) => void)[]>();
    const win: PageLifecycleTarget = {
      addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: () => undefined,
    };
    const fire = (type: string, persisted: boolean) => (listeners.get(type) ?? []).forEach((fn) => fn({ persisted }));
    const reload = jest.fn();
    const a = await openWebStore({ kv, locks });
    await a.store.saveLearner(learner);
    // the open session's checkpoint is queued before the revocation, so it is saved
    bindPageLifecycle(a, win, reload, () => void a.store.saveSnapshot({ checkpoint: true } as never));
    const b = await openWebStore({ kv, locks });
    const takeover = b.whenWritable!();
    fire('pagehide', true); // page enters the back/forward cache
    const bw = await takeover;
    expect(await bw.loadSnapshot()).toEqual({ checkpoint: true }); // A's checkpoint landed before its revocation
    await bw.recordAnswer(answer('tab-b'), null);
    fire('pageshow', true); // restored from the cache while tab B owns the lock
    await expect(a.store.recordAnswer(answer('stale-a'), null)).rejects.toThrow(/read-only/i);
    expect(reload).toHaveBeenCalledTimes(1); // the restored page re-opens through the normal (read-only) path
    const fresh = new KvStore(kv);
    await fresh.init();
    expect((await fresh.listAnswers()).map((x) => x.answer_id)).toEqual(['tab-b']);
  });

  it('pagehide while a checkpoint waits for an in-flight answer save: the checkpoint lands, then the lock is released', async () => {
    const kv = memoryKv();
    const locks = fakeLocks();
    const listeners = new Map<string, ((e: { persisted?: boolean }) => void)[]>();
    const win: PageLifecycleTarget = {
      addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
      removeEventListener: () => undefined,
    };
    const a = await openWebStore({ kv, locks });
    await a.store.saveLearner(learner);
    let finishSave: () => void = () => undefined;
    const inFlight = new Promise<void>((r) => (finishSave = r));
    // the checkpoint can only be computed once the pending answer save settles
    bindPageLifecycle(a, win, () => undefined, () => inFlight.then(() => a.store.saveSnapshot({ checkpoint: 'late' } as never)));
    const b = await openWebStore({ kv, locks });
    let taken = false;
    const takeover = b.whenWritable!().then((s) => ((taken = true), s));
    (listeners.get('pagehide') ?? []).forEach((fn) => fn({ persisted: false }));
    await Promise.resolve();
    expect(taken).toBe(false); // not released before the checkpoint
    finishSave();
    const bw = await takeover;
    expect(await bw.loadSnapshot()).toEqual({ checkpoint: 'late' });
    await expect(a.store.saveSnapshot(null)).rejects.toThrow(/read-only/i);
  });
});
