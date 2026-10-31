/**
 * @jest-environment node
 */
// Guest Unit A progress after an explicit guest copy, RED (regression-first). The generic copy carries the guest's pilot
// document into the account byte for byte, still owned by "guest:<learner>", so the account's controller
// ("account:<learner>") blocks it as another owner's; and pilot-only progress has no AnswerRecord, so nothing offered it.
// hasGuestPilotProgress offers only the guest's own current document with real lesson or attempt activity.
// adoptGuestPilot, after the explicit copy only, first archives the exact guest document under
// PILOT_GUEST_ARCHIVE_PREFIX + sha256(raw), then, only while the account's working document is still exactly the imported
// one and its learner is the guest's, rewrites its owner and nothing else. Another learner's imported copy is archived
// and cleared (only on an exact match); the account's own progress is never overwritten. Real memory KvStore datasets,
// the real copy and the real controller (developer demo); every value is a fixture.
import { accountNamespace, copyGuestToAccount, GUEST_NAMESPACE, kvRawSource, openKvDataset, type GuestCopyConsent, type OpenedKvDataset } from '@/account/datasets';
import { KvStore, memoryKv, readKvRaw, type KvBackend } from '@/storage/kvStore';
import type { RawDataset } from '@/storage/rawRecords';
import type { Learner, Store } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { sha256Hex } from '@/sync/sha256';
import { PILOT_META_KEY } from '../capture';
import { createPilotController, unitAStatus, type PilotView } from '../controller';
import { adoptGuestPilot, hasGuestPilotProgress, PILOT_GUEST_ARCHIVE_PREFIX } from '../guestImport';

const LEARNER_ID = 'lrn-guest-pilot-1';
const OTHER_ID = 'lrn-account-own-2';
const GUEST_OWNER = `guest:${LEARNER_ID}`;
const ACCOUNT_OWNER = `account:${LEARNER_ID}`;
const ACCOUNT_ID = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const GUEST_KEY = GUEST_NAMESPACE.kvKey;
const ACCOUNT_KEY = accountNamespace(ACCOUNT_ID).kvKey;
const DAY = '2026-10-27';
const CONSENT: GuestCopyConsent = { copyGuestData: true, at: '2026-10-27T04:00:00.000Z' };
/** No other tab exists here: every writer lock is granted. */
const OWN_LOCKS: LockManagerLike = { request: (_name, _options, callback) => Promise.resolve(callback({})) };

const learnerOf = (id: string): Learner => ({
  learner_id: id,
  created_at: '2026-10-20T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-20T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: [],
});

const archiveKey = (raw: string) => `${PILOT_GUEST_ARCHIVE_PREFIX}${sha256Hex(raw)}`;

function controller(store: Store, owner: string) {
  return createPilotController({
    store,
    owner,
    mode: 'developer-demo',
    today: () => DAY,
    readOnly: () => false,
    active: () => true,
    assistedToday: async () => false,
    random: () => 0.5,
  });
}

/** A device whose guest learner has Unit A progress only in the pilot document: a lesson shown, or paused at feedback. */
async function guestDevice(stage: 'lesson' | 'feedback', kv: KvBackend = memoryKv()) {
  const guest = new KvStore(kv);
  await guest.init();
  await guest.saveLearner(learnerOf(LEARNER_ID));
  const c = controller(guest, GUEST_OWNER);
  let view: PilotView = await c.load();
  expect(view.kind).toBe('lesson');
  if (stage === 'feedback') {
    const q = await c.next();
    if (q.kind !== 'question') throw new Error(`expected a question, got ${q.kind}`);
    view = await c.answer(q.presentationId, q.options[1]!.id);
    expect(view.kind).toBe('feedback');
  }
  c.dispose();
  const pilotRaw = (await guest.getMeta(PILOT_META_KEY))!;
  expect(await guest.listAnswers()).toEqual([]);
  return { kv, view, pilotRaw, guestBytes: kv.getItem(GUEST_KEY), source: () => readKvRaw(kv, GUEST_KEY) };
}

const openAccount = (kv: KvBackend) => openKvDataset({ kv, locks: OWN_LOCKS, namespace: accountNamespace(ACCOUNT_ID) });

/** The explicit generic guest copy: no guest answers to copy, only the learner (if missing) and metadata. */
async function copyGuest(kv: KvBackend, account: OpenedKvDataset) {
  expect(await copyGuestToAccount({ from: kvRawSource(kv, GUEST_NAMESPACE), to: account.raw, consent: CONSENT })).toEqual({ answers: 0, reports: 0 });
}

const adopt = (account: OpenedKvDataset, source: RawDataset | null, over: Partial<Parameters<typeof adoptGuestPilot>[0]> = {}) =>
  adoptGuestPilot({ store: account.store, source, consent: CONSENT, active: () => true, today: DAY, ...over });

/** The outcome, with a rejection as 'refused'. */
const settle = (outcome: Promise<string>) => outcome.then((value) => value, () => 'refused');

const blobOf = (text: string | null) => JSON.parse(text ?? 'null') as Record<string, unknown> & { meta: Record<string, string>; answers: unknown[] };

it('a paused guest, explicitly copied, is adopted: the account resumes the same feedback, the guest and its exact archive kept, no answer backfilled; a repeat changes nothing', async () => {
  const g = await guestDevice('feedback');
  const source = g.source();
  expect(source?.answers).toEqual([]);
  expect(hasGuestPilotProgress(source, DAY)).toBe(true);
  const account = await openAccount(g.kv);
  await copyGuest(g.kv, account);
  // The reproduced failure: the generic copy keeps the guest owner, which the account's controller refuses.
  expect(await account.store.getMeta(PILOT_META_KEY)).toBe(g.pilotRaw);
  const refusing = controller(account.store, ACCOUNT_OWNER);
  expect(await refusing.load()).toEqual({ kind: 'blocked', reason: 'owner' });
  refusing.dispose();
  const before = blobOf(g.kv.getItem(ACCOUNT_KEY));

  expect(await adopt(account, source)).toBe('adopted');

  const after = blobOf(g.kv.getItem(ACCOUNT_KEY));
  const adopted = after.meta[PILOT_META_KEY]!;
  // The owner changed and nothing else: attempts, order, days and current exactly as the guest left them.
  expect(JSON.parse(adopted)).toEqual({ ...JSON.parse(g.pilotRaw), owner: ACCOUNT_OWNER });
  expect(unitAStatus(adopted, ACCOUNT_OWNER, DAY)).not.toBeNull();
  // Only the working document and the exact archive changed; no answer, learner or snapshot was written.
  const { meta: metaBefore, ...restBefore } = before;
  const { meta: metaAfter, ...restAfter } = after;
  expect(restAfter).toEqual(restBefore);
  expect({ ...metaAfter, [PILOT_META_KEY]: null }).toEqual({ ...metaBefore, [PILOT_META_KEY]: null, [archiveKey(g.pilotRaw)]: g.pilotRaw });
  expect(after.answers).toEqual([]);
  expect((await account.store.getLearner())?.learner_id).toBe(LEARNER_ID);
  expect(g.kv.getItem(GUEST_KEY)).toBe(g.guestBytes);

  const adoptedBytes = g.kv.getItem(ACCOUNT_KEY);
  expect(await adopt(account, g.source())).toBe('unchanged');
  expect(g.kv.getItem(ACCOUNT_KEY)).toBe(adoptedBytes);

  const resumed = controller(account.store, ACCOUNT_OWNER);
  expect(await resumed.load()).toEqual(g.view);
  resumed.dispose();
  expect(g.kv.getItem(ACCOUNT_KEY)).toBe(adoptedBytes);
  expect(g.kv.getItem(GUEST_KEY)).toBe(g.guestBytes);
});

it('offers lesson-only and answered guest progress with an empty answer log; an absent, empty, unreadable, incoherent, foreign or other-content document is not offered', async () => {
  for (const stage of ['lesson', 'feedback'] as const) {
    const source = (await guestDevice(stage)).source();
    expect(source?.answers).toEqual([]);
    expect([stage, hasGuestPilotProgress(source, DAY)]).toEqual([stage, true]);
  }
  const g = await guestDevice('feedback');
  const source = g.source()!;
  const doc = JSON.parse(g.pilotRaw) as Record<string, unknown>;
  const withPilot = (raw: string | null): RawDataset => {
    const meta = { ...source.meta };
    if (raw === null) delete meta[PILOT_META_KEY];
    else meta[PILOT_META_KEY] = raw;
    return { ...source, meta };
  };
  const cases: [string, RawDataset | null][] = [
    ['no guest dataset', null],
    ['no pilot document', withPilot(null)],
    ['a document without activity', withPilot(JSON.stringify({ ...doc, attempts: [], current: null, presentations: [], lessons: [] }))],
    ['unreadable', withPilot('{"owner":')],
    ['incoherent', withPilot(JSON.stringify({ ...doc, lessons: null }))],
    ['another guest learner', withPilot(JSON.stringify({ ...doc, owner: 'guest:lrn-someone-else' }))],
    ['already account-owned', withPilot(JSON.stringify({ ...doc, owner: ACCOUNT_OWNER }))],
    ['other content', withPilot(JSON.stringify({ ...doc, contentVersion: `${String(doc.contentVersion)}-other` }))],
    ['no guest learner', { ...source, learner: null }],
  ];
  for (const [what, candidate] of cases) expect([what, hasGuestPilotProgress(candidate, DAY)]).toEqual([what, false]);

  // Nothing to adopt: nothing is written.
  const account = await openAccount(g.kv);
  expect(await adopt(account, withPilot(null))).toBe('none');
  expect(g.kv.getItem(ACCOUNT_KEY)).toBeNull();
});

it('without exactly an explicit copy consent, when inactive (also from the moment its queued update begins) or against a different archive, nothing changes', async () => {
  const variants: [string, (account: OpenedKvDataset, raw: string) => Promise<Partial<Parameters<typeof adoptGuestPilot>[0]>>][] = [
    ['no consent', async () => ({ consent: null as unknown as GuestCopyConsent })],
    ['a merely truthy consent', async () => ({ consent: { copyGuestData: 'yes', at: CONSENT.at } as unknown as GuestCopyConsent })],
    ['a consent without its time', async () => ({ consent: { copyGuestData: true, at: '' } as GuestCopyConsent })],
    ['inactive', async () => ({ active: () => false })],
    [
      'deactivated as its queued update begins',
      async (account) => {
        let live = true;
        const store = new Proxy(account.store, {
          get(target, prop) {
            if (prop === 'updateMeta') {
              return (key: string, transform: (raw: string | null) => Promise<string | null>) => {
                live = false;
                return target.updateMeta!(key, transform);
              };
            }
            const value: unknown = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return { store, active: () => live };
      },
    ],
    [
      'an archive already holding other bytes',
      async (account, raw) => {
        await account.store.setMeta(archiveKey(raw), `${raw} `);
        return {};
      },
    ],
  ];
  for (const [what, prepare] of variants) {
    const g = await guestDevice('feedback');
    const account = await openAccount(g.kv);
    await copyGuest(g.kv, account);
    const over = await prepare(account, g.pilotRaw);
    const before = g.kv.getItem(ACCOUNT_KEY);
    const outcome = await settle(adopt(account, g.source(), over));
    expect([what, outcome === 'adopted' || outcome === 'archived']).toEqual([what, false]);
    expect([what, g.kv.getItem(ACCOUNT_KEY) === before, g.kv.getItem(GUEST_KEY) === g.guestBytes]).toEqual([what, true, true]);
  }
});

it('when the adopted document fails to save after the archive, the archive and the exact imported copy remain, and one retry adopts', async () => {
  const kv = memoryKv();
  let failAdoption = 0;
  const accountOwned = (text: string) => {
    const pilot: unknown = (JSON.parse(text) as { meta?: Record<string, string> }).meta?.[PILOT_META_KEY];
    return typeof pilot === 'string' && (JSON.parse(pilot) as { owner?: unknown }).owner === ACCOUNT_OWNER;
  };
  const backend: KvBackend = {
    getItem: (key) => kv.getItem(key),
    removeItem: (key) => kv.removeItem(key),
    setItem: (key, value) => {
      if (failAdoption > 0 && key === ACCOUNT_KEY && accountOwned(value)) {
        failAdoption -= 1;
        throw new Error('simulated storage failure');
      }
      kv.setItem(key, value);
    },
  };
  const g = await guestDevice('feedback', backend);
  const account = await openAccount(backend);
  await copyGuest(backend, account);

  failAdoption = 1;
  await expect(adopt(account, g.source())).rejects.toThrow();
  expect(failAdoption).toBe(0);
  const stored = blobOf(kv.getItem(ACCOUNT_KEY)).meta;
  expect(stored[archiveKey(g.pilotRaw)]).toBe(g.pilotRaw);
  expect(stored[PILOT_META_KEY]).toBe(g.pilotRaw);
  expect(await account.store.getMeta(PILOT_META_KEY)).toBe(g.pilotRaw);

  expect(await adopt(account, g.source())).toBe('adopted');
  expect(JSON.parse((await account.store.getMeta(PILOT_META_KEY))!)).toEqual({ ...JSON.parse(g.pilotRaw), owner: ACCOUNT_OWNER });
  expect(await account.store.getMeta(archiveKey(g.pilotRaw))).toBe(g.pilotRaw);
  const resumed = controller(account.store, ACCOUNT_OWNER);
  expect(await resumed.load()).toEqual(g.view);
  resumed.dispose();
  expect(await account.store.listAnswers()).toEqual([]);
  expect(kv.getItem(GUEST_KEY)).toBe(g.guestBytes);
});

it("the account's own Unit A progress is never overwritten: the guest document is only archived beside it", async () => {
  const g = await guestDevice('feedback');
  const account = await openAccount(g.kv);
  await account.store.saveLearner(learnerOf(OTHER_ID));
  const own = controller(account.store, `account:${OTHER_ID}`);
  const ownView = await own.load();
  own.dispose();
  const ownRaw = await account.store.getMeta(PILOT_META_KEY);
  expect(ownRaw).not.toBeNull();
  await copyGuest(g.kv, account);
  expect(await account.store.getMeta(PILOT_META_KEY)).toBe(ownRaw);

  expect(await adopt(account, g.source())).toBe('archived');
  expect(await account.store.getMeta(archiveKey(g.pilotRaw))).toBe(g.pilotRaw);
  expect(await account.store.getMeta(PILOT_META_KEY)).toBe(ownRaw);
  expect((await account.store.getLearner())?.learner_id).toBe(OTHER_ID);

  const archivedBytes = g.kv.getItem(ACCOUNT_KEY);
  expect(await settle(adopt(account, g.source()))).not.toBe('adopted');
  expect(g.kv.getItem(ACCOUNT_KEY)).toBe(archivedBytes);
  const resumed = controller(account.store, `account:${OTHER_ID}`);
  expect(await resumed.load()).toEqual(ownView);
  resumed.dispose();
  expect(g.kv.getItem(GUEST_KEY)).toBe(g.guestBytes);
});

it("for another account learner, the exact imported guest copy is archived and cleared so the account starts fresh; a copy differing by a byte is left as it is", async () => {
  const g = await guestDevice('feedback');
  const account = await openAccount(g.kv);
  await account.store.saveLearner(learnerOf(OTHER_ID));
  await copyGuest(g.kv, account);
  // The generic copy imported the guest's document beside a learner it does not belong to.
  expect(await account.store.getMeta(PILOT_META_KEY)).toBe(g.pilotRaw);

  expect(await adopt(account, g.source())).toBe('archived');
  expect(await account.store.getMeta(archiveKey(g.pilotRaw))).toBe(g.pilotRaw);
  expect(await account.store.getMeta(PILOT_META_KEY)).toBeNull();
  expect((await account.store.getLearner())?.learner_id).toBe(OTHER_ID);
  expect(await account.store.listAnswers()).toEqual([]);
  const fresh = controller(account.store, `account:${OTHER_ID}`);
  expect((await fresh.load()).kind).toBe('lesson');
  fresh.dispose();
  expect(g.kv.getItem(GUEST_KEY)).toBe(g.guestBytes);

  const h = await guestDevice('feedback');
  const other = await openAccount(h.kv);
  await other.store.saveLearner(learnerOf(OTHER_ID));
  await copyGuest(h.kv, other);
  const reformatted = JSON.stringify(JSON.parse(h.pilotRaw), null, 1);
  await other.store.setMeta(PILOT_META_KEY, reformatted);
  expect(await settle(adopt(other, h.source()))).not.toBe('adopted');
  expect(await other.store.getMeta(PILOT_META_KEY)).toBe(reformatted);
  expect(h.kv.getItem(GUEST_KEY)).toBe(h.guestBytes);
});
