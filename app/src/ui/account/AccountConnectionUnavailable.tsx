import { Btn, Notice } from '@/ui/components';

/** Required device transport is not ready: no claim that a network request failed, and no configuration details. */
export function AccountConnectionUnavailable({ onRetry }: { onRetry(): void }) {
  return (
    <Notice tone="info" testID="account-connection-unavailable" action={
      <Btn testID="account-connection-retry" kind="quiet" label="Periksa lagi" onPress={onRetry} />
    }>
      Koneksi akun belum siap di aplikasi ini. Periksa lagi; jika tetap belum tersedia, hubungi pengelola aplikasi. Data tetap tersimpan di perangkat ini.
    </Notice>
  );
}
