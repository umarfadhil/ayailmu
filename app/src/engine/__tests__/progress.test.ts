import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { progress } from '@/engine/progress';
import type { Outcome } from '@/engine/scoring';
import type { AnswerRecord, StepRole } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(activePack, 'developer-demo');
let n = 0;
function ev(item_id: string, local_date: string, role: StepRole = 'practice', outcome: Outcome = 'correct', extra: Partial<AnswerRecord> = {}): AnswerRecord {
  n += 1;
  const item = content.items.find((i) => i.item_id === item_id);
  return {
    answer_id: `g${String(n).padStart(4, '0')}`,
    item_id,
    local_date,
    timestamp: `${local_date}T02:00:${String(n % 60).padStart(2, '0')}.000Z`,
    pool: role === 'review' ? 'REVIEW' : (item?.pool ?? 'PRACT'),
    unit: item?.unit ?? 'A',
    skills: item?.skills ?? [],
    outcome,
    role,
    lineage: item?.lineage,
    evidence_mode: 'recognition-4',
    answer_schema: 2,
    fresh_evidence: role === 'practice' || role === 'remed' || role === 'check',
    first_attempt: role !== 'review',
    serious_tag: null,
    error_tags: [],
    ...extra,
  } as AnswerRecord;
}
const A_SCREENS = ['DEMO-S1', 'DEMO-S2', 'DEMO-S3'];
const aCore = () => [
  ev('A2-M01', '2027-01-01'),
  ev('A2-F01', '2027-01-01'),
  ev('A2-P01', '2027-01-01', 'practice', 'wrong', { serious_tag: 'wrong-referent', error_tags: ['wrong-referent'] }),
  ev('A2-M02', '2027-01-01', 'practice', 'dont_know'),
  ev('A2-F02', '2027-01-01'),
  ev('A2-P02', '2027-01-01'),
  ev('A2-P03', '2027-01-01'),
];

describe('progress projection (factual, learned unassessed)', () => {
  it('empty log: Unit A open, Unit B not yet, nothing due, mastery lines unassessed', () => {
    const p = progress([], content, rules, '2027-01-01', []);
    expect(p.units.map((u) => [u.unit, u.open])).toEqual([
      ['A', true],
      ['B', false],
    ]);
    expect(p.next_due).toBeNull();
    for (const u of p.units) {
      expect(u.learned.status).toBe('unassessed');
      expect(u.transfer.status).toBe('unassessed');
    }
    expect(p.words).toEqual([]);
    expect(p.rules_version).toBe('pilot-0.2-local');
  });

  it('after Unit A practice on Jan 1: hand-checked counts, serious error open, words practising, next due Jan 2', () => {
    const p = progress(aCore(), content, rules, '2027-01-01', A_SCREENS);
    const skill = (id: string) => p.skills.find((s) => s.skill === id)!;
    expect(skill('NOM-01')).toMatchObject({ attempts: 3, correct: 2, wrong: 1, dont_know: 0, distinct_items: 3, days: 1, unresolved_serious: 'wrong-referent', learned: 'unassessed' });
    expect(skill('NOM-02')).toMatchObject({ attempts: 2, correct: 2, wrong: 0 });
    expect(skill('LEX-A:W-A5')).toMatchObject({ attempts: 1, correct: 0, dont_know: 1 });
    expect(skill('NOM-01').evidence_answer_ids).toHaveLength(3);
    expect(p.words).toEqual([
      { word_id: 'W-A3', display: 'صَادِقٌ', meaning: 'orang yang jujur', state: 'practising', level: 0, next_due: '2027-01-02' },
      { word_id: 'W-A5', display: 'عَالِمٌ', meaning: 'orang yang berilmu / mengetahui', state: 'practising', level: 0, next_due: '2027-01-02' },
    ]);
    expect(p.next_due).toBe('2027-01-02');
    const a = p.units[0];
    expect(a.retention_d7).toMatchObject({ status: 'not-due', due_date: '2027-01-08', available: 8, attempted: 0 });
    expect(a.retention_d30).toMatchObject({ status: 'not-due', due_date: '2027-01-31', available: 7, attempted: 0 });
    // the source asks for 2–3 items per skill; single-item word checks are reported, not padded
    expect(a.retention_d7.sparse_skills).toEqual(['LEX-A:W-A1', 'LEX-A:W-A3', 'LEX-A:W-A5']);
  });

  it('a word that is due today is marked as needing review; next due is today', () => {
    const p = progress(aCore(), content, rules, '2027-01-03', A_SCREENS);
    expect(p.words[0]).toMatchObject({ word_id: 'W-A3', state: 'needs-review', next_due: '2027-01-02' });
    expect(p.next_due).toBe('2027-01-03');
  });

  it('timed checks show raw counts only: partial when some of the available items were answered', () => {
    const log = [...aCore(), ev('A2-D7S1', '2027-01-08', 'check'), ev('A2-D7S2', '2027-01-08', 'check', 'wrong'), ev('A2-D7W1', '2027-01-08', 'check')];
    const d7 = progress(log, content, rules, '2027-01-08', A_SCREENS).units[0].retention_d7;
    expect(d7).toMatchObject({ status: 'partial', attempted: 3, correct: 2, available: 8 });
    expect(JSON.stringify(d7)).not.toMatch(/remembered|ingat|pass|lulus/i);
  });

  it('legacy typed answers are counted separately; pending is neither correct nor wrong', () => {
    const legacy = ev('DEMO-M02', '2027-01-01', 'practice', 'pending', {
      role: undefined,
      lineage: undefined,
      evidence_mode: undefined,
      answer_schema: undefined,
      skills: ['LEX-A:W-A5'],
      pool: 'PRACT',
      raw_response: JSON.stringify({ kind: 'typed', text: 'alim' }),
    });
    const s = progress([legacy], content, rules, '2027-01-01', []).skills.find((x) => x.skill === 'LEX-A:W-A5')!;
    expect(s).toMatchObject({ attempts: 0, correct: 0, wrong: 0, legacy: { attempts: 1, correct: 0, wrong: 0, pending: 1 } });
  });

  it('the word list never shows unintroduced or reserved forms', () => {
    const b = ['B2-W1', 'B2-W2', 'B2-W3', 'B2-VN1', 'B2-VN2', 'B2-V1', 'B2-V2', 'B2-V3', 'B2-W4'].map((id) => ev(id, '2027-01-10'));
    const p = progress([...aCore(), ...b], content, rules, '2027-01-10', [...A_SCREENS, 'DEMO-BS1', 'DEMO-BS2', 'DEMO-BS3']);
    const shown = p.words.map((w) => w.display);
    expect(shown).toEqual(['صَادِقٌ', 'عَالِمٌ', 'ذَهَبَ', 'خَرَجَ', 'دَخَلَتْ', 'رَجَعَتْ']);
    expect(JSON.stringify(p.words)).not.toMatch(/رَجَعَ"|سَمِعَ|سَمِعَتْ|mendengar/);
    expect(p.units[1].open).toBe(true);
  });

  it('advanced paths stay locked while the learned rule is pending, labelled without untaught Arabic forms', () => {
    const p = progress(aCore(), content, rules, '2027-01-01', A_SCREENS);
    expect(p.locked).toEqual([
      { path: 'VRB-02: kata kerja + pelaku', requires: 'VRB-01 learned', status: 'locked-rule-pending' },
      { path: 'OPR-01 / PRC-04: siapa yang berkata', requires: 'NOM-01 learned', status: 'locked-rule-pending' },
    ]);
    expect(JSON.stringify(p.locked)).not.toMatch(/[\u0600-\u06FF]/);
  });

  it('a legacy timed-check answer counts as legacy coverage of its active check lineage (not re-graded, not recognition)', () => {
    // v0.1 app: DEMO-D701 (هُوَ صَابِرٌ, D7) answered by typing; its result was pending human check
    const legacyCheck = ev('DEMO-D701', '2027-01-08', 'practice', 'pending', {
      role: undefined,
      pool: 'D7',
      lineage: undefined,
      evidence_mode: undefined,
      answer_schema: undefined,
      skills: ['NOM-01', 'LEX-P3'],
      raw_response: JSON.stringify({ kind: 'typed', text: 'dia sabar', ref: 'laki-laki' }),
      auto_score: { who: 'correct', description: 'correct', describes: 'correct' },
    });
    const d7 = progress([...aCore(), legacyCheck], content, rules, '2027-01-08', A_SCREENS).units[0].retention_d7;
    expect(d7).toMatchObject({ status: 'partial', attempted: 0, correct: 0, legacy_attempted: 1, legacy: { correct: 0, wrong: 0, pending: 1, dont_know: 0 } });
    expect(legacyCheck.raw_response).toBe(JSON.stringify({ kind: 'typed', text: 'dia sabar', ref: 'laki-laki' }));
  });
});
