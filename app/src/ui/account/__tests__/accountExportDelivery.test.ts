import { Share } from 'react-native';
import { deliverAccountExport } from '../accountExportDelivery';
const snapshot = { accountId: '3f0c9a52-7a1e-4c55-9d2e-6b8f1e2a4c01', json: '{\n "own": true\n}' };
afterEach(() => jest.restoreAllMocks());
it('opens native sharing with exact server bytes without claiming a saved file', async () => {
 const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
 expect(await deliverAccountExport(snapshot)).toBe('share-opened'); expect(share).toHaveBeenCalledWith({ title: 'Salinan data akun', message: snapshot.json });
});
it('reports an explicit native dismissal honestly', async () => {
 jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.dismissedAction }); expect(await deliverAccountExport(snapshot)).toBe('cancelled');
});
it('rejects a native sharing failure rather than claiming delivery', async () => {
 jest.spyOn(Share, 'share').mockRejectedValue(new Error('fixture failure')); await expect(deliverAccountExport(snapshot)).rejects.toThrow();
});
