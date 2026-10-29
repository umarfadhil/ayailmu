// Factual account progress: a pure projection of the durable journal and a same-account/profile server receipt. No
// React, no storage, no network. Server counts are saved-answer counts, never mastery.
import { EXPO_FAMILY, type AccountProgress, type JournalView } from './journal';

/** The server's progress counts as read for one account, kept with the time they were read. */
export interface ProgressReceipt {
  accountId: string;
  progress: AccountProgress;
  checkedAt: string;
}

export interface AccountSyncProgress {
  queued: number;
  blocked: number;
  conflicts: number;
  deviceAccepted: number;
  capturePending: boolean;
  server: { state: 'unknown' | 'verified' | 'stale'; total: number | null; excluded: number | null; checkedAt: string | null };
}

const CANONICAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** A UTC millisecond timestamp exactly as Date#toISOString writes it: no offsets, no missing milliseconds, no impossible dates. */
function canonicalTime(v: unknown): v is string {
  if (typeof v !== 'string' || !CANONICAL_TIME.test(v)) return false;
  const t = new Date(v);
  return !Number.isNaN(t.getTime()) && t.toISOString() === v;
}

const unknownServer = (): AccountSyncProgress['server'] => ({ state: 'unknown', total: null, excluded: null, checkedAt: null });

/**
 * The server's counts when the receipt belongs to exactly this journal's account and linked profile and is well formed,
 * else unknown with null counts. `events` holds the registered answers and `excludedUnregistered` the stored ones that are
 * not registered, so the two are disjoint and the total is their sum.
 */
function serverFacts(journal: JournalView, receipt: ProgressReceipt | null, state: 'verified' | 'stale'): AccountSyncProgress['server'] {
  if (!receipt || journal.profileId === null) return unknownServer();
  const { progress } = receipt;
  if (receipt.accountId !== journal.accountId || progress.profileId !== journal.profileId || progress.family !== EXPO_FAMILY) return unknownServer();
  if (!canonicalTime(receipt.checkedAt) || !isCount(progress.events) || !isCount(progress.excludedUnregistered)) return unknownServer();
  const total = progress.events + progress.excludedUnregistered;
  if (!Number.isSafeInteger(total)) return unknownServer();
  return { state, total, excluded: progress.excludedUnregistered, checkedAt: receipt.checkedAt };
}

export function projectAccountProgress(input: {
  journal: JournalView;
  receipt: ProgressReceipt | null;
  receiptState?: 'verified' | 'stale';
  capturePending?: boolean;
}): AccountSyncProgress {
  const { journal, receipt, receiptState, capturePending } = input;
  // Each original is exactly one of blocked, accepted on this device, or queued; a blocked one is never also acknowledged.
  let queued = 0;
  let blocked = 0;
  let deviceAccepted = 0;
  const sendable = new Set<string>();
  for (const o of journal.originals) {
    if (o.blocked) {
      blocked += 1;
    } else if (o.acked) {
      deviceAccepted += 1;
    } else {
      queued += 1;
      sendable.add(o.eventId);
    }
  }
  const conflicts = new Set(journal.conflicts.filter((id) => sendable.has(id))).size;
  return {
    queued,
    blocked,
    conflicts,
    deviceAccepted,
    capturePending: capturePending === true,
    server: serverFacts(journal, receipt, receiptState === undefined || receiptState === 'verified' ? 'verified' : 'stale'),
  };
}
