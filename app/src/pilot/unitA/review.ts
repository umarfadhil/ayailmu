// The content-review gate for the Unit A starter. Only a compiled review record approves it: status exactly
// "approved-for-trial", the exact content version, the lowercase SHA-256 of the exact JSON of the content, and an
// Arabic, an Indonesian and an assessment review, each with a named reviewer and a strict ISO timestamp. No setting,
// env value or beta capability ever approves content. The record compiled here is an owner-authorized, AI-only trial
// acceptance (see UNIT_A_STARTER_REVIEW): not human or expert certification, and no learning or mastery validation.
// The source content itself stays a synthetic, constructed draft; this gate never changes it.
import { PILOT_CONTENT, type PilotContent } from '@/pilot/unitA/content';
import { sha256Hex } from '@/sync/sha256';

/** The one status that approves the starter for a trial. */
export const APPROVED_FOR_TRIAL = 'approved-for-trial';

/** The review sections an approval needs, each with a named reviewer. The schema does not require the reviewers to differ. */
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

/**
 * The compiled review of the Unit A starter: an approval for a trial of exactly the content version and fingerprint below.
 *
 * Scope, stated plainly:
 * - ONE reviewer, the coordinating AI assistant, is recorded under all three sections (arabic, indonesian, assessment).
 *   The schema allows the same reviewer in every section; these are not three independent reviews.
 * - It is AI-only. No independent human or expert reviewed the content, and this is not human or expert certification.
 * - It shows no learning efficacy and no mastery validation.
 * - The reviewer completed all 20 questions at 2026-10-30T10:11:08Z, having read the 2 lessons, 3 examples and the 20
 *   questions with their options, keys and explanations, and found the keys correct and unambiguous for the specified
 *   constructed singular patterns. reviewedAt is when the 4 corrected teaching sentences were afterwards accepted.
 * - The content stays a synthetic, constructed draft. The fingerprint ties this approval to exactly that content, so
 *   any edit to the content denies access again until it is reviewed anew.
 * - No signature, expiry or other authority is recorded or implied.
 */
export const UNIT_A_STARTER_REVIEW: StarterReview = Object.freeze<ApprovedStarterReview>({
  status: APPROVED_FOR_TRIAL,
  contentVersion: 'unit-a-pilot-draft-0.1',
  contentSha256: '5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e',
  reviews: Object.freeze({
    arabic: Object.freeze({
      reviewer: '/root/check_fasih_expo — coordinating AI assistant (AI-only; not human/expert certification)',
      reviewedAt: '2026-10-30T10:25:22.000Z',
    }),
    indonesian: Object.freeze({
      reviewer: '/root/check_fasih_expo — coordinating AI assistant (AI-only; not human/expert certification)',
      reviewedAt: '2026-10-30T10:25:22.000Z',
    }),
    assessment: Object.freeze({
      reviewer: '/root/check_fasih_expo — coordinating AI assistant (AI-only; not human/expert certification)',
      reviewedAt: '2026-10-30T10:25:22.000Z',
    }),
  }),
});

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
 * content version, fingerprint and all three section reviews. Anything else, a pending record included, is denied
 * with a reason that never repeats a value. It checks that each section review is complete, not who the reviewer is:
 * it neither requires nor proves independent, human or expert review.
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
