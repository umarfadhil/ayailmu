// Teaching exposure provenance (repair 2026-10-16, acceptance follow-up): a timed check is
// independent retention evidence only if the material it relies on was not shown the same day.
// Lesson screens passed in a session and screens opened in the Guide are recorded as dated views.
import type { GatedContent } from '@/content/gating';
import type { Item, LessonScreen } from '@/content/schema';
import { createSerialQueue } from '@/storage/serial';
import type { Store } from '@/storage/types';

export interface ScreenView {
  screen_id: string;
  /** Local calendar date of the view (YYYY-MM-DD). */
  local_date: string;
  source: 'session' | 'guide';
  /** ISO time of the (first) view that day. */
  at: string;
}

export const SCREEN_VIEWS_KEY = 'screen_views';

const isView = (v: unknown): v is ScreenView => {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.screen_id === 'string' &&
    typeof o.local_date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(o.local_date) &&
    (o.source === 'session' || o.source === 'guide') &&
    typeof o.at === 'string'
  );
};

/** Parses the stored view list. Unreadable data is refused (thrown), never silently treated as "no exposure". */
export function parseScreenViews(raw: string | null): ScreenView[] {
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Stored screen views are unreadable; they were not modified.');
  }
  if (!Array.isArray(parsed) || !parsed.every(isView)) throw new Error('Stored screen views are malformed; they were not modified.');
  return parsed;
}

export async function loadScreenViews(store: Store): Promise<ScreenView[]> {
  return parseScreenViews(await store.getMeta(SCREEN_VIEWS_KEY));
}

// One queue per store: read-append-write of the view list is never interleaved within this app run.
const queues = new WeakMap<Store, ReturnType<typeof createSerialQueue>>();

/** Appends a view (one per screen, source and day; the first time is kept). Append-only. */
export function recordScreenView(store: Store, view: ScreenView): Promise<void> {
  let q = queues.get(store);
  if (!q) {
    q = createSerialQueue();
    queues.set(store, q);
  }
  return q(async () => {
    const views = await loadScreenViews(store);
    if (views.some((v) => v.screen_id === view.screen_id && v.local_date === view.local_date && v.source === view.source)) return;
    await store.setMeta(SCREEN_VIEWS_KEY, JSON.stringify([...views, view]));
  });
}

/**
 * Lesson screens whose content a check item relies on: every screen of the item's unit (rule
 * explanations and examples), plus any screen whose examples teach a lemma the item requires.
 */
export function teachingScreens(item: Item, content: GatedContent): LessonScreen[] {
  const needs = item.requires_taught ?? [];
  return content.screens.filter((sc) => sc.unit === item.unit || (sc.examples ?? []).some((e) => needs.includes(e.arabic)));
}

/** Same-day views of the item's teaching screens up to `nowIso`, as provenance labels ("guide:DEMO-S4"). */
export function sameDayExposure(item: Item, content: GatedContent, views: ScreenView[], today: string, nowIso?: string): string[] {
  const ids = new Set(teachingScreens(item, content).map((s) => s.screen_id));
  const labels = views
    .filter((v) => v.local_date === today && ids.has(v.screen_id) && (!nowIso || v.at <= nowIso))
    .map((v) => `${v.source}:${v.screen_id}`);
  return [...new Set(labels)].sort();
}

/** Teaching screens of the item the learner has never been shown (it must be taught on an earlier day first). */
export function unseenTeaching(item: Item, content: GatedContent, screensSeen: string[]): LessonScreen[] {
  const needs = item.requires_taught ?? [];
  return content.screens.filter((sc) => !screensSeen.includes(sc.screen_id) && (sc.examples ?? []).some((e) => needs.includes(e.arabic)));
}

/**
 * First-introduction baseline (migration): when a screen that teaches a lemma the item needs was
 * first shown AFTER the unit's practice anchor (e.g. the v0.3 word table reaching a v0.2 learner),
 * the check's D7/D30 interval runs from that first view, not from the old practice. Returns that
 * date, or null when the teaching predates the anchor (ordinary learners) or has no recorded view.
 * The practice anchor and the answer history are not changed.
 */
export function newTeachingBaseline(item: Item, content: GatedContent, views: ScreenView[], anchor: string | null): string | null {
  const needs = item.requires_taught ?? [];
  if (!needs.length) return null;
  const ids = new Set(content.screens.filter((sc) => (sc.examples ?? []).some((e) => needs.includes(e.arabic))).map((sc) => sc.screen_id));
  let latestFirst: string | null = null;
  for (const id of ids) {
    const first = views
      .filter((v) => v.screen_id === id)
      .map((v) => v.local_date)
      .sort()[0];
    if (first && (!latestFirst || first > latestFirst)) latestFirst = first;
  }
  return latestFirst && (!anchor || latestFirst > anchor) ? latestFirst : null;
}
