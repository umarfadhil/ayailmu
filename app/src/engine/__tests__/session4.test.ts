import { loadRules } from '@/config/rules';
import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import type { ContentPack } from '@/content/schema';
import { advance, currentStep, makeItemStep, startSession, submitAnswer, type SessionState } from '@/engine/session';
import type { AnswerRecord } from '@/storage/types';

const rules = loadRules('developer-demo');
const content = gateContent(activePack, 'developer-demo');
const T0 = new Date('2026-10-15T09:00:00+07:00').getTime();
const zero = () => 0;

const begin = (history: AnswerRecord[] = [], screensSeen = ['DEMO-S1', 'DEMO-S2', 'DEMO-S3'], rng = zero, c = content) =>
  startSession({ content: c, rules, history, learnerId: 'lrn-1', now: T0, budgetMinutes: 15, screensSeen, appVersion: '0.2.0', rng });

const env = (history: AnswerRecord[] = [], rng = zero) => ({ content, rules, history, now: T0, timeOnItemMs: 1000, rng });

/** Minimal legacy (v0.1) record, as the typed app wrote it. */
const legacyRecord = (item_id: string, extra: Partial<AnswerRecord> = {}): AnswerRecord =>
  ({
    answer_id: `old-${item_id}`,
    learner_id: 'lrn-1',
    item_id,
    content_version: 'demo-synthetic-0.1',
    rules_version: 'pilot-0.1-local',
    app_version: '0.1.0',
    timestamp: '2026-10-14T02:00:00.000Z',
    local_date: '2026-10-14',
    session_id: 'ses-old',
    pool: 'PRACT',
    unit: 'A',
    skills: ['LEX-A:W-A3'],
    raw_response: JSON.stringify({ kind: 'typed', text: 'jujur' }),
    auto_score: { meaning: 'correct' },
    outcome: 'correct',
    error_tags: [],
    serious_tag: null,
    hint_used: false,
    help_lines_shown: [],
    first_attempt: true,
    fresh_evidence: true,
    time_on_item_ms: 1,
    audio_status: null,
    report_flag: false,
    review_status: 'draft',
    synthetic: true,
    ...extra,
  }) as AnswerRecord;

const onItem = (id: string, rng = zero): SessionState => ({ ...begin(), queue: [makeItemStep(content, id, 'practice', rng)], index: 0, phase: 'step' });

describe('persisted option order', () => {
  it('each queued item step carries a hand-checkable permutation from the injected RNG', () => {
    const s = begin();
    const step = currentStep(s);
    expect(step).toMatchObject({ kind: 'item', item_id: 'A2-M01', role: 'practice' });
    // [k,d1,d2,d3] with rng 0: [d3,d1,d2,k] → [d2,d1,d3,k] → [d1,d2,d3,k]
    expect((step as { option_order: string[] }).option_order).toEqual(['d1', 'd2', 'd3', 'k']);
  });

  it('a different RNG gives a new order for a new attempt; the saved order survives a JSON round trip', () => {
    const a = begin([], undefined, () => 0.999);
    expect((currentStep(a) as { option_order: string[] }).option_order).toEqual(['k', 'd1', 'd2', 'd3']);
    const restored = JSON.parse(JSON.stringify(a)) as SessionState;
    expect(currentStep(restored)).toEqual(currentStep(a));
  });
});

describe('four-choice answer events', () => {
  it('logs the shown order, selected ID/position, version and recognition evidence', () => {
    const s = begin();
    const r = submitAnswer(s, { kind: 'choice', option_id: 'k' }, env());
    expect(r.record).toMatchObject({
      item_id: 'A2-M01',
      content_version: 'demo-synthetic-0.2',
      answer_schema: 2,
      evidence_mode: 'recognition-4',
      lineage: 'A:word-form:صَادِقٌ',
      role: 'practice',
      outcome: 'correct',
      selected_option_id: 'k',
      selected_position: 3,
      first_attempt: true,
      fresh_evidence: true,
    });
    expect(r.record!.presented_options).toEqual([
      { id: 'd1', text: 'orang yang bersedekah', position: 0 },
      { id: 'd2', text: 'sahabat', position: 1 },
      { id: 'd3', text: 'orang yang sakit', position: 2 },
      { id: 'k', text: 'orang yang jujur', position: 3 },
    ]);
    expect(r.state.feedback?.messages).toEqual(['Benar. صَادِقٌ artinya "orang yang jujur".']);
  });

  it('synthetic comes from the pack flag, not the item ID prefix', () => {
    const r = submitAnswer(begin(), { kind: 'choice', option_id: 'k' }, env());
    expect(r.record!.item_id.startsWith('DEMO-')).toBe(false);
    expect(r.record!.synthetic).toBe(true);
    const realPack = gateContent({ ...(JSON.parse(JSON.stringify(activePack)) as ContentPack), synthetic: false }, 'developer-demo');
    const s2 = { ...begin(undefined, undefined, zero, realPack) };
    const r2 = submitAnswer(s2, { kind: 'choice', option_id: 'k' }, { ...env(), content: realPack });
    expect(r2.record!.synthetic).toBe(false);
  });

  it('records misconceptions; «belum tahu» records no selection', () => {
    const wrong = submitAnswer(onItem('A2-P01'), { kind: 'choice', option_id: 'p' }, env());
    expect(wrong.record).toMatchObject({ outcome: 'wrong', misconceptions: ['possession'], serious_tag: 'possession' });
    const dk = submitAnswer(onItem('A2-P01'), { kind: 'dont_know' }, env());
    expect(dk.record).toMatchObject({ outcome: 'dont_know', selected_option_id: null, selected_position: null });
  });
});

describe('remediation stays in the right unit', () => {
  it('Unit A he/she mistake → Unit A focus, then a fresh Unit A REMED, each with its own saved order', () => {
    const r = submitAnswer(onItem('A2-P01'), { kind: 'choice', option_id: 'r' }, env());
    const s = advance(r.state, T0);
    expect(currentStep(s)).toMatchObject({ item_id: 'A2-FQ-REF-F', role: 'focus' });
    expect((currentStep(s) as { option_order: string[] }).option_order).toHaveLength(4);
    expect(s.queue[2]).toMatchObject({ item_id: 'A2-R01', role: 'remed' });
  });

  it('Unit B doer-gender mistake → the Unit B verb focus, not the Unit A pronoun focus', () => {
    const r = submitAnswer(onItem('B2-V1'), { kind: 'choice', option_id: 'r' }, env());
    expect(r.record!.serious_tag).toBe('wrong-referent');
    const s = advance(r.state, T0);
    expect(currentStep(s)).toMatchObject({ item_id: 'B2-FQ-REF-F', role: 'focus' });
    // No defensible Unit B REMED item exists in this slice: reported, not substituted with Unit A material
    expect(r.state.flags).toContain('out-of-fresh:VRB-01');
    expect(s.queue.some((q) => q.kind === 'item' && q.item_id.startsWith('A2-'))).toBe(false);
  });
});

describe('freshness across content versions and shared forms', () => {
  it('material answered under a legacy ID is not fresh under its new ID', () => {
    const s = begin([legacyRecord('DEMO-M01')]);
    const practice = s.queue.filter((q) => q.kind === 'item' && q.role === 'practice').map((q) => (q as { item_id: string }).item_id);
    expect(practice[0]).toBe('A2-F01');
    expect(practice).not.toContain('A2-M01');
    // it returns only as a scheduled review (legacy exposure Oct 14 → due Oct 15)
    expect(s.queue.filter((q) => q.kind === 'item' && q.item_id === 'A2-M01').map((q) => (q as { role: string }).role)).toEqual(['review']);
  });

  it('a verb form already shown in a word card is not fresh for a VRB-01 item', () => {
    const shownInWordCard = legacyRecord('B2-W4', { unit: 'B', content_version: 'demo-synthetic-0.2', skills: ['LEX-B:V-B4'] });
    const aCore = ['A2-M01', 'A2-F01', 'A2-P01', 'A2-M02', 'A2-F02', 'A2-P02', 'A2-P03'].map((id) =>
      legacyRecord(id, { content_version: 'demo-synthetic-0.2', answer_id: `a-${id}` })
    );
    const s = begin([...aCore, shownInWordCard], ['DEMO-S1', 'DEMO-S2', 'DEMO-S3', 'DEMO-BS1', 'DEMO-BS2', 'DEMO-BS3']);
    const planned = s.queue.filter((q) => q.kind === 'item').map((q) => (q as { item_id: string }).item_id);
    expect(planned).toContain('B2-V1'); // Unit B practice is open
    expect(planned).not.toContain('B2-V3'); // رَجَعَتْ was already shown, so not fresh for VRB-01
  });
});
