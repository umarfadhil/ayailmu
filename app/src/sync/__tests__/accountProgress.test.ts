/**
 * @jest-environment node
 */
// The pure account progress projection, written before its implementation. Fixtures are typed JournalView and
// AccountProgress values; nothing is mocked and no store, network or React is involved.
import { EXPO_FAMILY, type AccountProgress, type JournalOriginal, type JournalView, type RemoteAnswer } from '@/sync/journal';
import { projectAccountProgress, type AccountSyncProgress, type ProgressReceipt } from '../accountProgress';

const ACCOUNT = '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01';
const PROFILE = '5d2b8c1e-4f6a-4b0d-9c3e-7a1f2e4b6c08';
const FOREIGN_ACCOUNT = '9b7d5e21-0c4f-4a8e-b1d3-2f6a8c0e4b12';
const FOREIGN_PROFILE = 'c1a4e7f0-2b3d-4e5f-8a6b-9c0d1e2f3a4b';
const CHECKED_AT = '2026-10-28T03:04:05.678Z';
const MAX = Number.MAX_SAFE_INTEGER;

const UNKNOWN: AccountSyncProgress['server'] = { state: 'unknown', total: null, excluded: null, checkedAt: null };

const original = (eventId: string, over: Partial<JournalOriginal> = {}): JournalOriginal => ({
  eventId,
  learnerId: 'learner-1',
  envelope: '{"opaque":"envelope"}',
  semanticSha256: 'opaque-hash',
  acked: false,
  blocked: null,
  ...over,
});

const journal = (over: Partial<JournalView> = {}): JournalView => ({
  accountId: ACCOUNT,
  installId: 'inst-1',
  profileId: PROFILE,
  sources: [],
  originals: [],
  cursor: 0,
  remote: [],
  base: null,
  changed: {},
  preferenceConflict: null,
  conflicts: [],
  ...over,
});

const truth = { true: 0, false: 0, absent: 0, unknown: 0 };
const progress = (over: Partial<AccountProgress> = {}): AccountProgress => ({
  profileId: PROFILE,
  family: EXPO_FAMILY,
  asOfSeq: 5,
  events: 3,
  excludedUnregistered: 2,
  learned: 'not_assessed_by_server',
  retention: 'not_assessed_by_server',
  provenance: { synthetic: truth, feedbackDeferred: truth, hintUsed: truth, retentionValidFalse: 0 },
  ...over,
});

const receipt = (over: { accountId?: string; checkedAt?: string; progress?: Partial<AccountProgress> } = {}): ProgressReceipt => ({
  accountId: over.accountId ?? ACCOUNT,
  progress: progress(over.progress),
  checkedAt: over.checkedAt ?? CHECKED_AT,
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value as object).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// One of each local class: acknowledged, two sendable, a blocked one, and a blocked one whose ack flag is malformed.
const MIXED = [
  original('a1', { acked: true }),
  original('q1'),
  original('q2'),
  original('b1', { blocked: 'invalid_json' }),
  original('b2', { blocked: 'invalid_timestamp', acked: true }),
];
const MIXED_FACTS = { queued: 2, blocked: 2, conflicts: 1, deviceAccepted: 1, capturePending: false };
const mixed = (over: Partial<JournalView> = {}) => journal({ originals: MIXED, conflicts: ['q1'], ...over });

describe('server counts', () => {
  test.each([
    ['without a receipt state', undefined],
    ['with the verified receipt state', 'verified' as const],
  ])('a verified receipt of 3 events and 2 excluded totals 5 %s', (_name, receiptState) => {
    expect(projectAccountProgress({ journal: journal(), receipt: receipt(), receiptState })).toStrictEqual({
      queued: 0,
      blocked: 0,
      conflicts: 0,
      deviceAccepted: 0,
      capturePending: false,
      server: { state: 'verified', total: 5, excluded: 2, checkedAt: CHECKED_AT },
    });
  });

  test('a verified receipt of zero is a real zero, not unknown', () => {
    const r = receipt({ progress: { events: 0, excludedUnregistered: 0 } });
    expect(projectAccountProgress({ journal: journal(), receipt: r }).server).toStrictEqual({ state: 'verified', total: 0, excluded: 0, checkedAt: CHECKED_AT });
  });

  test('a missing receipt is unknown with null counts, never zero, and keeps the local queue facts', () => {
    expect(projectAccountProgress({ journal: mixed(), receipt: null })).toStrictEqual({ ...MIXED_FACTS, server: UNKNOWN });
    expect(projectAccountProgress({ journal: mixed(), receipt: null, receiptState: 'stale' }).server).toStrictEqual(UNKNOWN);
  });

  test('the largest safe total is still verified', () => {
    const r = receipt({ progress: { events: MAX, excludedUnregistered: 0 } });
    expect(projectAccountProgress({ journal: journal(), receipt: r }).server).toMatchObject({ state: 'verified', total: MAX });
  });

  const unusable: Array<[string, () => { journal: JournalView; receipt: ProgressReceipt }]> = [
    ['no linked profile', () => ({ journal: mixed({ profileId: null }), receipt: receipt() })],
    ['a foreign account', () => ({ journal: mixed(), receipt: receipt({ accountId: FOREIGN_ACCOUNT }) })],
    ['a foreign profile', () => ({ journal: mixed(), receipt: receipt({ progress: { profileId: FOREIGN_PROFILE } }) })],
    ['a profile ID that differs only by case (never normalized)', () => ({ journal: mixed(), receipt: receipt({ progress: { profileId: PROFILE.toUpperCase() } }) })],
    ['a wrong family', () => ({ journal: mixed(), receipt: receipt({ progress: { family: 'other-family' } }) })],
    ...['', 'not a date', '2026-10-28', '2026-10-28T03:04:05Z', '2026-10-28T03:04:05.678+00:00', ' 2026-10-28T03:04:05.678Z', '2026-13-45T00:00:00.000Z'].map(
      (checkedAt): [string, () => { journal: JournalView; receipt: ProgressReceipt }] => [
        `a non-canonical timestamp ${JSON.stringify(checkedAt)}`,
        () => ({ journal: mixed(), receipt: receipt({ checkedAt }) }),
      ]
    ),
    ...(
      [
        ['events', -1],
        ['events', 1.5],
        ['events', NaN],
        ['events', Infinity],
        ['events', MAX + 1],
        ['excludedUnregistered', -1],
        ['excludedUnregistered', 0.5],
        ['excludedUnregistered', NaN],
        ['excludedUnregistered', -Infinity],
        ['excludedUnregistered', MAX + 1],
      ] as const
    ).map(([field, value]): [string, () => { journal: JournalView; receipt: ProgressReceipt }] => [
      `${field} = ${String(value)}`,
      () => ({ journal: mixed(), receipt: receipt({ progress: field === 'events' ? { events: value } : { excludedUnregistered: value } }) }),
    ]),
    ['a total that overflows the safe integers', () => ({ journal: mixed(), receipt: receipt({ progress: { events: MAX, excludedUnregistered: 1 } }) })],
  ];

  test.each(unusable)('%s gives an unknown server count without throwing or losing local facts', (_name, build) => {
    const { journal: j, receipt: r } = build();
    for (const receiptState of [undefined, 'verified' as const, 'stale' as const]) {
      const result = projectAccountProgress({ journal: j, receipt: r, receiptState });
      expect(result.server).toStrictEqual(UNKNOWN);
      expect(result.queued).toBe(2);
      expect(result.blocked).toBe(2);
      expect(result.deviceAccepted).toBe(1);
    }
  });

  test('a stale receipt keeps its numbers and time but is marked stale', () => {
    const result = projectAccountProgress({ journal: journal(), receipt: receipt(), receiptState: 'stale' });
    expect(result.server).toStrictEqual({ state: 'stale', total: 5, excluded: 2, checkedAt: CHECKED_AT });
  });

  test('a foreign or invalid receipt never lends old counts, stale or not', () => {
    const foreign = receipt({ accountId: FOREIGN_ACCOUNT, progress: { events: 40, excludedUnregistered: 9 } });
    const otherProfile = receipt({ progress: { profileId: FOREIGN_PROFILE, events: 40 } });
    for (const r of [foreign, otherProfile]) {
      expect(projectAccountProgress({ journal: journal(), receipt: r, receiptState: 'stale' }).server).toStrictEqual(UNKNOWN);
    }
  });
});

describe('local queue facts', () => {
  test.each([
    ['an acknowledged valid original is accepted by the server on this device', original('e1', { acked: true }), { deviceAccepted: 1, queued: 0, blocked: 0 }],
    ['an unacknowledged valid original is queued', original('e1'), { deviceAccepted: 0, queued: 1, blocked: 0 }],
    ['a blocked original is blocked', original('e1', { blocked: 'invalid_json' }), { deviceAccepted: 0, queued: 0, blocked: 1 }],
    ['a blocked original with a malformed acked flag is still only blocked', original('e1', { blocked: 'invalid_timestamp', acked: true }), { deviceAccepted: 0, queued: 0, blocked: 1 }],
  ])('%s', (_name, o, expected) => {
    const result = projectAccountProgress({ journal: journal({ originals: [o] }), receipt: null });
    expect({ deviceAccepted: result.deviceAccepted, queued: result.queued, blocked: result.blocked }).toStrictEqual(expected);
  });

  test('a mixed journal is counted class by class', () => {
    expect(projectAccountProgress({ journal: mixed({ conflicts: [] }), receipt: null })).toStrictEqual({ ...MIXED_FACTS, conflicts: 0, server: UNKNOWN });
  });

  test.each([
    ['unique IDs of unacknowledged valid originals', ['q1', 'q2'], 2],
    ['a duplicated ID counts once', ['q1', 'q1', 'q1'], 1],
    ['an ID with no original is ignored', ['missing', 'q1'], 1],
    ['an acknowledged original is no conflict any more', ['a1'], 0],
    ['a blocked original is never a conflict', ['b1', 'b2'], 0],
    ['no conflicts', [], 0],
  ])('conflicts: %s', (_name, ids, expected) => {
    expect(projectAccountProgress({ journal: mixed({ conflicts: ids }), receipt: null }).conflicts).toBe(expected);
  });

  test('the result carries counters and server facts only, no mastery or percentage', () => {
    const result = projectAccountProgress({ journal: mixed(), receipt: receipt() });
    expect(Object.keys(result).sort()).toStrictEqual(['blocked', 'capturePending', 'conflicts', 'deviceAccepted', 'queued', 'server']);
    expect(Object.keys(result.server).sort()).toStrictEqual(['checkedAt', 'excluded', 'state', 'total']);
    expect(JSON.stringify(result)).not.toMatch(/mastery|learned|retention|percent/i);
  });
});

describe('pending capture', () => {
  test.each([
    [true, true],
    [false, false],
    [undefined, false],
    [1, false],
    ['true', false],
    [{}, false],
    [null, false],
  ])('capturePending %p is reported as %p (only the literal true counts)', (value, expected) => {
    const capturePending = value as unknown as boolean | undefined;
    expect(projectAccountProgress({ journal: journal(), receipt: null, capturePending }).capturePending).toBe(expected);
  });

  test('capturePending is independent of the sendable count', () => {
    const none = projectAccountProgress({ journal: journal(), receipt: null, capturePending: true });
    expect(none).toMatchObject({ queued: 0, capturePending: true });
    const some = projectAccountProgress({ journal: mixed(), receipt: null, capturePending: false });
    expect(some).toMatchObject({ queued: 2, capturePending: false });
  });
});

describe('purity', () => {
  test('deep-frozen inputs are neither mutated nor rejected', () => {
    const j = deepFreeze(mixed());
    const r = deepFreeze(receipt());
    const before = JSON.stringify({ j, r });
    expect(() => projectAccountProgress({ journal: j, receipt: r, receiptState: 'stale', capturePending: true })).not.toThrow();
    expect(JSON.stringify({ j, r })).toBe(before);
  });

  test('remote answers and profile metadata are never a local uploaded count and are not parsed or rewritten', () => {
    const remote: RemoteAnswer[] = [
      { seq: 1, eventId: 'q1', installId: 'other-inst', learnerId: 'learner-1', payload: '{"acked":true,"answer_id":"q1"}' },
      { seq: 2, eventId: 'r2', installId: 'other-inst', learnerId: 'learner-9', payload: 'not json at all' },
      { seq: 3, eventId: 'r3', installId: 'other-inst', learnerId: 'learner-9', payload: '{"events":99}' },
    ];
    const base = { revision: 3, settings: { events: 99, uploaded: 7, session_minutes: 15 } };
    const withRemote = deepFreeze(mixed({ remote, base, cursor: 42 }));
    const payloads = withRemote.remote.map((x) => x.payload);
    const result = projectAccountProgress({ journal: withRemote, receipt: null });
    expect(result).toStrictEqual(projectAccountProgress({ journal: mixed(), receipt: null }));
    expect(result.deviceAccepted).toBe(1);
    expect(result.queued).toBe(2);
    expect(withRemote.remote.map((x) => x.payload)).toStrictEqual(payloads);
  });

  test('remote answers alone leave every local counter at zero and the server unknown', () => {
    const remote: RemoteAnswer[] = [{ seq: 1, eventId: 'r1', installId: 'other-inst', learnerId: 'learner-9', payload: '{}' }];
    expect(projectAccountProgress({ journal: journal({ remote }), receipt: null })).toStrictEqual({
      queued: 0,
      blocked: 0,
      conflicts: 0,
      deviceAccepted: 0,
      capturePending: false,
      server: UNKNOWN,
    });
  });
});
