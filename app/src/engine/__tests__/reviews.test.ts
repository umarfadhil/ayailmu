import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { dueReviews, reviewStates } from '@/engine/reviews';
import type { Outcome } from '@/engine/scoring';
import type { AnswerRecord, StepRole } from '@/storage/types';

const rules = loadRules('developer-demo'); // review_spacing_days [1, 3, 7]
const content = gateContent(activePack, 'developer-demo');
let n = 0;

/** A minimal answer event on a calendar day (local_date is what scheduling uses). */
function ev(item_id: string, local_date: string, role: StepRole | undefined, outcome: Outcome = 'correct', extra: Partial<AnswerRecord> = {}): AnswerRecord {
  n += 1;
  const item = content.items.find((i) => i.item_id === item_id);
  return {
    answer_id: extra.answer_id ?? `e${String(n).padStart(4, '0')}`,
    item_id,
    local_date,
    timestamp: `${local_date}T03:00:${String(n % 60).padStart(2, '0')}.000Z`,
    pool: role === 'review' ? 'REVIEW' : (item?.pool ?? 'PRACT'),
    unit: item?.unit ?? 'A',
    skills: item?.skills ?? [],
    outcome,
    role,
    lineage: item?.lineage,
    ...extra,
  } as AnswerRecord;
}
const state = (log: AnswerRecord[], key: string) => reviewStates(log, content, rules).get(key);

describe('review ladder 1 → 3 → 7 days (hand-derived dates)', () => {
  const k = 'word:W-A3'; // صَادِقٌ (A2-M01)
  it('first exposure Jan 1 → due Jan 2', () => {
    expect(state([ev('A2-M01', '2027-01-01', 'practice')], k)).toMatchObject({ level: 0, last_exposure: '2027-01-01', due: '2027-01-02' });
  });
  it('correct Jan 2 → due Jan 5; correct Jan 5 → due Jan 12; wrong Jan 12 → due Jan 15', () => {
    const log = [ev('A2-M01', '2027-01-01', 'practice'), ev('A2-M01', '2027-01-02', 'review')];
    expect(state(log, k)).toMatchObject({ level: 1, due: '2027-01-05' });
    log.push(ev('A2-M01', '2027-01-05', 'review'));
    expect(state(log, k)).toMatchObject({ level: 2, due: '2027-01-12' });
    log.push(ev('A2-M01', '2027-01-12', 'review', 'wrong'));
    expect(state(log, k)).toMatchObject({ level: 1, due: '2027-01-15' });
  });
  it('upper bound 7 days; lower bound 1 day; «belum tahu» steps back like a wrong answer', () => {
    const up = [ev('A2-M01', '2027-01-01', 'practice'), ev('A2-M01', '2027-01-02', 'review'), ev('A2-M01', '2027-01-05', 'review'), ev('A2-M01', '2027-01-12', 'review')];
    expect(state(up, k)).toMatchObject({ level: 2, due: '2027-01-19' });
    const down = [ev('A2-M01', '2027-01-01', 'practice'), ev('A2-M01', '2027-01-02', 'review', 'wrong')];
    expect(state(down, k)).toMatchObject({ level: 0, due: '2027-01-03' });
    const dk = [ev('A2-M01', '2027-01-01', 'practice'), ev('A2-M01', '2027-01-02', 'review'), ev('A2-M01', '2027-01-05', 'review', 'dont_know')];
    expect(state(dk, k)).toMatchObject({ level: 0, due: '2027-01-06' });
  });
  it('leap-day and year boundaries', () => {
    expect(state([ev('A2-M01', '2028-02-28', 'practice')], k)).toMatchObject({ due: '2028-02-29' });
    const y = [ev('A2-M01', '2027-12-30', 'practice'), ev('A2-M01', '2027-12-31', 'review')];
    expect(state(y, k)).toMatchObject({ level: 1, due: '2028-01-03' });
  });
});

describe('review replay rules', () => {
  it('legacy v0.1 answers schedule the same lineage (no new fresh exposure from renamed IDs)', () => {
    const legacy = ev('DEMO-P01', '2027-01-01', undefined, 'pending', { pool: 'PRACT', lineage: undefined, content_version: 'demo-synthetic-0.1' });
    expect(state([legacy], 'sentence:هِيَ مُؤْمِنَةٌ')).toMatchObject({ level: 0, due: '2027-01-02', review_item_id: 'A2-P01' });
  });
  it('a replayed duplicate event does not advance the ladder twice', () => {
    const first = ev('A2-M01', '2027-01-01', 'practice');
    const rev = ev('A2-M01', '2027-01-02', 'review');
    expect(state([first, rev, { ...rev }], 'word:W-A3')).toMatchObject({ level: 1, due: '2027-01-05' });
  });
  it('timed checks, focus questions and practice-only items never create or move review keys', () => {
    const log = [
      ev('A2-D7W3', '2027-01-08', 'check'), // صَادِقَةٌ check also belongs to word:W-A3
      ev('A2-FQ-REF-F', '2027-01-01', 'focus'),
      ev('B2-VN1', '2027-01-01', 'practice'),
    ];
    const states = reviewStates(log, content, rules);
    expect(states.size).toBe(0);
  });
  it('replay is deterministic regardless of log order', () => {
    const log = [ev('A2-M01', '2027-01-01', 'practice'), ev('A2-M01', '2027-01-02', 'review'), ev('A2-P01', '2027-01-01', 'practice')];
    const a = [...reviewStates(log, content, rules).entries()];
    const b = [...reviewStates([...log].reverse(), content, rules).entries()];
    expect(a).toEqual(b);
  });
});

describe('due selection', () => {
  const log = [
    ev('A2-M01', '2027-01-01', 'practice'), // due Jan 2
    ev('A2-P01', '2027-01-03', 'practice'), // due Jan 4
    ev('A2-F01', '2027-01-01', 'practice'), // due Jan 2 (form-grid sentence key)
  ];
  it('each overdue key once, oldest due first, stable key order on ties', () => {
    const due = dueReviews(reviewStates(log, content, rules), '2027-01-09');
    expect(due.map((d) => d.key)).toEqual(['sentence:هِيَ نَادِمَةٌ', 'word:W-A3', 'sentence:هِيَ مُؤْمِنَةٌ']);
  });
  it('nothing is due on the day of the latest exposure', () => {
    expect(dueReviews(reviewStates([ev('A2-M01', '2027-01-05', 'practice')], content, rules), '2027-01-05')).toEqual([]);
  });
  it('a key exposed today again is not reviewed today', () => {
    const l2 = [...log, ev('A2-M01', '2027-01-09', 'review')];
    expect(dueReviews(reviewStates(l2, content, rules), '2027-01-09').map((d) => d.key)).not.toContain('word:W-A3');
  });
});
