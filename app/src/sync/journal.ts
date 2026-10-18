// The durable sync journal of one account dataset: the TypeScript counterpart of backend/internal/journal for the
// Expo family only. One document beside the dataset holds the install ID; the originals (each saved answer's exact
// raw text wrapped in envelope v1, never deleted) and which the server acknowledged; one frozen import per local
// learner source (its import ID and exact request text, saved before it is first sent and resent byte for byte); the
// linked profile and its settings base; the preferences the learner changed; the pull cursor; and other devices'
// answers with their exact payload text. Tokens, passwords and addresses are never stored; session snapshots and
// exposure ledgers stay in the learning store and are never sent. Network waits never hold the learning store's
// writer, and nothing pulled ever reaches the learning store.
import type { JournalStorage, RawTarget } from '@/account/datasets';
import type { AccountSession } from '@/account/session';
import type { ApiClient } from '@/api/client';
import type { EmulatorAuth } from '@/auth/emulatorAuth';
import type { Store } from '@/storage/types';

/** The only family this client records, links and pulls. */
export const EXPO_FAMILY = 'expo-trial-arabic';

/** The server's limits (Backend_Local_Contract §5 to §7). Tests may lower them. */
export interface SyncLimits {
  importEvents: number;
  importBytes: number;
  batchEvents: number;
  batchBytes: number;
  pullLimit: number;
}

export const SERVER_LIMITS: SyncLimits = Object.freeze({
  importEvents: 10000,
  importBytes: 16 * 1024 * 1024,
  batchEvents: 500,
  batchBytes: 4 * 1024 * 1024,
  pullLimit: 500,
});

/** What a journal needs of its account dataset (the owner): the learning store, its raw surface and its document. */
export interface JournalDataset {
  store: Store;
  raw: RawTarget;
  journal: JournalStorage;
}

/** The signed-in connection a sync runs on. Every request goes through auth.authorized, so a sign-out or a newer sign-in drops it. */
export interface SyncConnection {
  auth: EmulatorAuth;
  session: AccountSession;
  api: ApiClient;
}

export interface ProfileConsent {
  version: string;
  at: string;
}

/** How an unlinked dataset links: a new adult profile (with the learner's explicit consent), or one of the account's own profiles. */
export type LinkChoice = { kind: 'new-profile'; consent: ProfileConsent } | { kind: 'own-profile'; profileId: string };

/** The preferences this app lets the learner change; the server's other settings are never sent. */
export type PreferenceField = 'session_minutes' | 'arabic_scale';

export interface JournalOriginal {
  eventId: string;
  learnerId: string;
  /** Envelope v1 around the saved answer's exact raw text. */
  envelope: string;
  semanticSha256: string;
  acked: boolean;
  /** Why this original can never be sent (it stays stored), or null. */
  blocked: string | null;
}

/** One local learner of the dataset and its link: its own import, never another learner's. */
export interface JournalSource {
  learnerId: string;
  importId: string | null;
  /** The exact import request text, kept until a verified receipt or a refusal that proves nothing was written. */
  frozen: string | null;
  linked: boolean;
}

/** An answer pulled from another device, kept apart from the learning store. */
export interface RemoteAnswer {
  seq: number;
  eventId: string;
  installId: string;
  learnerId: string;
  /** The payload exactly as the server returned it. */
  payload: string;
}

export interface SettingsDoc {
  revision: number;
  /** The server's settings as returned, members this app does not edit included. */
  settings: Record<string, unknown>;
}

/** A copy of the journal's state, for the UI and for checks. */
export interface JournalView {
  accountId: string;
  installId: string;
  profileId: string | null;
  sources: JournalSource[];
  originals: JournalOriginal[];
  cursor: number;
  remote: RemoteAnswer[];
  base: SettingsDoc | null;
  /** Preferences the learner changed since the base, with the values chosen. */
  changed: Partial<Record<PreferenceField, number>>;
  /** A push refused as stale: the server's current revision and settings, kept until the learner chooses. */
  preferenceConflict: SettingsDoc | null;
  /** Answers whose stored server copy differs; they stay pending. */
  conflicts: string[];
}

export interface SyncReport {
  /** Learner sources linked by this sync. */
  linked: string[];
  /** A linking import was answered as a replay: an earlier attempt had committed. */
  replayed: boolean;
  stored: number;
  identical: number;
  conflicts: string[];
  /** Originals still not acknowledged after this sync. */
  pending: number;
  pulled: number;
}

export interface TruthCounts {
  true: number;
  false: number;
  absent: number;
  unknown: number;
}

/** The server's factual counts for the Expo family (GET /v1/profiles/{pid}/progress); nothing is inferred. */
export interface AccountProgress {
  profileId: string;
  family: string;
  asOfSeq: number;
  events: number;
  excludedUnregistered: number;
  /** The server's statuses verbatim, e.g. "not_assessed_by_server". */
  learned: string;
  retention: string;
  provenance: {
    synthetic: TruthCounts;
    feedbackDeferred: TruthCounts;
    hintUsed: TruthCounts;
    retentionValidFalse: number;
  };
}

export type SyncErrorCode =
  /** No verified account, or another account than the dataset's. Nothing was sent. */
  | 'account_mismatch'
  /** The profile to link is not one of the signed-in account's own. Nothing was sent. */
  | 'not_own_profile'
  /** The dataset is not linked and no link was chosen. */
  | 'not_linked'
  /** The import receipt does not answer the frozen request; nothing was acknowledged or linked. */
  | 'unverified_receipt'
  /** A reply does not match the request; nothing from it was kept. */
  | 'bad_response'
  /** The server refused the request. */
  | 'refused';

export class SyncError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    /** The HTTP status for refused and bad replies, else 0. */
    readonly status: number = 0,
    /** The server's stable problem code for a refusal, else null. */
    readonly problem: string | null = null
  ) {
    super(`Sync stopped: ${code}${status ? ` (${status})` : ''}`);
    this.name = 'SyncError';
  }
}

export type PreferencePush = 'sent' | 'nothing' | 'conflict';

export interface SyncJournal {
  view(): JournalView;
  /** Adds every saved answer of the dataset the journal does not hold yet, e.g. after a stop between saving and queueing. Returns how many. */
  reconcile(): Promise<number>;
  /** One manual sync: link each local learner source (frozen imports), upload later answers, pull the family's new answers. */
  sync(conn: SyncConnection, link: LinkChoice | null): Promise<SyncReport>;
  /** Records a preference change: the intent is saved first, then the learner record. */
  setPreference(field: PreferenceField, value: number): Promise<void>;
  /** Sends the changed preferences as a conditional merge patch; a stale base gives a conflict, never a merge or a retry. */
  pushPreferences(conn: SyncConnection): Promise<PreferencePush>;
  /** Resolves a preference conflict explicitly: keep this device's values, or take the account's. */
  resolvePreferences(choice: 'keep-local' | 'use-server'): Promise<void>;
  /** The linked profile's factual counts for the Expo family. */
  readProgress(conn: SyncConnection): Promise<AccountProgress>;
}

export interface JournalOptions {
  dataset: JournalDataset;
  /** The verified account this dataset belongs to; every sync checks the signed-in account against it. */
  accountId: string;
  /** The installed app version, sent as envelope transport metadata (never part of the semantic hash). */
  appVersion: string;
  limits?: Partial<SyncLimits>;
}

/** Opens (or creates) the journal of an account dataset. */
export async function openJournal(_options: JournalOptions): Promise<SyncJournal> {
  throw new Error('openJournal is not implemented yet');
}
