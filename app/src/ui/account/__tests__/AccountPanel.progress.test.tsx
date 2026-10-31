// The connected profile's account progress as the panel shows it: the caller's projection (`connected.progress`) is shown
// as given, never as a verified zero, mastery or freshness it does not have. Fixtures and no-op callbacks only.
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { AccountPanel, type AccountPanelProps, type ConnectedProfile } from '@/ui/account/AccountPanel';
import type { AccountSyncProgress } from '@/sync/accountProgress';

// The shared UI components import the app's storage module; the panel must never open the store.
jest.mock('@/storage/openStore', () => ({ STORAGE_KIND: 'test-memory', openStore: jest.fn() }));

/** The connected profile with the caller's future progress projection; absent (legacy) keeps the saved-answers count. */
type ProgressConnected = ConnectedProfile & { progress?: AccountSyncProgress | null };

const ANI = { key: 'session-1', label: 'ani@ayailmu.test' };
const CHECKED = '2026-10-27T12:00:00.000Z';

const progress = (over: Partial<AccountSyncProgress> = {}): AccountSyncProgress => ({
  queued: 0,
  blocked: 0,
  conflicts: 0,
  deviceAccepted: 0,
  capturePending: false,
  server: { state: 'unknown', total: null, excluded: null, checkedAt: null },
  ...over,
});
const server = (state: 'verified' | 'stale', total: number, excluded: number): AccountSyncProgress['server'] => ({ state, total, excluded, checkedAt: CHECKED });

/** A signed-in, connected panel whose callbacks are all mocks. */
function connectedProps(extra: Partial<ProgressConnected>): AccountPanelProps {
  const connected: ProgressConnected = { label: 'Profil dewasa', syncStatus: 'Belum disinkronkan dari perangkat ini.', savedAnswers: 1, otherDeviceAnswers: 4, ...extra };
  return {
    account: ANI,
    connected,
    onSubmit: jest.fn(),
    onGuestCopy: jest.fn(),
    onGuestSkip: jest.fn(),
    onLinkProfile: jest.fn(),
    onCreateProfile: jest.fn(),
    onSyncNow: jest.fn(),
    onKeepLocalPrefs: jest.fn(),
    onUseServerPrefs: jest.fn(),
    onSignOut: jest.fn(),
  };
}
const calls = (callback: unknown) => (callback as jest.Mock).mock.calls;
const UNAVAILABLE = /belum diperiksa|tidak tersedia/i;

it('server unknown, or no progress at all: the saved count is unavailable, never a verified 0 jawaban or an empty queue', async () => {
  // The legacy count is 0, but the server was never checked: that 0 is not a fact about the account.
  const view = await render(<AccountPanel {...connectedProps({ savedAnswers: 0, progress: progress({ queued: 1 }) })} />);
  expect(screen.getByTestId('account-progress-events')).toHaveTextContent(UNAVAILABLE);
  expect(screen.getByTestId('account-progress-events')).not.toHaveTextContent(/\d+ jawaban/);

  // Explicitly unavailable: no zero and no known-empty queue are claimed anywhere.
  await view.rerender(<AccountPanel {...connectedProps({ savedAnswers: 0, progress: null })} />);
  expect(screen.getByTestId('account-progress-events')).toHaveTextContent(UNAVAILABLE);
  expect(screen.queryAllByText(/\b0\b|kosong|tidak ada antrean/i)).toHaveLength(0);
});

it('verified: the server total is the answer count (not the legacy field), not mastery, and the lesson position stays on this device', async () => {
  await render(<AccountPanel {...connectedProps({ savedAnswers: 3, progress: progress({ server: server('verified', 5, 2) }) })} />);
  expect(screen.getByTestId('account-progress-events')).toHaveTextContent('5 jawaban');
  expect(screen.getByTestId('account-progress-events')).not.toHaveTextContent('3 jawaban');
  // A count of answers only: learning is still unjudged, and no percentage or mastery is invented from it.
  expect(screen.getByTestId('account-progress-learned')).toHaveTextContent('Belum dinilai');
  expect(screen.getByText(/hanya menghitung jawaban/)).toBeTruthy();
  expect(screen.queryAllByText(/dikuasai|%|streak|otomatis/i)).toHaveLength(0);
  expect(screen.getByText(/posisi pelajaran[^.]*perangkat ini/i)).toBeTruthy();
});

it('stale: the last known total is shown as last known, with no claim that it is current', async () => {
  await render(<AccountPanel {...connectedProps({ savedAnswers: 1, progress: progress({ server: server('stale', 5, 2) }) })} />);
  expect(screen.getByTestId('account-progress-events')).toHaveTextContent('5 jawaban');
  expect(screen.getByTestId('account-progress-events')).not.toHaveTextContent('1 jawaban');
  expect(within(screen.getByTestId('account-progress')).queryAllByText(/terakhir/i).length).toBeGreaterThan(0);
  expect(screen.queryAllByText(/terbaru|mutakhir|sudah sinkron/i)).toHaveLength(0);
});

it('queued, blocked, held capture and conflicts: each fact is shown on its own, the caller’s status is kept, and sync-now waits while busy', async () => {
  const props = connectedProps({
    syncStatus: 'Sebagian jawaban belum dikirim.',
    progress: progress({ queued: 2, blocked: 1, conflicts: 1, deviceAccepted: 4, capturePending: true }),
  });
  const view = await render(<AccountPanel {...props} />);
  expect(screen.getByTestId('sync-status')).toHaveTextContent('Sebagian jawaban belum dikirim.');
  // Queued is 2 and blocked is 1: the conflict (1) and the device-accepted (4) are not added in or mistaken for them.
  expect(screen.getByTestId('sync-queued')).toHaveTextContent(/\b2\b/);
  expect(screen.getByTestId('sync-queued')).not.toHaveTextContent(/\b[3-9]\b/);
  expect(screen.getByTestId('sync-blocked')).toHaveTextContent(/\b1\b/);
  expect(screen.getByTestId('sync-blocked')).not.toHaveTextContent(/\b[2-9]\b/);
  expect(screen.getByTestId('sync-capture')).toBeTruthy();
  expect(screen.queryAllByText(/konflik/i).length).toBeGreaterThan(0);
  expect(screen.getByTestId('sync-now')).not.toBeDisabled();

  await view.rerender(<AccountPanel {...props} busy="sync" />);
  expect(screen.getByTestId('sync-now')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('sync-now'));
  expect(calls(props.onSyncNow)).toHaveLength(0);
  expect(screen.getByTestId('sync-queued')).toHaveTextContent(/\b2\b/);
});
