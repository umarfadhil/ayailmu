// Additive prerequisite manifest for the U-C nominal-definiteness increment. It names existing
// Unit A pilot concepts, their existing lessons and the practice/transfer item IDs the existing
// gate (canAdvanceUnitA) reads for them. It records no learner events or outcomes, claims no
// progress and unlocks nothing. The developer-demo next lesson does not read it: its controller
// checks qualification through the canonical Unit A status (unitAStatus) on every operation.

import { PILOT_CONTENT } from '../../../pilot/unitA/content';
import type { PrerequisiteManifest } from './schema';

export const NOMINAL_DEFINITENESS_PREREQUISITES: PrerequisiteManifest = {
  increment_id: 'nominal-definiteness',
  source_content_version: 'unit-a-pilot-draft-0.1',
  source_policy_version: 'unit-a-evidence-provisional-0.1',
  gate: 'canAdvanceUnitA',
  requires: [
    {
      construct: 'reference',
      lesson_id: 'ua-d01-ref-lesson',
      evidence_item_ids: [
        'ua-d01-ref-p01',
        'ua-d01-ref-p02',
        'ua-d01-ref-p03',
        'ua-d01-ref-p04',
        'ua-d01-ref-t01',
        'ua-d01-ref-t02',
      ],
      reason:
        'The complete sentence pattern (definite noun + bare adjective, no word for "adalah") extends the verbless nominal sentence taught with pronoun subjects in the reference lesson.',
    },
    {
      construct: 'agreement',
      lesson_id: 'ua-d01-agr-lesson',
      evidence_item_ids: [
        'ua-d01-agr-p01',
        'ua-d01-agr-p02',
        'ua-d01-agr-p03',
        'ua-d01-agr-p04',
        'ua-d01-agr-t01',
        'ua-d01-agr-t02',
      ],
      reason:
        'Adjectives stay in the masculine base form because each noun gender is supplied as masculine; this presumes the gender agreement taught in the agreement lesson.',
    },
  ],
  progress_claimed: false,
  unlocks: false,
  automatic_integration: false,
};

const MANIFEST_KEYS = [
  'increment_id',
  'source_content_version',
  'source_policy_version',
  'gate',
  'requires',
  'progress_claimed',
  'unlocks',
  'automatic_integration',
] as const;
const REF_KEYS = ['construct', 'lesson_id', 'evidence_item_ids', 'reason'] as const;
// The gate reads only these phases; d7/d30 delayed checks are not prerequisite evidence.
const GATE_PHASES: readonly string[] = ['practice', 'transfer'];
const CONSTRUCTS: readonly string[] = [...new Set(PILOT_CONTENT.lessons.map((lesson) => lesson.construct))];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

function exactKeys(value: Record<string, unknown>, keys: readonly string[], where: string, errors: string[]): void {
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${where}: missing ${key}`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) errors.push(`${where}: unknown key ${key}`);
}

function checkRef(value: unknown, where: string, errors: string[]): string | undefined {
  if (!isRecord(value)) {
    errors.push(`${where}: expected an object`);
    return undefined;
  }
  exactKeys(value, REF_KEYS, where, errors);
  const { construct, lesson_id: lessonId, evidence_item_ids: evidence, reason } = value;
  if (typeof construct !== 'string' || !CONSTRUCTS.includes(construct)) {
    errors.push(`${where}: unknown Unit A construct`);
    return undefined;
  }
  const lesson = PILOT_CONTENT.lessons.find((candidate) => candidate.id === lessonId);
  if (lesson === undefined || lesson.construct !== construct) errors.push(`${where}: lesson is not an existing ${construct} lesson`);
  if (!isText(reason)) errors.push(`${where}: reason must be non-empty text`);
  if (!Array.isArray(evidence) || evidence.length === 0) {
    errors.push(`${where}: evidence_item_ids must be a non-empty list`);
    return construct;
  }
  if (new Set(evidence).size !== evidence.length) errors.push(`${where}: duplicate evidence id`);
  for (const id of evidence) {
    const item = PILOT_CONTENT.items.find((candidate) => candidate.id === id);
    if (item === undefined) errors.push(`${where}: unknown evidence ${String(id)}`);
    else if (item.construct !== construct) errors.push(`${where}: ${item.id} belongs to another construct`);
    else if (!GATE_PHASES.includes(item.phase)) errors.push(`${where}: ${item.id} is not evidence the gate reads`);
  }
  // Exactly the practice/transfer items the gate reads for this construct, transfer included.
  const gateIds = PILOT_CONTENT.items
    .filter((item) => item.construct === construct && GATE_PHASES.includes(item.phase))
    .map((item) => item.id);
  const missing = gateIds.filter((id) => !evidence.includes(id));
  if (missing.length > 0) errors.push(`${where}: evidence omits ${missing.join(', ')}`);
  const transferIds = gateIds.filter((id) => PILOT_CONTENT.items.find((item) => item.id === id)?.phase === 'transfer');
  if (!transferIds.some((id) => evidence.includes(id))) errors.push(`${where}: no transfer evidence`);
  return construct;
}

/** Returns non-empty messages for anything off-contract; an empty list means valid. */
export function validatePrerequisiteManifest(value: unknown): string[] {
  if (!isRecord(value)) return ['manifest: expected an object'];
  const errors: string[] = [];
  try {
    exactKeys(value, MANIFEST_KEYS, 'manifest', errors);
    const literals: [string, unknown][] = [
      ['increment_id', 'nominal-definiteness'],
      ['source_content_version', PILOT_CONTENT.contentVersion],
      ['source_policy_version', PILOT_CONTENT.policyVersion],
      ['gate', 'canAdvanceUnitA'],
      ['progress_claimed', false],
      ['unlocks', false],
      ['automatic_integration', false],
    ];
    for (const [key, expected] of literals) {
      if (value[key] !== expected) errors.push(`manifest: ${key} must be ${String(expected)}`);
    }
    const requires = value.requires;
    if (!Array.isArray(requires)) {
      errors.push('manifest.requires: expected a list');
      return errors;
    }
    const named = requires.map((ref: unknown, index: number) => checkRef(ref, `manifest.requires[${index}]`, errors));
    for (const construct of CONSTRUCTS) {
      const times = named.filter((name) => name === construct).length;
      if (times !== 1) errors.push(`manifest.requires: ${construct} must be named exactly once (found ${times})`);
    }
    return errors;
  } catch {
    // Safety net for exotic inputs (e.g. throwing getters); plain malformed data never gets here.
    return [...errors, 'manifest: input could not be read'];
  }
}
