// The content-review gate for the Unit A starter. Only a compiled review record approves it: status exactly
// "approved-for-trial", the exact content version, the lowercase SHA-256 of the exact JSON of the content, and an
// Arabic, an Indonesian and an assessment review, each with a named reviewer and a strict ISO timestamp. No setting,
// env value or beta capability ever approves content, and the record compiled here stays pending until real reviews
// exist. The source content itself stays a synthetic draft; this gate never changes it.
import { PILOT_CONTENT, type PilotContent } from '@/pilot/unitA/content';
import { sha256Hex } from '@/sync/sha256';

/** The one status that approves the starter for a trial. */
export const APPROVED_FOR_TRIAL = 'approved-for-trial';

/** The review sections an approval needs, each signed by its own reviewer. */
export const REVIEW_SECTIONS = ['arabic', 'indonesian', 'assessment'] as const;

export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

export interface SectionReview {
  /** Who reviewed the section; never empty. */
  reviewer: string;
  /** When, as Date.prototype.toISOString writes it (e.g. 2026-10-20T09:00:00.000Z). */
  reviewedAt: string;
}

export interface PendingStarterReview {
  status: 'pending';
}

export interface ApprovedStarterReview {
  status: typeof APPROVED_FOR_TRIAL;
  contentVersion: string;
  /** The lowercase hex SHA-256 of JSON.stringify of the reviewed content. */
  contentSha256: string;
  reviews: Record<ReviewSection, SectionReview>;
}

export type StarterReview = PendingStarterReview | ApprovedStarterReview;

export type StarterAccess = { allowed: true } | { allowed: false; reason: string };

/** The compiled review of the Unit A starter: pending, with no reviewer, until real reviews are recorded here. */
export const UNIT_A_STARTER_REVIEW: StarterReview = Object.freeze<PendingStarterReview>({ status: 'pending' });

/** The lowercase hex SHA-256 of the exact JSON of `content`. */
export function unitAContentFingerprint(content: PilotContent = PILOT_CONTENT): string {
  return sha256Hex(JSON.stringify(content));
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Exactly the form toISOString writes (UTC, milliseconds, Z), for a real calendar instant. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether `value` is a strict ISO timestamp that round-trips exactly, so no other spelling or impossible date passes. */
export function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

function isSectionReview(value: unknown): value is SectionReview {
  return isRecord(value) && typeof value.reviewer === 'string' && value.reviewer.trim() !== '' && isIsoTimestamp(value.reviewedAt);
}

const denied = (reason: string): StarterAccess => ({ allowed: false, reason });

/**
 * Whether the starter may run for `content`: only when `review` is an exact compiled approval of it, by status,
 * content version, fingerprint and all three section reviews. Anything else, the pending default included, is denied
 * with a reason that never repeats a value.
 */
export function starterReviewAccess(review: unknown = UNIT_A_STARTER_REVIEW, content: PilotContent = PILOT_CONTENT): StarterAccess {
  if (!isRecord(review) || review.status !== APPROVED_FOR_TRIAL) return denied('The starter content has not been approved for a trial.');
  if (review.contentVersion !== content.contentVersion) return denied('The starter review is for another content version.');
  if (typeof review.contentSha256 !== 'string' || !SHA256_HEX.test(review.contentSha256) || review.contentSha256 !== unitAContentFingerprint(content)) {
    return denied('The starter review is for other content.');
  }
  const reviews = review.reviews;
  if (!isRecord(reviews)) return denied('The starter review has no section reviews.');
  for (const section of REVIEW_SECTIONS) {
    if (!isSectionReview(reviews[section])) return denied(`The starter review lacks a complete ${section} review.`);
  }
  return { allowed: true };
}
