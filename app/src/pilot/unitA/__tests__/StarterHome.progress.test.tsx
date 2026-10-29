// The tester Home's account progress, from the approved account-progress-sync spec: a reviewed Home with a connected
// account shows the compact factual sync state and a manual «Sinkronkan», never mastery or an automatic restore, and
// the lesson position stays on this device. A pending review, or a signed-out guest, gets none of it.
// MOCK PROJECTION / TEST FIXTURES, NOT LIVE PROOF. Only useApp and useAccount are replaced, with fixed values; the real
// StarterHome renders, and the review prop is the fixture's own (the compiled review file is never loaded or changed).
// No service, device, content approval or native claim is made; the callback spies are secondary to the rendered state.
import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Learner } from '@/storage/types';
import type { AccountSyncProgress } from '@/sync/accountProgress';
import { StarterHome } from '../StarterHome';

let mockApp: Record<string, unknown> = {};
let mockAccount: Record<string, unknown> = {};
jest.mock('@/storage/openStore', () => ({ STORAGE_KIND: 'test-memory', openStore: jest.fn() }));
jest.mock('@/ui/AppContext', () => ({ ...jest.requireActual('@/ui/AppContext'), useApp: () => mockApp }));
jest.mock('@/ui/AccountContext', () => ({ ...jest.requireActual('@/ui/AccountContext'), useAccount: () => mockAccount }));

const learner: Learner = {
  learner_id: 'private-beta-fixture', created_at: '2026-01-01T00:00:00.000Z', consent_version: 'demo-consent-0.1',
  consent_at: '2026-01-01T00:00:00.000Z', age_confirmed: true, session_minutes: 15, arabic_scale: 1, screens_seen: [],
};

/** Two queued, one blocked, and a server count of 5 read earlier (stale); the older saved count (3) must not show. */
const PROGRESS: AccountSyncProgress = {
  queued: 2,
  blocked: 1,
  conflicts: 0,
  deviceAccepted: 0,
  capturePending: false,
  server: { state: 'stale', total: 5, excluded: 0, checkedAt: '2026-10-27T12:00:00.000Z' },
};

/** A signed-in, connected account fixture; `onSyncNow` is a spy and `busy` the panel's action in progress. */
const connectedAccount = (onSyncNow: jest.Mock, busy: 'sync' | null = null) => ({
  enabled: true,
  signedIn: true,
  connected: true,
  panel: {
    account: { key: 'session-1', label: 'ani@ayailmu.test' },
    busy,
    onSyncNow,
    connected: { label: 'Profil dewasa', syncStatus: 'Sebagian jawaban belum dikirim.', savedAnswers: 3, otherDeviceAnswers: 0, progress: PROGRESS },
  },
});

it('reviewed Home with a connected account: compact sync facts and a manual Sinkronkan that waits while syncing; the lesson position stays on this device', async () => {
  const onSyncNow = jest.fn();
  mockApp = { learner };
  mockAccount = connectedAccount(onSyncNow);
  const view = await render(<StarterHome reviewed />);

  const facts = screen.getByTestId('beta-sync-status');
  expect(facts).toHaveTextContent(/\b2\b/); // queued
  expect(facts).toHaveTextContent(/\b1\b/); // blocked
  expect(facts).toHaveTextContent(/\b5\b/); // the server's count, from the projection
  expect(facts).toHaveTextContent(/terakhir/i); // stale: worded as the account panel words it
  expect(facts).not.toHaveTextContent(/\b3\b/); // never the older saved-answers count
  expect(facts).not.toHaveTextContent(/terbaru|mutakhir|sudah sinkron/i);
  expect(screen.queryAllByText(/posisi.*perangkat ini/i).length).toBeGreaterThan(0);
  expect(screen.queryAllByText(/dikuasai|dipulihkan|otomatis/i)).toHaveLength(0);
  // Signed in: the entry is no longer an invitation to sign in, while the study entry is untouched.
  expect(screen.queryByText('Masuk ke akun')).toBeNull();
  expect(screen.getByTestId('beta-starter-open')).toBeTruthy();

  const sync = screen.getByTestId('beta-sync-now');
  expect(sync).toHaveTextContent('Sinkronkan');
  expect(sync).not.toBeDisabled();
  await fireEvent.press(sync);
  expect(onSyncNow).toHaveBeenCalledTimes(1);

  mockAccount = connectedAccount(onSyncNow, 'sync');
  await view.rerender(<StarterHome reviewed />);
  expect(screen.getByTestId('beta-sync-now')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('beta-sync-now'));
  expect(onSyncNow).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('beta-sync-status')).toHaveTextContent(/\b2\b/);
});

it('pending review stays blocked even with a learner and connected progress; a signed-out reviewed guest has no account facts, an honest Masuk ke akun and no verified zero', async () => {
  const onSyncNow = jest.fn();
  mockApp = { learner };
  mockAccount = connectedAccount(onSyncNow);
  const view = await render(<StarterHome reviewed={false} />);
  expect(screen.getByText('Materi awal sedang ditinjau')).toBeTruthy();
  expect(screen.queryByTestId('beta-starter-open')).toBeNull();
  expect(screen.queryByTestId('beta-starter-start')).toBeNull();

  mockApp = { learner: null };
  mockAccount = { enabled: true, signedIn: false, connected: false, panel: { account: null, onSyncNow } };
  await view.rerender(<StarterHome reviewed />);
  expect(screen.queryByTestId('beta-sync-status')).toBeNull();
  expect(screen.queryByTestId('beta-sync-now')).toBeNull();
  expect(screen.getByTestId('welcome-account')).toHaveTextContent('Masuk ke akun');
  expect(screen.queryAllByText(/\b0\b|jawaban|terverifikasi|sudah sinkron/i)).toHaveLength(0);
});
