// Unit A pilot screen: the real screen over the real controller and real KvStores on isolated in-memory
// backends (no accounts, no controller or storage mocks, injected day). These prove local engineering only —
// not linguistic or pedagogical approval, device behaviour or any backend.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { KvStore, memoryKv } from '@/storage/kvStore';
import { PILOT_CONTENT } from '../content';
import { PILOT_META_KEY } from '../controller';
import { UnitAPilotScreen } from '../UnitAPilotScreen';

type Props = ComponentProps<typeof UnitAPilotScreen>;
interface Doc {
  owner: string;
  attempts: { presentationId: string; itemId: string; optionId: string | null }[];
  current: { presentationId: string; itemId: string; day: string } | null;
}

const DAY = '2026-01-01';
const OWNER = 'pilot-screen-owner';
const today = () => DAY;
const CLAIM = /mastery|mastered|menguasai|dikuasai|lulus|passed/i;

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
type Item = ReturnType<typeof item>;
// Keys come from the fixture content only; the screen must never render them.
const optionWhere = (source: Item, correct: boolean, skip = 0) => source.options.filter((o) => o.correct === correct)[skip].id;

const props = (store: KvStore, over: Partial<Props> = {}): Props => ({
  store, owner: OWNER, mode: 'developer-demo', readOnly: null, arabicScale: 1, today, ...over,
});
const optionIds = () => screen.queryAllByTestId(/^pilot-option-/).map((e) => String(e.props.testID).slice('pilot-option-'.length));
const visible = (text: string) => screen.queryAllByText(text, { exact: false }).length > 0;
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

/** Presses a control captured earlier; once it has left the tree RNTL may refuse, which is equally fine. */
async function pressStale(el: ReturnType<typeof screen.getByTestId>) {
  try { await fireEvent.press(el); } catch { /* detached control: nothing reachable */ }
}

/** Lets queued store work and effects finish when no visible element marks the end. */
const settle = () => act(async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); });

async function openToQuestion(store: KvStore, kv: Kv, over: Partial<Props> = {}) {
  await render(<UnitAPilotScreen {...props(store, over)} />);
  await screen.findByTestId('pilot-lesson');
  await press('pilot-next');
  await screen.findByTestId('pilot-question');
  const doc = await readDoc(kv);
  if (!doc?.current) throw new Error('question shown before it was saved');
  return { doc, current: doc.current, source: item(doc.current.itemId) };
}

describe('UnitAPilotScreen (initial slice)', () => {
  it('shows the reference worked lesson, then the saved first question; only pilot-check confirms a choice', async () => {
    const kv = backend();
    const store = await open(kv);
    await render(<UnitAPilotScreen {...props(store)} />);
    await screen.findByTestId('pilot-lesson');
    const lesson = PILOT_CONTENT.lessons[0];
    expect(lesson.construct).toBe('reference');
    expect(visible(lesson.title)).toBe(true);
    expect(visible(lesson.examples[0].arabic)).toBe(true);
    expect(screen.queryByTestId('pilot-question')).toBeNull();

    await press('pilot-next');
    await screen.findByTestId('pilot-question');
    const doc = await readDoc(kv);
    expect(doc).toMatchObject({ owner: OWNER, attempts: [], current: { day: DAY } });
    const source = item(doc?.current?.itemId ?? '');
    expect(source).toMatchObject({ construct: 'reference', phase: 'practice' });
    expect([...optionIds()].sort()).toEqual(source.options.map((o) => o.id).sort());
    expect(visible(source.prompt)).toBe(true);
    expect(visible(source.arabic)).toBe(true);
    source.glosses.forEach((g) => expect(visible(g.meaning)).toBe(true));

    const noVerdict = () => {
      expect(screen.queryByTestId('pilot-feedback')).toBeNull();
      source.options.forEach((o) => expect(visible(o.feedback)).toBe(false));
    };
    noVerdict();
    await press(`pilot-option-${optionWhere(source, false, 0)}`);
    const chosen = optionWhere(source, false, 1);
    await press(`pilot-option-${chosen}`);
    await settle();
    noVerdict();
    expect((await readDoc(kv))?.attempts).toEqual([]);

    await press('pilot-check');
    await screen.findByTestId('pilot-feedback');
    expect((await readDoc(kv))?.attempts).toEqual([{ presentationId: doc?.current?.presentationId, itemId: source.id, optionId: chosen }]);
  });

  it('a correct check shows saved practice feedback once, a duplicate press appends nothing, next shows the next question', async () => {
    const kv = backend();
    const { current, source } = await openToQuestion(await open(kv), kv);
    const key = optionWhere(source, true);
    await press(`pilot-option-${key}`);
    const check = screen.getByTestId('pilot-check');
    await fireEvent.press(check);
    await pressStale(check);
    await screen.findByTestId('pilot-feedback');
    await settle();
    expect(screen.getAllByTestId('pilot-feedback')).toHaveLength(1);
    expect(screen.queryByTestId('pilot-error')).toBeNull();
    expect(screen.queryByText(CLAIM)).toBeNull();
    expect((await readDoc(kv))?.attempts).toEqual([{ presentationId: current.presentationId, itemId: source.id, optionId: key }]);

    await press('pilot-next');
    await screen.findByTestId('pilot-question');
    expect(screen.queryByTestId('pilot-feedback')).toBeNull();
    expect(optionIds()).toHaveLength(4);
    const after = await readDoc(kv);
    expect(after?.attempts).toHaveLength(1);
    expect(after?.current?.presentationId).not.toBe(current.presentationId);
    expect(screen.queryByText(CLAIM)).toBeNull();
  });

  it('unmount and remount on the same store and owner resumes the identical question and option order', async () => {
    const kv = backend();
    const store = await open(kv);
    const { doc, source } = await openToQuestion(store, kv);
    const order = optionIds();
    await screen.unmount();
    // A different random source on remount: only the persisted order can reproduce the first one.
    let state = 424242;
    const random = jest.spyOn(Math, 'random').mockImplementation(() => (state = (state * 16807) % 2147483647) / 2147483647);
    try {
      await render(<UnitAPilotScreen {...props(store)} />);
      await screen.findByTestId('pilot-question');
      await settle();
    } finally {
      random.mockRestore();
    }
    expect(optionIds()).toEqual(order);
    expect(visible(source.arabic)).toBe(true);
    expect(screen.queryByTestId('pilot-feedback')).toBeNull();
    expect(await readDoc(kv)).toEqual(doc);
  });

  it('a failed answer write shows an error, keeps the question answerable, and a retry saves exactly one attempt', async () => {
    const kv = backend();
    const { doc, current, source } = await openToQuestion(await open(kv), kv);
    const choice = optionWhere(source, false);
    await press(`pilot-option-${choice}`);
    kv.failWrites = true;
    await press('pilot-check');
    await screen.findByTestId('pilot-error');
    await settle();
    expect(screen.getByTestId('pilot-question')).toBeTruthy();
    expect(optionIds()).toHaveLength(4);
    expect(screen.queryByTestId('pilot-feedback')).toBeNull();
    kv.failWrites = false;
    expect(await readDoc(kv)).toEqual(doc);

    await press(`pilot-option-${choice}`);
    await press('pilot-check');
    await screen.findByTestId('pilot-feedback');
    await settle();
    expect(screen.getAllByTestId('pilot-feedback')).toHaveLength(1);
    expect(screen.queryByTestId('pilot-error')).toBeNull();
    expect((await readDoc(kv))?.attempts).toEqual([{ presentationId: current.presentationId, itemId: source.id, optionId: choice }]);
  });

  it.each([
    ['tester mode', { mode: 'tester' }],
    ['read-only storage', { readOnly: 'storage is read-only' }],
  ] as [string, Partial<Props>][])('%s renders no curriculum and writes no pilot metadata', async (_, over) => {
    const kv = backend();
    const store = await open(kv);
    const raw = kv.raw();
    await render(<UnitAPilotScreen {...props(store, over)} />);
    await settle();
    ['pilot-lesson', 'pilot-question', 'pilot-feedback', 'pilot-check'].forEach((id) => expect(screen.queryByTestId(id)).toBeNull());
    expect(optionIds()).toEqual([]);
    expect(visible(PILOT_CONTENT.lessons[0].title)).toBe(false);
    expect(kv.raw()).toBe(raw);
    expect(await (await open(kv)).getMeta(PILOT_META_KEY)).toBeNull();
  });

  it('switching owner and store isolates B from A; a read-only rerender hides the question immediately', async () => {
    const kvA = backend();
    const kvB = backend();
    const storeB = await open(kvB);
    const { current: currentA, source } = await openToQuestion(await open(kvA), kvA, { owner: 'owner-a' });
    await press(`pilot-option-${optionWhere(source, true)}`);
    const staleCheck = screen.getByTestId('pilot-check');
    const rawA = kvA.raw();

    await screen.rerender(<UnitAPilotScreen {...props(storeB, { owner: 'owner-b' })} />);
    expect(screen.queryByTestId('pilot-question')).toBeNull();
    expect(optionIds()).toEqual([]);
    await pressStale(staleCheck);
    await screen.findByTestId('pilot-lesson');
    await settle();
    expect(screen.queryByTestId('pilot-question')).toBeNull();
    expect(screen.queryByTestId('pilot-feedback')).toBeNull();
    expect(kvA.raw()).toBe(rawA);
    const lessonB = await readDoc(kvB);
    expect(lessonB?.owner ?? 'owner-b').toBe('owner-b');
    expect(lessonB?.attempts ?? []).toEqual([]);

    await press('pilot-next');
    await screen.findByTestId('pilot-question');
    const docB = await readDoc(kvB);
    expect(docB).toMatchObject({ owner: 'owner-b', attempts: [], current: { day: DAY } });
    expect(docB?.current?.presentationId).not.toBe(currentA.presentationId);
    expect(kvA.raw()).toBe(rawA);

    const rawB = kvB.raw();
    await screen.rerender(<UnitAPilotScreen {...props(storeB, { owner: 'owner-b', readOnly: 'storage is read-only' })} />);
    expect(screen.queryByTestId('pilot-question')).toBeNull();
    expect(optionIds()).toEqual([]);
    await settle();
    expect(screen.queryByTestId('pilot-question')).toBeNull();
    expect(kvB.raw()).toBe(rawB);
  });
});
