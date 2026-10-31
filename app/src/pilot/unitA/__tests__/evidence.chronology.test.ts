import { canAdvanceUnitA, type PilotEvidence } from '../evidence';

type Outcome = PilotEvidence['outcome'];

const JAN_1 = '2027-01-01';
const JAN_2 = '2027-01-02';
const JAN_3 = '2027-01-03';
const NOT_CORRECT: readonly Outcome[] = ['wrong', 'dont-know'];

const ev = (
  id: string,
  construct: PilotEvidence['construct'],
  family: string,
  kind: PilotEvidence['kind'],
  day: string,
  outcome: Outcome = 'correct',
): PilotEvidence => ({ id, construct, family, kind, outcome, day });

// Canonical append order with non-decreasing days: Jan 1 practice (first r1
// attempt not correct), one Jan 2 practice, then fresh transfers on Jan 3.
const appendLog = (firstR1: Outcome, jan2: PilotEvidence): PilotEvidence[] => [
  ev('p-r1', 'reference', 'r1', 'practice', JAN_1, firstR1),
  ev('p-r2', 'reference', 'r2', 'practice', JAN_1),
  ev('p-a1', 'agreement', 'a1', 'practice', JAN_1),
  ev('p-a2', 'agreement', 'a2', 'practice', JAN_1),
  jan2,
  ev('t-rt', 'reference', 'rt', 'transfer', JAN_3),
  ev('t-at', 'agreement', 'at', 'transfer', JAN_3),
];

describe('canAdvanceUnitA chronology (provisional)', () => {
  it.each(NOT_CORRECT)(
    'ignores an r1 retry logged before the transfers when r1 was first %s',
    (firstR1) => {
      const retry = ev('p-r1-retry', 'reference', 'r1', 'practice', JAN_2);
      expect(canAdvanceUnitA(appendLog(firstR1, retry))).toBe(false);
    },
  );

  it('lets correct practice in a new family r3 qualify after the r1 mistake', () => {
    const newFamily = ev('p-r3', 'reference', 'r3', 'practice', JAN_2);
    expect(canAdvanceUnitA(appendLog('wrong', newFamily))).toBe(true);
  });
});
