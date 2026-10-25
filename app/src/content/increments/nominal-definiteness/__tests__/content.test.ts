import * as fs from 'fs';
import * as path from 'path';
import { activePack, historicalItem, legacyPack, lineageOf, v02Pack } from '@/content/load';
import { PILOT_CONTENT } from '@/pilot/unitA/content';
import { canAdvanceUnitA } from '@/pilot/unitA/evidence';
import { NOMINAL_DEFINITENESS, validateNominalDefiniteness } from '../content';
import { NOMINAL_DEFINITENESS_PREREQUISITES, validatePrerequisiteManifest } from '../prerequisites';
import type { Combination, IncrementItem, PhraseShape } from '../schema';

// U-C increment: definite noun + definite adjective (a phrase) versus definite noun +
// indefinite adjective (a complete nominal sentence). Constructed draft, isolated from
// the shipped course; these checks are structural and are no linguistic sign-off.

const content = NOMINAL_DEFINITENESS;
const manifest = NOMINAL_DEFINITENESS_PREREQUISITES;
const { items, lessons } = content;
const practice = items.filter((item) => item.phase === 'practice');
const transfer = items.filter((item) => item.phase === 'transfer');
const screens = lessons.flatMap((lesson) => lesson.screens);
const examples = screens.flatMap((screen) => screen.examples);
const SHIPPED = [activePack, v02Pack, legacyPack];
const SHAPES: readonly PhraseShape[] = ['definite-phrase', 'nominal-sentence'];
const OPPOSITE: Readonly<Record<PhraseShape, PhraseShape>> = {
  'definite-phrase': 'nominal-sentence',
  'nominal-sentence': 'definite-phrase',
};

// Whole-text comparison ignores harakat (after NFC), punctuation, spacing and case,
// as the Unit A pilot does. Single words may recur; whole solutions may not.
const norm = (text: string): string =>
  text
    .normalize('NFC')
    .replace(/\p{Mn}/gu, '')
    .replace(/\p{P}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const tokens = (text: string): string[] => norm(text).split(' ').filter((token) => token !== '');
const ARABIC_LETTER = /[ء-غف-ي]/;
const AL = 'ال';
const bare = (word: string): string => norm(word).replace(/^ال/, '');
const pairKey = (combo: Combination): string => `${norm(combo.noun)}|${bare(combo.adjective)}`;

const strings = (value: unknown, seen: WeakSet<object> = new WeakSet()): string[] => {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((child: unknown) => strings(child, seen));
};

const keysOf = (value: unknown): string[] =>
  typeof value !== 'object' || value === null
    ? []
    : Object.entries(value).flatMap(([key, child]: [string, unknown]) => [key, ...keysOf(child)]);

// Arabic structure, derived from the declared noun and adjective: الْـN الْـA is the
// phrase ("the A N"), الْـN A is the complete sentence ("the N is A").
const shapeOfArabic = (text: string, combo: Combination): PhraseShape | undefined => {
  const [first, second, ...rest] = tokens(text);
  if (rest.length > 0 || first !== norm(combo.noun)) return undefined;
  if (second === AL + bare(combo.adjective)) return 'definite-phrase';
  if (second === bare(combo.adjective)) return 'nominal-sentence';
  return undefined;
};

// Indonesian structure: "rumah besar itu" (phrase) versus "rumah itu besar" (sentence).
const shapeOfIndonesian = (text: string): PhraseShape | undefined => {
  const words = tokens(text);
  const at = words.indexOf('itu');
  if (at < 1 || words.lastIndexOf('itu') !== at) return undefined;
  if (at === words.length - 1) return at >= 2 ? 'definite-phrase' : undefined;
  return 'nominal-sentence';
};

const keyOf = (item: IncrementItem) => item.options.filter((option) => option.correct);

const must = <T,>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`increment lacks ${what}`);
  return value;
};

const pilotItem = (construct: string, phase: string) =>
  must(
    PILOT_CONTENT.items.find((item) => item.construct === construct && item.phase === phase),
    `pilot ${construct} ${phase} item`,
  );

const learnerTexts = (): string[] => [
  ...lessons.flatMap((lesson) => [
    lesson.title,
    ...lesson.vocabulary.nouns.map((noun) => noun.meaning),
    ...lesson.vocabulary.adjectives.map((adjective) => adjective.meaning),
  ]),
  ...screens.flatMap((screen) => [
    screen.title,
    ...screen.body,
    ...screen.examples.flatMap((example) => [
      example.meaning,
      example.explanation,
      ...example.help_lines.map((line) => line.meaning),
    ]),
  ]),
  ...items.flatMap((item) => [
    item.prompt,
    item.stem,
    ...item.help_lines.map((line) => line.meaning),
    ...item.options.flatMap((option) => [option.text, option.feedback]),
  ]),
];

const arabicFields = (): string[] => [
  ...lessons.flatMap((lesson) => [
    ...lesson.vocabulary.nouns.map((noun) => noun.word),
    ...lesson.vocabulary.adjectives.map((adjective) => adjective.word),
  ]),
  ...examples.flatMap((example) => [
    example.arabic,
    example.combination.noun,
    example.combination.adjective,
    ...example.help_lines.map((line) => line.word),
  ]),
  ...items.flatMap((item) => [
    item.solution.arabic,
    item.combination.noun,
    item.combination.adjective,
    ...item.help_lines.map((line) => line.word),
    ...(item.format === 'arabic-to-meaning' ? [item.stem] : []),
    ...item.options.filter((option) => option.arabic === true).map((option) => option.text),
  ]),
];

const arabicTokens = (): string[] => arabicFields().flatMap(tokens).filter((token) => ARABIC_LETTER.test(token));

describe('U-C nominal definiteness increment (constructed draft, isolated)', () => {
  it('is truthfully labelled as an unshipped, constructed draft pending human review', () => {
    expect(content).toMatchObject({
      increment_id: 'nominal-definiteness',
      unit: 'U-C',
      language: 'id',
      synthetic: true,
      constructed: true,
      quran_attribution: false,
      review_status: 'draft',
      human_review: { arabic: 'pending', indonesian: 'pending', assessment: 'pending' },
      integration: { shipped: false, automatic_unlock: false },
    });
    expect(content.content_version).toMatch(/draft/);
    const knownVersions = [...SHIPPED.map((pack) => pack.content_version), PILOT_CONTENT.contentVersion];
    expect(knownVersions).not.toContain(content.content_version);
    const mentions = [...SHIPPED, PILOT_CONTENT].flatMap((pack) => strings(pack));
    expect(mentions.filter((text) => text.includes(content.content_version))).toEqual([]);
    const drafts = [...lessons, ...screens, ...items].filter((part) => part.review_status !== 'draft');
    expect(drafts.length).toBe(0);
    expect(items.filter((item) => item.constructed !== true).map((item) => item.item_id)).toEqual([]);
  });

  it('teaches one lesson with worked phrase/sentence examples, including a minimal pair', () => {
    expect(lessons.length).toBe(1);
    const lesson = must(lessons[0], 'a lesson');
    expect(lesson.unit).toBe('U-C');
    expect(lesson.title.trim()).not.toBe('');
    expect(screens.length).toBeGreaterThan(0);
    const thinScreens = screens.filter(
      (screen) => screen.title.trim() === '' || screen.body.length === 0 || screen.body.some((p) => p.trim() === ''),
    );
    expect(thinScreens.map((screen) => screen.screen_id)).toEqual([]);

    // al- is named explicitly as its own marker in the explanation.
    const bodyTokens = screens.flatMap((screen) => screen.body).flatMap(tokens);
    expect(bodyTokens.some((token) => /^الـ?$/.test(token))).toBe(true);

    expect(examples.length).toBeGreaterThanOrEqual(4);
    const perShape = SHAPES.map((shape) => examples.filter((example) => example.shape === shape).length);
    expect(perShape.every((count) => count >= 2)).toBe(true);
    const incoherent = examples.filter(
      (example) =>
        shapeOfArabic(example.arabic, example.combination) !== example.shape ||
        shapeOfIndonesian(example.meaning) !== example.shape ||
        example.explanation.trim() === '' ||
        example.help_lines.length === 0,
    );
    expect(incoherent.map((example) => example.arabic)).toEqual([]);
    // The same noun and adjective shown both ways: shared al- (phrase) vs bare adjective (sentence).
    const shapesByPair = new Map<string, Set<PhraseShape>>();
    for (const example of examples) {
      const shapes = shapesByPair.get(pairKey(example.combination)) ?? new Set<PhraseShape>();
      shapes.add(example.shape);
      shapesByPair.set(pairKey(example.combination), shapes);
    }
    expect([...shapesByPair.values()].some((shapes) => shapes.size === 2)).toBe(true);
  });

  it('limits vocabulary to a few masculine singular nouns with supplied gender and regular adjectives', () => {
    expect(lessons.length).toBe(1);
    const lesson = must(lessons[0], 'a lesson');
    const { nouns, adjectives } = lesson.vocabulary;
    expect(nouns.length).toBeGreaterThanOrEqual(2);
    expect(nouns.length).toBeLessThanOrEqual(5);
    expect(adjectives.length).toBeGreaterThanOrEqual(2);
    expect(adjectives.length).toBeLessThanOrEqual(5);
    const badNouns = nouns.filter(
      (noun) =>
        noun.gender !== 'masculine' ||
        !norm(noun.word).startsWith(AL) ||
        bare(noun.word).length < 2 ||
        tokens(noun.word).length !== 1 ||
        noun.word.includes('ة') ||
        noun.meaning.trim() === '',
    );
    expect(badNouns.map((noun) => noun.word)).toEqual([]);
    // Indefinite base form: no al-, tanwin dammah, no feminine ـة.
    const badAdjectives = adjectives.filter(
      (adjective) =>
        norm(adjective.word).startsWith(AL) ||
        !adjective.word.includes('ٌ') ||
        tokens(adjective.word).length !== 1 ||
        adjective.word.includes('ة') ||
        adjective.meaning.trim() === '',
    );
    expect(badAdjectives.map((adjective) => adjective.word)).toEqual([]);
    const words = [...nouns, ...adjectives].map((entry) => norm(entry.word));
    expect(new Set(words).size).toBe(words.length);
  });

  it('has exactly six practice and four transfer tasks, tied to the lesson, balanced by format and shape', () => {
    expect({ total: items.length, practice: practice.length, transfer: transfer.length }).toEqual({
      total: 10,
      practice: 6,
      transfer: 4,
    });
    const lessonIds = new Set(lessons.map((lesson) => lesson.lesson_id));
    const orphans = items.filter((item) => !lessonIds.has(item.lesson_id) || item.unit !== 'U-C');
    expect(orphans.map((item) => item.item_id)).toEqual([]);
    const families = items.map((item) => item.family);
    expect(new Set(families).size).toBe(items.length);

    const count = (list: readonly IncrementItem[], test: (item: IncrementItem) => boolean) => list.filter(test).length;
    const coverage = {
      practiceMeaning: count(practice, (i) => i.format === 'arabic-to-meaning') >= 2,
      practiceArabic: count(practice, (i) => i.format === 'meaning-to-arabic') >= 2,
      practicePhrase: count(practice, (i) => i.key_shape === 'definite-phrase') >= 2,
      practiceSentence: count(practice, (i) => i.key_shape === 'nominal-sentence') >= 2,
      transferMeaning: count(transfer, (i) => i.format === 'arabic-to-meaning') >= 1,
      transferArabic: count(transfer, (i) => i.format === 'meaning-to-arabic') >= 1,
      transferPhrase: count(transfer, (i) => i.key_shape === 'definite-phrase') === 2,
      transferSentence: count(transfer, (i) => i.key_shape === 'nominal-sentence') === 2,
    };
    expect(Object.entries(coverage).filter(([, ok]) => !ok).map(([name]) => name)).toEqual([]);

    // Keys are spread over all four positions, none used more than four times.
    const positions = items.map((item) => item.options.findIndex((option) => option.correct));
    expect(new Set(positions)).toEqual(new Set([0, 1, 2, 3]));
    expect(Math.max(...[0, 1, 2, 3].map((p) => positions.filter((q) => q === p).length))).toBeLessThanOrEqual(4);
  });

  it('gives every task four distinct choices, one key, typed distractors and distinct non-empty feedback', () => {
    expect(items.length).toBe(10);
    const broken = items.filter((item) => {
      const texts = new Set(item.options.map((option) => norm(option.text)));
      const feedback = item.options.map((option) => option.feedback.trim());
      const wrong = item.options.filter((option) => !option.correct);
      return !(
        item.options.length === 4 &&
        texts.size === 4 &&
        !texts.has('') &&
        new Set(item.options.map((option) => option.id)).size === 4 &&
        keyOf(item).length === 1 &&
        keyOf(item).every((option) => option.distractor === undefined) &&
        wrong.every((option) => option.distractor !== undefined) &&
        wrong.some((option) => option.distractor === 'other-structure') &&
        feedback.every((text) => text !== '') &&
        new Set(feedback).size === 4 &&
        item.prompt.trim() !== '' &&
        item.stem.trim() !== ''
      );
    });
    expect(broken.map((item) => item.item_id)).toEqual([]);
    const kinds = new Set<string | undefined>(items.flatMap((item) => item.options.map((option) => option.distractor)));
    expect(['other-structure', 'wrong-definiteness', 'wrong-word'].filter((kind) => !kinds.has(kind))).toEqual([]);

    // Script of the choices matches the task direction.
    const mixedScript = items.filter((item) =>
      item.options.some((option) => {
        const isArabic = ARABIC_LETTER.test(option.text);
        const flagged = option.arabic === true;
        return flagged !== isArabic || isArabic !== (item.format === 'meaning-to-arabic');
      }),
    );
    expect(mixedScript.map((item) => item.item_id)).toEqual([]);
  });

  it('keys a coherent solution in Arabic and Indonesian, with structurally real distractors', () => {
    expect(items.length).toBe(10);
    const problems = items.flatMap((item) => {
      const found: string[] = [];
      const [key] = keyOf(item);
      const { arabic, indonesian } = item.solution;
      if (shapeOfArabic(arabic, item.combination) !== item.key_shape) found.push('arabic solution shape');
      if (shapeOfIndonesian(indonesian) !== item.key_shape) found.push('indonesian solution shape');
      const [stemSide, keySide] = item.format === 'arabic-to-meaning' ? [arabic, indonesian] : [indonesian, arabic];
      if (norm(item.stem) !== norm(stemSide)) found.push('stem is not the solution side shown');
      if (key === undefined || norm(key.text) !== norm(keySide)) found.push('key is not the solution');
      const shapeOf = (text: string) =>
        item.format === 'meaning-to-arabic' ? shapeOfArabic(text, item.combination) : shapeOfIndonesian(text);
      for (const option of item.options) {
        if (option.distractor === 'other-structure' && shapeOf(option.text) !== OPPOSITE[item.key_shape]) {
          found.push(`option ${option.id} is not the other structure`);
        }
        if (option.distractor === 'wrong-definiteness') {
          const lostDefiniteness =
            item.format === 'meaning-to-arabic'
              ? tokens(option.text)[0] === bare(item.combination.noun)
              : !tokens(option.text).includes('itu');
          if (!lostDefiniteness) found.push(`option ${option.id} keeps the definite noun`);
        }
      }
      const giveaway = [item.prompt, ...item.help_lines.flatMap((line) => [line.word, line.meaning])].map(norm);
      if (giveaway.some((text) => text.includes(norm(arabic)) || text.includes(norm(indonesian)))) {
        found.push('prompt or help gives away the whole solution');
      }
      if ([item.stem, item.prompt].some((text) => /_|\.\.\.|…/.test(text))) found.push('fill-in blank');
      if (item.noun_gender !== 'masculine') found.push('noun gender');
      if (!item.help_lines.some((line) => norm(line.word) === norm(item.combination.noun))) found.push('noun not glossed');
      const visible = [item.prompt, ...item.help_lines.map((line) => line.meaning)].join(' ');
      if (!/maskulin/i.test(visible)) found.push('noun gender not supplied to the learner');
      return found.map((problem) => `${item.item_id}: ${problem}`);
    });
    expect(problems).toEqual([]);
  });

  it('uses only taught forms: no new words, feminine, plural, verbs, possession or negation', () => {
    expect(lessons.length).toBe(1);
    const lesson = must(lessons[0], 'a lesson');
    const nouns = lesson.vocabulary.nouns.map((noun) => norm(noun.word));
    const adjectives = lesson.vocabulary.adjectives.map((adjective) => bare(adjective.word));
    const combos = [...examples.map((example) => example.combination), ...items.map((item) => item.combination)];
    expect(combos.length).toBeGreaterThan(0);
    const untaught = combos.filter(
      (combo) => !nouns.includes(norm(combo.noun)) || !adjectives.includes(bare(combo.adjective)),
    );
    expect(untaught.map(pairKey)).toEqual([]);
    const allowed = new Set([
      ...nouns,
      ...nouns.map((noun) => noun.replace(/^ال/, '')),
      ...adjectives,
      ...adjectives.map((adjective) => AL + adjective),
    ]);
    const found = arabicTokens();
    expect(found.length).toBeGreaterThan(0);
    expect([...new Set(found.filter((token) => !allowed.has(token)))]).toEqual([]);
  });

  it('builds transfer from taught words in combinations never shown before', () => {
    expect(transfer.length).toBe(4);
    const transferPairs = transfer.map((item) => pairKey(item.combination));
    expect(new Set(transferPairs).size).toBe(transfer.length);

    const earlier = [...examples.map((example) => example.combination), ...practice.map((item) => item.combination)];
    const earlierPairs = new Set(earlier.map(pairKey));
    const earlierNouns = new Set(earlier.map((combo) => norm(combo.noun)));
    const earlierAdjectives = new Set(earlier.map((combo) => bare(combo.adjective)));
    const seenTexts = [...strings(lessons), ...strings(practice), ...[...SHIPPED, PILOT_CONTENT].flatMap((p) => strings(p))].map(norm);

    const problems = transfer.flatMap((item) => {
      const found: string[] = [];
      const { combination } = item;
      if (earlierPairs.has(pairKey(combination))) found.push('combination already shown');
      if (!earlierNouns.has(norm(combination.noun))) found.push('noun not used before');
      if (!earlierAdjectives.has(bare(combination.adjective))) found.push('adjective not used before');
      const bothShapes = [
        `${norm(combination.noun)} ${bare(combination.adjective)}`,
        `${norm(combination.noun)} ${AL}${bare(combination.adjective)}`,
      ];
      if (seenTexts.some((text) => bothShapes.some((form) => text.includes(form)))) {
        found.push('combination appears in lesson, practice or shipped material');
      }
      return found.map((problem) => `${item.item_id}: ${problem}`);
    });
    expect(problems).toEqual([]);
  });

  it('keeps reserved transfer solutions (Arabic and Indonesian) out of lesson, practice, other tasks and shipped content', () => {
    expect(transfer.length).toBe(4);
    const lessonTexts = strings(lessons).map(norm);
    const practiceTexts = strings(practice).map(norm);
    const shippedTexts = [...SHIPPED, PILOT_CONTENT].flatMap((pack) => strings(pack)).map(norm);
    const leaks = transfer.flatMap((item) => {
      const reserved = [norm(item.solution.arabic), norm(item.solution.indonesian)];
      if (reserved.some((solution) => solution.split(' ').length < 2)) return [`${item.item_id}: solution too short to reserve`];
      const others = strings(transfer.filter((other) => other !== item)).map(norm);
      const places: [string, string[]][] = [
        ['lesson', lessonTexts],
        ['practice', practiceTexts],
        ['other transfer task', others],
        ['shipped content', shippedTexts],
      ];
      return places.flatMap(([place, texts]) =>
        reserved.filter((solution) => texts.some((text) => text.includes(solution))).map(
          (solution) => `${item.item_id}: "${solution}" appears in ${place}`,
        ),
      );
    });
    expect(leaks).toEqual([]);
    const stems = items.map((item) => norm(item.stem));
    expect(new Set(stems).size).toBe(items.length);
  });

  it('does not reveal existing Unit A held-out solutions or reserved forms', () => {
    const pilotHeldOut = PILOT_CONTENT.items.filter((item) => item.phase !== 'practice');
    const reserved = pilotHeldOut.flatMap((item) => [
      ...(tokens(item.arabic).length >= 2 ? [norm(item.arabic)] : []),
      ...item.options.filter((option) => option.correct).map((option) => norm(option.text)),
    ]);
    expect(reserved.length).toBeGreaterThan(0);
    const ours = [...strings(content), ...strings(manifest)].map(norm);
    expect(reserved.filter((solution) => ours.some((text) => text.includes(solution)))).toEqual([]);

    const pilotPairs = new Set(
      pilotHeldOut.flatMap((item) =>
        item.options
          .filter((option) => option.correct)
          .map((option) => tokens(option.text))
          .filter((words) => words.length === 2 && words.every((word) => ARABIC_LETTER.test(word)))
          .map(([noun, adjective]) => `${noun}|${(adjective ?? '').replace(/^ال/, '')}`),
      ),
    );
    const combos = [...examples.map((example) => example.combination), ...items.map((item) => item.combination)];
    expect(combos.map(pairKey).filter((pair) => pilotPairs.has(pair))).toEqual([]);

    const reservedForms = new Set(
      SHIPPED.flatMap((pack) => pack.items)
        .filter((item) => item.reserve_forms === true)
        .flatMap((item) => item.forms ?? [])
        .map(norm),
    );
    expect([...new Set(arabicTokens().filter((token) => reservedForms.has(token)))]).toEqual([]);
  });

  it('uses its own namespaced IDs, unknown to every shipped and pilot registry', () => {
    const ours = [
      ...lessons.map((lesson) => lesson.lesson_id),
      ...screens.map((screen) => screen.screen_id),
      ...items.flatMap((item) => [item.item_id, item.family]),
    ];
    expect(items.length).toBe(10);
    expect(ours.length).toBe(1 + screens.length + 20);
    expect(new Set(ours).size).toBe(ours.length);
    expect(ours.filter((id) => !id.startsWith('uc-nd-'))).toEqual([]);
    const known = new Set<string>([
      ...SHIPPED.flatMap((pack) =>
        pack.items.flatMap((item) => [item.item_id, ...(item.legacy_item_ids ?? []), ...(item.lineage ? [item.lineage] : [])]),
      ),
      ...SHIPPED.flatMap((pack) => [
        ...pack.lesson_screens.map((screen) => screen.screen_id),
        ...Object.keys(pack.prompts),
        ...Object.keys(pack.feedback),
      ]),
      ...PILOT_CONTENT.lessons.map((lesson) => lesson.id),
      ...PILOT_CONTENT.items.flatMap((item) => [item.id, item.family]),
    ]);
    expect(ours.filter((id) => known.has(id))).toEqual([]);
    const itemIds = items.map((item) => item.item_id);
    expect(itemIds.filter((id) => historicalItem(id) !== undefined)).toEqual([]);
    expect(itemIds.filter((id) => lineageOf(id) !== `id:${id}`)).toEqual([]);
  });

  it('keeps learner text free of implementation jargon and source attribution', () => {
    const texts = learnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    const jargon =
      /\b(transfer|practice|held[- ]?out|item|phase|family|construct|validator|schema|evidence|mastery|unlock\w*|xp|d7|d30|u-c|key|distractor|draft|synthetic|prerequisite)\b/i;
    const attribution = /qur['’]?an|\bayat\b|\bsurah?\b|\bhadi[st]s?\b|hadith/i;
    expect(texts.filter((text) => jargon.test(text) || attribution.test(text))).toEqual([]);
  });

  it('is not imported by existing app code and itself imports only content/pilot definitions', () => {
    const appRoot = path.resolve(__dirname, '../../../../..');
    const incrementDir = path.resolve(__dirname, '..');
    const appPackage: unknown = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
    expect(appPackage).toMatchObject({ name: 'arabic-trial-app' });
    const skip = new Set(['node_modules', 'dist', '.expo', '.git', 'ios', 'android', 'coverage', 'web-build']);
    const sourceFiles = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return skip.has(entry.name) || full === incrementDir ? [] : sourceFiles(full);
        return /\.(tsx?|jsx?|json)$/.test(entry.name) && !/lock\.json$/.test(entry.name) ? [full] : [];
      });
    const files = sourceFiles(appRoot);
    expect(files).toContain(path.join(appRoot, 'src', 'pilot', 'unitA', 'content.ts'));
    const importers = files.filter((file) => fs.readFileSync(file, 'utf8').includes('nominal-definiteness'));
    expect(importers.map((file) => path.relative(appRoot, file))).toEqual([]);

    const allowed = new Set([
      './schema',
      './content',
      './prerequisites',
      '../../schema',
      '../../load',
      '../../../pilot/unitA/content',
      '../../../pilot/unitA/evidence',
      '@/content/schema',
      '@/content/load',
      '@/pilot/unitA/content',
      '@/pilot/unitA/evidence',
    ]);
    const ownSources = fs.readdirSync(incrementDir).filter((name) => /\.tsx?$/.test(name));
    expect(ownSources).toEqual(expect.arrayContaining(['content.ts', 'prerequisites.ts', 'schema.ts']));
    const specifiers = ownSources.flatMap((name) => {
      const source = fs.readFileSync(path.join(incrementDir, name), 'utf8');
      const pattern = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;
      return [...source.matchAll(pattern)].map((match) => `${name}: ${match[1] ?? ''}`);
    });
    expect(specifiers.filter((entry) => !allowed.has(entry.split(': ')[1] ?? ''))).toEqual([]);
  });

  it('references real Unit A pilot lessons and evidence IDs without claiming any progress', () => {
    expect(manifest).toMatchObject({
      increment_id: content.increment_id,
      source_content_version: PILOT_CONTENT.contentVersion,
      source_policy_version: PILOT_CONTENT.policyVersion,
      gate: 'canAdvanceUnitA',
      progress_claimed: false,
      unlocks: false,
      automatic_integration: false,
    });
    // The named gate is the real evaluator, and nothing here feeds it events.
    expect(typeof canAdvanceUnitA).toBe('function');
    expect(canAdvanceUnitA([])).toBe(false);
    const eventLike = new Set(['outcome', 'day', 'events', 'completed', 'completed_at', 'mastered', 'unlocked_at', 'score']);
    expect(keysOf(manifest).filter((key) => eventLike.has(key))).toEqual([]);

    expect(manifest.requires.map((ref) => ref.construct).sort()).toEqual(['agreement', 'reference']);
    const problems = manifest.requires.flatMap((ref) => {
      const found: string[] = [];
      const lesson = PILOT_CONTENT.lessons.find((candidate) => candidate.id === ref.lesson_id);
      if (lesson === undefined || lesson.construct !== ref.construct) found.push('lesson is not this construct');
      if (ref.reason.trim() === '') found.push('no reason');
      if (ref.evidence_item_ids.length === 0) found.push('no evidence');
      if (new Set(ref.evidence_item_ids).size !== ref.evidence_item_ids.length) found.push('duplicate evidence');
      const evidence = ref.evidence_item_ids.map((id) => PILOT_CONTENT.items.find((item) => item.id === id));
      evidence.forEach((item, index) => {
        if (item === undefined) found.push(`unknown evidence ${ref.evidence_item_ids[index] ?? ''}`);
        else if (item.construct !== ref.construct) found.push(`${item.id} is another construct`);
        else if (item.phase !== 'practice' && item.phase !== 'transfer') found.push(`${item.id} is not gate evidence`);
      });
      if (!evidence.some((item) => item?.phase === 'transfer')) found.push('no transfer evidence');
      return found.map((problem) => `${ref.construct}: ${problem}`);
    });
    expect(problems).toEqual([]);
    expect(validatePrerequisiteManifest(manifest)).toEqual([]);
  });

  it('validator accepts the real draft and rejects broken, leaking or mislabelled variants', () => {
    expect({ practice: practice.length, transfer: transfer.length }).toEqual({ practice: 6, transfer: 4 });
    expect(validateNominalDefiniteness(content)).toEqual([]);
    const before = JSON.stringify(content);

    const lesson = must(lessons[0], 'a lesson');
    const p = must(practice[0], 'practice');
    const t = must(transfer[0], 'transfer');
    const t2 = must(transfer[1], 'second transfer');
    const tArabic = must(
      transfer.find((item) => item.format === 'meaning-to-arabic'),
      'transfer with Arabic choices',
    );
    const pKey = must(keyOf(p)[0], 'practice key');
    const pWrong = must(p.options.find((option) => !option.correct), 'practice wrong option');
    const pilotHeldOutKey = must(pilotItem('agreement', 'd7').options.find((option) => option.correct), 'pilot d7 key');
    const otherShapeOfT = `${norm(t.combination.noun)} ${t.key_shape === 'definite-phrase' ? '' : AL}${bare(t.combination.adjective)}`;

    const withItem = (id: string, patch: object): unknown => ({
      ...content,
      items: items.map((item) => (item.item_id === id ? { ...item, ...patch } : item)),
    });
    const withLesson = (patch: object): unknown => ({
      ...content,
      lessons: lessons.map((entry) => (entry === lesson ? { ...entry, ...patch } : entry)),
    });
    const withPracticeOptions = (map: (option: IncrementItem['options'][number], index: number) => object): unknown =>
      withItem(p.item_id, { options: p.options.map(map) });

    const variants: Record<string, unknown> = {
      notAnObject: null,
      unitA: { ...content, unit: 'A' },
      approvedPack: { ...content, review_status: 'approved-for-trial' },
      notSynthetic: { ...content, synthetic: false },
      notConstructed: { ...content, constructed: false },
      reviewSignedOff: { ...content, human_review: { ...content.human_review, arabic: 'approved' } },
      shipped: { ...content, integration: { ...content.integration, shipped: true } },
      autoUnlock: { ...content, integration: { ...content.integration, automatic_unlock: true } },
      quranAttributed: { ...content, quran_attribution: true },
      unknownPackKey: { ...content, mastery_threshold: 0.8 },
      noLesson: { ...content, lessons: [] },
      twoLessons: { ...content, lessons: [lesson, { ...lesson, lesson_id: 'uc-nd-lesson-copy' }] },
      noWorkedExamples: withLesson({ screens: lesson.screens.map((screen) => ({ ...screen, examples: [] })) }),
      untaughtAdjective: withLesson({
        vocabulary: {
          ...lesson.vocabulary,
          adjectives: lesson.vocabulary.adjectives.filter((a) => bare(a.word) !== bare(t.combination.adjective)),
        },
      }),
      itemsNotArray: { ...content, items: 'items' },
      nullItem: { ...content, items: [null, ...items] },
      droppedTransfer: { ...content, items: items.filter((item) => item.item_id !== t.item_id) },
      duplicateId: withItem(t2.item_id, { item_id: t.item_id }),
      pilotIdCollision: withItem(p.item_id, { item_id: pilotItem('agreement', 'practice').id }),
      shippedIdCollision: withItem(p.item_id, { item_id: must(activePack.items[0], 'active item').item_id }),
      unknownPhase: withItem(t.item_id, { phase: 'd7' }),
      unknownFormat: withItem(p.item_id, { format: 'fill-in' }),
      unknownItemKey: withItem(p.item_id, { mastered: true }),
      wrongUnitItem: withItem(p.item_id, { unit: 'A' }),
      foreignLesson: withItem(p.item_id, { lesson_id: pilotItem('agreement', 'practice').lessonId }),
      approvedItem: withItem(p.item_id, { review_status: 'approved-for-trial' }),
      feminineNoun: withItem(p.item_id, { noun_gender: 'feminine' }),
      threeOptions: withItem(p.item_id, { options: p.options.slice(0, 3) }),
      fiveOptions: withItem(p.item_id, { options: [...p.options, { ...pWrong, id: 'extra', text: `${pWrong.text} lagi` }] }),
      twoKeys: withPracticeOptions((option) => (option === pWrong ? { ...option, correct: true, distractor: undefined } : option)),
      noKey: withPracticeOptions((option) => ({ ...option, correct: false })),
      blankFeedback: withPracticeOptions((option) => (option === pKey ? { ...option, feedback: '  ' } : option)),
      missingFeedback: withPracticeOptions((option) =>
        option === pKey ? { id: option.id, text: option.text, arabic: option.arabic, correct: option.correct } : option,
      ),
      copiedFeedback: withPracticeOptions((option) => (option === pWrong ? { ...option, feedback: pKey.feedback } : option)),
      duplicateChoiceText: withPracticeOptions((option) => (option === pWrong ? { ...option, text: pKey.text } : option)),
      noOtherStructureDistractor: withPracticeOptions((option) =>
        option.correct ? option : { ...option, distractor: 'wrong-word' },
      ),
      flippedKeyShape: withItem(p.item_id, { key_shape: OPPOSITE[p.key_shape] }),
      solutionOffKey: withItem(p.item_id, {
        solution:
          p.format === 'arabic-to-meaning'
            ? { ...p.solution, indonesian: pWrong.text }
            : { ...p.solution, arabic: pWrong.text },
      }),
      fillInStem: withItem(p.item_id, { stem: `${p.stem} ___` }),
      promptGivesAwayKey: withItem(p.item_id, { prompt: `${p.prompt} ${p.solution.arabic} = ${p.solution.indonesian}` }),
      jargonPrompt: withItem(p.item_id, { prompt: `${p.prompt} (transfer)` }),
      quranPrompt: withItem(p.item_id, { prompt: `${p.prompt} Ayat ini dari Al-Qur'an.` }),
      newVocabularyChoice: withItem(tArabic.item_id, {
        options: tArabic.options.map((option) =>
          option.distractor === 'wrong-word' ? { ...option, text: `${tArabic.combination.noun} جَمِيلَاتٌ` } : option,
        ),
      }),
      transferArabicInLesson: withLesson({
        screens: lesson.screens.map((screen, index) =>
          index === 0 ? { ...screen, body: [...screen.body, t.solution.arabic] } : screen,
        ),
      }),
      transferIndonesianInPractice: withPracticeOptions((option) =>
        option === pKey ? { ...option, feedback: `${option.feedback} ${t.solution.indonesian}` } : option,
      ),
      transferCombinationShownInPractice: withPracticeOptions((option) =>
        option === pWrong ? { ...option, feedback: `${option.feedback} ${otherShapeOfT}` } : option,
      ),
      transferSolutionInOtherTransfer: withItem(t2.item_id, { prompt: `${t2.prompt} ${t.solution.indonesian}` }),
      transferCopiesPracticeTask: withItem(t.item_id, {
        format: p.format,
        stem: p.stem,
        prompt: p.prompt,
        help_lines: p.help_lines,
        combination: p.combination,
        key_shape: p.key_shape,
        solution: p.solution,
        options: p.options,
      }),
      transferReusesPracticeCombination: withItem(t.item_id, { combination: p.combination }),
      leaksPilotHeldOutKey: withPracticeOptions((option) =>
        option === pWrong ? { ...option, feedback: `${option.feedback} ${pilotHeldOutKey.text}` } : option,
      ),
    };
    const accepted = Object.entries(variants).filter(([, value]) => validateNominalDefiniteness(value).length === 0);
    expect(accepted.map(([name]) => name)).toEqual([]);
    expect(JSON.stringify(content)).toBe(before);
  });

  it('validators reject unknown inputs with messages, without throwing or mutating', () => {
    const cyclic: Record<string, unknown> = { ...content };
    cyclic.self = cyclic;
    cyclic.items = [cyclic];
    const inputs: Record<string, unknown> = {
      undefined: undefined,
      null: null,
      number: 7,
      string: 'nominal-definiteness',
      array: [],
      emptyObject: {},
      itemsOfNull: { ...content, lessons: [null], items: [null, 3, 'x'] },
      cyclic,
    };
    const before = JSON.stringify([content, manifest]);
    for (const [name, input] of Object.entries(inputs)) {
      for (const validate of [validateNominalDefiniteness, validatePrerequisiteManifest]) {
        const run = (): unknown => validate(input);
        expect(run).not.toThrow();
        const errors = run();
        const messages: unknown[] = Array.isArray(errors) ? errors : [];
        expect({ name, rejected: messages.length > 0 }).toEqual({ name, rejected: true });
        expect(messages.every((message: unknown) => typeof message === 'string' && message.trim() !== '')).toBe(true);
      }
    }
    expect(JSON.stringify([content, manifest])).toBe(before);
  });

  it('prerequisite validator rejects invented, mismatched or progress-claiming manifests', () => {
    expect(manifest.requires.length).toBe(2);
    const reference = must(manifest.requires.find((ref) => ref.construct === 'reference'), 'reference prerequisite');
    const agreement = must(manifest.requires.find((ref) => ref.construct === 'agreement'), 'agreement prerequisite');
    const withRef = (construct: string, patch: object): unknown => ({
      ...manifest,
      requires: manifest.requires.map((ref) => (ref.construct === construct ? { ...ref, ...patch } : ref)),
    });
    const bogusId = 'ua-d01-agr-t99-missing';
    expect(PILOT_CONTENT.items.some((item) => item.id === bogusId)).toBe(false);
    const before = JSON.stringify(manifest);
    const variants: Record<string, unknown> = {
      notAnObject: null,
      droppedConstruct: { ...manifest, requires: manifest.requires.filter((ref) => ref !== reference) },
      duplicateConstruct: { ...manifest, requires: [...manifest.requires, agreement] },
      unknownConstruct: { ...manifest, requires: [...manifest.requires, { ...agreement, construct: 'definiteness' }] },
      unknownLesson: withRef('reference', { lesson_id: 'ua-d01-def-lesson' }),
      swappedLesson: withRef('reference', { lesson_id: agreement.lesson_id }),
      unknownEvidence: withRef('agreement', { evidence_item_ids: [...agreement.evidence_item_ids, bogusId] }),
      crossConstructEvidence: withRef('agreement', {
        evidence_item_ids: [...agreement.evidence_item_ids, pilotItem('reference', 'transfer').id],
      }),
      delayedCheckEvidence: withRef('agreement', {
        evidence_item_ids: [...agreement.evidence_item_ids, pilotItem('agreement', 'd7').id],
      }),
      noTransferEvidence: withRef('agreement', {
        evidence_item_ids: agreement.evidence_item_ids.filter(
          (id) => PILOT_CONTENT.items.find((item) => item.id === id)?.phase !== 'transfer',
        ),
      }),
      emptyEvidence: withRef('agreement', { evidence_item_ids: [] }),
      blankReason: withRef('reference', { reason: ' ' }),
      wrongPolicy: { ...manifest, source_policy_version: 'unit-a-evidence-final' },
      wrongContentVersion: { ...manifest, source_content_version: 'unit-a-pilot-approved-1.0' },
      inventedGate: { ...manifest, gate: 'masteredUnitA' },
      claimsProgress: { ...manifest, progress_claimed: true },
      unlocks: { ...manifest, unlocks: true },
      autoIntegrates: { ...manifest, automatic_integration: true },
      fabricatedEvents: {
        ...manifest,
        events: [{ id: pilotItem('agreement', 'transfer').id, outcome: 'correct', day: '2026-10-20' }],
      },
    };
    const accepted = Object.entries(variants).filter(([, value]) => validatePrerequisiteManifest(value).length === 0);
    expect(accepted.map(([name]) => name)).toEqual([]);
    expect(JSON.stringify(manifest)).toBe(before);
  });
});
