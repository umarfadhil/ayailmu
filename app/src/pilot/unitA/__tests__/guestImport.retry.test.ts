/**
 * @jest-environment node
 */
// Guest Unit A adoption retried after the guest kept learning, RED (regression-first). The first explicit copy imports
// the guest's document raw1 and adoption archives it, but the owner rewrite fails to save. The guest then answers its
// current question (raw2). The retried generic copy keeps the account's existing metadata, so the account's working
// document is still raw1: adoption archives raw2 and resumes that earlier, archived raw1 under the account owner
// ('restored'), never raw2 and never a merge. Without raw1's exact archive, for another learner, or for anything not
// that exact earlier guest snapshot, the working document is left as it is. Real memory KvStore datasets, the real copy
// and the real controller (developer demo); every value is a fixture.
import { accountNamespace, copyGuestToAccount, GUEST_NAMESPACE, kvRawSource, openKvDataset, type GuestCopyConsent, type OpenedKvDataset } from '@/account/datasets';
import { KvStore, memoryKv, readKvRaw, type KvBackend } from '@/storage/kvStore';
import type { Learner, Store } from '@/storage/types';
import type { LockManagerLike } from '@/storage/webStore';
import { sha256Hex } from '@/sync/sha256';
import { PILOT_META_KEY } from '../capture';
import { createPilotController, unitAStatus, type PilotView } from '../controller';
import { adoptGuestPilot, PILOT_GUEST_ARCHIVE_PREFIX } from '../guestImport';

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

const blobOf = (text: string | null) => JSON.parse(text ?? 'null') as Record<string, unknown> & { meta: Record<string, string>; answers: unknown[] };

/**
 * A guest shown its first question, explicitly copied into the account; the adoption that follows archives raw1, then
 * its owner rewrite fails to save once. The guest then answers that same question (raw2), and the generic copy is
 * retried. Returns the state just before the retried adoption.
 */
async function afterFailedAdoptionAndGuestProgress(
  prepare: (account: OpenedKvDataset, raw1: string) => Promise<void> = async () => undefined
) {
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

  const guest = new KvStore(backend);
  await guest.init();
  await guest.saveLearner(learnerOf(LEARNER_ID));
  const first = controller(guest, GUEST_OWNER);
  expect((await first.load()).kind).toBe('lesson');
  const question: PilotView = await first.next();
  first.dispose();
  if (question.kind !== 'question') throw new Error(`expected a question, got ${question.kind}`);
  const raw1 = (await guest.getMeta(PILOT_META_KEY))!;

  const account = await openKvDataset({ kv: backend, locks: OWN_LOCKS, namespace: accountNamespace(ACCOUNT_ID) });
  const copy = () => copyGuestToAccount({ from: kvRawSource(backend, GUEST_NAMESPACE), to: account.raw, consent: CONSENT });
  await copy();
  expect(await account.store.getMeta(PILOT_META_KEY)).toBe(raw1);

  failAdoption = 1;
  await expect(adoptGuestPilot({ store: account.store, source: readKvRaw(backend, GUEST_KEY), consent: CONSENT, active: () => true, today: DAY })).rejects.toThrow();
  expect(failAdoption).toBe(0);
  expect(await account.store.getMeta(archiveKey(raw1))).toBe(raw1);
  expect(await account.store.getMeta(PILOT_META_KEY)).toBe(raw1);

  // The guest keeps learning: it answers the same question it was shown.
  const later = controller(guest, GUEST_OWNER);
  expect(await later.load()).toEqual(question);
  const feedback = await later.answer(question.presentationId, question.options[1]!.id);
  later.dispose();
  expect(feedback.kind).toBe('feedback');
  const raw2 = (await guest.getMeta(PILOT_META_KEY))!;
  expect(raw2).not.toBe(raw1);
  expect(await guest.listAnswers()).toEqual([]);

  // The retried generic copy keeps the account's existing metadata: the working document is still raw1.
  expect(await copy()).toEqual({ answers: 0, reports: 0 });
  expect(await account.store.getMeta(PILOT_META_KEY)).toBe(raw1);

  await prepare(account, raw1);
  const retry = () => adoptGuestPilot({ store: account.store, source: readKvRaw(backend, GUEST_KEY), consent: CONSENT, active: () => true, today: DAY });
  return { kv, account, question, feedback, raw1, raw2, guestBytes: kv.getItem(GUEST_KEY), retry };
}

/** The outcome, with a rejection as 'refused'. */
const settle = (outcome: Promise<string>) => outcome.then((value) => value, () => 'refused');

it('a retry after the guest kept learning resumes the earlier copied snapshot at its original question: both archives and the newer guest progress kept, nothing merged or backfilled; a repeat changes nothing', async () => {
  const s = await afterFailedAdoptionAndGuestProgress();
  const before = blobOf(s.kv.getItem(ACCOUNT_KEY));

  expect(await s.retry()).toBe('restored');

  const after = blobOf(s.kv.getItem(ACCOUNT_KEY));
  const working = after.meta[PILOT_META_KEY]!;
  // The earlier snapshot under the account owner, nothing else changed: not the guest's newer document.
  expect(JSON.parse(working)).toEqual({ ...JSON.parse(s.raw1), owner: ACCOUNT_OWNER });
  expect(JSON.parse(working)).not.toEqual({ ...JSON.parse(s.raw2), owner: ACCOUNT_OWNER });
  expect(unitAStatus(working, ACCOUNT_OWNER, DAY)).not.toBeNull();
  // Both exact archives; only the working document and the newer archive changed; no answer or learner written.
  expect(after.meta[archiveKey(s.raw1)]).toBe(s.raw1);
  expect(after.meta[archiveKey(s.raw2)]).toBe(s.raw2);
  const { meta: metaBefore, ...restBefore } = before;
  const { meta: metaAfter, ...restAfter } = after;
  expect(restAfter).toEqual(restBefore);
  expect({ ...metaAfter, [PILOT_META_KEY]: null }).toEqual({ ...metaBefore, [PILOT_META_KEY]: null, [archiveKey(s.raw2)]: s.raw2 });
  expect(after.answers).toEqual([]);
  expect((await s.account.store.getLearner())?.learner_id).toBe(LEARNER_ID);
  expect(s.kv.getItem(GUEST_KEY)).toBe(s.guestBytes);

  // The account resumes the original presentation, unanswered: not the feedback the guest reached.
  const resumed = controller(s.account.store, ACCOUNT_OWNER);
  expect(await resumed.load()).toEqual(s.question);
  resumed.dispose();
  expect(await s.account.store.listAnswers()).toEqual([]);

  const restoredBytes = s.kv.getItem(ACCOUNT_KEY);
  expect(await s.retry()).toBe('unchanged');
  expect(s.kv.getItem(ACCOUNT_KEY)).toBe(restoredBytes);
  expect(s.kv.getItem(GUEST_KEY)).toBe(s.guestBytes);
});

it('without the earlier snapshot exactly archived, for another account learner, or for any other working document, the retry only archives and leaves the working document as it is', async () => {
  const variants: [string, (account: OpenedKvDataset, raw1: string) => Promise<void>][] = [
    ['missing archive', (account, raw1) => account.store.setMeta(archiveKey(raw1), null)],
    ['different archive bytes', (account, raw1) => account.store.setMeta(archiveKey(raw1), `${raw1} `)],
    ['another account learner', (account) => account.store.saveLearner(learnerOf(OTHER_ID))],
    [
      'reformatted, archived under its own key',
      async (account, raw1) => {
        const reformatted = JSON.stringify(JSON.parse(raw1), null, 1);
        await account.store.setMeta(PILOT_META_KEY, reformatted);
        await account.store.setMeta(archiveKey(reformatted), reformatted);
      },
    ],
    [
      'with captures, archived under its own key',
      async (account, raw1) => {
        const captured = JSON.stringify({ ...JSON.parse(raw1), captures: [] });
        await account.store.setMeta(PILOT_META_KEY, captured);
        await account.store.setMeta(archiveKey(captured), captured);
      },
    ],
    [
      "the account's own document, archived under its own key",
      async (account, raw1) => {
        const own = JSON.stringify({ ...JSON.parse(raw1), owner: ACCOUNT_OWNER });
        await account.store.setMeta(PILOT_META_KEY, own);
        await account.store.setMeta(archiveKey(own), own);
      },
    ],
  ];
  for (const [what, prepare] of variants) {
    const s = await afterFailedAdoptionAndGuestProgress(prepare);
    const working = await s.account.store.getMeta(PILOT_META_KEY);
    const learner = await s.account.store.getLearner();

    const outcome = await settle(s.retry());
    expect([what, outcome === 'restored' || outcome === 'adopted']).toEqual([what, false]);
    expect([what, await s.account.store.getMeta(PILOT_META_KEY)]).toEqual([what, working]);
    expect([what, await s.account.store.getLearner()]).toEqual([what, learner]);
    expect([what, await s.account.store.listAnswers()]).toEqual([what, []]);
    expect([what, s.kv.getItem(GUEST_KEY) === s.guestBytes]).toEqual([what, true]);
  }
});
