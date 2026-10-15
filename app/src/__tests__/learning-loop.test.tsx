import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { gateContent } from '@/content/gating';
import { activePack } from '@/content/load';
import { localDate } from '@/engine/util';
import { KvStore, memoryKv, type KvBackend } from '@/storage/kvStore';
import type { AnswerRecord, Learner } from '@/storage/types';

import RootLayout from '@/app/_layout';
import Consent from '@/app/consent';
import Dev from '@/app/dev';
import Guide from '@/app/guide';
import Home from '@/app/index';
import ProgressScreen from '@/app/progress';
import SessionScreen from '@/app/session';
import Settings from '@/app/settings';
import Setup from '@/app/setup';
import Summary from '@/app/summary';

let mockKv: KvBackend = memoryKv();
/** When set, opening the store waits for this promise (simulates slow durable hydration on reload). */
let mockOpenGate: Promise<void> | null = null;
jest.mock('@/storage/openStore', () => ({
  STORAGE_KIND: 'test-memory',
  openStore: async () => {
    if (mockOpenGate) await mockOpenGate;
    const { KvStore: Store } = jest.requireActual('@/storage/kvStore');
    const s = new Store(mockKv);
    await s.init();
    return s;
  },
}));

const routes = {
  _layout: RootLayout,
  index: Home,
  consent: Consent,
  setup: Setup,
  session: SessionScreen,
  summary: Summary,
  settings: Settings,
  dev: Dev,
  guide: Guide,
  progress: ProgressScreen,
};
const content = gateContent(activePack, 'developer-demo');
const start = (initialUrl = '/') => renderRouter(routes, { initialUrl }) as unknown as Promise<{ unmount: () => Promise<void> }>;
const press = async (id: string) => {
  await fireEvent.press(screen.getByTestId(id));
};
const tap = async (id: string) => {
  await waitFor(() => expect(screen.getByTestId(id)).toBeEnabled());
  await press(id);
};
const blob = () => JSON.parse(mockKv.getItem(KvStore.KEY)!);
const tileIds = () => screen.getAllByTestId(/^option-/).map((t) => String(t.props.testID).replace('option-', ''));

const DAY = 86_400_000;
const daysAgo = (d: number) => localDate(Date.now() - d * DAY);

const learner: Learner = {
  learner_id: 'lrn-seeded',
  created_at: '2026-10-01T01:00:00.000Z',
  consent_version: 'demo-consent-0.1',
  consent_at: '2026-10-01T01:00:00.000Z',
  age_confirmed: true,
  session_minutes: 20,
  arabic_scale: 1,
  screens_seen: ['DEMO-S1', 'DEMO-S2', 'DEMO-S3'],
};
let n = 0;
function v2(item_id: string, local_date: string, outcome: AnswerRecord['outcome'] = 'correct'): AnswerRecord {
  n += 1;
  const item = content.items.find((i) => i.item_id === item_id)!;
  return {
    answer_id: `seed-${n}`,
    learner_id: learner.learner_id,
    item_id,
    content_version: 'demo-synthetic-0.2',
    rules_version: 'pilot-0.2-local',
    app_version: '0.2.0',
    timestamp: `${local_date}T02:00:${String(n % 60).padStart(2, '0')}.000Z`,
    local_date,
    session_id: 'ses-seed',
    pool: item.pool,
    unit: item.unit,
    skills: item.skills,
    raw_response: JSON.stringify({ kind: 'choice', option_id: 'k' }),
    auto_score: { answer: outcome },
    outcome,
    error_tags: [],
    serious_tag: null,
    hint_used: false,
    help_lines_shown: [],
    first_attempt: true,
    fresh_evidence: true,
    time_on_item_ms: 1000,
    audio_status: null,
    report_flag: false,
    review_status: 'draft',
    synthetic: true,
    answer_schema: 2,
    evidence_mode: 'recognition-4',
    lineage: item.lineage,
    role: 'practice',
  };
}
const A_CORE = ['A2-M01', 'A2-F01', 'A2-P01', 'A2-M02', 'A2-F02', 'A2-P02', 'A2-P03'];
const seed = (data: object) => mockKv.setItem(KvStore.KEY, JSON.stringify({ schema: 2, meta: {}, learner: null, answers: [], snapshot: null, reports: [], ...data }));

beforeEach(() => {
  mockKv = memoryKv();
  mockOpenGate = null;
  delete process.env.EXPO_PUBLIC_APP_MODE;
});

describe('four answers everywhere (review, readiness, Unit B, focus)', () => {
  it('two days after Unit A core: every graded question has exactly four tiles and no typing field', async () => {
    seed({ learner, answers: A_CORE.map((id) => v2(id, daysAgo(2))) });
    await start();
    await waitFor(() => expect(screen.getByTestId('next-due')).toHaveTextContent(/hari ini/));
    expect(screen.getByTestId('unit-title')).toHaveTextContent(/^Unit B \(dasar\)/);
    await tap('start-session');

    const seenRoles = new Set<string>();
    for (let guard = 0; guard < 40; guard++) {
      await waitFor(() => expect(screen.queryByTestId('next') ?? screen.queryByTestId('answer-tiles') ?? screen.queryByText('Sesi selesai')).toBeTruthy());
      if (screen.queryByText('Sesi selesai')) break;
      if (screen.queryByTestId('lesson-title') && !screen.queryByTestId('answer-tiles')) {
        await tap('next');
        continue;
      }
      expect(tileIds()).toHaveLength(4);
      expect(screen.queryByTestId('answer-input')).toBeNull();
      const eyebrow = screen.getAllByText(/^Unit [AB]/)[0].props.children as string;
      if (eyebrow.includes('Ulasan')) seenRoles.add('review');
      if (eyebrow.includes('Pertanyaan singkat')) seenRoles.add('focus');
      if (eyebrow.startsWith('Unit B')) seenRoles.add('unitB');
      const arabic = screen.queryByTestId('item-arabic')?.props.children;
      if (arabic === 'خَرَجَتْ') await tap('option-r'); // serious doer-gender mistake → Unit B focus
      else if (screen.queryByTestId('dont-know')) await tap('dont-know');
      else await tap('option-k');
      await tap('next');
    }
    expect([...seenRoles].sort()).toEqual(['focus', 'review', 'unitB']);
    const answers = blob().answers as AnswerRecord[];
    expect(answers.filter((a) => a.role === 'review').length).toBe(7);
    expect(answers.some((a) => a.item_id === 'A2-Y01')).toBe(true); // Unit A READY reached after B opened
    expect(answers.find((a) => a.item_id === 'B2-FQ-REF-F')).toMatchObject({ role: 'focus', fresh_evidence: false });
    expect(answers.filter((a) => a.answer_id.startsWith('ans')).every((a) => a.presented_options?.length === 4)).toBe(true);
  }, 60000);
});

describe('reload while the store is still hydrating (regression from rendered QA)', () => {
  async function savedQuestion() {
    seed({ learner, answers: [] });
    const first = await start();
    await tap('start-session'); // lesson screens already seen by the seeded learner
    await waitFor(() => expect(screen.getByTestId('item-arabic')).toHaveTextContent('صَادِقٌ'));
    const order = tileIds();
    await first.unmount();
    return { order, session: JSON.parse(blob().snapshot).session_id as string, bytes: mockKv.getItem(KvStore.KEY) };
  }

  it('a direct /session reload waits for hydration and shows the same question, order and session (no Home redirect)', async () => {
    const saved = await savedQuestion();
    let release!: () => void;
    mockOpenGate = new Promise<void>((r) => (release = r));
    await start('/session');
    // still hydrating: no redirect to Home, no consent, no question yet
    expect(screen.queryByTestId('start-session')).toBeNull();
    expect(screen.queryByText('Persetujuan (versi demo)')).toBeNull();
    release();
    await waitFor(() => expect(screen.getByTestId('item-arabic')).toHaveTextContent('صَادِقٌ'));
    expect(tileIds()).toEqual(saved.order);
    expect(JSON.parse(blob().snapshot).session_id).toBe(saved.session);
    expect(screen.queryByTestId('start-session')).toBeNull();
    expect(mockKv.getItem(KvStore.KEY)).toBe(saved.bytes);
  }, 30000);

  it.each(['/settings', '/guide', '/progress', '/summary'])('a direct %s reload does not bounce to Home while hydrating', async (url) => {
    seed({ learner, answers: A_CORE.map((id) => v2(id, daysAgo(1))) });
    let release!: () => void;
    mockOpenGate = new Promise<void>((r) => (release = r));
    await start(url);
    expect(screen.queryByTestId('start-session')).toBeNull();
    release();
    const marker = { '/settings': 'learner-id', '/guide': 'lesson-title', '/progress': 'unit-A', '/summary': 'summary-next' }[url]!;
    await waitFor(() => expect(screen.getAllByTestId(marker).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('start-session')).toBeNull();
  }, 30000);
});

describe('safe migration of a realistic v1 developer save', () => {
  const typed = { ...v2('A2-P01', daysAgo(3), 'wrong'), answer_id: 'v1-ans', item_id: 'DEMO-P01', content_version: 'demo-synthetic-0.1', answer_schema: undefined, evidence_mode: undefined, lineage: undefined, role: undefined, raw_response: JSON.stringify({ kind: 'typed', text: 'dia beriman', ref: 'laki-laki' }) };
  const v1snap = { version: 1, session_id: 'ses-v1', content_version: 'demo-synthetic-0.1', index: 4, phase: 'step', queue: [{ kind: 'item', item_id: 'DEMO-M02', role: 'practice' }] };

  it('home explains the old session; starting archives it, shows an honest notice and keeps every record', async () => {
    mockKv.setItem(KvStore.KEY, JSON.stringify({ learner, answers: [typed], snapshot: JSON.stringify(v1snap), reports: [{ report_id: 'r1' }] }));
    await start();
    await waitFor(() => expect(screen.getByTestId('session-status')).toHaveTextContent(/format soal sebelumnya/));
    await tap('start-session');
    await screen.findByTestId('migration-notice');
    expect(screen.getAllByText(/semua jawaban, pengaturan, dan laporan Anda tetap tersimpan/).length).toBeGreaterThan(0);
    const b = blob();
    expect(b.answers[0]).toEqual(typed);
    expect(b.learner).toEqual(learner);
    expect(b.reports).toEqual([{ report_id: 'r1' }]);
    expect(JSON.parse(JSON.parse(b.meta.snapshot_archive)[0].raw)).toEqual(v1snap);
    expect(JSON.parse(b.snapshot).version).toBe(2);
    await tap('migration-notice-dismiss');
    await waitFor(() => expect(screen.queryByTestId('migration-notice')).toBeNull());
    expect(blob().meta.pending_notice).toBeUndefined();
  }, 30000);
});

describe('Kemajuan (progress) and next-due labels', () => {
  it('shows separate factual lines with mastery unassessed, a safe word list and locked paths', async () => {
    seed({ learner, answers: A_CORE.map((id) => v2(id, daysAgo(1))) });
    await start('/progress');
    await screen.findByTestId('unit-A');
    expect(screen.getByTestId('line-learned-A')).toHaveTextContent(/Belum dinilai/);
    expect(screen.getByTestId('line-transfer-A')).toHaveTextContent(/Belum dinilai/);
    expect(screen.getByTestId('line-retention-A')).toHaveTextContent(/7 hari: Belum waktunya/);
    expect(screen.getByTestId('word-list')).toHaveTextContent(/orang yang jujur/);
    expect(screen.getByTestId('word-list')).toHaveTextContent(/صَادِقٌ/);
    expect(screen.queryByText(/رَجَعَ|سَمِعَ|قَالَ/)).toBeNull();
    expect(screen.getByText(/OPR-01 \/ PRC-04: siapa yang berkata — terkunci/)).toBeTruthy();
    expect(screen.queryByText(/%|sudah dikuasai/)).toBeNull(); // ("tidak dinilai lulus atau gagal" is the disclaimer)
  }, 30000);

  it('a brand-new learner has no next-due claim; nothing is invented for tomorrow', async () => {
    seed({ learner: { ...learner, screens_seen: [] } });
    await start();
    await screen.findByTestId('start-session');
    expect(screen.queryByTestId('next-due')).toBeNull();
    await start('/summary');
    await waitFor(() => expect(screen.getAllByTestId('summary-next')[0]).toHaveTextContent('Belum ada ulasan atau cek yang terjadwal.'));
  }, 30000);
});

describe('tester mode with old developer data', () => {
  it.each(['/', '/session', '/guide', '/summary', '/progress', '/dev', '/settings'])('%s shows no draft content', async (url) => {
    process.env.EXPO_PUBLIC_APP_MODE = 'tester';
    seed({ learner, answers: A_CORE.map((id) => v2(id, daysAgo(2))) });
    await start(url);
    await waitFor(() => expect(screen.queryByText(/Prototipe · mode penguji/)).toBeTruthy());
    for (const id of ['item-arabic', 'answer-tiles', 'lesson-title', 'word-list', 'menu-open', 'start-session']) {
      expect(screen.queryByTestId(id)).toBeNull();
    }
    expect(screen.queryByText(/[؀-ۿ]/)).toBeNull();
  });
});
