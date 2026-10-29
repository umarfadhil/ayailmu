// Liveness contract for the journal's reconcile on a real account dataset (KvStore on memoryKv, opened as owner).
// A reconcile that is no longer active must not save the journal or publish its sources, and a guarded reconcile
// never falls back to an unguarded save. Neither reconcile(active) nor JournalStorage.saveGuarded exists yet, so
// the guarded cases fail until they do. Every case checks the persisted journal, never calls on a mock.
import { accountNamespace, openKvDataset } from '../../account/datasets';
import { memoryKv } from '../../storage/kvStore';
import type { Learner } from '../../storage/types';
import type { LockManagerLike } from '../../storage/webStore';
import { openJournal, type JournalDataset, type SyncJournal } from '../journal';

const ACCOUNT = '3f2b8c1e-5d4a-4b7e-9c1a-2e6f8a0b1c3d';

const LEARNER: Learner = {
  learner_id: 'learner-1',
  created_at: '2026-10-28T00:00:00.000Z',
  consent_version: 'v1',
  consent_at: '2026-10-28T00:00:00.000Z',
  age_confirmed: true,
  session_minutes: 10,
  arabic_scale: 1,
  screens_seen: ['welcome'],
};

/** Grants every request: this test process is the one tab, so it owns each writer lock. */
const ownerLocks: LockManagerLike = { request: (_name, _options, cb) => Promise.resolve(cb({})) };

/** A synthetic account whose dataset holds one learner and no answers: reconcile adds that learner as a source. */
async function account() {
  const dataset = await openKvDataset({ kv: memoryKv(), locks: ownerLocks, namespace: accountNamespace(ACCOUNT) });
  await dataset.store.saveLearner(LEARNER);
  return dataset;
}

const open = (dataset: JournalDataset) => openJournal({ dataset, accountId: ACCOUNT, appVersion: '1.0.0' });

/** reconcile as the future additive `reconcile(active?)`; assignable today because a shorter signature fits. */
const guarded = (journal: SyncJournal): ((active?: () => boolean) => Promise<number>) => journal.reconcile.bind(journal);

const sources = (journal: SyncJournal) => journal.view().sources.map((s) => s.learnerId);

describe('journal reconcile liveness', () => {
  it('persists the source learner while the guard stays true; a reopened journal sees it', async () => {
    const dataset = await account();
    const journal = await open(dataset);

    await expect(guarded(journal)(() => true)).resolves.toBe(0);

    expect(sources(journal)).toEqual([LEARNER.learner_id]);
    expect(sources(await open(dataset))).toEqual([LEARNER.learner_id]);
  });

  it('a guard lost while the raw read is held saves no journal and publishes no source', async () => {
    const dataset = await account();
    let hold: Promise<void> = Promise.resolve();
    const held: JournalDataset = { ...dataset, raw: { ...dataset.raw, readRaw: () => hold.then(() => dataset.raw.readRaw()) } };
    const journal = await open(held);

    let release: () => void = () => undefined;
    hold = new Promise<void>((resolve) => (release = resolve));
    let live = true;
    const pending = guarded(journal)(() => live);
    live = false;
    release();

    await expect(pending).resolves.toBe(0);
    expect(await dataset.journal.load()).toBeNull();
    expect(sources(journal)).toEqual([]);

    // A guard that is already false before the call changes nothing either.
    await expect(guarded(journal)(() => false)).resolves.toBe(0);
    expect(await dataset.journal.load()).toBeNull();
    expect(sources(journal)).toEqual([]);
  });

  it('rejects a guarded reconcile on journal storage without saveGuarded, never saving unguarded; unguarded reconcile still works', async () => {
    const dataset = await account();
    const bare: JournalDataset = { ...dataset, journal: { load: () => dataset.journal.load(), save: (text) => dataset.journal.save(text) } };
    const journal = await open(bare);

    await expect(guarded(journal)(() => true)).rejects.toThrow();
    expect(await dataset.journal.load()).toBeNull();
    expect(sources(journal)).toEqual([]);

    await expect(journal.reconcile()).resolves.toBe(0);
    expect(sources(await open(dataset))).toEqual([LEARNER.learner_id]);
  });
});
