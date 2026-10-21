// Password recovery's fixed failure copy: the stage a failed request, link or password change returns to, and what it
// says. Only an AuthError's code chooses it; an error's own text is never shown, logged or kept.
import { AuthError } from '@/auth/types';

export type RecoveryOperation = 'request' | 'resume' | 'update';

export interface RecoveryFailure {
  /** ready keeps the recovery session for another try; email starts over. */
  stage: 'email' | 'ready';
  message: string;
}

const WEAK_PASSWORD = 'Kata sandi terlalu lemah.';
const UPDATE_UNKNOWN =
  'Server tidak dapat dihubungi, jadi hasilnya belum diketahui: kata sandi mungkin sudah diganti. Coba lagi, atau coba masuk dengan kata sandi baru.';
const UNREACHABLE = 'Server tidak dapat dihubungi. Periksa koneksi, lalu coba lagi.';
const NOT_SYNTHETIC = 'Gunakan alamat email uji yang berakhiran .test.';
const BAD_LINK = 'Tautan pemulihan tidak valid atau sudah kedaluwarsa. Mulai lagi untuk meminta tautan baru.';
const UNAVAILABLE = 'Pemulihan kata sandi sedang tidak tersedia. Mulai lagi nanti.';

/**
 * What a failed recovery step shows. Only a password change refused as weak, or one whose server could not be reached
 * (it may have been applied), stays ready for another try; everything else, unknown errors included, starts over.
 */
export function recoveryFailure(error: unknown, operation: RecoveryOperation): RecoveryFailure {
  const code = error instanceof AuthError ? error.code : null;
  if (operation === 'update' && code === 'weak_password') return { stage: 'ready', message: WEAK_PASSWORD };
  if (operation === 'update' && code === 'network') return { stage: 'ready', message: UPDATE_UNKNOWN };
  if (code === 'network') return { stage: 'email', message: UNREACHABLE };
  if (code === 'not_synthetic') return { stage: 'email', message: NOT_SYNTHETIC };
  if (code === 'bad_callback' || code === 'expired') return { stage: 'email', message: BAD_LINK };
  return { stage: 'email', message: UNAVAILABLE };
}
