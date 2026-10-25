// Whether the next lesson displayed teaching, a question or feedback to `owner` on `day`, read from its own stored
// document, so Unit A can count it as same-day assistance. No document is no help; a present one must be this
// owner's and pass the controller's own parser, or the read rejects. Nothing is repaired or written.
import { NEXT_LESSON_META_KEY, nextLessonHelpDays } from '@/pilot/nextLesson/controller';
import type { Store } from '@/storage/types';

export async function nextLessonAssistedOn(
  store: Pick<Store, 'getMeta'>,
  owner: string | undefined,
  day: string,
): Promise<boolean> {
  const raw: unknown = await store.getMeta(NEXT_LESSON_META_KEY);
  if (raw === null) return false;
  const days = typeof raw === 'string' && owner !== undefined ? nextLessonHelpDays(raw, owner, day) : null;
  if (days === null) throw new Error('Next lesson progress is unreadable for this learner; it was not modified.');
  return days.includes(day);
}
