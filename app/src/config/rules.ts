// Pilot learning rules (Trial_App_Spec.md §7). Values live in rules.json, never in code.
// A remote override can later replace the bundled file without an app update;
// this local prototype has no backend, so only the bundled file is used.
import bundled from './rules.json';

export type AppMode = 'developer-demo' | 'tester';

export interface RulesConfig {
  rules_version: string;
  mode: AppMode;
  audio_enabled: boolean;
  typo_tolerance: { min_word_length: number; max_edits: number };
  review_spacing_days: number[];
  review_share_max: number;
  /** Cap on active time charged for one step (answer + feedback); time with the app closed is not charged. */
  max_step_active_minutes: number;
  binary_streak: number;
  binary_min_days: number;
  tile_counts_as_free: boolean;
  session_minutes_options: number[];
  default_session_minutes: number;
  ready_after_practice_attempts: number;
  check_days: { D7: number; D30: number };
  /** Source: 2–3 later-check items per skill. Fewer available → reported as partial coverage. */
  checks_per_skill_min: number;
  checks_per_skill_max: number;
  /** Four-choice recognition never counts as typed/built ("free") evidence. */
  recognition_counts_as_free: false;
  /** 'pending': the learned rule is not evaluated until the product decision is made. */
  learned_rule: 'pending';
  unit_order: ('A' | 'B')[];
  /** Practice progression (not mastery): a unit starts once the previous unit's core screens and PRACT items were attempted. */
  unit_start_rule: 'previous-unit-core-screens-and-practice-attempted';
  negation_words: string[];
  possession_words: string[];
  action_words: string[];
}

export function validateRules(raw: unknown): RulesConfig {
  const r = raw as Partial<RulesConfig>;
  const errors: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) errors.push(msg);
  };
  need(typeof r.rules_version === 'string' && r.rules_version.length > 0, 'rules_version');
  need(r.mode === 'developer-demo' || r.mode === 'tester', 'mode');
  need(typeof r.audio_enabled === 'boolean', 'audio_enabled');
  need(
    !!r.typo_tolerance &&
      Number.isInteger(r.typo_tolerance.min_word_length) &&
      Number.isInteger(r.typo_tolerance.max_edits),
    'typo_tolerance'
  );
  need(
    Array.isArray(r.review_spacing_days) &&
      r.review_spacing_days.length > 0 &&
      r.review_spacing_days.every((d) => Number.isInteger(d) && d > 0),
    'review_spacing_days'
  );
  need(typeof r.review_share_max === 'number' && r.review_share_max >= 0 && r.review_share_max <= 1, 'review_share_max');
  need(typeof r.max_step_active_minutes === 'number' && r.max_step_active_minutes > 0, 'max_step_active_minutes');
  need(Number.isInteger(r.binary_streak) && (r.binary_streak ?? 0) > 0, 'binary_streak');
  need(Number.isInteger(r.binary_min_days), 'binary_min_days');
  need(typeof r.tile_counts_as_free === 'boolean', 'tile_counts_as_free');
  need(Array.isArray(r.session_minutes_options) && r.session_minutes_options.length > 0, 'session_minutes_options');
  need(
    typeof r.default_session_minutes === 'number' &&
      !!r.session_minutes_options?.includes(r.default_session_minutes),
    'default_session_minutes'
  );
  need(Number.isInteger(r.ready_after_practice_attempts), 'ready_after_practice_attempts');
  need(!!r.check_days && Number.isInteger(r.check_days.D7) && Number.isInteger(r.check_days.D30), 'check_days');
  need(Number.isInteger(r.checks_per_skill_min) && Number.isInteger(r.checks_per_skill_max), 'checks_per_skill');
  need(r.recognition_counts_as_free === false, 'recognition_counts_as_free must be false');
  need(r.learned_rule === 'pending', 'learned_rule');
  need(Array.isArray(r.unit_order) && r.unit_order.length > 0, 'unit_order');
  need(r.unit_start_rule === 'previous-unit-core-screens-and-practice-attempted', 'unit_start_rule');
  for (const key of ['negation_words', 'possession_words', 'action_words'] as const) {
    need(Array.isArray(r[key]) && r[key]!.every((w) => typeof w === 'string'), key);
  }
  if (errors.length) {
    throw new Error(`Invalid rules config: ${errors.join(', ')}`);
  }
  return r as RulesConfig;
}

/** Shallow-merges an override (e.g. a future remote config) over the bundled rules and re-validates. */
export function mergeRules(base: RulesConfig, override: Partial<RulesConfig> | null | undefined): RulesConfig {
  return validateRules({ ...base, ...(override ?? {}) });
}

/** EXPO_PUBLIC_APP_MODE=tester builds a tester-mode bundle without editing rules.json. */
export function loadRules(envMode: string | undefined = process.env.EXPO_PUBLIC_APP_MODE): RulesConfig {
  const base = validateRules(bundled);
  if (envMode === 'tester' || envMode === 'developer-demo') {
    return mergeRules(base, { mode: envMode });
  }
  return base;
}
