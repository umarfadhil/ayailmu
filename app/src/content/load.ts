import type { ContentPack } from './schema';
import legacy from './fixtures/demo-unit-a.json';
import v02 from './fixtures/demo-v0.2.json';
import active from './fixtures/demo-v0.3.json';

/**
 * Read-only legacy registry (v0.1, typed/binary questions). Kept only to interpret old
 * answers and their lineage; it is never offered as a learner question path.
 */
export const legacyPack = legacy as unknown as ContentPack;

/** Previous four-choice pack (v0.2): read-only, for lineage and history interpretation. */
export const v02Pack = v02 as unknown as ContentPack;

/**
 * Active four-choice pack (v0.3, content repair 2026-10-16). Synthetic, unreviewed developer fixture. Real lesson content
 * is loaded only after reviewers mark items approved-for-trial (spec §9, §14).
 */
export const activePack = active as unknown as ContentPack;

/** @deprecated legacy alias used by legacy-semantics tests. */
export const demoPack = legacyPack;

/** Every pack the app has shipped, newest first (read-only history registry). */
const HISTORY: ContentPack[] = [activePack, v02Pack, legacyPack];

/**
 * Item ID → lineage, from `pack` (it wins) and then every earlier shipped pack, so retired
 * material (e.g. v0.2 B2-Y1, B2-D7V1, B2-W4) keeps its identity for interpreting old answers.
 */
export function buildLineageMap(pack: ContentPack = activePack): Record<string, string> {
  const map: Record<string, string> = {};
  for (const p of [pack, ...HISTORY.filter((h) => h !== pack)]) {
    for (const item of p.items) {
      if (!item.lineage) continue;
      if (!(item.item_id in map)) map[item.item_id] = item.lineage;
      for (const old of item.legacy_item_ids ?? []) if (!(old in map)) map[old] = item.lineage;
    }
  }
  return map;
}

/**
 * The item exactly as a learner saw it: by ID within the pack of that content version (or, for
 * records without a version, the newest pack that has the ID). Never the revised wording of a
 * successor item: exposure history must describe what was actually displayed.
 */
export function historicalItem(itemId: string, contentVersion?: string): ContentPack['items'][number] | undefined {
  const packs = contentVersion ? HISTORY.filter((p) => p.content_version === contentVersion) : HISTORY;
  for (const p of packs) {
    const hit = p.items.find((i) => i.item_id === itemId);
    if (hit) return hit;
  }
  return undefined;
}

const LINEAGE = buildLineageMap();

/** Lineage of any active or legacy item ID; unknown IDs are their own lineage. */
export function lineageOf(itemId: string, map: Record<string, string> = LINEAGE): string {
  return map[itemId] ?? `id:${itemId}`;
}
