import { canAdvanceUnitA } from '../evidence';

type PilotEvidence = Parameters<typeof canAdvanceUnitA>[0][number];

const PRACTICE_DAY = '2027-01-01';
const LATER_DAY = '2027-01-02';

const evidence = (
  id: string,
  construct: PilotEvidence['construct'],
  family: string,
  kind: PilotEvidence['kind'],
  day: string,
): PilotEvidence => ({ id, construct, family, kind, outcome: 'correct', day });

// Provisional rule only: two first-correct practice families per construct, then
// a correct transfer in a fresh family per construct on a later day.
const qualifying: readonly PilotEvidence[] = [
  evidence('practice-r1', 'reference', 'r1', 'practice', PRACTICE_DAY),
  evidence('practice-r2', 'reference', 'r2', 'practice', PRACTICE_DAY),
  evidence('practice-a1', 'agreement', 'a1', 'practice', PRACTICE_DAY),
  evidence('practice-a2', 'agreement', 'a2', 'practice', PRACTICE_DAY),
  evidence('transfer-rt', 'reference', 'rt', 'transfer', LATER_DAY),
  evidence('transfer-at', 'agreement', 'at', 'transfer', LATER_DAY),
];

describe('canAdvanceUnitA (provisional rule)', () => {
  it('advances with two first-correct practice families per construct and later-day transfer', () => {
    expect(canAdvanceUnitA(qualifying)).toBe(true);
  });

  it('never advances on the same attempts when every outcome is wrong or dont-know', () => {
    const attemptsOnly = qualifying.map((event, index): PilotEvidence => ({
      ...event,
      outcome: index % 2 === 0 ? 'wrong' : 'dont-know',
    }));
    expect(canAdvanceUnitA(attemptsOnly)).toBe(false);
  });

  it('does not advance when transfer happens on the practice day', () => {
    const sameDay = qualifying.map((event) =>
      event.kind === 'transfer' ? { ...event, day: PRACTICE_DAY } : event,
    );
    expect(canAdvanceUnitA(sameDay)).toBe(false);
  });
});
