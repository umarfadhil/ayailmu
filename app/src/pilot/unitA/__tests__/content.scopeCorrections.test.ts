import { PILOT_CONTENT, validatePilotContent } from "../content";
import { UNIT_A_STARTER_REVIEW, starterReviewAccess, unitAContentFingerprint } from "../review";

// Narrow technical copy/key regressions for the Unit A scope corrections.
// They come from the parent's direct AI-only key assessment. They are not
// human or expert certification and not proof of learning efficacy. The
// actual compiled review is the owner-authorized AI-only trial acceptance,
// bound to the exact current content hash; nothing here changes it, and the
// content itself stays a synthetic, constructed draft.

type TestOption = { id: string; correct?: boolean };
type TestItem = { id: string; options: TestOption[] };
type TestLesson = { id: string; body: string[]; items?: TestItem[] };
type TestContent = { lessons: TestLesson[]; items?: TestItem[] };

const content = PILOT_CONTENT as unknown as TestContent;

function findLesson(idPattern: RegExp): TestLesson {
  const lesson = content.lessons.find((candidate) => idPattern.test(candidate.id));
  if (!lesson) {
    throw new Error(`No lesson id matches ${idPattern}`);
  }
  return lesson;
}

function allItems(): TestItem[] {
  return content.items ?? content.lessons.flatMap((lesson) => lesson.items ?? []);
}

describe("Unit A scope corrections", () => {
  it("scopes the construct reference lesson to a unit pattern that admits noun subjects", () => {
    const lesson = findLesson(/(^|-)ref($|-)/);
    const intro = lesson.body[0];

    expect(intro).toContain("Di unit ini");
    expect(intro).toContain("masa kini");
    expect(intro).toContain("bukan definisi semua kalimat nominal");
    expect(intro).toContain("kata benda");
  });

  it("scopes the agreement lesson to grammatical gender and regular singular adjectives", () => {
    const lesson = findLesson(/(^|-)agr($|-)/);

    expect(lesson.body[0]).toContain("jenis gramatikal");
    expect(lesson.body[0]).toContain("bukan jenis kelamin biologis");

    expect(lesson.body[1]).toContain("tunggal beraturan");
    expect(lesson.body[1]).toContain("كَبِيرٌ");
    expect(lesson.body[1]).toContain("كَبِيرَةٌ");
    expect(lesson.body[1]).toContain("tidak berlaku untuk semua kata sifat");

    expect(lesson.body[3]).toContain("beraturan di unit ini");
  });

  it("keeps validation clean, the item count fixed, the declared correct keys exact, and the AI-only review bound to them", () => {
    expect(validatePilotContent(PILOT_CONTENT)).toEqual([]);
    expect(content.lessons).toHaveLength(2);

    const items = allItems();
    expect(items).toHaveLength(20);

    const actual = Object.fromEntries(
      items.map((item) => [
        item.id,
        item.options.filter((option) => option.correct).map((option) => option.id),
      ]),
    );

    const expected = {
      "ua-d01-ref-p01": ["b"],
      "ua-d01-ref-p02": ["c"],
      "ua-d01-ref-p03": ["d"],
      "ua-d01-ref-p04": ["a"],
      "ua-d01-agr-p01": ["c"],
      "ua-d01-agr-p02": ["a"],
      "ua-d01-agr-p03": ["d"],
      "ua-d01-agr-p04": ["b"],
      "ua-d01-ref-t01": ["b"],
      "ua-d01-ref-t02": ["d"],
      "ua-d01-agr-t01": ["c"],
      "ua-d01-agr-t02": ["a"],
      "ua-d01-ref-d7-01": ["c"],
      "ua-d01-ref-d7-02": ["a"],
      "ua-d01-ref-d30-01": ["d"],
      "ua-d01-ref-d30-02": ["b"],
      "ua-d01-agr-d7-01": ["d"],
      "ua-d01-agr-d7-02": ["a"],
      "ua-d01-agr-d30-01": ["b"],
      "ua-d01-agr-d30-02": ["c"],
    };

    expect(actual).toEqual(expected);
    // The AI-only trial approval is bound to exactly this keyed content: any key change would also change the hash.
    expect(UNIT_A_STARTER_REVIEW).toMatchObject({
      status: "approved-for-trial",
      contentVersion: PILOT_CONTENT.contentVersion,
      contentSha256: unitAContentFingerprint(),
    });
    expect(starterReviewAccess(UNIT_A_STARTER_REVIEW)).toEqual({ allowed: true });
  });
});
