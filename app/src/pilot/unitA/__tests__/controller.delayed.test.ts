// Unit A pilot controller, delayed slice: d7 and d30 delayed checks after a qualifying held-out transfer block,
// over a real KvStore on an isolated in-memory backend (no accounts, no module mocks, injected day and
// assistance). This is an engineering calendar simulation, not a learner 30-day study: it proves local scheduling
// and bookkeeping only — not retention, efficacy, linguistic or pedagogical approval, device behaviour or any
// backend. The reserved bank is finite (20 items: 8 practice, 4 transfer, 4 d7, 4 d30), so every item is issued
// once and nothing is retried. Contracts this slice adds, described structurally:
//   delayed question: the existing question view with phase 'd7' | 'd30', options { id, text } only;
//   unfinished delayed answer: { kind: 'assessment-feedback', phase: 'd7' | 'd30', deferred: true, answered, total };
//   closed progress: delayed.d7 / delayed.d30 each null until that check closes, then { answered, correct, valid }
//     — descriptive counts of raw first choices and of independent (shown and answered the same day, unassisted)
//     ones, never mastery, a pass or a Unit B unlock. anchorDay stays the day the first qualifying transfer block
//     closed; d7 is due anchor + 7 and d30 anchor + 30 whenever d7 actually ran; nextDue is null after d30.
// Durable names relied on are only attempts and current; no private schedule or anchor fields are read.
import { KvStore, memoryKv } from '@/storage/kvStore';
import { PILOT_CONTENT, type PilotItem, type PilotPhase } from '../content';
import { createPilotController, PILOT_META_KEY, type PilotView } from '../controller';

type Controller = ReturnType<typeof createPilotController>;
type Question = Extract<PilotView, { kind: 'question' }>;
type Kv = ReturnType<typeof memoryKv>;
type Delayed = Extract<PilotPhase, 'd7' | 'd30'>;
interface Loose {
  kind: string;
  [key: string]: unknown;
}
interface Attempt {
  presentationId: string;
  itemId: string;
  optionId: string | null;
}
interface Doc {
  attempts: Attempt[];
  current: { presentationId: string; itemId: string; day: string } | null;
}
/** Mutable clock and assistance signal shared with every controller a test opens. */
interface Session {
  day: string;
  assisted: boolean;
}
interface Counts {
  answered: number;
  correct: number;
  valid: number;
}

const JAN1 = '2026-01-01';
const JAN2 = '2026-01-02';
const JAN8 = '2026-01-08';
const JAN9 = '2026-01-09';
const JAN10 = '2026-01-10';
const JAN11 = '2026-01-11';
const JAN31 = '2026-01-31';
const FEB1 = '2026-02-01';
const FEB2 = '2026-02-02';
const FEB3 = '2026-02-03';
const OWNER = 'pilot-delayed-owner';
const UNLOCK = /"(eligible|canAdvance|unlocked|passed)"\s*:\s*true/;
const OVERCLAIM = /mastery|mastered|unit-?b/i;
const GRADING = /"(correct|isCorrect|outcome|keyed|explanation|feedback|correctOptionId|answerKey|score|provisional|anchorDay)"\s*:/;
const ofPhase = (phase: PilotPhase) => PILOT_CONTENT.items.filter((i) => i.phase === phase);
const PRACTICE = ofPhase('practice');
const TRANSFER = ofPhase('transfer');
const BLOCK: Record<Delayed, readonly PilotItem[]> = { d7: ofPhase('d7'), d30: ofPhase('d30') };
const BEFORE_DELAYED = PRACTICE.length + TRANSFER.length;
const ALL_IDS = PILOT_CONTENT.items.map((i) => i.id).sort();
const FULL: Counts = { answered: 4, correct: 4, valid: 4 };

const loose = (view: PilotView | null): Loose => view as unknown as Loose;
const idsOf = (items: readonly PilotItem[]) => items.map((i) => i.id);

async function open(kv: Kv): Promise<KvStore> {
  const store = new KvStore(kv);
  await store.init();
  return store;
}

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

const make = (store: KvStore, s: Session): Controller =>
  createPilotController({
    store, owner: OWNER, mode: 'developer-demo', today: () => s.day, readOnly: () => false,
    active: () => true, assistedToday: async () => s.assisted, random: seeded(11),
  });
const reopen = async (kv: Kv, s: Session): Promise<Controller> => make(await open(kv), s);

/** Durable state as a freshly reopened store over the same backend sees it. */
async function rawDoc(kv: Kv): Promise<string> {
  const raw = await (await open(kv)).getMeta(PILOT_META_KEY);
  if (raw === null) throw new Error('pilot document missing');
  return raw;
}
const readDoc = async (kv: Kv): Promise<Doc> => JSON.parse(await rawDoc(kv)) as Doc;

function item(id: string): PilotItem {
  const found = PILOT_CONTENT.items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown item ${id}`);
  return found;
}
// Keys come from the fixture content only; public views must never carry them.
const keyFor = (q: Question) => item(q.itemId).options.find((o) => o.correct)?.id ?? '';
const wrongFor = (q: Question) => item(q.itemId).options.find((o) => !o.correct)?.id ?? '';

function asQuestion(view: PilotView): Question {
  expect(view.kind).toBe('question');
  const q = view as Question;
  const source = item(q.itemId);
  expect(q).toMatchObject({ phase: source.phase, prompt: source.prompt, arabic: source.arabic, glosses: source.glosses });
  expect(q.options).toHaveLength(4);
  q.options.forEach((o) => {
    expect(Object.keys(o).sort()).toEqual(['id', 'text']);
    expect(o.text).toBe(source.options.find((x) => x.id === o.id)?.text);
  });
  const text = JSON.stringify(view);
  expect(text).not.toMatch(GRADING);
  source.options.forEach((o) => expect(text).not.toContain(o.feedback));
  return q;
}

/** No item of `phase` is named in `text` (a view or the raw document), so none of it was issued. */
const expectNone = (text: string, phase: Delayed) => BLOCK[phase].forEach((i) => expect(text).not.toContain(i.id));

function expectDeferred(view: PilotView, phase: Delayed, answered: number): void {
  expect(loose(view)).toMatchObject({
    kind: 'assessment-feedback', phase, deferred: true, answered, total: BLOCK[phase].length,
  });
  const text = JSON.stringify(view);
  expect(text).not.toMatch(GRADING);
  BLOCK[phase].forEach((i) => i.options.forEach((o) => expect(text).not.toContain(o.feedback)));
}

/** Closed progress still anchored on the qualifying Jan 2 block: descriptive counts, never a pass or unlock. */
function expectProgress(view: PilotView, nextDue: string | null, d7: Counts | null, d30: Counts | null): void {
  expect(loose(view)).toMatchObject({ kind: 'progress', provisional: true, anchorDay: JAN2, nextDue });
  expect(loose(view).delayed).toEqual({ d7, d30 });
  const text = JSON.stringify(view);
  expect(text).not.toMatch(UNLOCK);
  expect(text).not.toMatch(OVERCLAIM);
}

const exactAttempts = (doc: Doc) =>
  doc.attempts.forEach((a) => expect(Object.keys(a).sort()).toEqual(['itemId', 'optionId', 'presentationId']));

/** Both lessons and all eight practice items, every first choice correct, ending awaiting transfer. */
async function practiceAll(c: Controller): Promise<void> {
  let view = await c.load();
  for (let step = 0; view.kind !== 'awaiting-transfer'; step += 1) {
    if (step > 40) throw new Error(`practice did not end after 40 actions (last: ${view.kind})`);
    if (view.kind === 'question') {
      const q = asQuestion(view);
      expect(q.phase).toBe('practice');
      expect((await c.answer(q.presentationId, keyFor(q))).kind).toBe('feedback');
    } else {
      expect(view.kind).toBe('lesson');
    }
    view = await c.next();
  }
}

/** Practice on Jan 1, then four correct unassisted transfers on Jan 2: provisional, anchored Jan 2, due Jan 9. */
async function qualified(kv: Kv, s: Session): Promise<void> {
  const c = make(await open(kv), s);
  await practiceAll(c);
  s.day = JAN2;
  let view = await c.load();
  for (let n = 1; n <= TRANSFER.length; n += 1) {
    const q = asQuestion(view);
    expect(q.phase).toBe('transfer');
    view = await c.answer(q.presentationId, keyFor(q));
    if (n < TRANSFER.length) view = await c.next();
  }
  expectProgress(view, JAN9, null, null);
  c.dispose();
}

interface Run {
  kv: Kv;
  c: Controller;
  s: Session;
}
interface Hooks {
  beforeAnswer?: () => void;
  afterAnswer?: () => void;
}

/**
 * Answers the rest of a delayed block from `start`. Each question is a fresh item of `phase`, never issued before,
 * saved as current on the day it is shown, from a family not yet used in the block; unfinished answers defer.
 */
async function finishDelayed(
  { kv, c, s }: Run,
  phase: Delayed,
  start: PilotView,
  done: readonly Question[],
  pick: (q: Question, n: number) => string | null,
  hooks: Hooks = {},
): Promise<PilotView> {
  const total = BLOCK[phase].length;
  const issued = (await readDoc(kv)).attempts.map((a) => a.itemId);
  const questions = [...done];
  let view = start;
  let final = start;
  for (let n = questions.length; n < total; n += 1) {
    const q = asQuestion(view);
    expect(q.phase).toBe(phase);
    expect(idsOf(BLOCK[phase])).toContain(q.itemId);
    expect(issued).not.toContain(q.itemId);
    expect(questions.map((b) => b.itemId)).not.toContain(q.itemId);
    expect(questions.map((b) => item(b.itemId).family)).not.toContain(item(q.itemId).family);
    expect((await readDoc(kv)).current).toEqual({ presentationId: q.presentationId, itemId: q.itemId, day: s.day });
    questions.push(q);
    hooks.beforeAnswer?.();
    final = await c.answer(q.presentationId, pick(q, n));
    hooks.afterAnswer?.();
    if (n < total - 1) {
      expectDeferred(final, phase, n + 1);
      view = await c.next();
    }
  }
  for (const construct of ['reference', 'agreement'] as const) {
    const families = questions.map((q) => item(q.itemId)).filter((i) => i.construct === construct).map((i) => i.family);
    expect(families).toHaveLength(2);
    expect(new Set(families).size).toBe(2);
  }
  const doc = await readDoc(kv);
  exactAttempts(doc);
  expect(doc.attempts.slice(-total)).toEqual(
    questions.map((q, n) => ({ presentationId: q.presentationId, itemId: q.itemId, optionId: pick(q, n) })),
  );
  return final;
}

/** Opens a fresh controller on `day`; load and next both stay on the same closed progress. */
async function expectSettled(kv: Kv, s: Session, day: string, nextDue: string | null, d7: Counts | null, d30: Counts | null) {
  s.day = day;
  const c = await reopen(kv, s);
  expectProgress(await c.load(), nextDue, d7, d30);
  expectProgress(await c.next(), nextDue, d7, d30);
  c.dispose();
}

describe('Unit A pilot controller (delayed slice)', () => {
  it('d7 opens on anchor + 7 and d30 on anchor + 30, each four fresh deferred items closing to descriptive counts', async () => {
    expect(BLOCK.d7).toHaveLength(4);
    expect(BLOCK.d30).toHaveLength(4);
    expect(ALL_IDS).toHaveLength(20);
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    const legacy = await open(kv);
    await legacy.setMeta('legacy_sentinel', 'keep-me');
    await legacy.saveSnapshot({ legacy: true });
    await qualified(kv, s);

    await expectSettled(kv, s, JAN8, JAN9, null, null);
    const jan8 = await rawDoc(kv);
    expectNone(jan8, 'd7');
    expect((JSON.parse(jan8) as Doc).attempts).toHaveLength(BEFORE_DELAYED);

    s.day = JAN9;
    const c = await reopen(kv, s);
    expectProgress(await finishDelayed({ kv, c, s }, 'd7', await c.load(), [], keyFor), FEB1, FULL, null);
    c.dispose();
    await expectSettled(kv, s, JAN9, FEB1, FULL, null);
    await expectSettled(kv, s, JAN10, FEB1, FULL, null);
    await expectSettled(kv, s, JAN31, FEB1, FULL, null);
    const jan31 = await rawDoc(kv);
    expectNone(jan31, 'd30');
    expect((JSON.parse(jan31) as Doc).attempts).toHaveLength(BEFORE_DELAYED + 4);

    s.day = FEB1;
    const late = await reopen(kv, s);
    expectProgress(await finishDelayed({ kv, c: late, s }, 'd30', await late.load(), [], keyFor), null, FULL, FULL);
    late.dispose();
    const doc = await readDoc(kv);
    expect(doc.attempts).toHaveLength(20);
    expect(doc.attempts.map((a) => a.itemId).sort()).toEqual(ALL_IDS);
    await expectSettled(kv, s, FEB1, null, FULL, FULL);
    expect((await readDoc(kv)).attempts).toEqual(doc.attempts);
    const after = await open(kv);
    expect(await after.getMeta('legacy_sentinel')).toBe('keep-me');
    expect(await after.loadSnapshotRaw()).toBe(JSON.stringify({ legacy: true }));
  });

  it('an assisted due day postpones d7 without issuing anything; d30 stays anchor + 30 and reopening never re-anchors', async () => {
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    await qualified(kv, s);
    const before = await readDoc(kv);

    s.day = JAN9;
    s.assisted = true;
    const assisted = await reopen(kv, s);
    for (const view of [await assisted.load(), await assisted.next()]) {
      expect(['question', 'assessment-feedback', 'blocked']).not.toContain(view.kind);
      expectNone(JSON.stringify(view), 'd7');
      expect(JSON.stringify(view)).not.toMatch(OVERCLAIM);
    }
    assisted.dispose();
    const waited = await rawDoc(kv);
    expectNone(waited, 'd7');
    expectNone(waited, 'd30');
    expect((JSON.parse(waited) as Doc).attempts).toEqual(before.attempts);
    expect((JSON.parse(waited) as Doc).current).toBeNull();

    s.day = JAN10;
    s.assisted = false;
    const c = await reopen(kv, s);
    expectProgress(await finishDelayed({ kv, c, s }, 'd7', await c.load(), [], keyFor), FEB1, FULL, null);
    c.dispose();
    await expectSettled(kv, s, JAN11, FEB1, FULL, null);
    await expectSettled(kv, s, JAN31, FEB1, FULL, null);
    expectNone(await rawDoc(kv), 'd30');

    // Due anchor + 30 (Feb 1), not d7's own day + 30 (Feb 9).
    s.day = FEB1;
    const due = await reopen(kv, s);
    const q = asQuestion(await due.load());
    expect(q.phase).toBe('d30');
    expect(idsOf(BLOCK.d30)).toContain(q.itemId);
    expect((await readDoc(kv)).current).toEqual({ presentationId: q.presentationId, itemId: q.itemId, day: FEB1 });
  });

  it('a d7 answer on a later day or after assistance is kept as answered but not valid; anchor and schedule hold', async () => {
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    await qualified(kv, s);

    s.day = JAN9;
    const c = await reopen(kv, s);
    const q1 = asQuestion(await c.load());
    expect(q1.phase).toBe('d7');
    expect((await readDoc(kv)).current).toEqual({ presentationId: q1.presentationId, itemId: q1.itemId, day: JAN9 });
    s.day = JAN10;
    expectDeferred(await c.answer(q1.presentationId, keyFor(q1)), 'd7', 1);
    const afterFirst = await readDoc(kv);
    expect(afterFirst.attempts).toHaveLength(BEFORE_DELAYED + 1);
    expect(afterFirst.attempts[BEFORE_DELAYED]).toEqual({ presentationId: q1.presentationId, itemId: q1.itemId, optionId: keyFor(q1) });
    await expect(c.answer(q1.presentationId, wrongFor(q1))).rejects.toThrow();
    await expect(c.answer(q1.presentationId, null)).rejects.toThrow();
    expect((await readDoc(kv)).attempts).toEqual(afterFirst.attempts);
    c.dispose();

    const resumed = await reopen(kv, s);
    expectDeferred(await resumed.load(), 'd7', 1);
    const final = await finishDelayed({ kv, c: resumed, s }, 'd7', await resumed.next(), [q1], keyFor, {
      beforeAnswer: () => { s.assisted = true; },
      afterAnswer: () => { s.assisted = false; },
    });
    const invalid: Counts = { answered: 4, correct: 4, valid: 0 };
    expectProgress(final, FEB1, invalid, null);
    resumed.dispose();
    const doc = await readDoc(kv);

    await expectSettled(kv, s, JAN10, FEB1, invalid, null);
    await expectSettled(kv, s, JAN11, FEB1, invalid, null);
    const kept = await readDoc(kv);
    expect(kept.attempts).toEqual(doc.attempts);
    expect(kept.attempts.filter((a) => item(a.itemId).phase === 'd7').map((a) => a.itemId).sort()).toEqual(
      idsOf(BLOCK.d7).sort(),
    );
  });

  it('overdue on Feb 2 offers d7 first and no d30 that day; d30 on Feb 3 counts wrong or dont-know as valid, not correct', async () => {
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    await qualified(kv, s);

    s.day = FEB2;
    const c = await reopen(kv, s);
    const first = await c.load();
    expectNone(JSON.stringify(first), 'd30');
    expectProgress(await finishDelayed({ kv, c, s }, 'd7', first, [], keyFor), FEB1, FULL, null);
    // The d7 check is itself assessment on Feb 2, so d30 waits for a later day rather than following it.
    expectProgress(await c.load(), FEB1, FULL, null);
    expectProgress(await c.next(), FEB1, FULL, null);
    c.dispose();
    await expectSettled(kv, s, FEB2, FEB1, FULL, null);
    const feb2 = await rawDoc(kv);
    expectNone(feb2, 'd30');
    expect((JSON.parse(feb2) as Doc).attempts).toHaveLength(BEFORE_DELAYED + 4);

    s.day = FEB3;
    const late = await reopen(kv, s);
    const final = await finishDelayed({ kv, c: late, s }, 'd30', await late.load(), [], (q, n) => (n % 2 ? null : wrongFor(q)));
    const closed = (view: PilotView) => {
      expect(loose(view)).toMatchObject({ kind: 'progress', anchorDay: JAN2, nextDue: null });
      expect(loose(view).delayed).toEqual({ d7: FULL, d30: { answered: 4, correct: 0, valid: 4 } });
      expect(JSON.stringify(view)).not.toMatch(UNLOCK);
      expect(JSON.stringify(view)).not.toMatch(OVERCLAIM);
    };
    closed(final);
    late.dispose();

    const doc = await readDoc(kv);
    exactAttempts(doc);
    expect(doc.attempts).toHaveLength(20);
    expect(doc.attempts.map((a) => a.itemId).sort()).toEqual(ALL_IDS);
    expect(new Set(doc.attempts.map((a) => a.presentationId)).size).toBe(20);
    const again = await reopen(kv, s);
    closed(await again.load());
    closed(await again.next());
    expect((await readDoc(kv)).attempts).toEqual(doc.attempts);
  });
});
