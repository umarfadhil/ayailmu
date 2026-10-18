import type { AppMode } from '@/config/rules';
import { buildLineageMap } from './load';
import { normalize } from '@/engine/scoring';
import type { ContentPack, Item, LessonScreen, ReviewStatus } from './schema';

export interface GatedContent {
  content_version: string;
  /** Authoritative pack flag: synthetic developer material (never inferred from item IDs). */
  synthetic: boolean;
  answer_format?: 'mcq4';
  /** Active + legacy item ID → lineage (freshness/review identity across content versions). */
  lineage: Record<string, string>;
  /** True when anything shown is not approved-for-trial (developer demo). */
  unreviewed: boolean;
  /** True when nothing can be shown (tester mode before approval). */
  empty: boolean;
  prompts: ContentPack['prompts'];
  feedback: ContentPack['feedback'];
  screens: LessonScreen[];
  items: Item[];
}

export function isShowable(status: ReviewStatus, synthetic: boolean, mode: AppMode): boolean {
  if (mode === 'developer-demo') return true;
  return !synthetic && status === 'approved-for-trial';
}

/** Read-only filter: never changes review_status. Tester mode shows only approved, non-synthetic content. */
export function gateContent(pack: ContentPack, mode: AppMode): GatedContent {
  const items = pack.items.filter((i) => isShowable(i.review_status, pack.synthetic, mode));
  const screens = pack.lesson_screens.filter((s) => isShowable(s.review_status, pack.synthetic, mode));
  const unreviewed =
    pack.synthetic ||
    items.some((i) => i.review_status !== 'approved-for-trial') ||
    screens.some((s) => s.review_status !== 'approved-for-trial');
  return {
    content_version: pack.content_version,
    synthetic: pack.synthetic,
    answer_format: pack.answer_format,
    lineage: buildLineageMap(pack),
    unreviewed,
    empty: items.length === 0,
    prompts: pack.prompts,
    feedback: pack.feedback,
    screens,
    items,
  };
}

const ARABIC_LETTER = /[ء-يٱ-ۓ]/;
const HARAKAT = /[ً-ْ]/;

/** Every Arabic word must carry vowel marks (spec §5: never stripped of marks). */
export function missingHarakat(text: string): string[] {
  return text
    .split(/[\s.,:؛،!?«»"()]+/)
    .filter((w) => ARABIC_LETTER.test(w) && !HARAKAT.test(w));
}

export function validatePack(pack: ContentPack): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const checkFeedback = (owner: string, id: string | undefined) => {
    if (id && !pack.feedback[id]) errors.push(`${owner}: unknown feedback id ${id}`);
  };

  for (const s of pack.lesson_screens) {
    if (s.clue_paragraph !== undefined && !(s.clue_paragraph >= 0 && s.clue_paragraph < s.body.length)) {
      errors.push(`${s.screen_id}: clue_paragraph out of range`);
    }
    for (const ex of s.examples ?? []) {
      const bare = missingHarakat(ex.arabic);
      if (bare.length) errors.push(`${s.screen_id}: harakat missing in ${bare.join(' ')}`);
    }
  }

  for (const item of pack.items) {
    const id = item.item_id;
    if (ids.has(id)) errors.push(`${id}: duplicate item_id`);
    ids.add(id);
    if (item.constructed !== true) errors.push(`${id}: constructed must be true in this trial`);
    if (!pack.prompts[item.prompt_id]) errors.push(`${id}: unknown prompt_id ${item.prompt_id}`);
    if (item.content_version !== pack.content_version) errors.push(`${id}: content_version mismatch`);
    const bare = [
      ...missingHarakat(item.arabic),
      ...item.help_lines.flatMap((h) => missingHarakat(h.word)),
      ...(item.options ?? []).filter((o) => o.arabic).flatMap((o) => missingHarakat(o.text)),
    ];
    if (bare.length) errors.push(`${id}: harakat missing in ${bare.join(' ')}`);
    for (const fid of Object.values(item.feedback_ids)) checkFeedback(id, fid);

    if (pack.answer_format === 'mcq4') {
      errors.push(...validateMcq4(item, pack));
      continue;
    }
    if (item.type === 'q-form2' || item.type === 'choose' || item.type === 'q-ref') {
      const correct = (item.options ?? []).filter((o) => o.correct).length;
      if (correct !== 1) errors.push(`${id}: choice item needs exactly one correct option`);
      for (const o of item.options ?? []) checkFeedback(id, o.feedback_id);
    }
    if (item.type === 'q-mean' || item.type === 'q-para') {
      if (!item.accepted || item.accepted.terms.length === 0) errors.push(`${id}: typed item needs accepted terms`);
      for (const k of item.accepted?.known_errors ?? []) checkFeedback(id, k.feedback_id);
      for (const p of item.accepted?.pending_terms ?? []) checkFeedback(id, p.feedback_id);
    }
    if (item.type === 'q-para' && !item.referent) errors.push(`${id}: q-para needs a referent`);
    if (item.pool === 'FOCUS' && !item.focus_for) errors.push(`${id}: FOCUS item needs focus_for`);
  }
  return errors;
}

/** Four-choice rules (content v0.2). A validator cannot certify pedagogy; content review still applies. */
function validateMcq4(item: Item, pack: ContentPack): string[] {
  const id = item.item_id;
  const errors: string[] = [];
  if (item.type !== 'mcq4') return [`${id}: active items must be mcq4 (got ${item.type})`];
  if (!item.format) errors.push(`${id}: mcq4 needs a format`);
  if (!item.lineage) errors.push(`${id}: mcq4 needs a lineage`);
  const opts = item.options ?? [];
  if (opts.length !== 4) errors.push(`${id}: needs exactly 4 options (got ${opts.length})`);
  if (new Set(opts.map((o) => o.id)).size !== opts.length) errors.push(`${id}: duplicate option id`);
  const texts = opts.map((o) => (o.arabic ? o.text : normalize(o.text)));
  if (new Set(texts).size !== texts.length) errors.push(`${id}: duplicate option text`);
  if (opts.filter((o) => o.correct).length !== 1) errors.push(`${id}: needs exactly one correct option`);
  for (const o of opts) {
    if (o.arabic && missingHarakat(o.text).length) errors.push(`${id}/${o.id}: harakat missing in option`);
    if (o.correct) continue;
    if (!o.misconceptions?.length) errors.push(`${id}/${o.id}: wrong option needs a misconception`);
    if (typeof o.serious !== 'boolean') errors.push(`${id}/${o.id}: wrong option needs serious true/false`);
    if (!o.feedback_ids?.length) errors.push(`${id}/${o.id}: wrong option needs feedback`);
    for (const f of o.feedback_ids ?? []) if (!pack.feedback[f]) errors.push(`${id}/${o.id}: unknown feedback id ${f}`);
  }
  if (item.feedback_ids.correct && !pack.feedback[item.feedback_ids.correct]) {
    errors.push(`${id}: unknown feedback id ${item.feedback_ids.correct}`);
  }
  if (!pack.prompts[item.prompt_id]) errors.push(`${id}: unknown prompt_id ${item.prompt_id}`);
  if (item.content_version !== pack.content_version) errors.push(`${id}: content_version mismatch`);
  const bare = [...missingHarakat(item.arabic), ...item.help_lines.flatMap((h) => missingHarakat(h.word))];
  if (bare.length) errors.push(`${id}: harakat missing in ${bare.join(' ')}`);
  if (item.pool === 'FOCUS' && !item.focus_for) errors.push(`${id}: FOCUS item needs focus_for`);
  return errors;
}
