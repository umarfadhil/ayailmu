import { act, fireEvent, render } from '@testing-library/react-native';
import type { AccountDeletionModel } from '@/ui/AccountContext';
import { AccountDeletionPanel } from '../AccountDeletionPanel';
function model(phase: AccountDeletionModel['state']['phase'] = 'idle', local: AccountDeletionModel['state']['local'] = 'kept'): AccountDeletionModel { return { key: 'A', state: { phase, local, busy: false }, available: true, remove: jest.fn(async () => undefined), check: jest.fn(async () => undefined), retryIdentity: jest.fn(async () => undefined), retryCleanup: jest.fn(async () => undefined) }; }
it('requires a separate confirmation and fresh password; cancel clears both without sending', async () => {
 const m = model(); const v = await render(<AccountDeletionPanel model={m} />); expect(m.remove).not.toHaveBeenCalled(); await fireEvent.press(v.getByTestId('deletion-start'));
 await fireEvent.changeText(v.getByTestId('deletion-password'),'fixture-password'); await fireEvent.changeText(v.getByTestId('deletion-confirm'),'wrong'); await fireEvent.press(v.getByTestId('deletion-submit')); expect(m.remove).not.toHaveBeenCalled();
 await fireEvent.press(v.getByTestId('deletion-cancel')); await fireEvent.press(v.getByTestId('deletion-start')); expect(v.getByTestId('deletion-password').props.value).toBe(''); expect(v.getByTestId('deletion-confirm').props.value).toBe('');
});
it('submits once, clears inputs immediately and ignores a late failure after owner replacement', async () => {
 const m = model(); let refuse!: (error: Error)=>void; m.remove = jest.fn(() => new Promise<void>((_r,j)=>{refuse=j;})); const v = await render(<AccountDeletionPanel model={m} />);
 await fireEvent.press(v.getByTestId('deletion-start')); await fireEvent.changeText(v.getByTestId('deletion-password'),'fixture-password'); await fireEvent.changeText(v.getByTestId('deletion-confirm'),'HAPUS'); await fireEvent.press(v.getByTestId('deletion-submit'));
 expect(m.remove).toHaveBeenCalledTimes(1); expect(m.remove).toHaveBeenCalledWith('fixture-password',true); expect(v.queryByTestId('deletion-password')).toBeNull(); await fireEvent.press(v.getByTestId('deletion-start')); expect(m.remove).toHaveBeenCalledTimes(1);
 await v.rerender(<AccountDeletionPanel model={{...model(),key:'B'}} />); await act(async()=>refuse(new Error('private-error-password'))); expect(v.queryByText(/private-error-password/)).toBeNull(); expect(v.queryByTestId('deletion-password')).toBeNull();
});
it('pending status separates checking from explicit password-confirmed identity retry', async () => {
 const m = model('pending','erased'); const v = await render(<AccountDeletionPanel model={m} />); expect(v.getByText('Data server sudah dihapus. Penghapusan akun masuk masih tertunda.')).toBeTruthy(); expect(m.check).not.toHaveBeenCalled();
 await fireEvent.press(v.getByTestId('deletion-check')); expect(m.check).toHaveBeenCalledTimes(1); expect(m.remove).not.toHaveBeenCalled(); expect(m.retryIdentity).not.toHaveBeenCalled();
 await fireEvent.press(v.getByTestId('deletion-retry')); await fireEvent.changeText(v.getByTestId('deletion-password'),'fresh-password'); await fireEvent.changeText(v.getByTestId('deletion-confirm'),'HAPUS'); await fireEvent.press(v.getByTestId('deletion-submit')); expect(m.retryIdentity).toHaveBeenCalledWith('fresh-password',true); expect(m.remove).not.toHaveBeenCalled();
});
it('unknown status offers a check, never an automatic or repeated deletion', async () => {
 const m = model('unknown'); const v = await render(<AccountDeletionPanel model={m} />); expect(v.getByText('Hasil permintaan belum diketahui. Periksa status sebelum mencoba lagi.')).toBeTruthy(); expect(v.queryByTestId('deletion-start')).toBeNull(); expect(v.queryByTestId('deletion-retry')).toBeNull(); await v.rerender(<AccountDeletionPanel model={m} />); expect(m.check).not.toHaveBeenCalled(); expect(m.remove).not.toHaveBeenCalled(); await fireEvent.press(v.getByTestId('deletion-check')); expect(m.check).toHaveBeenCalledTimes(1);
});
it('completed server deletion never conceals failed local cleanup and cleanup does not call deletion again', async () => {
 const m = model('completed','failed'); const v = await render(<AccountDeletionPanel model={m} />); expect(v.getByText('Akun sudah dihapus.')).toBeTruthy(); expect(v.getByText('Salinan akun di perangkat ini belum berhasil dihapus.')).toBeTruthy(); expect(v.queryByTestId('deletion-retry')).toBeNull(); await fireEvent.press(v.getByTestId('deletion-cleanup')); expect(m.retryCleanup).toHaveBeenCalledTimes(1); expect(m.remove).not.toHaveBeenCalled(); expect(m.retryIdentity).not.toHaveBeenCalled();
});
it('last pending proof remains visible after sign-out without claiming failed sign-in proves completion', async () => {
 const m = {...model('pending','erased'),available:false}; const v = await render(<AccountDeletionPanel model={m} />); expect(v.getByText('Gagal masuk bukan bukti akun sudah dihapus.')).toBeTruthy(); expect(v.getByTestId('deletion-check').props.accessibilityState.disabled).toBe(true); await fireEvent.press(v.getByTestId('deletion-check')); expect(m.check).not.toHaveBeenCalled();
});
