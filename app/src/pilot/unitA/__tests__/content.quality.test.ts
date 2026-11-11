// Content-quality regressions from docs/Unit_A_Pilot_Content_Review.md (issues 4, 6, 9).
// These enforce instruction/lexical coverage and reserved-solution integrity only.
// They do not certify Arabic grammar or Indonesian wording; reviewer sign-off stays PENDING.
import { PILOT_CONTENT, validatePilotContent } from '../content';

// Consonant skeleton: harakat (Mn) dropped after NFC so a decomposed hamza survives as أ.
const skeleton = (text: string): string =>
  text.normalize('NFC').replace(/\p{Mn}/gu, '').replace(/[\p{P}\s]+/gu, ' ').trim();

// Vocalised form with each run of harakat sorted, so mark order (e.g. shadda+kasra) is irrelevant.
const vocalised = (text: string): string =>
  text.normalize('NFD').replace(/\p{Mn}+/gu, (run) => [...run].sort().join('')).replace(/[\p{P}\s]+/gu, ' ').trim();

const PRONOUNS = ['أَنَا', 'أَنْتَ', 'أَنْتِ', 'هُوَ', 'هِيَ'].map(skeleton);
const subjectOf = (arabic: string): string => skeleton(arabic).split(' ')[0] ?? '';
const isSingularNoun = (word: string): boolean => word.startsWith('ال') && !/(ان|ات|ون)$/.test(word);

const byId = <T extends { readonly id: string }>(list: readonly T[], id: string): T => {
  const found = list.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`Unit A pilot fixture "${id}" is missing`);
  return found;
};

const keyOf = <T extends { readonly correct: boolean }>(options: readonly T[], id: string): T => {
  const [key, ...extra] = options.filter((option) => option.correct);
  if (key === undefined || extra.length > 0) throw new Error(`${id} must have exactly one correct option`);
  return key;
};

// Mutable mirror of the fields these probes touch; the copy is passed to the validator as unknown input.
type Draft = {
  lessons: { id: string; body: string[] }[];
  items: { id: string; arabic: string; options: { text: string; correct: boolean; feedback: string }[] }[];
};

const draft = (): Draft => {
  expect(validatePilotContent(PILOT_CONTENT)).toEqual([]);
  const copy: Draft = JSON.parse(JSON.stringify(PILOT_CONTENT));
  return copy;
};

const expectRejected = (copy: Draft): void => {
  const before = JSON.stringify(copy);
  expect(validatePilotContent(copy)).not.toEqual([]);
  expect(JSON.stringify(copy)).toBe(before);
};

it('agreement lesson works through both a singular noun subject and a pronoun subject before assessing them', () => {
  const lesson = byId(PILOT_CONTENT.lessons, 'ua-d01-agr-lesson');
  const explained = lesson.examples
    .filter((example) => example.meaning.trim() !== '' && example.explanation.trim() !== '')
    .map((example) => ({ subject: subjectOf(example.arabic), explanation: skeleton(example.explanation) }))
    .filter(({ subject, explanation }) => subject !== '' && explanation.includes(subject))
    .map(({ subject }) => subject);
  expect(explained.filter(isSingularNoun)).not.toEqual([]);
  expect(explained.filter((subject) => PRONOUNS.includes(subject))).not.toEqual([]);
});

it('glosses the base lexeme of every opposite-meaning agreement distractor', () => {
  const lexemes: Readonly<Record<string, string>> = {
    'ua-d01-agr-p01': 'صَغِيرٌ',
    'ua-d01-agr-p02': 'قَدِيمٌ',
    'ua-d01-agr-d7-01': 'ضَيِّقٌ',
    'ua-d01-agr-d7-02': 'حَزِينٌ',
    'ua-d01-agr-d30-01': 'قَصِيرٌ',
    'ua-d01-agr-d30-02': 'غَاضِبٌ',
  };
  const missing = Object.entries(lexemes)
    .filter(([id, lexeme]) => !byId(PILOT_CONTENT.items, id).glosses.some(
      (gloss) => vocalised(gloss.arabic) === vocalised(lexeme) && gloss.meaning.trim() !== '',
    ))
    .map(([id, lexeme]) => `${id}: ${lexeme}`);
  expect(missing).toEqual([]);
});

it('rejects an assessment whose full Arabic answer reuses an earlier practice answer despite a fresh stimulus', () => {
  const copy = draft();
  const practiceKey = keyOf(byId(copy.items, 'ua-d01-agr-p01').options, 'ua-d01-agr-p01');
  const assessment = byId(copy.items, 'ua-d01-agr-d7-01');
  const assessmentKey = keyOf(assessment.options, assessment.id);
  expect(skeleton(assessmentKey.text)).not.toBe(skeleton(practiceKey.text));
  expect(skeleton(practiceKey.text)).not.toContain(skeleton(assessment.arabic));
  assessmentKey.text = practiceKey.text;
  expectRejected(copy);
});

it('rejects two assessment items sharing one full Arabic answer under different stimuli', () => {
  const copy = draft();
  const first = byId(copy.items, 'ua-d01-agr-t01');
  const second = byId(copy.items, 'ua-d01-agr-t02');
  const firstKey = keyOf(first.options, first.id);
  const secondKey = keyOf(second.options, second.id);
  expect(skeleton(first.arabic)).not.toBe(skeleton(second.arabic));
  expect(skeleton(firstKey.text)).not.toBe(skeleton(secondKey.text));
  secondKey.text = firstKey.text;
  expectRejected(copy);
});

it('rejects the full Indonesian solution of ua-d01-ref-t01 copied into a lesson body', () => {
  const copy = draft();
  const assessment = byId(copy.items, 'ua-d01-ref-t01');
  const solution = keyOf(assessment.options, assessment.id).text;
  expect(skeleton(solution)).not.toContain(skeleton(assessment.arabic));
  byId(copy.lessons, 'ua-d01-ref-lesson').body.push(solution);
  expectRejected(copy);
});

it('rejects the full Indonesian solution of ua-d01-ref-t01 copied into earlier practice feedback', () => {
  const copy = draft();
  const assessment = byId(copy.items, 'ua-d01-ref-t01');
  const solution = keyOf(assessment.options, assessment.id).text;
  expect(skeleton(solution)).not.toContain(skeleton(assessment.arabic));
  const practiceKey = keyOf(byId(copy.items, 'ua-d01-ref-p02').options, 'ua-d01-ref-p02');
  practiceKey.feedback = `${practiceKey.feedback} ${solution}`;
  expectRejected(copy);
});
