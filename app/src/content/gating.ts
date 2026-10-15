import type { AppMode } from '@/config/rules';
import type { ContentPack, Item, LessonScreen, ReviewStatus } from './schema';

export interface GatedContent {
  content_version: string;
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
