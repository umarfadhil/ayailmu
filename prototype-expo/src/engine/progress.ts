// Factual progress projection, rebuilt from the durable answer log (no stored counters).
// The source "learned" rule needs typed/built answers, which four-choice recognition cannot
// supply; until a replacement rule is agreed, learned / retention / transfer are NOT judged.
import type { RulesConfig } from '@/config/rules';
import type { GatedContent } from '@/content/gating';
import type { ErrorTag, Item } from '@/content/schema';
import type { AnswerRecord } from '@/storage/types';
import { answeredLineages, openCheckItems } from './checks';
import { newTeachingBaseline, unseenTeaching, type ScreenView } from './exposure';
import { daysBetween, lastPracticeDate } from './freshness';
import { reviewStates } from './reviews';
import { openUnits, toAttempt, unresolvedSerious } from './session';
import { addDays } from './util';

export interface CheckLine {
  /** not-started: no practice yet · not-due · due: none answered · partial · answered: all available answered. */
  status: 'not-started' | 'not-due' | 'due' | 'partial' | 'answered';
  due_date: string | null;
  available: number;
  /** Four-choice check answers (raw counts only; no remembered/not-remembered judgement). */
  attempted: number;
  /** null while any item of this check is unanswered: outcomes are not shown before the check is complete. */
  correct: number | null;
  /** v0.1 typed answers on the same check lineage: counted as coverage, never re-graded or relabelled. */
  legacy_attempted: number;
  legacy: { correct: number; wrong: number; pending: number; dont_know: number };
  /** Skills with fewer check items than the source's minimum (2): coverage is incomplete, not padded. */
  sparse_skills: string[];
  /**
   * True when the content offers fewer items than the source's 2–3 per skill: the check can never be
   * complete, so it stays partial (never "answered") once its available items are used (SCOPE-02).
   */
  missing_content: boolean;
  /**
   * Check answers given after the material was shown the same day (lesson or Guide): recorded and
   * never re-presented, but not counted in `attempted`/`correct` as retention evidence.
   */
  assisted: number;
  /**
   * Unanswered items whose teaching was first introduced after the practice anchor (migration):
   * their interval runs from that introduction (or they wait for it to be taught).
   */
  waiting_new_teaching: number;
  /** Earliest date a waiting item becomes due (null when none waits or the teaching is still unseen). */
  waiting_until: string | null;
}

export interface UnitProgress {
  unit: 'A' | 'B';
  open: boolean;
  learned: { status: 'unassessed'; reason: string };
  retention_d7: CheckLine;
  retention_d30: CheckLine;
  transfer: { status: 'unassessed'; reason: string };
}

export interface SkillProgress {
  skill: string;
  unit: 'A' | 'B';
  /** Fresh four-choice recognition attempts (practice and remediation). */
  attempts: number;
  correct: number;
  wrong: number;
  dont_know: number;
  distinct_items: number;
  days: number;
  review_attempts: number;
  review_correct: number;
  /** Legacy (v0.1 typed) answers, shown separately and never re-graded. Pending counts neither way. */
  legacy: { attempts: number; correct: number; wrong: number; pending: number; dont_know: number };
  unresolved_serious: ErrorTag | null;
  learned: 'unassessed';
  evidence_answer_ids: string[];
}

export interface WordProgress {
  word_id: string;
  /** The form the learner was actually shown (never an unintroduced or reserved form). */
  display: string;
  meaning: string;
  state: 'practising' | 'needs-review';
  /** A due, unanswered timed check relies on this word today: its meaning is not shown (no lookup mid-check). */
  meaning_hidden: boolean;
  level: number;
  next_due: string;
}

export interface Progress {
  rules_version: string;
  content_version: string;
  learned_rule: 'pending';
  evidence_note: string;
  units: UnitProgress[];
  skills: SkillProgress[];
  words: WordProgress[];
  /** Earliest scheduled review or timed check (today if overdue); null when nothing is scheduled. */
  next_due: string | null;
  locked: { path: string; requires: string; status: 'locked-rule-pending' }[];
}

const LEARNED_REASON =
  'Aturan «sudah dipelajari» membutuhkan jawaban yang ditulis atau disusun sendiri; latihan empat pilihan belum dinilai dengan aturan itu (menunggu keputusan).';
const TRANSFER_REASON = 'Belum ada soal kalimat baru (transfer) di versi ini.';

function resolveItem(r: AnswerRecord, content: GatedContent): Item | undefined {
  const direct = content.items.find((i) => i.item_id === r.item_id);
  if (direct) return direct;
  const lineage = r.lineage ?? content.lineage[r.item_id];
  return lineage ? content.items.find((i) => i.lineage === lineage && (i.pool === 'PRACT' || i.pool === 'REMED' || i.pool === 'READY')) : undefined;
}

function checkLine(
  pool: 'D7' | 'D30',
  unit: 'A' | 'B',
  log: AnswerRecord[],
  content: GatedContent,
  rules: RulesConfig,
  anchor: string | null,
  today: string,
  screensSeen: string[],
  views: ScreenView[]
): CheckLine {
  const items = content.items.filter((i) => i.unit === unit && i.pool === pool);
  const byLineage = new Map(items.map((i) => [i.lineage ?? i.item_id, i.item_id]));
  const answered = new Map<string, AnswerRecord>();
  const legacyAnswered = new Map<string, AnswerRecord>();
  for (const r of log) {
    const lineage = r.lineage ?? content.lineage[r.item_id] ?? r.item_id;
    const target = byLineage.get(lineage);
    if (!target) continue;
    const bucket = r.evidence_mode === 'recognition-4' ? answered : legacyAnswered;
    if (!bucket.has(target) && !answered.has(target)) bucket.set(target, r);
  }
  for (const id of answered.keys()) legacyAnswered.delete(id);
  const assisted = new Map([...answered].filter(([, r]) => r.retention_valid === false));
  for (const id of assisted.keys()) answered.delete(id);
  // Unanswered items waiting for (or counting from) a first introduction of their teaching.
  let waiting = 0;
  let waiting_until: string | null = null;
  for (const i of items) {
    if (answered.has(i.item_id) || assisted.has(i.item_id) || legacyAnswered.has(i.item_id)) continue;
    const baseline = newTeachingBaseline(i, content, views, anchor);
    const unseen = unseenTeaching(i, content, screensSeen).length > 0;
    if (unseen || (baseline && daysBetween(baseline, today) < rules.check_days[pool])) {
      waiting += 1;
      const until = baseline ? addDays(baseline, rules.check_days[pool]) : null;
      if (until && (!waiting_until || until < waiting_until)) waiting_until = until;
    }
  }
  const perSkill = new Map<string, number>();
  for (const i of items) perSkill.set(i.skills[0] ?? i.item_id, (perSkill.get(i.skills[0] ?? i.item_id) ?? 0) + 1);
  const sparse = [...perSkill.entries()].filter(([, c]) => c < rules.checks_per_skill_min).map(([s]) => s).sort();
  const due_date = anchor ? addDays(anchor, rules.check_days[pool]) : null;
  const attempted = answered.size;
  const covered = attempted + assisted.size + legacyAnswered.size;
  const missing_content = items.length === 0 || sparse.length > 0;
  const allWaiting = waiting > 0 && covered + waiting >= items.length;
  const status: CheckLine['status'] = !anchor
    ? 'not-started'
    : covered >= items.length && items.length > 0 && !missing_content && assisted.size === 0
      ? 'answered'
      : covered >= items.length && items.length > 0
        ? 'partial'
      : covered > 0
        ? 'partial'
        : daysBetween(anchor, today) < rules.check_days[pool] || allWaiting
          ? 'not-due'
          : 'due';
  return {
    status,
    // Everything still open waits for new teaching: the line is due from that introduction.
    due_date: allWaiting && covered === 0 ? (waiting_until ?? due_date) : due_date,
    assisted: assisted.size,
    waiting_new_teaching: waiting,
    waiting_until,
    available: items.length,
    attempted,
    correct: covered < items.length ? null : [...answered.values()].filter((r) => r.outcome === 'correct').length,
    legacy_attempted: legacyAnswered.size,
    legacy: {
      correct: [...legacyAnswered.values()].filter((r) => r.outcome === 'correct').length,
      wrong: [...legacyAnswered.values()].filter((r) => r.outcome === 'wrong').length,
      pending: [...legacyAnswered.values()].filter((r) => r.outcome === 'pending').length,
      dont_know: [...legacyAnswered.values()].filter((r) => r.outcome === 'dont_know').length,
    },
    sparse_skills: sparse,
    missing_content,
  };
}

export function progress(
  log: AnswerRecord[],
  content: GatedContent,
  rules: RulesConfig,
  today: string,
  screensSeen: string[],
  screenViews: ScreenView[] = []
): Progress {
  const unique = [...new Map(log.map((r) => [r.answer_id, r])).values()].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp) || a.answer_id.localeCompare(b.answer_id)
  );
  const attempts = unique.map((r) => toAttempt(r, content));
  const open = openUnits(content, rules, attempts, screensSeen);
  const states = reviewStates(unique, content, rules);
  // The serious-mistake marker must not reveal a check answer while its check is still open: it is
  // computed as if those check answers were not yet logged (practice markers and the engine's own
  // follow-up obligations are unaffected; check answers never resolve a mistake).
  const answeredForMask = answeredLineages(unique, content);
  const inOpenCheck = (r: AnswerRecord) => {
    if (r.role !== 'check') return false;
    const it = content.items.find((i) => i.item_id === r.item_id) ?? content.items.find((i) => i.lineage === (r.lineage ?? content.lineage[r.item_id]));
    return !!it && (it.pool === 'D7' || it.pool === 'D30') && openCheckItems(it.unit, it.pool, answeredForMask, content).length > 0;
  };
  const serious = new Map(unresolvedSerious(unique.filter((r) => !inOpenCheck(r))).map((u) => [u.skill, u.tag]));

  const units: UnitProgress[] = rules.unit_order.map((unit) => {
    const anchor = lastPracticeDate(attempts, unit);
    return {
      unit,
      open: open.includes(unit),
      learned: { status: 'unassessed', reason: LEARNED_REASON },
      retention_d7: checkLine('D7', unit, unique, content, rules, anchor, today, screensSeen, screenViews),
      retention_d30: checkLine('D30', unit, unique, content, rules, anchor, today, screensSeen, screenViews),
      transfer: { status: 'unassessed', reason: TRANSFER_REASON },
    };
  });

  const skillUnit = new Map<string, 'A' | 'B'>();
  for (const i of content.items) for (const s of i.skills) if (!skillUnit.has(s)) skillUnit.set(s, i.unit as 'A' | 'B');
  const skills: SkillProgress[] = [...skillUnit.entries()].map(([skill, unit]) => {
    const own = unique.filter((r) => r.skills?.includes(skill) && r.pool !== 'FOCUS' && r.role !== 'focus');
    const rec = own.filter((r) => r.evidence_mode === 'recognition-4' && (r.role === 'practice' || r.role === 'remed'));
    const reviews = own.filter((r) => r.evidence_mode === 'recognition-4' && r.role === 'review');
    const legacy = own.filter((r) => !r.evidence_mode);
    const count = (rs: AnswerRecord[], o: string) => rs.filter((r) => r.outcome === o).length;
    return {
      skill,
      unit,
      attempts: rec.length,
      correct: count(rec, 'correct'),
      wrong: count(rec, 'wrong'),
      dont_know: count(rec, 'dont_know'),
      distinct_items: new Set(rec.map((r) => r.lineage ?? r.item_id)).size,
      days: new Set(rec.map((r) => r.local_date)).size,
      review_attempts: reviews.length,
      review_correct: count(reviews, 'correct'),
      legacy: {
        attempts: legacy.length,
        correct: count(legacy, 'correct'),
        wrong: count(legacy, 'wrong'),
        pending: count(legacy, 'pending'),
        dont_know: count(legacy, 'dont_know'),
      },
      unresolved_serious: serious.get(skill) ?? null,
      learned: 'unassessed',
      evidence_answer_ids: rec.map((r) => r.answer_id),
    };
  });

  // Lemmas that a due, still-unanswered timed check relies on (not items waiting for new teaching).
  const held = new Set<string>();
  const answeredLin = answeredLineages(unique, content);
  for (const unit of rules.unit_order) {
    if (!open.includes(unit)) continue;
    const anchor = lastPracticeDate(attempts, unit);
    if (!anchor) continue;
    for (const pool of ['D7', 'D30'] as const) {
      if (daysBetween(anchor, today) < rules.check_days[pool]) continue;
      for (const i of openCheckItems(unit, pool, answeredLin, content)) {
        const baseline = newTeachingBaseline(i, content, screenViews, anchor);
        if (unseenTeaching(i, content, screensSeen).length || (baseline && daysBetween(baseline, today) < rules.check_days[pool])) continue;
        for (const l of i.requires_taught ?? []) held.add(l);
      }
    }
  }
  const words: WordProgress[] = [];
  for (const r of unique) {
    if (r.role === 'check' || r.role === 'focus') continue;
    const item = resolveItem(r, content);
    if (!item || item.format !== 'word-meaning' || !item.word_id || words.some((w) => w.word_id === item.word_id)) continue;
    const st = states.get(`word:${item.word_id}`);
    if (!st) continue;
    words.push({
      word_id: item.word_id,
      display: item.arabic,
      meaning: item.word_meaning ?? '',
      state: st.due <= today ? 'needs-review' : 'practising',
      meaning_hidden: (item.requires_taught ?? [item.arabic]).some((l) => held.has(l)),
      level: st.level,
      next_due: st.due,
    });
  }

  const candidates = [
    ...[...states.values()].map((s) => s.due),
    ...units.flatMap((u) =>
      // Only checks that still have unanswered items can be due (answered sparse checks are not re-presented).
      [u.retention_d7, u.retention_d30]
        .filter((c) => c.due_date && c.attempted + c.assisted + c.legacy_attempted < c.available)
        .map((c) => {
          // Only waiting items left: the next date is when the first of them becomes due.
          const open = c.available - c.attempted - c.assisted - c.legacy_attempted;
          return open <= c.waiting_new_teaching ? c.waiting_until : (c.due_date as string);
        })
        .filter((d): d is string => !!d)
    ),
  ].sort();
  const next_due = candidates.length ? (candidates[0] < today ? today : candidates[0]) : null;

  return {
    rules_version: rules.rules_version,
    content_version: content.content_version,
    learned_rule: rules.learned_rule,
    evidence_note: 'Jawaban empat pilihan dicatat sebagai pengenalan (recognition), bukan jawaban yang ditulis sendiri.',
    units,
    skills,
    words,
    next_due,
    locked: [
      // Labels identify locked paths in Indonesian + skill ID only (no untaught Arabic forms).
      { path: 'VRB-02: kata kerja + pelaku', requires: 'VRB-01 learned', status: 'locked-rule-pending' },
      { path: 'OPR-01 / PRC-04: siapa yang berkata', requires: 'NOM-01 learned', status: 'locked-rule-pending' },
    ],
  };
}
