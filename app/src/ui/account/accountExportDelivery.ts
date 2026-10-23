import { Share } from 'react-native';
import type { AccountExportDelivery, AccountExportSnapshot } from './AccountDataPanel';
export const accountExportDeliveryLabel = 'Bagikan salinan';
export async function deliverAccountExport(snapshot: AccountExportSnapshot): Promise<AccountExportDelivery> {
 const result = await Share.share({ title: 'Salinan data akun', message: snapshot.json });
 return result.action === Share.dismissedAction ? 'cancelled' : 'share-opened';
}
