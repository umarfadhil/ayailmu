// Unit A pilot controller, initial slice: pure controller over a real KvStore on an isolated in-memory
// backend (no accounts, no real data, no module mocks, injected day). These prove local engineering only —
// not linguistic or pedagogical approval, device behaviour or any backend.
// Durable document under PILOT_META_KEY (names fixed here): { owner, schema, contentVersion, policyVersion,
// attempts: [{ presentationId, itemId, optionId }], current: { presentationId, itemId, day } | null }.
import { KvStore, memoryKv } from '@/storage/kvStore';
import { PILOT_CONTENT } from '../content';
import { createPilotController, PILOT_META_KEY, type PilotView } from '../controller';

type Options = Parameters<typeof createPilotController>[0];
type Controller = ReturnType<typeof createPilotController>;
type Question = Extract<PilotView, { kind: 'question' }>;
interface Doc {
  owner: string;
  schema: number;
  contentVersion: string;
  policyVersion: string;
  attempts: { presentationId: string; itemId: string; optionId: string | null }[];
  current: { presentationId: string; itemId: string; day: string } | null;
}

const DAY = '2026-01-01';
const OWNER = 'pilot-test-owner';
const UNLOCK = /"(eligible|canAdvance|unlocked|passed)"\s*:\s*true/;

function backend() {
  const inner = memoryKv();
  const kv = {
    failWrites: false,
    raw: () => inner.getItem(KvStore.KEY),
    getItem: (k: string) => inner.getItem(k),
    setItem: (k: string, v: string) => {
      if (kv.failWrites) throw new Error('injected write failure');
      inner.setItem(k, v);
    },
    removeItem: (k: string) => inner.removeItem(k),
  };
  return kv;
}
type Kv = ReturnType<typeof backend>;

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

const make = (store: KvStore, over: Partial<Options> = {}): Controller =>
  createPilotController({
    store, owner: OWNER, mode: 'developer-demo', today: () => DAY, readOnly: () => false,
    active: () => true, assistedToday: async () => false, random: seeded(7), ...over,
  });

/** Durable state as a freshly reopened store over the same backend sees it. */
async function readDoc(kv: Kv): Promise<Doc | null> {
  const raw = await (await open(kv)).getMeta(PILOT_META_KEY);
  return raw === null ? null : (JSON.parse(raw) as Doc);
}

function item(id: string) {
  const found = PILOT_CONTENT.items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown item ${id}`);
  return found;
}
// Keys come from the fixture content only; the public view must never carry them.
const optionWhere = (q: Question, correct: boolean) => item(q.itemId).options.find((o) => o.correct === correct)?.id ?? '';

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
  expect(text).not.toMatch(/"(correct|feedback|correctOptionId|answerKey)"\s*:/);
  source.options.forEach((o) => expect(text).not.toContain(o.feedback));
  return q;
}

async function firstQuestion(c: Controller): Promise<Question> {
  let view = await c.load();
  for (let step = 0; view.kind === 'lesson' && step < 3; step += 1) view = await c.next();
  return asQuestion(view);
}

async function expectRefused(pending: Promise<PilotView>): Promise<void> {
  const view = await pending.catch(() => null);
  expect(view?.kind ?? 'rejected').toMatch(/^(blocked|rejected)$/);
}

describe('Unit A pilot controller (initial slice)', () => {
  it('shows the reference lesson first, then saves the first four-choice practice before showing it', async () => {
    const kv = backend();
    const store = await open(kv);
    await store.setMeta('legacy_sentinel', 'keep-me');
    await store.saveSnapshot({ legacy: true });
    const c = make(store);
    const lesson = await c.load();
    expect(lesson.kind).toBe('lesson');
    expect((lesson as Extract<PilotView, { kind: 'lesson' }>).lesson.id).toBe('ua-d01-ref-lesson');
    expect((await readDoc(kv))?.attempts ?? []).toEqual([]);
    const q = asQuestion(await c.next());
    expect(item(q.itemId)).toMatchObject({ construct: 'reference', phase: 'practice' });
    const saved = await readDoc(kv);
    expect(saved).toMatchObject({
      owner: OWNER, contentVersion: PILOT_CONTENT.contentVersion, policyVersion: PILOT_CONTENT.policyVersion,
      attempts: [], current: { presentationId: q.presentationId, itemId: q.itemId, day: DAY },
    });
    expect(typeof saved?.schema).toBe('number');
    const reopened = await open(kv);
    expect(await reopened.getMeta('legacy_sentinel')).toBe('keep-me');
    expect(await reopened.loadSnapshotRaw()).toBe(JSON.stringify({ legacy: true }));
  });

  it('saves exactly one first-choice attempt, then feedback; a repeat answer cannot replace or append', async () => {
    const kv = backend();
    const c = make(await open(kv));
    const q = await firstQuestion(c);
    const key = optionWhere(q, true);
    expect((await c.answer(q.presentationId, key)).kind).toBe('feedback');
    const saved = await readDoc(kv);
    expect(saved?.attempts).toEqual([{ presentationId: q.presentationId, itemId: q.itemId, optionId: key }]);
    await c.answer(q.presentationId, optionWhere(q, false)).catch(() => null);
    await c.answer(q.presentationId, null).catch(() => null);
    expect((await readDoc(kv))?.attempts).toEqual(saved?.attempts);
  });

  it('resumes the identical presentation after reopening, despite a different random source', async () => {
    const kv = backend();
    const first = make(await open(kv), { random: seeded(1) });
    const q = await firstQuestion(first);
    first.dispose();
    const before = await readDoc(kv);
    const resumed = asQuestion(await make(await open(kv), { random: seeded(424242) }).load());
    const shown = ({ presentationId, itemId, phase, options }: Question) => ({ presentationId, itemId, phase, options });
    expect(shown(resumed)).toEqual(shown(q));
    expect(await readDoc(kv)).toEqual(before);
  });

  it.each([
    ['tester mode', { mode: 'tester' }],
    ['read-only storage', { readOnly: () => true }],
  ] as [string, Partial<Options>][])('%s blocks before any lesson or question and writes nothing', async (_, over) => {
    const kv = backend();
    const store = await open(kv);
    await store.setMeta('legacy_sentinel', 'keep-me');
    const raw = kv.raw();
    const c = make(store, over);
    expect((await c.load()).kind).toBe('blocked');
    await expectRefused(c.next());
    expect(kv.raw()).toBe(raw);
    expect(await (await open(kv)).getMeta(PILOT_META_KEY)).toBeNull();
  });

  it('a failed answer write rejects, keeps durable history, and the same presentation stays answerable', async () => {
    const kv = backend();
    const store = await open(kv);
    await store.setMeta('legacy_sentinel', 'keep-me');
    const c = make(store);
    const q1 = await firstQuestion(c);
    await c.answer(q1.presentationId, optionWhere(q1, true));
    const q2 = asQuestion(await c.next());
    const raw = kv.raw();
    kv.failWrites = true;
    await expect(c.answer(q2.presentationId, optionWhere(q2, false))).rejects.toThrow();
    kv.failWrites = false;
    expect(kv.raw()).toBe(raw);
    expect(asQuestion(await c.load()).presentationId).toBe(q2.presentationId);
    const durable = await readDoc(kv);
    expect(durable?.attempts.map((a) => a.presentationId)).toEqual([q1.presentationId]);
    expect(durable?.current?.presentationId).toBe(q2.presentationId);
    expect((await c.answer(q2.presentationId, optionWhere(q2, true))).kind).toBe('feedback');
    expect((await readDoc(kv))?.attempts.map((a) => [a.presentationId, a.optionId])).toEqual([
      [q1.presentationId, optionWhere(q1, true)],
      [q2.presentationId, optionWhere(q2, true)],
    ]);
    expect(await (await open(kv)).getMeta('legacy_sentinel')).toBe('keep-me');
  });

  it.each(['inactive', 'disposed'] as const)('%s controller refuses further writes and content', async (how) => {
    const kv = backend();
    let live = true;
    const c = make(await open(kv), { active: () => live });
    const q = await firstQuestion(c);
    const raw = kv.raw();
    if (how === 'inactive') live = false;
    else c.dispose();
    await expectRefused(c.load());
    await expectRefused(c.next());
    await expectRefused(c.answer(q.presentationId, optionWhere(q, true)));
    expect(kv.raw()).toBe(raw);
  });

  // Recovery through distinct fresh practice on a later day belongs to a future slice.
  it('all wrong or dont-know practice consumes the fresh bank once and ends insufficient, never transfer', async () => {
    const kv = backend();
    const c = make(await open(kv));
    const practice = PILOT_CONTENT.items.filter((i) => i.phase === 'practice').map((i) => i.id);
    const answered: string[] = [];
    let view = await c.load();
    for (let step = 0; view.kind !== 'insufficient'; step += 1) {
      if (step > 60) throw new Error(`no honest end after 60 actions (last: ${view.kind})`);
      if (view.kind === 'question') {
        const q = asQuestion(view);
        expect(q.phase).toBe('practice');
        answered.push(q.itemId);
        view = await c.answer(q.presentationId, answered.length % 2 ? optionWhere(q, false) : null);
      } else {
        expect(['lesson', 'feedback']).toContain(view.kind);
        view = await c.next();
      }
    }
    expect([...answered].sort()).toEqual([...practice].sort());
    expect(JSON.stringify(view)).not.toMatch(UNLOCK);
    const saved = await readDoc(kv);
    expect(saved?.attempts.map((a) => a.itemId)).toEqual(answered);
    saved?.attempts.forEach((a) => expect(item(a.itemId).options.find((o) => o.id === a.optionId)?.correct ?? false).toBe(false));
    expect(JSON.stringify(saved)).not.toMatch(UNLOCK);
    expect((await c.next()).kind).toBe('insufficient');
    expect((await c.load()).kind).toBe('insufficient');
    expect((await readDoc(kv))?.attempts).toHaveLength(practice.length);
  });

  const edit = (change: (doc: Doc) => void) => (raw: string) => {
    const doc = JSON.parse(raw) as Doc;
    change(doc);
    return JSON.stringify(doc);
  };
  it.each([
    ['wrong owner', edit((d) => { d.owner = 'another-owner'; })],
    ['newer schema', edit((d) => { d.schema += 1; })],
    ['content-version mismatch', edit((d) => { d.contentVersion = 'unit-a-pilot-draft-9.9'; })],
    ['malformed JSON', (raw: string) => raw.slice(0, -1)],
    ['future presentation day', edit((d) => { (d.current as NonNullable<Doc['current']>).day = '2026-01-02'; })],
  ])('fails closed on %s: blocked, raw metadata kept byte-for-byte', async (_, mutate) => {
    const kv = backend();
    const c = make(await open(kv));
    const q = await firstQuestion(c);
    c.dispose();
    const store = await open(kv);
    const original = (await store.getMeta(PILOT_META_KEY)) ?? '';
    const tampered = mutate(original);
    expect(tampered).not.toBe(original);
    await store.setMeta(PILOT_META_KEY, tampered);
    const reopened = make(await open(kv));
    expect((await reopened.load()).kind).toBe('blocked');
    await expectRefused(reopened.next());
    await expectRefused(reopened.answer(q.presentationId, optionWhere(q, true)));
    expect(await (await open(kv)).getMeta(PILOT_META_KEY)).toBe(tampered);
  });
});
