// Own schema for the U-C nominal-definiteness increment. The shipped ContentPack, Item and
// LessonScreen types fix `unit` to 'A' | 'B', so this draft gets a small typed boundary in
// its own namespace instead of being labelled as Unit A/B content. It reuses the shipped
// HelpLine, ChoiceOption and LessonScreen shapes where they fit. Nothing here is shipped or
// unlocks anything; outside this folder only the developer-demo next lesson (src/pilot/nextLesson)
// and its tests import it.

import type { ChoiceOption, HelpLine, LessonScreen } from '../../schema';
import type { PilotConstruct, PilotContent } from '../../../pilot/unitA/content';

/** "the A N" (noun and adjective share al-) versus "the N is A" (bare adjective). */
export type PhraseShape = 'definite-phrase' | 'nominal-sentence';

/** Arabic shown, choose the Indonesian meaning; or Indonesian shown, choose the Arabic. */
export type TaskFormat = 'arabic-to-meaning' | 'meaning-to-arabic';

export type IncrementPhase = 'practice' | 'transfer';

/** Reviewer metadata: which misreading a wrong choice represents. */
export type DistractorKind = 'other-structure' | 'wrong-definiteness' | 'wrong-word';

/** Noun as taught (definite, e.g. الْبَيْتُ) and adjective in its indefinite base form (e.g. كَبِيرٌ). */
export interface Combination {
  readonly noun: string;
  readonly adjective: string;
}

/** The full keyed meaning of a task, in both languages, whichever side the choices show. */
export interface Solution {
  readonly arabic: string;
  readonly indonesian: string;
}

export interface VocabularyNoun extends HelpLine {
  /** Supplied, never inferred from the spelling. Only masculine singular nouns in this increment. */
  readonly gender: 'masculine';
}

export interface WorkedExample {
  readonly arabic: string;
  readonly shape: PhraseShape;
  readonly combination: Combination;
  readonly help_lines: readonly HelpLine[];
  readonly meaning: string;
  readonly explanation: string;
}

export interface IncrementScreen extends Omit<LessonScreen, 'unit' | 'examples' | 'review_status'> {
  readonly unit: 'U-C';
  readonly examples: readonly WorkedExample[];
  readonly review_status: 'draft';
}

export interface IncrementLesson {
  readonly lesson_id: string;
  readonly unit: 'U-C';
  readonly title: string;
  readonly vocabulary: {
    readonly nouns: readonly VocabularyNoun[];
    readonly adjectives: readonly HelpLine[];
  };
  readonly screens: readonly IncrementScreen[];
  readonly review_status: 'draft';
}

export interface IncrementOption extends Pick<ChoiceOption, 'id' | 'text' | 'arabic'> {
  readonly correct: boolean;
  readonly feedback: string;
  /** Wrong choices only. */
  readonly distractor?: DistractorKind;
}

export interface IncrementItem {
  readonly item_id: string;
  readonly unit: 'U-C';
  readonly lesson_id: string;
  readonly phase: IncrementPhase;
  readonly family: string;
  readonly format: TaskFormat;
  /** What the learner reads above the prompt: Arabic or Indonesian, per `format`. */
  readonly stem: string;
  readonly prompt: string;
  readonly help_lines: readonly HelpLine[];
  readonly noun_gender: 'masculine';
  readonly combination: Combination;
  readonly key_shape: PhraseShape;
  readonly solution: Solution;
  readonly options: readonly IncrementOption[];
  readonly constructed: true;
  readonly review_status: 'draft';
}

export interface IncrementContent {
  readonly increment_id: 'nominal-definiteness';
  readonly unit: 'U-C';
  readonly content_version: 'u-c-nominal-definiteness-draft-0.1';
  /** Language of the explanations. */
  readonly language: 'id';
  readonly synthetic: true;
  readonly constructed: true;
  readonly quran_attribution: false;
  readonly review_status: 'draft';
  readonly human_review: {
    readonly arabic: 'pending';
    readonly indonesian: 'pending';
    readonly assessment: 'pending';
  };
  readonly integration: {
    readonly shipped: false;
    readonly automatic_unlock: false;
  };
  readonly lessons: readonly IncrementLesson[];
  readonly items: readonly IncrementItem[];
}

/** One existing Unit A pilot concept this increment builds on. */
export interface PrerequisiteRef {
  readonly construct: PilotConstruct;
  /** An existing PILOT_CONTENT lesson ID for that construct. */
  readonly lesson_id: string;
  /** Existing PILOT_CONTENT practice/transfer item IDs the existing gate reads for that construct. */
  readonly evidence_item_ids: readonly string[];
  readonly reason: string;
}

/**
 * Additive, read-only description of what the increment presupposes. It names existing
 * concepts and the existing gate only; it holds no learner events and grants nothing.
 */
export interface PrerequisiteManifest {
  readonly increment_id: IncrementContent['increment_id'];
  readonly source_content_version: PilotContent['contentVersion'];
  readonly source_policy_version: PilotContent['policyVersion'];
  readonly gate: 'canAdvanceUnitA';
  readonly requires: readonly PrerequisiteRef[];
  readonly progress_claimed: false;
  readonly unlocks: false;
  readonly automatic_integration: false;
}
