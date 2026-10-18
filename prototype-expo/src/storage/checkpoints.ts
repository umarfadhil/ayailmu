/**
 * Lifecycle checkpoints (ENG-04 with ENG-R01): work that must be saved before this tab gives up
 * its writer lock (e.g. the open session's active time). A callback may return a promise (a
 * checkpoint waiting for an answer that is still being saved); the lock is released after it settles.
 */
const callbacks = new Set<() => unknown>();

export function onCheckpoint(fn: () => unknown): () => void {
  callbacks.add(fn);
  return () => void callbacks.delete(fn);
}

/** Runs every checkpoint; resolves when all have settled (a failure never blocks the release). */
export function runCheckpoints(): Promise<void> | undefined {
  const pending: Promise<unknown>[] = [];
  for (const fn of [...callbacks]) {
    try {
      const r = fn();
      if (r && typeof (r as Promise<unknown>).then === 'function') pending.push(r as Promise<unknown>);
    } catch {
      // A failed checkpoint must never keep the lock from being released.
    }
  }
  return pending.length ? Promise.allSettled(pending).then(() => undefined) : undefined;
}
