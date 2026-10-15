import { KvStore, memoryKv } from '@/storage/kvStore';

const learner = {
  learner_id: 'lrn-1',
  created_at: '2026-10-14T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-14T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 15,
  arabic_scale: 1,
  screens_seen: ['DEMO-S1'],
};
const okAnswer = { answer_id: 'a1', item_id: 'DEMO-M01', outcome: 'correct', raw_response: '{}' };

describe('KvStore outer envelope validation (REV-2)', () => {
  it.each<[string, string]>([
    ['a JSON array', '[]'],
    ['an empty object (incomplete envelope)', '{}'],
    ['missing reports', JSON.stringify({ learner: null, answers: [], snapshot: null })],
    ['learner as a string', JSON.stringify({ learner: 'corrupt', answers: [], snapshot: null, reports: [] })],
    ['learner without an ID', JSON.stringify({ learner: { ...learner, learner_id: 5 }, answers: [], snapshot: null, reports: [] })],
    ['learner screens_seen not a list', JSON.stringify({ learner: { ...learner, screens_seen: 'x' }, answers: [], snapshot: null, reports: [] })],
    ['answers not an array', JSON.stringify({ learner: null, answers: {}, snapshot: null, reports: [] })],
    ['an answer without an ID', JSON.stringify({ learner: null, answers: [{ item_id: 'x' }], snapshot: null, reports: [] })],
    ['a null answer', JSON.stringify({ learner: null, answers: [null], snapshot: null, reports: [] })],
    ['snapshot as a number', JSON.stringify({ learner: null, answers: [], snapshot: 7, reports: [] })],
    ['a report without an ID', JSON.stringify({ learner: null, answers: [], snapshot: null, reports: [{}] })],
    ['meta as an array (v2)', JSON.stringify({ schema: 2, meta: [], learner: null, answers: [], snapshot: null, reports: [] })],
    ['a non-string meta value (v2)', JSON.stringify({ schema: 2, meta: { a: 1 }, learner: null, answers: [], snapshot: null, reports: [] })],
    ['schema 0', JSON.stringify({ schema: 0, learner: null, answers: [], snapshot: null, reports: [] })],
  ])('refuses %s without overwriting the stored bytes', async (_name, raw) => {
    const kv = memoryKv();
    kv.setItem(KvStore.KEY, raw);
    const store = new KvStore(kv);
    await expect(store.init()).rejects.toThrow(/malformed|unsupported|unreadable/i);
    // a refused store also refuses later writes
    await expect(store.setMeta('x', 'y')).rejects.toThrow(/refused/i);
    await expect(store.saveSnapshot({ version: 2 })).rejects.toThrow(/refused/i);
    expect(kv.getItem(KvStore.KEY)).toBe(raw);
  });

  it.each<[string, object]>([
    ['an empty v1 store', { learner: null, answers: [], snapshot: null, reports: [] }],
    ['a populated v1 store', { learner, answers: [okAnswer], snapshot: '{"version":1}', reports: [{ report_id: 'r1' }] }],
    ['a v2 store', { schema: 2, meta: { pending_notice: 'format-change' }, learner, answers: [okAnswer], snapshot: null, reports: [] }],
  ])('accepts %s unchanged', async (_name, data) => {
    const kv = memoryKv();
    kv.setItem(KvStore.KEY, JSON.stringify(data));
    const store = new KvStore(kv);
    await store.init();
    expect(await store.listAnswers()).toEqual((data as { answers: unknown[] }).answers);
    expect(await store.getLearner()).toEqual((data as { learner: unknown }).learner);
  });
});
