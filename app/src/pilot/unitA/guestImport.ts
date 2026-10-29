// Guest Unit A progress into an account, only after the learner's explicit guest copy. The generic copy carries the
// guest's pilot document into the account byte for byte, still owned "guest:<learner>", which the account's controller
// ("account:<learner>") blocks as another owner's; and pilot-only progress has no AnswerRecord to offer it by.
// hasGuestPilotProgress offers only the guest learner's own current document, through the controller's strict reading,
// with real lesson or attempt activity. adoptGuestPilot first archives that exact document under
// PILOT_GUEST_ARCHIVE_PREFIX + sha256(raw), never replacing other bytes there. Then, only while the account's working
// document is still exactly the imported one: for the guest's own learner, without captures, its owner becomes
// "account:<learner>" and nothing else changes; for another learner, or with captures (whose records name the guest
// owner), that imported copy is removed so the account starts fresh. Anything else there (the account's own progress, an
// unknown or reformatted document) is never touched, with one exception for a retry after the guest kept learning: the
// generic copy keeps the account's existing metadata, so the working document may still be an earlier explicitly copied
// guest snapshot. Only when it is the same guest learner's strict, canonical, capture-free document with activity, and
// its exact bytes are archived under its own key (the earlier copy's provenance), is that earlier snapshot adopted, owner
// only, for that same account learner ('restored'); the newer guest document stays in its own archive, never merged.
// Both writes are queued store.updateMeta transforms that read the freshest value and learner and check `active` again;
// no answer, learner, snapshot or guest data is ever written.
import type { GuestCopyConsent } from '@/account/datasets';
import type { RawDataset } from '@/storage/rawRecords';
import type { Store } from '@/storage/types';
import { learnerProblem } from '@/storage/validate';
import { sha256Hex } from '@/sync/sha256';
import { PILOT_META_KEY } from './capture';
import { unitAStatus } from './controller';

/** Where an exact guest pilot document is archived in the account: this prefix and the SHA-256 of its bytes. */
export const PILOT_GUEST_ARCHIVE_PREFIX = `${PILOT_META_KEY}_guest_archive:`;

/**
 * 'adopted': the account's working document is now the guest's progress under the account owner. 'restored': the guest
 * document was archived, and the earlier guest snapshot an explicit copy left as the working document is now the
 * account's progress under its owner; the newer guest progress is only in its archive. 'archived': the guest document
 * was archived (or its foreign imported copy cleared) and the account's own progress left as it is. 'unchanged': both
 * were already in place; nothing was written. 'none': no guest progress to adopt; nothing was read.
 */
export type GuestPilotAdoption = 'adopted' | 'restored' | 'archived' | 'unchanged' | 'none';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const hasOwn = (value: Json, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function holds(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

/** The same rule as the guest copy's: exactly `copyGuestData: true` with the time it was given. */
const isConsent = (consent: unknown): consent is GuestCopyConsent =>
  isRecord(consent) && consent.copyGuestData === true && typeof consent.at === 'string' && consent.at !== '';

interface GuestPilot {
  raw: string;
  learnerId: string;
  doc: Json;
}

/** The guest learner's own current pilot document in `source`, with lesson or attempt activity; else null. */
function guestPilotOf(source: RawDataset | null, today: string): GuestPilot | null {
  try {
    if (!isRecord(source) || typeof source.learner !== 'string' || !isRecord(source.meta)) return null;
    const learner: unknown = JSON.parse(source.learner);
    if (!isRecord(learner) || learnerProblem(learner) !== null || !isText(learner.learner_id)) return null;
    return pilotOf(source.meta[PILOT_META_KEY], learner.learner_id, today);
  } catch {
    return null;
  }
}

/** `raw` as the current document of guest learner `learnerId`, through the controller's strict reading, with activity. */
function pilotOf(raw: unknown, learnerId: string, today: string): GuestPilot | null {
  try {
    if (typeof raw !== 'string') return null;
    if (unitAStatus(raw, `guest:${learnerId}`, today) === null) return null;
    const doc: unknown = JSON.parse(raw);
    if (!isRecord(doc) || !Array.isArray(doc.lessons) || !Array.isArray(doc.attempts)) return null;
    if (doc.lessons.length === 0 && doc.attempts.length === 0) return null;
    return { raw, learnerId, doc };
  } catch {
    return null;
  }
}

const archiveKeyOf = (raw: string) => `${PILOT_GUEST_ARCHIVE_PREFIX}${sha256Hex(raw)}`;

/** Whether `source` holds guest Unit A progress worth offering: the guest learner's own current document, with activity. */
export function hasGuestPilotProgress(source: RawDataset | null, today: string): boolean {
  return guestPilotOf(source, today) !== null;
}

/**
 * The guest document under the account owner, owner only: null when it has captures (their records name the guest
 * owner) or is not exactly the controller's own serialization (then the owner would not be the only change).
 */
function adoptedRawOf(pilot: GuestPilot, today: string): string | null {
  if (hasOwn(pilot.doc, 'captures') || JSON.stringify(pilot.doc) !== pilot.raw) return null;
  const owner = `account:${pilot.learnerId}`;
  const next = JSON.stringify({ ...pilot.doc, owner });
  return unitAStatus(next, owner, today) === null ? null : next;
}

const inactive = () => new Error('Guest progress adoption is no longer active; nothing more was written.');

/**
 * After the explicit guest copy only: archives the exact guest pilot document of `source` (the snapshot that copy read)
 * in `store`, then adopts, clears or leaves the account's working document as described above. Rejects, writing
 * nothing, without that exact consent, when inactive, without store.updateMeta, or when the archive key holds other
 * bytes; a failed adoption keeps the archive and the imported document for a retry.
 */
export async function adoptGuestPilot(args: {
  /** Without getMeta, an earlier snapshot's archive cannot be checked, so it is never restored. */
  store: Pick<Store, 'getLearner'> & Partial<Pick<Store, 'updateMeta' | 'getMeta'>>;
  source: RawDataset | null;
  consent: GuestCopyConsent | null;
  active: () => boolean;
  /** Local calendar day, YYYY-MM-DD, both documents are read on. */
  today: string;
}): Promise<GuestPilotAdoption> {
  const { store, source, consent, today } = args;
  const active = () => holds(() => args.active() === true);
  if (!isConsent(consent)) throw new Error('Guest progress is adopted only after an explicit guest copy consent; nothing was written.');
  if (!active()) throw inactive();
  const pilot = guestPilotOf(source, today);
  if (pilot === null) return 'none';
  if (typeof store.updateMeta !== 'function' || typeof store.getLearner !== 'function') {
    throw new Error('Account storage has no atomic metadata update; nothing was written.');
  }
  const updateMeta = (key: string, transform: (raw: string | null) => Promise<string | null>) => store.updateMeta!(key, transform);

  // Filled by the transforms; read only once their writes have succeeded.
  const outcome = { archived: false, adopted: false, restored: false, cleared: false };
  await updateMeta(archiveKeyOf(pilot.raw), async (stored) => {
    if (!active()) throw inactive();
    if (stored === pilot.raw) return stored;
    if (stored !== null) throw new Error('Other bytes are already archived under this guest progress key; nothing was written.');
    outcome.archived = true;
    return pilot.raw;
  });

  const adopted = adoptedRawOf(pilot, today);
  await updateMeta(PILOT_META_KEY, async (working) => {
    if (!active()) throw inactive();
    // Only the exact imported guest document is ever replaced: anything else is the account's own or unknown, except an
    // earlier exact snapshot of the same guest learner that an explicit copy imported and archived, adopted owner only.
    if (working !== pilot.raw) {
      const earlier = pilotOf(working, pilot.learnerId, today);
      const restored = earlier === null ? null : adoptedRawOf(earlier, today);
      if (earlier === null || restored === null || typeof store.getMeta !== 'function') return working;
      const provenance = await store.getMeta(archiveKeyOf(earlier.raw));
      if (!active()) throw inactive();
      if (provenance !== earlier.raw) return working;
      const learner = await store.getLearner();
      if (!active()) throw inactive();
      if (learner?.learner_id !== earlier.learnerId) return working;
      outcome.restored = true;
      return restored;
    }
    const learner = await store.getLearner();
    if (!active()) throw inactive();
    const own = learner?.learner_id === pilot.learnerId;
    if (own && adopted !== null) {
      outcome.adopted = true;
      return adopted;
    }
    if (!own || hasOwn(pilot.doc, 'captures')) {
      outcome.cleared = true;
      return null;
    }
    return working;
  });

  if (outcome.adopted) return 'adopted';
  if (outcome.restored) return 'restored';
  return outcome.archived || outcome.cleared ? 'archived' : 'unchanged';
}
