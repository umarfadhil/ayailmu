// Timed-check collections (whole-branch review): a check is the set of D7 or D30 items of one unit.
// Its outcomes, and follow-ups that would reveal them, stay closed until no item of it is unanswered.
import type { GatedContent } from '@/content/gating';
import type { Item } from '@/content/schema';
import type { AnswerRecord } from '@/storage/types';

const lineageOfItem = (i: Item) => i.lineage ?? `id:${i.item_id}`;

/** Lineages a learner has answered (any role), across content versions. */
export function answeredLineages(log: Pick<AnswerRecord, 'item_id' | 'lineage'>[], content: GatedContent): Set<string> {
  return new Set(log.map((r) => r.lineage ?? content.lineage[r.item_id] ?? `id:${r.item_id}`));
}

/** Items of the timed check (unit × pool) that are still unanswered. */
export function openCheckItems(unit: Item['unit'], pool: 'D7' | 'D30', answered: Set<string>, content: GatedContent): Item[] {
  return content.items.filter((i) => i.unit === unit && i.pool === pool && !answered.has(lineageOfItem(i)));
}

export const isCheckPool = (pool: string): pool is 'D7' | 'D30' => pool === 'D7' || pool === 'D30';
