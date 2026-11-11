import { canAdvanceUnitA, type PilotEvidence } from '../evidence';

const JAN_1 = '2027-01-01';
const JAN_2 = '2027-01-02';
const JAN_3 = '2027-01-03';

const ev = (
  id: string,
  construct: PilotEvidence['construct'],
  family: string,
  kind: PilotEvidence['kind'],
  day: string,
  outcome: PilotEvidence['outcome'] = 'correct',
): PilotEvidence => ({ id, construct, family, kind, outcome, day });

// New clone per call: correct practice r1/r2 + a1/a2 on Jan 1, then a correct
// transfer in fresh families rt/at (Jan 2 by default), all unique IDs.
const base = (transferDay = JAN_2): PilotEvidence[] => [
  ev('p-r1', 'reference', 'r1', 'practice', JAN_1),
  ev('p-r2', 'reference', 'r2', 'practice', JAN_1),
  ev('p-a1', 'agreement', 'a1', 'practice', JAN_1),
  ev('p-a2', 'agreement', 'a2', 'practice', JAN_1),
  ev('t-rt', 'reference', 'rt', 'transfer', transferDay),
  ev('t-at', 'agreement', 'at', 'transfer', transferDay),
];

const patch = (
  events: PilotEvidence[],
  id: string,
  changes: Partial<PilotEvidence>,
): PilotEvidence[] =>
  events.map((event) => (event.id === id ? { ...event, ...changes } : event));

describe('canAdvanceUnitA replay, retry and date rules (provisional)', () => {
  it('counts only the first event for a reused ID', () => {
    // r2 reuses r1's ID, so reference has one practice observation, not two.
    expect(canAdvanceUnitA(patch(base(), 'p-r2', { id: 'p-r1' }))).toBe(false);
    // A later replay of an accepted ID cannot overwrite its first outcome.
    const replay = ev('p-r1', 'reference', 'r1', 'practice', JAN_1, 'wrong');
    expect(canAdvanceUnitA([...base(), replay])).toBe(true);
  });

  it('does not let a repeated practice family stand in for a second family', () => {
    const events = patch(base(), 'p-r2', { id: 'p-r1-again', family: 'r1' });
    expect(canAdvanceUnitA(events)).toBe(false);
  });

  it('does not count a practice family whose first attempt was wrong', () => {
    const events = [
      ...patch(base(JAN_3), 'p-r1', { outcome: 'wrong' }),
      ev('p-r1-retry', 'reference', 'r1', 'practice', JAN_2),
    ];
    expect(canAdvanceUnitA(events)).toBe(false);
  });

  it('does not treat a transfer retried after a wrong attempt as fresh', () => {
    const events = [
      ...patch(base(), 't-rt', { outcome: 'wrong' }),
      ev('t-rt-retry', 'reference', 'rt', 'transfer', JAN_3),
    ];
    expect(canAdvanceUnitA(events)).toBe(false);
  });

  it.each(['2027-01-32', '2027-02-29'])(
    'rejects a transfer dated %s, which is not a real calendar day',
    (day) => {
      expect(canAdvanceUnitA(patch(base(), 't-rt', { day }))).toBe(false);
    },
  );

  it('keeps a fresh transfer valid despite later practice in its family', () => {
    const laterPractice = ev('p-rt', 'reference', 'rt', 'practice', JAN_3);
    expect(canAdvanceUnitA([...base(), laterPractice])).toBe(true);
  });
});
