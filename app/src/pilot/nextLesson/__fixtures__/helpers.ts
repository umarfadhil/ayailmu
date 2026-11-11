import { KvStore, memoryKv } from '@/storage/kvStore';
import { PILOT_CONTENT } from '@/pilot/unitA/content';
import { createPilotController, PILOT_META_KEY, type PilotView } from '@/pilot/unitA/controller';

const JAN1 = '2026-01-01';
const JAN2 = '2026-01-02';
const JAN3 = '2026-01-03';

export type Controller = ReturnType<typeof createPilotController>;
export type Question = Extract<PilotView, { kind: 'question' }>;
type PilotItem = (typeof PILOT_CONTENT.items)[number];
export interface Clock {
  day: string;
}

/** In-memory backend; `failWrites` makes every setItem throw (nothing is stored). */
export function backend() {
  const inner = memoryKv();
  const kv = {
    failWrites: false,
    raw: (): string | null => inner.getItem(KvStore.KEY),
    getItem: (k: string): string | null => inner.getItem(k),
    setItem: (k: string, v: string): void => {
      if (kv.failWrites) throw new Error('test backend: write failed');
      inner.setItem(k, v);
    },
    removeItem: (k: string): void => inner.removeItem(k),
  };
  return kv;
}
export type Kv = ReturnType<typeof backend>;

export async function open(kv: Kv): Promise<KvStore> {
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

function item(id: string): PilotItem {
  const found = PILOT_CONTENT.items.find((i) => i.id === id);
  if (!found) throw new Error(`unknown item ${id}`);
  return found;
}

// Keys come from the pilot content only.
function keyFor(q: Question): string {
  const key = item(q.itemId).options.find((o) => o.correct)?.id;
  if (!key) throw new Error(`item ${q.itemId} has no correct option`);
  return key;
}

/**
 * The real Unit A controller: both lessons and every practice item correct on Jan 1, then every transfer item
 * correct on Jan 2, until it reports provisional progress. Throws if it ends anywhere else.
 */
export async function qualifyUnitA(store: KvStore, owner: string, clock: Clock): Promise<void> {
  clock.day = JAN1;
  const random = seeded(13);
  const c = createPilotController({
    store,
    owner,
    mode: 'developer-demo',
    today: () => clock.day,
    readOnly: () => false,
    active: () => true,
    assistedToday: async () => false,
    random,
  });
  try {
    let view: PilotView = await c.load();
    for (let step = 0; view.kind !== 'progress'; step += 1) {
      if (step > 60) throw new Error(`Unit A did not qualify after 60 actions (last: ${view.kind})`);
      if (view.kind === 'awaiting-transfer') {
        if (clock.day !== JAN1) throw new Error(`awaiting transfer on ${clock.day}, expected ${JAN1}`);
        clock.day = JAN2;
        view = await c.load();
        continue;
      }
      if (view.kind === 'question') {
        const answered = await c.answer(view.presentationId, keyFor(view));
        if (answered.kind === 'progress') {
          view = answered;
          break;
        }
      } else if (view.kind !== 'lesson') {
        throw new Error(`unexpected view while qualifying: ${view.kind}`);
      }
      view = await c.next();
    }
    if (view.kind !== 'progress' || view.provisional !== true) throw new Error('Unit A did not reach provisional progress');
    if (clock.day !== JAN2) throw new Error(`Unit A qualified on ${clock.day}, expected ${JAN2}`);
    if ((await store.getMeta(PILOT_META_KEY)) === null) throw new Error('Unit A qualified without stored pilot state');
  } finally {
    c.dispose();
  }
}

/** An isolated store whose owner has qualified Unit A, with the clock on the next day. */
export async function qualifiedFixture(owner = 'next-test-owner') {
  const kv = backend();
  const store = await open(kv);
  const clock: Clock = { day: JAN1 };
  await qualifyUnitA(store, owner, clock);
  clock.day = JAN3;
  return { kv, store, clock, owner };
}
export type QualifiedFixture = Awaited<ReturnType<typeof qualifiedFixture>>;
