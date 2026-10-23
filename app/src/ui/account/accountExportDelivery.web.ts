import type { AccountExportDelivery, AccountExportSnapshot } from './AccountDataPanel';
export const accountExportDeliveryLabel = 'Unduh salinan';
export async function deliverAccountExport(snapshot: AccountExportSnapshot): Promise<AccountExportDelivery> {
 const url = URL.createObjectURL(new Blob([snapshot.json], { type: 'application/json;charset=utf-8' }));
 const anchor = document.createElement('a');
 try { anchor.href = url; anchor.download = 'ayailmu-data-akun.json'; document.body.appendChild(anchor); anchor.click(); return 'download-started'; }
 finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
