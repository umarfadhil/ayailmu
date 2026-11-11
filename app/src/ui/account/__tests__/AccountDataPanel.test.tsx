import { act, fireEvent, render } from '@testing-library/react-native';
import { AuthError } from '@/auth/types';
import { AccountDataPanel, type AccountDataPanelProps, type AccountExportDelivery } from '../AccountDataPanel';
const SNAPSHOT = { accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01', json: '{\n  "account": "fixture-own-server-copy"\n}' };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
function props(extra: Partial<AccountDataPanelProps> = {}): AccountDataPanelProps { return { accountKey: 'A', onExport: jest.fn(async () => SNAPSHOT), onDeliver: jest.fn(async () => 'download-started' as const), deliveryLabel: 'Unduh salinan', ...extra }; }
it('explains server-only scope and refuses an empty password without sending', async () => {
 const p = props(); const v = await render(<AccountDataPanel {...p} />);
 expect(v.getByText('Data tamu dan jawaban belum tersinkron tidak ikut.')).toBeTruthy();
 await fireEvent.press(v.getByTestId('account-data-prepare')); expect(v.getByText('Masukkan kata sandi.')).toBeTruthy(); expect(p.onExport).not.toHaveBeenCalled();
});
it('clears the password immediately, refuses duplicate preparation, and delivers exact bytes only on request', async () => {
 const request = deferred<typeof SNAPSHOT>(); const p = props({ onExport: jest.fn(() => request.promise) }); const v = await render(<AccountDataPanel {...p} />);
 await fireEvent.changeText(v.getByTestId('account-data-password'), 'fixture-password'); await fireEvent.press(v.getByTestId('account-data-prepare'));
 expect(p.onExport).toHaveBeenCalledWith('fixture-password'); expect(v.getByTestId('account-data-password').props.value).toBe(''); expect(v.getByTestId('account-data-prepare').props.accessibilityState.disabled).toBe(true);
 await fireEvent.press(v.getByTestId('account-data-prepare')); expect(p.onExport).toHaveBeenCalledTimes(1);
 await act(async () => request.resolve(SNAPSHOT)); expect(v.getByText('Salinan siap.')).toBeTruthy(); expect(p.onDeliver).not.toHaveBeenCalled();
 await act(async () => await fireEvent.press(v.getByTestId('account-data-deliver'))); expect(p.onDeliver).toHaveBeenCalledWith(SNAPSHOT); expect(v.getByText('Unduhan dimulai.')).toBeTruthy();
});
it.each([[new Error('private-server-text fixture-password'), 'Salinan belum bisa disiapkan. Coba lagi.'], [new AuthError('invalid_credentials'), 'Kata sandi tidak cocok.']])('shows fixed safe guidance after refusal %#', async (error, message) => {
 const p = props({ onExport: jest.fn(async () => { throw error; }) }); const v = await render(<AccountDataPanel {...p} />);
 await fireEvent.changeText(v.getByTestId('account-data-password'), 'fixture-password'); await act(async () => await fireEvent.press(v.getByTestId('account-data-prepare')));
 expect(v.getByText(message)).toBeTruthy(); expect(v.queryByText(/private-server-text|fixture-password/)).toBeNull(); expect(v.getByTestId('account-data-password').props.value).toBe(''); expect(v.queryByTestId('account-data-deliver')).toBeNull();
});
it.each(['export', 'delivery'])('drops a late %s result after switching owner', async (stage) => {
 const request = deferred<typeof SNAPSHOT>(); const delivery = deferred<AccountExportDelivery>(); const p = props({ onExport: jest.fn(() => stage === 'export' ? request.promise : Promise.resolve(SNAPSHOT)), onDeliver: jest.fn(() => delivery.promise) }); const v = await render(<AccountDataPanel {...p} />);
 await fireEvent.changeText(v.getByTestId('account-data-password'), 'fixture-password'); await act(async () => await fireEvent.press(v.getByTestId('account-data-prepare')));
 if (stage === 'delivery') await fireEvent.press(v.getByTestId('account-data-deliver'));
 await v.rerender(<AccountDataPanel {...p} accountKey="B" />);
 await act(async () => { request.resolve(SNAPSHOT); delivery.resolve('download-started'); });
 expect(v.getByTestId('account-data-password').props.value).toBe(''); expect(v.queryByText('Salinan siap.')).toBeNull(); expect(v.queryByText('Unduhan dimulai.')).toBeNull(); expect(v.queryByTestId('account-data-deliver')).toBeNull(); expect(p.onDeliver).toHaveBeenCalledTimes(stage === 'delivery' ? 1 : 0);
});
