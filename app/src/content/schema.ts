// Content format for the trial app (Trial_App_Spec.md §9).
// Item IDs in real content must match Lessons_Unit_A_B_Draft.md exactly.

export type ReviewStatus =
  | 'draft'
  | 'reviewed-arabic'
  | 'reviewed-indonesian'
  | 'approved-for-trial';

export type Pool =
  | 'INSTR'
  | 'PRACT'
  | 'READY'
  | 'D7'
  | 'D30'
  | 'REMED'
  | 'TRANS'
  | 'SPARE'
  | 'MT'
  | 'ENTRY'
  | 'REPROBE'
  // Focused questions after a serious mistake. Never evidence, may repeat.
  | 'FOCUS'
  // Answer-record pool for scheduled reviews of already-seen material (never fresh evidence).
  | 'REVIEW';

/** Legacy (v0.1) types are kept for history/analysis only. Active content uses 'mcq4'. */
export type ItemType = 'q-mean' | 'q-para' | 'q-form2' | 'q-ref' | 'choose' | 'mcq4';

/** Four-choice question formats (content v0.2). */
export type McqFormat = 'word-meaning' | 'interpretation' | 'form-grid' | 'verb-identify' | 'verb-interpretation';

export type Referent = 'laki-laki' | 'perempuan';

export type ErrorTag =
  | 'wrong-referent'
  | 'possession'
  | 'invented-action'
  | 'wrong-form'
  | 'lexical'
  | 'look-alike'
  | 'ta-confusion';

export interface HelpLine {
  word: string;
  meaning: string;
}

export interface ChoiceOption {
  id: string;
  text: string;
  /** Render as Arabic (RTL, Arabic font). */
  arabic?: boolean;
  correct?: boolean;
  /** Legacy single tag (v0.1 choice items). */
  error_tag?: ErrorTag;
  feedback_id?: string;
  /** mcq4: every misconception this wrong option represents (a compound distractor names each). */
  misconceptions?: ErrorTag[];
  /** mcq4: a serious mistake (spec §7) — triggers FOCUS + fresh REMED. */
  serious?: boolean;
  /** mcq4: feedback messages for this option, in order. */
  feedback_ids?: string[];
  /** mcq4: why this distractor is plausible (content review audit). */
  rationale?: string;
}

export interface KnownError {
  /** Normalized phrase that, when present, makes the typed answer a known wrong answer. */
  pattern: string;
  tag: ErrorTag;
  feedback_id: string;
  serious: boolean;
}

export interface PendingTerm {
  /** Normalized phrase that is held for human check (e.g. "alim"). */
  term: string;
  feedback_id: string;
}

export interface AcceptedAnswers {
  /** Accepted Indonesian words/phrases for the meaning (normalized form). */
  terms: string[];
  pending_terms?: PendingTerm[];
  known_errors?: KnownError[];
}

export interface Item {
  item_id: string;
  unit: 'ENTRY' | 'A' | 'B';
  type: ItemType;
  /** Skills this item gives evidence for. */
  skills: string[];
  pool: Pool;
  arabic: string;
  constructed: true;
  help_lines: HelpLine[];
  prompt_id: string;
  options?: ChoiceOption[];
  accepted?: AcceptedAnswers;
  /** Who the sentence is about, for the laki-laki/perempuan part. */
  referent?: Referent;
  /** Model Indonesian meaning, shown in feedback. */
  model_answer?: string;
  /** Word this item practices (for word lists). */
  word_id?: string;
  /** Learner-facing word meaning for FA-LEX feedback. */
  word_meaning?: string;
  feedback_ids: Record<string, string>;
  /** Arabic content-word forms used (not pronouns), for reserved-form and clash checks (spec §9). */
  forms?: string[];
  /** D7/D30 items: their forms must not appear in any other item before the check (lessons §3.5). */
  reserve_forms?: boolean;
  /** Needs an earlier-day attempt on the same skill (e.g. "READY, later session"). */
  later_day?: boolean;
  /** mcq4 only: question format. */
  format?: McqFormat;
  /** mcq4 only: Indonesian target meaning shown with form-grid prompts. */
  target?: string;
  /**
   * Identity of the underlying word form/sentence across content versions. Freshness uses it,
   * so material seen under an old item ID is never fresh again.
   */
  lineage?: string;
  /** Review key (a word or a sentence lineage) for spaced review. Absent = never reviewed. */
  review_key?: string;
  /** Legacy (v0.1) item IDs this item replaces. Raw legacy answers are never re-graded. */
  legacy_item_ids?: string[];
  /** Practice only: never counts as evidence for any skill. */
  practice_only?: boolean;
  /** FOCUS items only: which serious mistake (and referent) this question follows up. */
  focus_for?: { tag: ErrorTag; referent?: Referent };
  /** Order in which the planner offers PRACT items. */
  order?: number;
  review_status: ReviewStatus;
  content_version: string;
}

export interface LessonScreen {
  screen_id: string;
  unit: 'A' | 'B';
  title: string;
  body: string[];
  examples?: { arabic: string; gloss: string }[];
  /** Index of an existing body paragraph that is a reading explanation (rendered as a clue box). */
  clue_paragraph?: number;
  review_status: ReviewStatus;
}

export interface ContentPack {
  content_version: string;
  /** 'mcq4' for the active four-choice pack; absent for the legacy v0.1 pack. */
  answer_format?: 'mcq4';
  /** True for made-up developer fixtures. Never shown in tester mode. */
  synthetic: boolean;
  note?: string;
  prompts: Record<string, string>;
  feedback: Record<string, string>;
  lesson_screens: LessonScreen[];
  items: Item[];
}
