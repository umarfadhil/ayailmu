import type { ContentPack } from './schema';
import legacy from './fixtures/demo-unit-a.json';
import active from './fixtures/demo-v0.2.json';

/**
 * Read-only legacy registry (v0.1, typed/binary questions). Kept only to interpret old
 * answers and their lineage; it is never offered as a learner question path.
 */
export const legacyPack = legacy as unknown as ContentPack;

/**
 * Active four-choice pack (v0.2). Synthetic, unreviewed developer fixture. Real lesson content
 * is loaded only after reviewers mark items approved-for-trial (spec §9, §14).
 */
export const activePack = active as unknown as ContentPack;

/** @deprecated legacy alias used by legacy-semantics tests. */
export const demoPack = legacyPack;

/** Legacy item ID → lineage, from the active items' `legacy_item_ids`. */
export function buildLineageMap(pack: ContentPack = activePack): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of pack.items) {
    if (!item.lineage) continue;
    map[item.item_id] = item.lineage;
    for (const old of item.legacy_item_ids ?? []) map[old] = item.lineage;
  }
  return map;
}

const LINEAGE = buildLineageMap();

/** Lineage of any active or legacy item ID; unknown IDs are their own lineage. */
export function lineageOf(itemId: string, map: Record<string, string> = LINEAGE): string {
  return map[itemId] ?? `id:${itemId}`;
}
