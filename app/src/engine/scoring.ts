// Answer scoring (Trial_App_Spec.md §5, Lessons_Unit_A_B_Draft.md §2.6).
// Typed answers are never auto-marked wrong unless they clearly match a known error;
// everything unclear is "pending" (waiting for human check) and counts neither way.
import type { RulesConfig } from '@/config/rules';
import type { AcceptedAnswers, ErrorTag, Item, KnownError, Referent } from '@/content/schema';

export type PartScore = 'correct' | 'wrong' | 'pending' | 'dont_know' | 'not_assessed';
export type Outcome = 'correct' | 'wrong' | 'pending' | 'dont_know';

export type Response =
  | { kind: 'typed'; text: string; ref?: Referent | 'dont_know' }
  | { kind: 'choice'; option_id: string }
  | { kind: 'dont_know' };

export interface TypedScore {
  status: 'correct' | 'wrong' | 'pending';
  matched?: string;
  /** Generic possession/action flags (held for human check). */
  flags: ErrorTag[];
  known_error?: KnownError;
  feedback_id?: string;
  /** An accepted word appeared with a negation; held for human check. */
  negated?: boolean;
}

export interface ItemScore {
  outcome: Outcome;
  parts: Record<string, PartScore>;
  error_tags: ErrorTag[];
  /** Serious mistake (blocks "learned" until resolved, spec §7). */
  serious: ErrorTag | null;
  feedback_ids: string[];
}

export function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function tokenMatches(answerToken: string, termToken: string, rules: RulesConfig): boolean {
  if (answerToken === termToken) return true;
  const { min_word_length, max_edits } = rules.typo_tolerance;
  return (
    max_edits > 0 &&
    termToken.length >= min_word_length &&
    Math.abs(answerToken.length - termToken.length) <= max_edits &&
    levenshtein(answerToken, termToken) <= max_edits
  );
}

/** Finds `term` as a run of whole tokens. Returns the start index, or -1. */
function findTerm(tokens: string[], term: string, rules: RulesConfig, typos: boolean): number {
  const termTokens = normalize(term).split(' ').filter(Boolean);
  if (!termTokens.length) return -1;
  for (let i = 0; i + termTokens.length <= tokens.length; i++) {
    const ok = termTokens.every((t, k) =>
      typos ? tokenMatches(tokens[i + k], t, rules) : tokens[i + k] === t
    );
    if (ok) return i;
  }
  return -1;
}

const NOMINALIZED = /^ke[a-z]{3,}an(nya)?$/;

function genericFlags(tokens: string[], rules: RulesConfig): ErrorTag[] {
  const flags: ErrorTag[] = [];
  if (tokens.some((t) => rules.possession_words.includes(t) || NOMINALIZED.test(t))) flags.push('possession');
  if (tokens.some((t) => rules.action_words.includes(t))) flags.push('invented-action');
  return flags;
}

export function scoreTyped(raw: string, accepted: AcceptedAnswers, rules: RulesConfig): TypedScore {
  const tokens = normalize(raw).split(' ').filter(Boolean);

  for (const k of accepted.known_errors ?? []) {
    if (findTerm(tokens, k.pattern, rules, false) >= 0) {
      return { status: 'wrong', known_error: k, flags: [k.tag], feedback_id: k.feedback_id };
    }
  }
  for (const p of accepted.pending_terms ?? []) {
    if (findTerm(tokens, p.term, rules, false) >= 0) {
      return { status: 'pending', flags: [], feedback_id: p.feedback_id };
    }
  }

  const flags = genericFlags(tokens, rules);
  let matched: string | undefined;
  let negated = false;
  for (const term of accepted.terms) {
    const at = findTerm(tokens, term, rules, true);
    if (at < 0) continue;
    const len = normalize(term).split(' ').length;
    // Conservative: a negation anywhere outside the matched term ("tidak terlalu beriman",
    // "belum menjadi orang yang beriman") may reverse the meaning, so hold for human check.
    const outside = [...tokens.slice(0, at), ...tokens.slice(at + len)];
    if (outside.some((t) => rules.negation_words.includes(t))) {
      negated = true;
      continue;
    }
    matched = term;
    break;
  }
  if (matched && !negated && flags.length === 0) return { status: 'correct', matched, flags };
  return { status: 'pending', matched: negated ? undefined : matched, negated, flags };
}

function pickOutcome(parts: PartScore[]): Outcome {
  if (parts.includes('wrong')) return 'wrong';
  if (parts.every((p) => p === 'correct')) return 'correct';
  if (parts.every((p) => p === 'dont_know')) return 'dont_know';
  return 'pending';
}

function refFeedback(referent: Referent): string {
  return referent === 'perempuan' ? 'FA-REF-HIYA' : 'FA-REF-HUWA';
}

export function scoreItem(item: Item, response: Response, rules: RulesConfig): ItemScore {
  const fb = item.feedback_ids;

  if (response.kind === 'dont_know') {
    const parts: Record<string, PartScore> =
      item.type === 'q-para'
        ? { who: 'dont_know', description: 'dont_know', describes: 'dont_know' }
        : { answer: 'dont_know' };
    return { outcome: 'dont_know', parts, error_tags: [], serious: null, feedback_ids: fb.dont_know ? [fb.dont_know] : [] };
  }

  if (item.type === 'q-mean') {
    const text = response.kind === 'typed' ? response.text : '';
    const t = scoreTyped(text, item.accepted ?? { terms: [] }, rules);
    const feedback = t.feedback_id ?? fb[t.status];
    return {
      outcome: t.status,
      parts: { meaning: t.status },
      error_tags: t.status === 'wrong' ? ['lexical', ...t.flags.filter((f) => f !== 'lexical')] : [],
      serious: null,
      feedback_ids: feedback ? [feedback] : [],
    };
  }

  if (item.type === 'q-para') {
    if (response.kind !== 'typed') throw new Error(`${item.item_id}: q-para needs a typed response`);
    const referent = item.referent!;
    const who: PartScore =
      !response.ref || response.ref === 'dont_know' ? 'dont_know' : response.ref === referent ? 'correct' : 'wrong';
    const t = scoreTyped(response.text, item.accepted ?? { terms: [] }, rules);
    // Parts follow the typed status: a pending (unclear/negated/flagged) answer is never upgraded to correct.
    const description: PartScore = t.known_error ? 'wrong' : t.status === 'correct' || (t.matched && !t.negated) ? 'correct' : 'pending';
    const describes: PartScore = t.known_error ? 'wrong' : t.status === 'correct' ? 'correct' : 'pending';

    const error_tags: ErrorTag[] = [];
    const feedback_ids: string[] = [];
    let serious: ErrorTag | null = null;
    if (t.known_error) {
      error_tags.push(t.known_error.tag);
      feedback_ids.push(t.known_error.feedback_id);
      if (t.known_error.serious) serious = t.known_error.tag;
    } else {
      error_tags.push(...t.flags);
    }
    if (who === 'wrong') {
      error_tags.push('wrong-referent');
      feedback_ids.push(refFeedback(referent));
      serious = serious ?? 'wrong-referent';
    }
    const outcome = pickOutcome([who, description, describes]);
    if (outcome === 'correct' && fb.correct) feedback_ids.push(fb.correct);
    if (outcome === 'pending' && feedback_ids.length === 0) feedback_ids.push(t.feedback_id ?? fb.pending ?? 'FA-PEND');
    return { outcome, parts: { who, description, describes }, error_tags, serious, feedback_ids };
  }

  // Choice items: q-form2, q-ref, choose
  if (response.kind !== 'choice') throw new Error(`${item.item_id}: choice item needs a choice response`);
  const option = (item.options ?? []).find((o) => o.id === response.option_id);
  if (!option) throw new Error(`${item.item_id}: unknown option ${response.option_id}`);
  if (option.correct) {
    return { outcome: 'correct', parts: { answer: 'correct' }, error_tags: [], serious: null, feedback_ids: fb.correct ? [fb.correct] : [] };
  }
  const tag: ErrorTag | undefined = option.error_tag ?? (item.type === 'q-ref' ? 'wrong-referent' : undefined);
  const feedback = option.feedback_id ?? fb.wrong;
  return {
    outcome: 'wrong',
    parts: { answer: 'wrong' },
    error_tags: tag ? [tag] : [],
    serious: item.type === 'q-ref' && item.pool !== 'FOCUS' ? 'wrong-referent' : null,
    feedback_ids: feedback ? [feedback] : [],
  };
}
