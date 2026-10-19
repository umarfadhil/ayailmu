// «Jalur belajar»: one factual state per unit, read from the existing progress projection. No rule of
// its own: nothing here says a unit is learned or finished (the learned rule is pending).
import type { GatedContent } from '@/content/gating';
import type { CheckLine } from '@/engine/progress';
import type { Learning } from './useLearning';
import type { UnitId } from './labels';

export type UnitState = 'due' | 'practising' | 'available' | 'closed';

export const UNIT_STATE_LABEL: Record<UnitState, string> = {
  due: 'Ulasan hari ini',
  practising: 'Sedang dilatih',
  available: 'Tersedia',
  closed: 'Belum dibuka',
};

/** A check still has unanswered items that are due (a check that can never be complete is not "due" forever). */
function checkDue(c: CheckLine): boolean {
  if (c.status === 'due') return true;
  return c.status === 'partial' && c.attempted + c.assisted + c.legacy_attempted < c.available;
}

/**
 * Per unit: «Belum dibuka» while `open` is false; «Ulasan hari ini» when one of its words or checks is due
 * today or earlier; «Sedang dilatih» once it has answers; otherwise «Tersedia».
 */
export function unitStates(learning: Learning, content: GatedContent): { unit: UnitId; state: UnitState }[] {
  const wordUnit = new Map(content.items.filter((i) => i.word_id).map((i) => [i.word_id as string, i.unit]));
  return learning.progress.units.map((u): { unit: UnitId; state: UnitState } => {
    if (!u.open) return { unit: u.unit, state: 'closed' };
    const wordDue = learning.progress.words.some((w) => wordUnit.get(w.word_id) === u.unit && w.next_due <= learning.today);
    if (wordDue || checkDue(u.retention_d7) || checkDue(u.retention_d30)) return { unit: u.unit, state: 'due' };
    return { unit: u.unit, state: learning.answers.some((r) => r.unit === u.unit) ? 'practising' : 'available' };
  });
}
