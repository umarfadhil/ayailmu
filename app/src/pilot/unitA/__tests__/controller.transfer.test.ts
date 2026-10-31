// Unit A pilot controller, transfer slice: a held-out transfer block after correctness practice, over a
// real KvStore on an isolated in-memory backend (no accounts, no module mocks, injected day and
// assistance). These prove local engineering only — not learner retention, linguistic or pedagogical
// approval, device behaviour or any backend. Views this slice adds are described here structurally:
//   unfinished assessment answer: { kind: 'assessment-feedback', phase: 'transfer', deferred: true, answered, total },
//     carrying no correctness, outcome, key or explanation until the block closes;
//   closed block: { kind: 'progress', provisional: boolean, anchorDay: string | null, nextDue: string | null,
//     delayed: { d7: null, d30: null } } — a block that cannot qualify may instead stay 'insufficient';
//   waiting for a later day or an unassisted day: 'awaiting-transfer'.
// Durable names relied on are only those already fixed by the initial slice: attempts and current.
import { KvStore, memoryKv } from '@/storage/kvStore';
import { PILOT_CONTENT, type PilotItem } from '../content';
import { createPilotController, PILOT_META_KEY, type PilotView } from '../controller';
import { canAdvanceUnitA, type PilotEvidence } from '../evidence';

type Controller = ReturnType<typeof createPilotController>;
type Question = Extract<PilotView, { kind: 'question' }>;
type Kv = ReturnType<typeof memoryKv>;
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

const JAN1 = '2026-01-01';
const JAN2 = '2026-01-02';
const JAN3 = '2026-01-03';
const JAN9 = '2026-01-09';
const OWNER = 'pilot-transfer-owner';
const UNLOCK = /"(eligible|canAdvance|unlocked|passed)"\s*:\s*true/;
const OVERCLAIM = /mastery|mastered|unit-?b/i;
const GRADING = /"(correct|isCorrect|outcome|keyed|explanation|feedback|correctOptionId|answerKey|score|provisional|anchorDay)"\s*:/;
const PRACTICE = PILOT_CONTENT.items.filter((i) => i.phase === 'practice');
const TRANSFER = PILOT_CONTENT.items.filter((i) => i.phase === 'transfer');
const TRANSFER_IDS = TRANSFER.map((i) => i.id);
const PRACTICE_FAMILIES = PRACTICE.map((i) => i.family);

const loose = (view: PilotView | null): Loose => view as unknown as Loose;

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
    expect(o.text).toBe(source.options.find((s) => s.id === o.id)?.text);
  });
  const text = JSON.stringify(view);
  expect(text).not.toMatch(GRADING);
  source.options.forEach((o) => expect(text).not.toContain(o.feedback));
  return q;
}

/** A held-out transfer question never shown before, from a family no practice item or earlier question used. */
function asTransfer(view: PilotView, before: readonly Question[]): Question {
  const q = asQuestion(view);
  expect(q.phase).toBe('transfer');
  expect(TRANSFER_IDS).toContain(q.itemId);
  expect(before.map((b) => b.itemId)).not.toContain(q.itemId);
  expect(PRACTICE_FAMILIES).not.toContain(item(q.itemId).family);
  expect(before.map((b) => item(b.itemId).family)).not.toContain(item(q.itemId).family);
  return q;
}

function expectDeferred(view: PilotView, answered: number): void {
  expect(loose(view)).toMatchObject({
    kind: 'assessment-feedback', phase: 'transfer', deferred: true, answered, total: TRANSFER.length,
  });
  const text = JSON.stringify(view);
  expect(text).not.toMatch(GRADING);
  TRANSFER.forEach((t) => t.options.forEach((o) => expect(text).not.toContain(o.feedback)));
}

/** A closed block that must not qualify: honest, unanchored, never a mastery or Unit B claim. */
function expectNoAnchor(view: PilotView): void {
  const v = loose(view);
  expect(['progress', 'insufficient']).toContain(v.kind);
  expect(v.provisional ?? false).toBe(false);
  expect(v.anchorDay ?? null).toBeNull();
  const text = JSON.stringify(view);
  expect(text).not.toMatch(UNLOCK);
  expect(text).not.toMatch(OVERCLAIM);
}

const exactAttempts = (doc: Doc) =>
  doc.attempts.forEach((a) => expect(Object.keys(a).sort()).toEqual(['itemId', 'optionId', 'presentationId']));

/** Raw first choices joined to canonical item metadata, for cross-checking the shared evaluator. */
function evidence(doc: Doc, dayOf: (i: PilotItem) => string): PilotEvidence[] {
  return doc.attempts.map((a): PilotEvidence => {
    const source = item(a.itemId);
    expect(['practice', 'transfer']).toContain(source.phase);
    const chosen = source.options.find((o) => o.id === a.optionId);
    let outcome: PilotEvidence['outcome'] = 'dont-know';
    if (chosen !== undefined) outcome = chosen.correct ? 'correct' : 'wrong';
    return {
      id: a.presentationId, construct: source.construct, family: source.family,
      kind: source.phase === 'practice' ? 'practice' : 'transfer', outcome, day: dayOf(source),
    };
  });
}
const practiceJan1 = (transferDay: string) => (i: PilotItem) => (i.phase === 'practice' ? JAN1 : transferDay);

/** Both lessons and all eight practice items, every first choice correct, ending awaiting transfer. */
async function practiceAll(c: Controller): Promise<PilotView> {
  const shown: string[] = [];
  let view = await c.load();
  for (let step = 0; view.kind !== 'awaiting-transfer'; step += 1) {
    if (step > 40) throw new Error(`practice did not end after 40 actions (last: ${view.kind})`);
    if (view.kind === 'question') {
      const q = asQuestion(view);
      expect(q.phase).toBe('practice');
      shown.push(q.itemId);
      expect((await c.answer(q.presentationId, keyFor(q))).kind).toBe('feedback');
    } else {
      expect(view.kind).toBe('lesson');
    }
    view = await c.next();
  }
  expect([...shown].sort()).toEqual(PRACTICE.map((i) => i.id).sort());
  return view;
}

interface Hooks {
  beforeAnswer?: () => void;
  afterAnswer?: () => void;
}

/** Answers the rest of the block; every unfinished answer defers grading and next() moves on. */
async function finishTransfer(
  c: Controller,
  start: PilotView,
  done: readonly Question[],
  pick: (q: Question, n: number) => string | null,
  hooks: Hooks = {},
): Promise<{ questions: Question[]; final: PilotView }> {
  const questions = [...done];
  let view = start;
  while (questions.length < TRANSFER.length) {
    const q = asTransfer(view, questions);
    questions.push(q);
    hooks.beforeAnswer?.();
    const result = await c.answer(q.presentationId, pick(q, questions.length - 1));
    hooks.afterAnswer?.();
    if (questions.length === TRANSFER.length) return { questions, final: result };
    expectDeferred(result, questions.length);
    view = await c.next();
  }
  throw new Error('block already had every transfer question');
}

const shownAs = ({ presentationId, itemId, phase, options }: Question) => ({ presentationId, itemId, phase, options });

describe('Unit A pilot controller (transfer slice)', () => {
  it('same-day practice is not transfer; a later day saves a fresh held-out four-choice question before showing it', async () => {
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    const c = make(await open(kv), s);
    const end = await practiceAll(c);
    expect(loose(end).provisional ?? false).toBe(false);
    expect(loose(end).anchorDay ?? null).toBeNull();
    expect((await c.load()).kind).toBe('awaiting-transfer');
    expect((await c.next()).kind).toBe('awaiting-transfer');
    const jan1 = await rawDoc(kv);
    TRANSFER_IDS.forEach((id) => expect(jan1).not.toContain(id));
    expect((JSON.parse(jan1) as Doc).attempts.map((a) => item(a.itemId).phase)).toEqual(PRACTICE.map(() => 'practice'));

    s.day = JAN2;
    const q = asTransfer(await c.load(), []);
    const saved = await readDoc(kv);
    expect(saved.current).toEqual({ presentationId: q.presentationId, itemId: q.itemId, day: JAN2 });
    expect(saved.attempts).toHaveLength(PRACTICE.length);
    c.dispose();
    expect(shownAs(asQuestion(await (await reopen(kv, s)).load()))).toEqual(shownAs(q));
  });

  it('four correct transfers on Jan 2 defer grading, then close provisional anchored Jan 2, due Jan 9, kept on reopen', async () => {
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    const c = make(await open(kv), s);
    await practiceAll(c);
    s.day = JAN2;
    const { questions, final } = await finishTransfer(c, await c.load(), [], keyFor);
    const closed = { kind: 'progress', provisional: true, anchorDay: JAN2, nextDue: JAN9, delayed: { d7: null, d30: null } };
    expect(loose(final)).toMatchObject(closed);
    expect(JSON.stringify(final)).not.toMatch(OVERCLAIM);

    expect(questions.map((q) => q.itemId).sort()).toEqual([...TRANSFER_IDS].sort());
    for (const construct of ['reference', 'agreement'] as const) {
      const families = questions.map((q) => item(q.itemId)).filter((i) => i.construct === construct).map((i) => i.family);
      expect(new Set(families).size).toBe(2);
    }
    const doc = await readDoc(kv);
    exactAttempts(doc);
    expect(doc.attempts.slice(PRACTICE.length)).toEqual(
      questions.map((q) => ({ presentationId: q.presentationId, itemId: q.itemId, optionId: keyFor(q) })),
    );
    expect(canAdvanceUnitA(evidence(doc, practiceJan1(JAN2)))).toBe(true);

    c.dispose();
    s.day = JAN3;
    const later = await reopen(kv, s);
    expect(loose(await later.load())).toMatchObject(closed);
    expect(loose(await later.load())).toMatchObject(closed);
    expect((await readDoc(kv)).attempts).toEqual(doc.attempts);
  });

  it('assistance waits without consuming a held-out item; assistance after display invalidates every transfer answer', async () => {
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    await practiceAll(make(await open(kv), s));
    const before = await readDoc(kv);

    s.day = JAN2;
    s.assisted = true;
    const assisted = await reopen(kv, s);
    expect((await assisted.load()).kind).toBe('awaiting-transfer');
    expect((await assisted.next()).kind).toBe('awaiting-transfer');
    const waited = await rawDoc(kv);
    TRANSFER_IDS.forEach((id) => expect(waited).not.toContain(id));
    expect((JSON.parse(waited) as Doc).attempts).toEqual(before.attempts);
    assisted.dispose();

    s.day = JAN3;
    s.assisted = false;
    const c = await reopen(kv, s);
    const { questions, final } = await finishTransfer(c, await c.load(), [], keyFor, {
      beforeAnswer: () => { s.assisted = true; },
      afterAnswer: () => { s.assisted = false; },
    });
    expectNoAnchor(final);
    const doc = await readDoc(kv);
    exactAttempts(doc);
    expect(doc.attempts.slice(PRACTICE.length)).toEqual(
      questions.map((q) => ({ presentationId: q.presentationId, itemId: q.itemId, optionId: keyFor(q) })),
    );
    // The raw choices alone would satisfy the evaluator: only the assistance context may withhold the anchor.
    expect(canAdvanceUnitA(evidence(doc, practiceJan1(JAN3)))).toBe(true);
    c.dispose();
    expectNoAnchor(await (await reopen(kv, s)).load());
  });

  it('wrong or dont-know transfers cannot qualify; a repeat answer cannot launder; reload never reuses a held-out item', async () => {
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    const c = make(await open(kv), s);
    await practiceAll(c);
    s.day = JAN2;
    const q1 = asTransfer(await c.load(), []);
    expectDeferred(await c.answer(q1.presentationId, wrongFor(q1)), 1);
    const afterFirst = await readDoc(kv);
    expect(afterFirst.attempts[PRACTICE.length]).toEqual({ presentationId: q1.presentationId, itemId: q1.itemId, optionId: wrongFor(q1) });
    expect(JSON.stringify(await c.answer(q1.presentationId, keyFor(q1)).catch(() => null))).not.toMatch(GRADING);
    expect(JSON.stringify(await c.answer(q1.presentationId, null).catch(() => null))).not.toMatch(GRADING);
    expect((await readDoc(kv)).attempts).toEqual(afterFirst.attempts);
    expectDeferred(await c.load(), 1);

    const q2 = asTransfer(await c.next(), [q1]);
    expectDeferred(await c.answer(q2.presentationId, null), 2);
    c.dispose();
    const resumed = await reopen(kv, s);
    expectDeferred(await resumed.load(), 2);
    const { questions, final } = await finishTransfer(resumed, await resumed.next(), [q1, q2], (q, n) => (n % 2 ? null : wrongFor(q)));
    expectNoAnchor(final);

    const doc = await readDoc(kv);
    exactAttempts(doc);
    expect(doc.attempts.slice(PRACTICE.length).map((a) => a.itemId)).toEqual(questions.map((q) => q.itemId));
    expect(questions.map((q) => q.itemId).sort()).toEqual([...TRANSFER_IDS].sort());
    doc.attempts.slice(PRACTICE.length).forEach((a) =>
      expect(item(a.itemId).options.find((o) => o.id === a.optionId)?.correct ?? false).toBe(false));
    expect(canAdvanceUnitA(evidence(doc, practiceJan1(JAN2)))).toBe(false);
    resumed.dispose();

    for (const day of [JAN2, JAN3]) {
      s.day = day;
      const again = await reopen(kv, s);
      expectNoAnchor(await again.load());
      expectNoAnchor(await again.next());
      again.dispose();
    }
    expect((await readDoc(kv)).attempts).toEqual(doc.attempts);
    expect(await rawDoc(kv)).not.toMatch(/"provisional"\s*:\s*true/);
  });

  it('a question shown Jan 2 but answered Jan 3, then assisted answers, closes unanchored and survives reopen', async () => {
    const kv = memoryKv();
    const s: Session = { day: JAN1, assisted: false };
    const store = await open(kv);
    await store.setMeta('legacy_sentinel', 'keep-me');
    await store.saveSnapshot({ legacy: true });
    const c = make(store, s);
    await practiceAll(c);

    s.day = JAN2;
    const q1 = asTransfer(await c.load(), []);
    expect((await readDoc(kv)).current).toEqual({ presentationId: q1.presentationId, itemId: q1.itemId, day: JAN2 });
    s.day = JAN3;
    expectDeferred(await c.answer(q1.presentationId, keyFor(q1)), 1);
    expect((await readDoc(kv)).attempts[PRACTICE.length]).toEqual({ presentationId: q1.presentationId, itemId: q1.itemId, optionId: keyFor(q1) });

    const { questions, final } = await finishTransfer(c, await c.next(), [q1], keyFor, {
      beforeAnswer: () => { s.assisted = true; },
      afterAnswer: () => { s.assisted = false; },
    });
    expectNoAnchor(final);
    const doc = await readDoc(kv);
    exactAttempts(doc);
    expect(doc.attempts.slice(PRACTICE.length)).toEqual(
      questions.map((q) => ({ presentationId: q.presentationId, itemId: q.itemId, optionId: keyFor(q) })),
    );
    // Dated by answer day the raw choices would pass the evaluator; the cross-day and assisted context must not.
    expect(canAdvanceUnitA(evidence(doc, practiceJan1(JAN3)))).toBe(true);

    c.dispose();
    const reopened = await open(kv);
    const again = make(reopened, s);
    expectNoAnchor(await again.load());
    expect((await readDoc(kv)).attempts).toEqual(doc.attempts);
    expect(await rawDoc(kv)).not.toMatch(/"provisional"\s*:\s*true/);
    expect(await reopened.getMeta('legacy_sentinel')).toBe('keep-me');
    expect(await reopened.loadSnapshotRaw()).toBe(JSON.stringify({ legacy: true }));
  });
});
