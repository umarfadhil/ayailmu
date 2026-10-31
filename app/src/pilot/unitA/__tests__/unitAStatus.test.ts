// Unit A pure status read: unitAStatus(raw, owner, today) from the controller module reports whether a stored
// pilot document is this controller's own canonical, anchored Unit A state, through the same strict reading
// and the shared evaluator, without a store, a controller, the assistance check, randomness or any write:
//   { qualified: boolean, days: string[] } for a valid (or absent) document, null for anything the controller
//   would block on. Driven over a real KvStore on an isolated in-memory backend (no module mocks, injected day
//   and assistance). These prove local engineering only — not retention, mastery, pedagogy or any backend.
import { KvStore, memoryKv } from '@/storage/kvStore';
import { PILOT_CONTENT, type PilotItem } from '../content';
import * as pilot from '../controller';

type PilotView = pilot.PilotView;
type Controller = ReturnType<typeof pilot.createPilotController>;
type Question = Extract<PilotView, { kind: 'question' }>;
type Status = { qualified: boolean; days: string[] } | null;
type UnitAStatus = (raw: string | null, owner: string, today: string) => Status;
/** Mutable clock and assistance signal, with counters for every injected call. */
interface Session {
  day: string;
  assisted: boolean;
  assistedCalls: number;
  randomCalls: number;
}
interface Snapshot {
  raw: string | null;
  view: PilotView | null;
  day: string;
}

const JAN1 = '2026-01-01';
const JAN2 = '2026-01-02';
const JAN3 = '2026-01-03';
const JAN9 = '2026-01-09';
const OWNER = 'pilot-status-owner';
const OTHER = 'pilot-other-owner';
const D7_IDS = PILOT_CONTENT.items.filter((i) => i.phase === 'd7').map((i) => i.id);
/** Not local calendar days: 2026 is not a leap year, and only exact YYYY-MM-DD is a day. */
const BAD_DAYS = ['', 'today', '2026-02-29', '2026-13-01', '2026-01-32', '2026-1-03', ' 2026-01-03', '2026-01-03T00:00:00Z'];

/** The proposed export, looked up at run time so its absence fails an assertion rather than the import. */
function unitAStatus(): UnitAStatus {
  const fn: unknown = Reflect.get(pilot, 'unitAStatus');
  expect(typeof fn).toBe('function');
  return fn as UnitAStatus;
}

function backend() {
  const inner = memoryKv();
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    calls,
    blob: () => inner.getItem(KvStore.KEY),
    getItem: (k: string) => {
      calls.get += 1;
      return inner.getItem(k);
    },
    setItem: (k: string, v: string) => {
      calls.set += 1;
      inner.setItem(k, v);
    },
    removeItem: (k: string) => {
      calls.remove += 1;
      inner.removeItem(k);
    },
  };
}
type Kv = ReturnType<typeof backend>;

async function open(kv: Kv): Promise<KvStore> {
  const store = new KvStore(kv);
  await store.init();
  return store;
}
const rawOf = async (kv: Kv): Promise<string | null> => (await open(kv)).getMeta(pilot.PILOT_META_KEY);

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

function make(store: KvStore, s: Session): Controller {
  const random = seeded(13);
  return pilot.createPilotController({
    store, owner: OWNER, mode: 'developer-demo', today: () => s.day, readOnly: () => false, active: () => true,
    assistedToday: async () => {
      s.assistedCalls += 1;
      return s.assisted;
    },
    random: () => {
      s.randomCalls += 1;
      return random();
    },
  });
}

function item(id: string): PilotItem {
  const found = PILOT_CONTENT.items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown item ${id}`);
  return found;
}
// Keys come from the fixture content only.
const keyFor = (q: Question) => item(q.itemId).options.find((o) => o.correct)?.id ?? '';
const wrongFor = (q: Question) => item(q.itemId).options.find((o) => !o.correct)?.id ?? '';

interface Run {
  kv: Kv;
  s: Session;
  c: Controller;
  trail: Snapshot[];
  final: PilotView;
}

/**
 * The real controller from an empty store: both lessons and every practice item correct on Jan 1, then the
 * transfer block on Jan 2 answered by `pick`, recording the stored bytes after every action until it closes.
 */
async function driveToClosed(pick: (q: Question) => string): Promise<Run> {
  const kv = backend();
  const s: Session = { day: JAN1, assisted: false, assistedCalls: 0, randomCalls: 0 };
  const store = await open(kv);
  await store.setMeta('legacy_sentinel', 'keep-me');
  const c = make(store, s);
  const trail: Snapshot[] = [{ raw: await rawOf(kv), view: null, day: s.day }];
  const record = async (pending: Promise<PilotView>): Promise<PilotView> => {
    const view = await pending;
    trail.push({ raw: await rawOf(kv), view, day: s.day });
    return view;
  };
  let view = await record(c.load());
  for (let step = 0; view.kind !== 'progress'; step += 1) {
    if (step > 60) throw new Error(`transfer block did not close after 60 actions (last: ${view.kind})`);
    if (view.kind === 'awaiting-transfer') {
      expect(s.day).toBe(JAN1);
      s.day = JAN2;
      view = await record(c.load());
      continue;
    }
    if (view.kind === 'question') {
      const choice = view.phase === 'practice' ? keyFor(view) : pick(view);
      const answered = await record(c.answer(view.presentationId, choice));
      if (answered.kind === 'progress') {
        view = answered;
        break;
      }
    } else {
      expect(view.kind).toBe('lesson');
    }
    view = await record(c.next());
  }
  return { kv, s, c, trail, final: view };
}

const uniqueDays = (status: Status): string[] => [...new Set(status?.days ?? [])].sort();
const lastRaw = (run: Run): string => {
  const raw = run.trail[run.trail.length - 1]?.raw ?? null;
  if (raw === null) throw new Error('pilot document missing');
  return raw;
};
const parsed = (raw: string): Record<string, unknown> => JSON.parse(raw) as Record<string, unknown>;

/** At every recorded stage the pure read agrees with what the real controller reported for the same bytes. */
function expectParity(run: Run): void {
  const status = unitAStatus();
  expect(run.trail.map((t) => t.view?.kind)).toEqual(
    expect.arrayContaining(['lesson', 'question', 'feedback', 'awaiting-transfer', 'assessment-feedback', 'progress']),
  );
  for (const snap of run.trail) {
    const result = status(snap.raw, OWNER, snap.day);
    if (snap.raw === null) {
      expect(result).toEqual({ qualified: false, days: [] });
      continue;
    }
    expect(result).not.toBeNull();
    const provisional = snap.view !== null && snap.view.kind === 'progress' && snap.view.provisional;
    expect(result?.qualified).toBe(provisional);
    expect(result?.days.length ?? 0).toBeGreaterThan(0);
    result?.days.forEach((d) => {
      expect([JAN1, JAN2]).toContain(d);
      expect(d <= snap.day).toBe(true);
    });
  }
}

describe('Unit A pure status read (unitAStatus)', () => {
  it('reads an absent document for a valid owner and day as unqualified with no days', () => {
    const status = unitAStatus();
    expect(status(null, OWNER, JAN1)).toEqual({ qualified: false, days: [] });
    expect(status(null, OTHER, JAN9)).toEqual({ qualified: false, days: [] });
  });

  it('matches the real gate at every stage, then reads the closed provisional transfer as qualified', async () => {
    const run = await driveToClosed(keyFor);
    expect(run.final).toMatchObject({ kind: 'progress', provisional: true, anchorDay: JAN2 });
    expectParity(run);
    const raw = lastRaw(run);
    expect(await rawOf(run.kv)).toBe(raw);
    const result = unitAStatus()(raw, OWNER, JAN3);
    expect(result?.qualified).toBe(true);
    expect(uniqueDays(result)).toEqual([JAN1, JAN2]);
  });

  it('matches the real gate at every stage, then reads a closed non-provisional transfer as unqualified', async () => {
    const run = await driveToClosed(wrongFor);
    expect(run.final).toMatchObject({ kind: 'progress', provisional: false, anchorDay: null });
    expectParity(run);
    const raw = lastRaw(run);
    const status = unitAStatus();
    expect(status(raw, OWNER, JAN2)).toMatchObject({ qualified: false });
    expect(status(raw, OWNER, JAN9)).toMatchObject({ qualified: false });
    expect(uniqueDays(status(raw, OWNER, JAN9))).toEqual([JAN1, JAN2]);
  });

  it('reads on the d7 due day without IO, assistance, randomness or a d7 presentation; qualification survives d7', async () => {
    const run = await driveToClosed(keyFor);
    run.s.day = JAN9;
    const raw = lastRaw(run);
    const blob = await run.kv.blob();
    const calls = { ...run.kv.calls };
    const { assistedCalls, randomCalls } = run.s;

    const status = unitAStatus();
    const first = status(raw, OWNER, JAN9);
    const second = status(raw, OWNER, JAN9);
    expect(first?.qualified).toBe(true);
    expect(second).toEqual(first);
    expect(first?.days).not.toContain(JAN9);
    expect(run.kv.calls).toEqual(calls);
    expect(run.s.assistedCalls).toBe(assistedCalls);
    expect(run.s.randomCalls).toBe(randomCalls);
    expect(await run.kv.blob()).toBe(blob);
    const after = await rawOf(run.kv);
    expect(after).toBe(raw);
    D7_IDS.forEach((id) => expect(after).not.toContain(id));
    expect(await (await open(run.kv)).getMeta('legacy_sentinel')).toBe('keep-me');

    // The d7 check really was due: the controller opens it, and a wrong delayed answer never moves the anchor.
    const d7 = await run.c.load();
    expect(d7.kind === 'question' && d7.phase).toBe('d7');
    const opened = await rawOf(run.kv);
    expect(opened).not.toBe(raw);
    expect(status(opened, OWNER, JAN9)?.qualified).toBe(true);
    expect(status(opened, OWNER, JAN9)?.days).toContain(JAN9);
    if (d7.kind !== 'question') throw new Error('d7 question expected');
    expect((await run.c.answer(d7.presentationId, wrongFor(d7))).kind).toBe('assessment-feedback');
    expect(status(await rawOf(run.kv), OWNER, JAN9)?.qualified).toBe(true);
  });

  it('fails closed on an invalid owner or local calendar day, for absent and real documents alike', async () => {
    const raw = lastRaw(await driveToClosed(keyFor));
    const status = unitAStatus();
    expect(status(raw, OWNER, JAN3)?.qualified).toBe(true);
    for (const doc of [null, raw]) {
      expect(status(doc, '', JAN3)).toBeNull();
      expect(status(doc, 42 as unknown as string, JAN3)).toBeNull();
      for (const day of BAD_DAYS) expect([day, status(doc, OWNER, day)]).toEqual([day, null]);
      expect(status(doc, OWNER, 20260103 as unknown as string)).toBeNull();
    }
  });

  it('fails closed on corrupt, foreign, schema, version or future-day clones of a real qualified record', async () => {
    const raw = lastRaw(await driveToClosed(keyFor));
    const status = unitAStatus();
    expect(status(raw, OWNER, JAN3)?.qualified).toBe(true);
    const doc = parsed(raw);
    expect(Array.isArray(doc.attempts)).toBe(true);
    const attempts = doc.attempts as unknown[];
    const variants: Record<string, string> = {
      truncated: raw.slice(0, -1),
      notJson: 'not json',
      jsonNull: 'null',
      jsonArray: '[]',
      foreign: JSON.stringify({ ...doc, owner: OTHER }),
      newerSchema: JSON.stringify({ ...doc, schema: 2 }),
      noSchema: JSON.stringify(Object.fromEntries(Object.entries(doc).filter(([k]) => k !== 'schema'))),
      contentVersion: JSON.stringify({ ...doc, contentVersion: `${PILOT_CONTENT.contentVersion}-next` }),
      policyVersion: JSON.stringify({ ...doc, policyVersion: `${PILOT_CONTENT.policyVersion}-next` }),
      extraKey: JSON.stringify({ ...doc, note: 'x' }),
      droppedAttempt: JSON.stringify({ ...doc, attempts: attempts.slice(1) }),
      reorderedAttempts: JSON.stringify({ ...doc, attempts: [...attempts].reverse() }),
    };
    for (const [name, variant] of Object.entries(variants)) {
      expect([name, status(variant, OWNER, JAN3)]).toEqual([name, null]);
    }
    // The record holds Jan 2 activity, so reading it as of Jan 1 is a future day.
    expect(status(raw, OWNER, JAN1)).toBeNull();
  });

  it('a forged verdict field cannot pass the parser; a coherent assisted context derives unqualified', async () => {
    const unqualified = await driveToClosed(wrongFor);
    const status = unitAStatus();
    const raw = lastRaw(unqualified);
    expect(status(raw, OWNER, JAN3)?.qualified).toBe(false);
    const doc = parsed(raw);
    for (const forged of [{ qualified: true }, { provisional: true }, { anchorDay: JAN2 }, { canAdvance: true }]) {
      expect(status(JSON.stringify({ ...doc, ...forged }), OWNER, JAN3)).toBeNull();
    }
    const awaiting = unqualified.trail.find((t) => t.view?.kind === 'awaiting-transfer')?.raw ?? null;
    if (awaiting === null) throw new Error('awaiting-transfer stage missing');
    expect(status(awaiting, OWNER, JAN1)?.qualified).toBe(false);
    expect(status(JSON.stringify({ ...parsed(awaiting), qualified: true }), OWNER, JAN1)).toBeNull();

    const qualified = parsed(lastRaw(await driveToClosed(keyFor)));
    expect(Array.isArray(qualified.assessments)).toBe(true);
    const assisted = (qualified.assessments as unknown[]).map((a) => ({
      ...(a as Record<string, unknown>),
      assistedWhenAnswered: true,
    }));
    expect(status(JSON.stringify({ ...qualified, assessments: assisted }), OWNER, JAN3)).toEqual(
      expect.objectContaining({ qualified: false }),
    );
  });
});
