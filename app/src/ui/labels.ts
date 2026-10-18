// Learner-facing catalog labels shared by several routes. Unit names from Lessons_Unit_A_B_Draft.md
// Part 2 / Part 3; Unit B in this slice is its basic part only (who did it).

export type UnitId = 'A' | 'B';

export const UNIT_ORDER: UnitId[] = ['A', 'B'];

export const UNIT_TITLE: Record<UnitId, string> = { A: 'Siapa yang dijelaskan?', B: 'Siapa yang melakukan?' };

/** «Unit A», «Unit B · Dasar». */
export const unitLabel = (unit: UnitId) => `Unit ${unit}${unit === 'B' ? ' · Dasar' : ''}`;

/** Practice skills with a learner-facing name. Skills without one (per-word skills) are not listed by name. */
export const SKILL_LABEL: Record<string, string> = {
  'NOM-01': 'Memahami kalimat «dia + sifat»',
  'NOM-02': 'Memilih bentuk yang cocok',
  'LEX-P3': 'Laki-laki atau perempuan (kata pertama)',
  'VRB-01': 'Siapa yang melakukan (akhir kata kerja)',
  'LEX-B': 'Arti kata kerja',
};

/** Arabic text size on the local learner record. */
export const ARABIC_SCALES = [
  { label: 'Kecil', value: 0.85 },
  { label: 'Sedang', value: 1 },
  { label: 'Besar', value: 1.3 },
];

/**
 * Size and welcome previews outside dated lesson, Guide and session views: neutral disconnected letters,
 * never a course word, check stimulus or answer (UI-port contract, board 21).
 */
export const NEUTRAL_PREVIEW = 'أَ بِ تُ';
