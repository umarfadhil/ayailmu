// Spaced review by deterministic replay of the durable answer log (Trial_App_Spec.md §6–§7).
// There is no second mutable schedule store: the same log always yields the same schedule.
//
// Provisional pilot ladder (rules.review_spacing_days, default [1, 3, 7]):
// - first eligible exposure → level 0, due +1 calendar day
// - correct review → one level up (max: last rung); wrong / «belum tahu» review → one level down (min 0)
// - due = latest exposure date + spacing[level]; never due on the day of the latest exposure
import type { RulesConfig } from '@/config/rules';
import type { GatedContent } from '@/content/gating';
import type { Item, Pool } from '@/content/schema';
import type { AnswerRecord } from '@/storage/types';
import { addDays } from './util';

export interface ReviewState {
  key: string;
  /** Index into review_spacing_days. */
  level: number;
  last_exposure: string;
  due: string;
  /** Active item to present when the key is reviewed (never a timed-check or focus item). */
  review_item_id: string | null;
  /** Answer IDs that shaped this state (provenance). */
  events: string[];
  rules_version: string;
}

/** Pools whose exposures create or refresh a review key. Checks/focus/practice-only never do. */
const EXPOSURE_POOLS: Pool[] = ['PRACT', 'REMED', 'READY', 'TRANS', 'SPARE'];

function resolveItem(r: AnswerRecord, content: GatedContent): Item | undefined {
  const direct = content.items.find((i) => i.item_id === r.item_id);
  if (direct) return direct;
  const lineage = r.lineage ?? content.lineage[r.item_id];
  return lineage ? content.items.find((i) => i.lineage === lineage && EXPOSURE_POOLS.includes(i.pool)) : undefined;
}

function isReviewEvent(r: AnswerRecord): boolean {
  return r.role === 'review' || r.pool === 'REVIEW';
}

function isExposure(r: AnswerRecord, item: Item): boolean {
  if (r.role === 'check' || r.role === 'focus') return false;
  return EXPOSURE_POOLS.includes(item.pool) && !item.practice_only;
}

/** Replays the log (deduplicated by answer ID, ordered by timestamp then ID) into per-key review states. */
export function reviewStates(log: AnswerRecord[], content: GatedContent, rules: RulesConfig): Map<string, ReviewState> {
  const spacing = rules.review_spacing_days;
  const top = spacing.length - 1;
  const unique = new Map<string, AnswerRecord>();
  for (const r of log) if (!unique.has(r.answer_id)) unique.set(r.answer_id, r);
  const events = [...unique.values()].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.answer_id.localeCompare(b.answer_id)
  );

  const states = new Map<string, ReviewState>();
  for (const r of events) {
    const item = resolveItem(r, content);
    if (!item?.review_key) continue;
    const review = isReviewEvent(r);
    if (!review && !isExposure(r, item)) continue;
    const key = item.review_key;
    const prev = states.get(key);
    if (!prev) {
      if (review) continue; // a review always follows an exposure; ignore orphans
      states.set(key, {
        key,
        level: 0,
        last_exposure: r.local_date,
        due: addDays(r.local_date, spacing[0]),
        review_item_id: item.item_id,
        events: [r.answer_id],
        rules_version: rules.rules_version,
      });
      continue;
    }
    let level = prev.level;
    if (review) {
      if (r.outcome === 'correct') level = Math.min(level + 1, top);
      else if (r.outcome === 'wrong' || r.outcome === 'dont_know') level = Math.max(level - 1, 0);
    }
    const last = r.local_date > prev.last_exposure ? r.local_date : prev.last_exposure;
    states.set(key, { ...prev, level, last_exposure: last, due: addDays(last, spacing[level]), events: [...prev.events, r.answer_id] });
  }
  return new Map([...states.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/** Keys due on `today`: each overdue key once, oldest due first, then by key. Never on the day of the latest exposure. */
export function dueReviews(states: Map<string, ReviewState>, today: string, exclude: Set<string> = new Set()): ReviewState[] {
  return [...states.values()]
    .filter((s) => s.review_item_id && s.due <= today && s.last_exposure < today && !exclude.has(s.key))
    .sort((a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key));
}

/** Earliest upcoming review date strictly after `today`, or null. */
export function nextReviewDate(states: Map<string, ReviewState>, today: string): string | null {
  const future = [...states.values()].map((s) => (s.due > today ? s.due : null)).filter((d): d is string => !!d);
  return future.length ? future.sort()[0] : null;
}
