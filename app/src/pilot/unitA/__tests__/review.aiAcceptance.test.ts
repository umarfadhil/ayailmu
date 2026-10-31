import { PILOT_CONTENT } from "../content";
import { APPROVED_FOR_TRIAL, REVIEW_SECTIONS, UNIT_A_STARTER_REVIEW, starterReviewAccess, unitAContentFingerprint } from "../review";

// Regression for the owner-authorized AI-only trial acceptance of the Unit A starter. The coordinating AI assistant
// (/root/check_fasih_expo) completed all 20 questions at 2026-10-30T10:11:08Z and accepted 4 corrected teaching
// sentences at 2026-10-30T10:25:22Z. That reviewed the correct keys AI-only: it is NOT human or expert certification
// and shows NO learning efficacy or human validation. The content stays a synthetic, constructed draft; the gate never
// changes it. Acceptance assertions are RED while the compiled record is pending, and the denial cases stay fail-closed.

const EXPECTED_FINGERPRINT = "5e8882a34ed33284f9145d11db8486c48f6ec778605ae91b1cd571236bf1a54e";
const EXPECTED_VERSION = "unit-a-pilot-draft-0.1";
const ACCEPTED_AT = "2026-10-30T10:25:22.000Z";
const COMPLETED_ALL_20_AT = "2026-10-30T10:11:08.000Z";

type ReviewPatch = { reviewer?: string; reviewedAt?: string };
type RecordShape = { status?: string; contentVersion?: string; contentSha256?: string; reviews?: Record<string, ReviewPatch | undefined> };
type DenialCase = [name: string, mutate: (record: RecordShape) => RecordShape, reason: RegExp];

const actual = UNIT_A_STARTER_REVIEW as unknown as RecordShape;

/** A deep copy of the actual record; it must itself be allowed, so each denial below is for its one mutation only. */
function approvedClone(): RecordShape {
  expect(starterReviewAccess(UNIT_A_STARTER_REVIEW)).toEqual({ allowed: true });
  return JSON.parse(JSON.stringify(UNIT_A_STARTER_REVIEW)) as RecordShape;
}

function withReview(record: RecordShape, section: string, patch: ReviewPatch): RecordShape {
  return { ...record, reviews: { ...record.reviews, [section]: { ...record.reviews?.[section], ...patch } } };
}

const DENIALS: DenialCase[] = [
  ["pending status", (r) => ({ ...r, status: "pending" }), /not been approved/],
  ["another content version", (r) => ({ ...r, contentVersion: "unit-a-pilot-draft-0.2" }), /another content version/],
  ["wrong hash", (r) => ({ ...r, contentSha256: "0".repeat(64) }), /other content/],
  ["uppercase hash", (r) => ({ ...r, contentSha256: String(r.contentSha256).toUpperCase() }), /other content/],
  ["missing section review", (r) => ({ ...r, reviews: { ...r.reviews, indonesian: undefined } }), /indonesian review/],
  ["missing timestamp", (r) => withReview(r, "arabic", { reviewedAt: undefined }), /arabic review/],
  ["empty reviewer", (r) => withReview(r, "assessment", { reviewer: "   " }), /assessment review/],
  ["impossible timestamp", (r) => withReview(r, "arabic", { reviewedAt: "2026-02-30T10:25:22.000Z" }), /arabic review/],
  ["non-canonical timestamp", (r) => withReview(r, "indonesian", { reviewedAt: "2026-10-30T10:25:22Z" }), /indonesian review/],
];

describe("Unit A AI-only trial acceptance", () => {
  it("records the exact approval for the current content", () => {
    expect(actual.status).toBe(APPROVED_FOR_TRIAL);
    expect(actual.contentVersion).toBe(EXPECTED_VERSION);
    expect(actual.contentSha256).toBe(EXPECTED_FINGERPRINT);
    expect(unitAContentFingerprint()).toBe(EXPECTED_FINGERPRINT);
    expect(starterReviewAccess()).toEqual({ allowed: true });
    expect(starterReviewAccess(UNIT_A_STARTER_REVIEW, PILOT_CONTENT)).toEqual({ allowed: true });
  });

  it("names one AI-only coordinating reviewer in all three categories at the exact acceptance time", () => {
    const reviews = REVIEW_SECTIONS.map((section) => actual.reviews?.[section]);
    const reviewers = reviews.map((review) => review?.reviewer);
    expect(reviewers.every((reviewer) => typeof reviewer === "string")).toBe(true);
    expect(new Set(reviewers).size).toBe(1);
    const reviewer = String(reviewers[0]);
    expect(reviewer).toContain("/root/check_fasih_expo");
    expect(reviewer).toMatch(/coordinating AI assistant/i);
    expect(reviewer).toMatch(/AI-only/i);
    expect(reviewer).toMatch(/\bnot\b[^.;]*\b(human|expert)\b/i);
    expect(reviews.map((review) => review?.reviewedAt)).toEqual([ACCEPTED_AT, ACCEPTED_AT, ACCEPTED_AT]);
    expect(Date.parse(ACCEPTED_AT)).toBeGreaterThan(Date.parse(COMPLETED_ALL_20_AT));
  });

  it("leaves the reviewed content a synthetic, constructed draft of all 20 questions", () => {
    expect(PILOT_CONTENT.contentVersion).toBe(EXPECTED_VERSION);
    expect(PILOT_CONTENT.synthetic).toBe(true);
    expect(PILOT_CONTENT.constructed).toBe(true);
    expect(PILOT_CONTENT.reviewStatus).toBe("draft");
    expect(PILOT_CONTENT.items).toHaveLength(20);
    expect(PILOT_CONTENT.items.every((item) => item.constructed === true && item.reviewStatus === "draft")).toBe(true);
  });
});

describe("Unit A starter review gate denials, from a clone of the actual record", () => {
  it.each(DENIALS)("denies %s", (_name, mutate, reason) => {
    const access = starterReviewAccess(mutate(approvedClone()));
    expect(access.allowed).toBe(false);
    expect(access).toEqual({ allowed: false, reason: expect.stringMatching(reason) });
  });

  it("denies the actual approval once the content has changed", () => {
    const edit = (lesson: (typeof PILOT_CONTENT.lessons)[number], index: number) => (index === 0 ? { ...lesson, title: `${lesson.title} (edited)` } : lesson);
    const changed = { ...PILOT_CONTENT, lessons: PILOT_CONTENT.lessons.map(edit) };
    expect(unitAContentFingerprint(changed)).not.toBe(EXPECTED_FINGERPRINT);
    expect(starterReviewAccess(approvedClone(), changed)).toEqual({ allowed: false, reason: expect.stringMatching(/other content/) });
  });

  it("denies a bare pending record and non-records", () => {
    for (const review of [{ status: "pending" }, null, "approved-for-trial", 0, []]) {
      expect(starterReviewAccess(review).allowed).toBe(false);
    }
  });
});
