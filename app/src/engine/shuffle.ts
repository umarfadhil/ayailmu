/** Fisher–Yates permutation of option IDs. The RNG is injectable for deterministic tests. */
export function optionOrder(ids: readonly string[], rng: () => number = Math.random): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** True only for an exact permutation: same IDs, same count, no duplicates. */
export function isPermutation(order: readonly string[] | undefined | null, ids: readonly string[]): boolean {
  if (!Array.isArray(order) || order.length !== ids.length) return false;
  const want = new Set(ids);
  const seen = new Set<string>();
  for (const id of order) {
    if (!want.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
