// Fresh-item selection and order protection (Trial_App_Spec.md §6, §7, §9; lessons §3.5).
// "Fresh" = never seen before by this learner. A seen item is never reused as fresh.
import type { RulesConfig } from '@/config/rules';
import type { ErrorTag, Item, Pool, Referent } from '@/content/schema';

export interface AttemptLog {
  item_id: string;
  local_date: string;
  pool: Pool;
  skills: string[];
  unit: 'ENTRY' | 'A' | 'B';
  first_attempt: boolean;
  hint_used: boolean;
}

export interface FreshContext {
  /** Local calendar date, YYYY-MM-DD. "Later session" means a different calendar day. */
  today: string;
  history: AttemptLog[];
  rules: RulesConfig;
}

const PRACTICE_POOLS: Pool[] = ['INSTR', 'PRACT', 'READY', 'REMED', 'TRANS', 'SPARE', 'MT'];
const COUNTED_PRACTICE: Pool[] = ['PRACT', 'REMED', 'TRANS', 'SPARE', 'MT'];

export function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

function lastPracticeDate(history: AttemptLog[], unit: Item['unit']): string | null {
  let last: string | null = null;
  for (const h of history) {
    if (h.unit === unit && PRACTICE_POOLS.includes(h.pool) && (!last || h.local_date > last)) last = h.local_date;
  }
  return last;
}

export function isEligibleFresh(item: Item, ctx: FreshContext, allItems: Item[] = []): boolean {
  if (item.pool === 'FOCUS') return false;
  const seen = new Set(ctx.history.map((h) => h.item_id));
  if (seen.has(item.item_id)) return false;

  // Forms reserved by a later check must not appear anywhere before that check.
  const forms = item.forms ?? [];
  if (forms.length) {
    const blocked = allItems.some(
      (r) =>
        r.reserve_forms &&
        r.item_id !== item.item_id &&
        !seen.has(r.item_id) &&
        (r.forms ?? []).some((f) => forms.includes(f))
    );
    if (blocked) return false;
  }

  const primary = item.skills[0];
  const onSkill = (h: AttemptLog) => !!primary && h.skills.includes(primary);

  if (item.pool === 'READY') {
    const practice = ctx.history.filter((h) => onSkill(h) && COUNTED_PRACTICE.includes(h.pool)).length;
    if (practice < ctx.rules.ready_after_practice_attempts) return false;
  }

  if (item.pool === 'D7' || item.pool === 'D30') {
    const last = lastPracticeDate(ctx.history, item.unit);
    if (!last || daysBetween(last, ctx.today) < ctx.rules.check_days[item.pool]) return false;
  }

  if (item.later_day && !ctx.history.some((h) => onSkill(h) && h.local_date < ctx.today)) return false;

  return true;
}

export function pickFreshItem(
  items: Item[],
  ctx: FreshContext,
  opts: { pools: Pool[]; skill?: string; exclude?: Set<string> }
): Item | null {
  const candidates = items
    .map((item, i) => ({ item, i }))
    .filter(
      ({ item }) =>
        opts.pools.includes(item.pool) &&
        (!opts.skill || item.skills.includes(opts.skill)) &&
        !opts.exclude?.has(item.item_id) &&
        isEligibleFresh(item, ctx, items)
    )
    .sort((a, b) => (a.item.order ?? Infinity) - (b.item.order ?? Infinity) || a.i - b.i);
  return candidates[0]?.item ?? null;
}

/** Focused question after a serious mistake. Not evidence; may be repeated. */
export function pickFocusItem(items: Item[], tag: ErrorTag, referent?: Referent): Item | null {
  const focus = items.filter((i) => i.pool === 'FOCUS' && i.focus_for?.tag === tag);
  return (
    focus.find((i) => referent && i.focus_for?.referent === referent) ??
    focus.find((i) => !i.focus_for?.referent) ??
    null
  );
}

export interface FormClash {
  trans_item: string;
  other_item: string;
  form: string;
}

/** TRANS items must use unseen material: report any form they share with another item (e.g. MT-B3/VT2). */
export function findFormClashes(items: Item[]): FormClash[] {
  const clashes: FormClash[] = [];
  for (const t of items.filter((i) => i.pool === 'TRANS')) {
    for (const o of items) {
      if (o === t || o.pool === 'FOCUS') continue;
      for (const form of t.forms ?? []) {
        if ((o.forms ?? []).includes(form)) clashes.push({ trans_item: t.item_id, other_item: o.item_id, form });
      }
    }
  }
  return clashes;
}
