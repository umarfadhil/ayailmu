// Provisional Unit A eligibility gate, not a mastery or efficacy claim. Pure
// over events already owner/version/catalogue-validated upstream, read in
// their canonical append-log order:
// - the first event for an ID wins; later reuses of that ID are ignored;
// - only the first attempt per construct/kind/family can count, so a later
//   retry cannot launder an earlier wrong, dont-know or invalid-day attempt;
// - days must be real YYYY-MM-DD calendar days (no rollover, no clock);
// - per construct, a correct-first transfer in a family with no practice
//   exposure logged before it must fall on a later day than at least two
//   distinct correct-first practice families logged before it.

export interface PilotEvidence {
  id: string;
  construct: 'reference' | 'agreement';
  family: string;
  kind: 'practice' | 'transfer';
  outcome: 'correct' | 'wrong' | 'dont-know';
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
}

type Construct = PilotEvidence['construct'];

const CONSTRUCTS: readonly Construct[] = ['reference', 'agreement'];
const MIN_PRACTICE_FAMILIES = 2;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// Arithmetic check, so 2027-02-29 or 2027-01-32 is rejected, not rolled over.
function isCalendarDay(day: string): boolean {
  const match = DAY_PATTERN.exec(day);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const feb = leap ? 29 : 28;
  const monthLengths = [31, feb, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return date >= 1 && date <= (monthLengths[month - 1] ?? 0);
}

function firstById(events: readonly PilotEvidence[]): PilotEvidence[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function meetsGate(
  events: readonly PilotEvidence[],
  construct: Construct,
): boolean {
  const own = events.filter((event) => event.construct === construct);
  const attempted = new Set<string>();
  const exposedFamilies = new Set<string>();
  const correctPracticeDays: string[] = [];

  for (const event of own) {
    const attempt = `${event.kind}:${event.family}`;
    const correctFirst =
      !attempted.has(attempt) &&
      event.outcome === 'correct' &&
      isCalendarDay(event.day);
    attempted.add(attempt);

    if (event.kind === 'practice') {
      exposedFamilies.add(event.family);
      if (correctFirst) correctPracticeDays.push(event.day);
    } else if (correctFirst && !exposedFamilies.has(event.family)) {
      const earlier = correctPracticeDays.filter((day) => day < event.day);
      if (earlier.length >= MIN_PRACTICE_FAMILIES) return true;
    }
  }
  return false;
}

export function canAdvanceUnitA(events: readonly PilotEvidence[]): boolean {
  const log = firstById(events);
  return CONSTRUCTS.every((construct) => meetsGate(log, construct));
}
