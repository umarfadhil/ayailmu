// Field validation for stored records (ENG-06): everything the learning projections replay must be
// present and well typed, or the stored data is refused (never rewritten). Optional v2 fields are
// checked only when present, so legitimate v1 records stay readable.
const OUTCOMES = new Set(['correct', 'wrong', 'pending', 'dont_know']);
const UNITS = new Set(['ENTRY', 'A', 'B']);
const ROLES = new Set(['practice', 'remed', 'focus', 'review', 'check']);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isDate = (v: unknown) => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

export function answerProblem(a: unknown): string | null {
  if (!isObj(a)) return 'not an object';
  for (const k of ['answer_id', 'item_id', 'timestamp', 'pool', 'raw_response']) if (!isStr(a[k])) return `${k}`;
  if (!isDate(a.local_date)) return 'local_date';
  if (!UNITS.has(a.unit as string)) return 'unit';
  if (!Array.isArray(a.skills) || !a.skills.every(isStr)) return 'skills';
  if (!OUTCOMES.has(a.outcome as string)) return 'outcome';
  if (a.role !== undefined && !ROLES.has(a.role as string)) return 'role';
  if (a.lineage !== undefined && !isStr(a.lineage)) return 'lineage';
  if (a.serious_tag !== undefined && a.serious_tag !== null && !isStr(a.serious_tag)) return 'serious_tag';
  for (const k of ['fresh_evidence', 'first_attempt', 'hint_used']) if (a[k] !== undefined && typeof a[k] !== 'boolean') return k;
  // Retention provenance: projections exclude these answers from retention counts, so a malformed value is refused.
  if (a.retention_valid !== undefined && a.retention_valid !== false) return 'retention_valid';
  if (a.exposure !== undefined && (!Array.isArray(a.exposure) || !a.exposure.every(isStr))) return 'exposure';
  if (a.presented_options !== undefined && (!Array.isArray(a.presented_options) || !a.presented_options.every((o) => isObj(o) && isStr(o.text)))) return 'presented_options';
  return null;
}

export function learnerProblem(l: unknown): string | null {
  if (l === null) return null;
  if (!isObj(l)) return 'not an object';
  if (!isStr(l.learner_id) || !isStr(l.consent_version) || !isStr(l.consent_at) || typeof l.age_confirmed !== 'boolean') return 'fields';
  if (typeof l.session_minutes !== 'number' || typeof l.arabic_scale !== 'number') return 'settings';
  if (!Array.isArray(l.screens_seen) || !l.screens_seen.every(isStr)) return 'screens';
  return null;
}

export function reportProblem(r: unknown): string | null {
  return isObj(r) && isStr(r.report_id) ? null : 'report_id';
}
