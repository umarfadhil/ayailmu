import { NOMINAL_DEFINITENESS, validateNominalDefiniteness } from '../content';
import type { IncrementContent, IncrementItem, IncrementOption, WorkedExample } from '../schema';

// Guard hardening: small corruptions of the actual content that the validator must reject.
// Each variant is an immutable update of NOMINAL_DEFINITENESS; the source is never mutated.

const content = NOMINAL_DEFINITENESS;
const TATWEEL = String.fromCodePoint(0x0640); // ARABIC TATWEEL
const RLM = String.fromCodePoint(0x200f); // RIGHT-TO-LEFT MARK
const DAMMA = String.fromCodePoint(0x064f);
const DAMMATAN = String.fromCodePoint(0x064c); // tanwin

const itemById = (id: string): IncrementItem => {
  const found = content.items.find((item) => item.item_id === id);
  if (found === undefined) throw new Error(`missing item ${id}`);
  return found;
};

const withItem = (id: string, update: (item: IncrementItem) => IncrementItem): IncrementContent => ({
  ...content,
  items: content.items.map((item) => (item.item_id === id ? update(item) : item)),
});

const withOption = (
  item: IncrementItem,
  pick: (option: IncrementOption) => boolean,
  update: (option: IncrementOption) => IncrementOption,
): IncrementItem => ({
  ...item,
  options: item.options.map((option) => (pick(option) ? update(option) : option)),
});

const withExample = (arabic: string, update: (example: WorkedExample) => WorkedExample): IncrementContent => {
  let done = false;
  return {
    ...content,
    lessons: content.lessons.map((lesson) => ({
      ...lesson,
      screens: lesson.screens.map((screen) => ({
        ...screen,
        examples: screen.examples.map((example) => {
          if (done || example.arabic !== arabic) return example;
          done = true;
          return update(example);
        }),
      })),
    })),
  };
};

/** Appends a reserved transfer solution, in decorated form, to the first wrong p01 feedback. */
const leakIntoP01 = (decorated: string): IncrementContent =>
  withItem('uc-nd-p01', (item) =>
    withOption(
      item,
      (option) => !option.correct,
      (option) => ({ ...option, feedback: `${option.feedback} Bandingkan: ${decorated}.` }),
    ),
  );

const t01Arabic = itemById('uc-nd-t01').solution.arabic;
const p01 = itemById('uc-nd-p01');
const p02 = itemById('uc-nd-p02');

const tatweelLeak = t01Arabic.replace('ب', `ب${TATWEEL}`);
const rlmLeak = t01Arabic.replace(' ', `${RLM} `);

const variants = {
  tatweelLeak: (): IncrementContent => leakIntoP01(tatweelLeak),
  rlmLeak: (): IncrementContent => leakIntoP01(rlmLeak),
  wrongNounMeaning: (): IncrementContent =>
    withItem('uc-nd-p01', (item) =>
      withOption(
        { ...item, solution: { ...item.solution, indonesian: 'Rumah itu besar' } },
        (option) => option.correct,
        (option) => ({ ...option, text: 'Rumah itu besar' }),
      ),
    ),
  wrongExampleMeaning: (): IncrementContent =>
    withExample('الْبَيْتُ الْكَبِيرُ', (example) => ({ ...example, meaning: 'Pena besar itu' })),
  tanwinOnDefiniteAdjective: (): IncrementContent =>
    withItem('uc-nd-p02', (item) =>
      withOption(
        { ...item, solution: { ...item.solution, arabic: 'الْكِتَابُ الْقَدِيمٌ' } },
        (option) => option.correct,
        (option) => ({ ...option, text: 'الْكِتَابُ الْقَدِيمٌ' }),
      ),
    ),
};

describe('nominal-definiteness guard hardening', () => {
  test('rejects a reserved transfer solution leaked into earlier feedback with tatweel inside the noun', () => {
    expect(tatweelLeak).not.toBe(t01Arabic);
    expect(tatweelLeak.replace(TATWEEL, '')).toBe(t01Arabic);
    expect(validateNominalDefiniteness(variants.tatweelLeak())).not.toEqual([]);
  });

  test('rejects a reserved transfer solution leaked into earlier feedback with a right-to-left mark', () => {
    expect(rlmLeak).not.toBe(t01Arabic);
    expect(rlmLeak.replace(RLM, '')).toBe(t01Arabic);
    expect(validateNominalDefiniteness(variants.rlmLeak())).not.toEqual([]);
  });

  test('rejects a keyed meaning whose noun contradicts the taught noun meaning', () => {
    expect(p01.solution.indonesian).toBe('Pena itu besar');
    expect(validateNominalDefiniteness(variants.wrongNounMeaning())).not.toEqual([]);
  });

  test('rejects a worked example meaning that contradicts its Arabic and taught meanings', () => {
    const changed = variants.wrongExampleMeaning().lessons.flatMap((lesson) =>
      lesson.screens.flatMap((screen) => screen.examples.filter((example) => example.meaning === 'Pena besar itu')),
    );
    expect(changed.map((example) => example.arabic)).toEqual(['الْبَيْتُ الْكَبِيرُ']);
    expect(validateNominalDefiniteness(variants.wrongExampleMeaning())).not.toEqual([]);
  });

  test('rejects a definite adjective that keeps its tanwin', () => {
    expect(p02.solution.arabic).toBe('الْكِتَابُ الْقَدِيمُ');
    expect(p02.solution.arabic.endsWith(DAMMA)).toBe(true);
    expect(`${p02.solution.arabic.slice(0, -1)}${DAMMATAN}`).toBe('الْكِتَابُ الْقَدِيمٌ');
    expect(validateNominalDefiniteness(variants.tanwinOnDefiniteAdjective())).not.toEqual([]);
  });

  test('actual content stays valid and building variants does not mutate it', () => {
    const before = JSON.stringify(content);
    for (const build of Object.values(variants)) validateNominalDefiniteness(build());
    expect(JSON.stringify(content)).toBe(before);
    expect(validateNominalDefiniteness(content)).toEqual([]);
  });
});
