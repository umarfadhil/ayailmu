# AyaIlmu privacy policy working draft

Updated 2026-11-11. **Not approved for publication.** This draft replaces the obsolete offline-only claim that AyaIlmu has no accounts, no server and no uploads. It describes the current source and the private deployment audited on this date. Shipping behavior must be checked again against the signed release.

Publication blockers: confirm the legal controller and address, support contact ownership, hosting and email-service recipients/countries, lawful basis and child/guardian requirements, access roles, retention periods, backup deletion/recovery process, incident contact, and a tested full account-deletion process. Do not remove these blockers or invent deadlines. Existing trial consent promises a six-month export retention limit; the owner must confirm and implement that process and align the final text before publication.

## Bahasa Indonesia

### Ringkasan

AyaIlmu menyimpan profil dan kegiatan belajar di perangkat. Jika fitur akun tersedia dan Anda memilih menggunakannya, layanan akun menerima alamat email serta informasi yang diperlukan untuk pendaftaran, masuk, konfirmasi email, dan pemulihan kata sandi. Data belajar dikirim ke server ketika sinkronisasi untuk profil tersebut diaktifkan dengan persetujuan. Menghapus data di perangkat atau keluar dari akun tidak dengan sendirinya menghapus data server.

### Pengelola dan kontak

Pengelola yang tercantum dalam dokumen proyek adalah PT Petalytix Teknologi Indonesia. Alamat terdaftar dan kontak privasi harus dikonfirmasi sebelum kebijakan ini diterbitkan. Alamat dukungan yang tercantum dalam aplikasi adalah support@petalytix.id; kepemilikan dan proses penanganan permintaan perlu diverifikasi.

### Data di perangkat

Bergantung pada fitur dan platform, aplikasi menyimpan label dan ID profil, jenis profil, tahun lahir, bahasa, pengaturan belajar, jawaban dan penilaian, waktu belajar, kemajuan, laporan soal, persetujuan, serta jawaban survei uji coba. Label profil dan tahun lahir bukan bagian dari kontrak unggahan jawaban saat ini. Aplikasi juga dapat menyimpan pengaturan pengingat dan hak akses paket yang dibeli.

Sesi akun dan informasi untuk melanjutkan proses masuk atau pemulihan dapat disimpan melalui penyimpanan akun perangkat. Kata sandi dikirim ke layanan autentikasi saat diperlukan; kata sandi tidak disimpan sebagai bagian dari data belajar. Informasi sesi merupakan data rahasia, bukan isi ekspor belajar. Implementasi penghapusan akun yang baru menyimpan bukti pemulihan rahasia secara terpisah di penyimpanan aman perangkat, bukan dalam ekspor belajar. Bukti ini memungkinkan pemeriksaan status tanpa masuk setelah akun dihapus. Keluar biasa tidak menghapus bukti; penghapusan seluruh data aplikasi dapat menghilangkan akses pemeriksaan tersebut.

### Data yang diterima layanan

- **Akun:** alamat email, kredensial yang dikirim untuk autentikasi, pengenal akun, status konfirmasi, dan informasi sesi. Layanan email memproses alamat penerima dan pesan konfirmasi/pemulihan. Layanan autentikasi menangani kata sandi; basis data belajar menyimpan pengenal penyedia/akun, bukan kata sandi atau email sebagai kolom profil belajar.
- **Profil tersinkron:** ID akun dan pelajar, ID profil lokal, jenis/audiens, bahasa, hubungan pembuat profil anak jika digunakan, serta catatan deklarasi dewasa dan persetujuan sinkronisasi.
- **Jawaban tersinkron:** ID jawaban/pelajar/soal/sesi, isi jawaban termasuk teks yang diketik, waktu dan tanggal, bahasa, materi dan versi aturan/aplikasi, hasil penilaian, serta status peninjauan konten. Server menyimpan salinan jawaban dan nomor urut untuk sinkronisasi dan pemulihan kemajuan. Sinkronisasi baru tidak otomatis mengunggah riwayat sebelum persetujuan.
- **Operasional:** permintaan jaringan menyertakan alamat IP dan metadata teknis. Autentikasi, pembatasan permintaan, dan layanan email dapat memprosesnya. Inventaris log, akses petugas, dan masa simpannya harus diselesaikan sebelum publikasi.
- **Ekspor pilihan Anda:** ekspor belajar Android membuat JSON/CSV dan membuka menu berbagi. Ekspor saat ini dapat memuat semua profil di perangkat, termasuk profil anak, tetapi tidak memuat label profil atau tahun lahir. Periksa isinya sebelum memilih layanan dan penerima. Kebijakan layanan yang Anda pilih berlaku selama pengiriman.

Data akun dan sinkronisasi digunakan untuk menyediakan akun, mengamankan akses, menyimpan dan memulihkan kemajuan, serta memenuhi pilihan persetujuan Anda. Ekspor yang dikirim kepada tim dapat digunakan untuk meninjau dan memperbaiki materi sesuai tujuan yang dijelaskan saat permintaan ekspor. Tidak ada SDK iklan atau analitik pihak ketiga yang ditemukan dalam audit sumber; kebijakan tidak boleh mengartikan ini sebagai tidak ada pemrosesan oleh penyedia autentikasi, email, hosting, atau platform.

### Pilihan, penghapusan, dan penyimpanan

- Keluar dari akun mengakhiri akses sesi; ini bukan penghapusan akun.
- Mematikan sinkronisasi menghentikan pengiriman berikutnya setelah penarikan persetujuan diterima. Jika perangkat offline, permintaan penarikan menunggu pengiriman. Data yang sudah ada di server tetap ada.
- Menghapus profil atau seluruh data melalui kontrol lokal menghapus data perangkat yang dipilih. Ini tidak menghapus akun penyedia autentikasi, data server, ekspor yang telah dibagikan, atau cadangan platform.
- Penghapusan salinan pelajar di server sedang diimplementasikan dan belum tersedia dalam deployment yang diaudit. Kode baru menghapus profil server, jawaban, dan persetujuannya, tetapi menyimpan bukti penghapusan minimal dan penanda ID untuk mencegah pengiriman ulang menghidupkan data lama. Ini tidak menghapus akun autentikasi. Jangan menjanjikan fitur ini sebelum deployment dan alur aplikasi diuji.
- Kode penghapusan akun lengkap kini menghapus semua profil belajar server milik akun beserta jawaban/persetujuan, lalu memproses penghapusan identitas masuk secara terpisah. Bukti minimal dan penanda pencegah pemulihan data lama tetap disimpan. Kontrol aplikasi sedang diverifikasi, belum diterapkan pada deployment yang diaudit. Permintaan melalui web, penghapusan cadangan, dan jangka waktu penyelesaian masih harus ditetapkan serta diuji sebelum peluncuran publik. Hubungi dukungan untuk pertanyaan; jangan mengirim kata sandi atau kode masuk.

Data lokal tersimpan sampai dihapus atau diubah oleh pengguna/aplikasi. Jadwal penghapusan data server, bukti penghapusan, log, ekspor dukungan, dan cadangan belum dibuktikan sebagai proses operasional. Kebijakan publik harus menyebutkan periode atau kriteria yang telah disetujui dan dapat dijalankan, bukan angka perkiraan.

### Anak, pembayaran, cadangan, dan pengingat

Profil anak pada Android dikelola melalui profil dewasa. Fitur sinkronisasi normal yang diaudit masih terbatas pada pelajar dewasa; jangan mengiklankan sinkronisasi keluarga lengkap sebelum alur wali/anak, persetujuan, ekspor dan penghapusannya diterima. Uji coba Bahasa Arab ditujukan untuk dewasa. Penilaian hukum dan kebijakan toko untuk anak belum menjadi sertifikasi kepatuhan.

Jika pembelian diaktifkan pada rilis, Google Play memproses pembayaran dan aplikasi memeriksa hak akses produk. Data kartu tidak masuk ke basis data belajar. Konfigurasi pembayaran rilis harus diuji sebelum bagian ini dipublikasikan sebagai fitur aktif.

Android dapat mencadangkan data lokal sesuai pengaturan perangkat dan aturan cadangan aplikasi. Cadangan platform dikelola melalui akun platform, terpisah dari sinkronisasi AyaIlmu. Pengingat Android dijadwalkan di perangkat setelah dipilih pengguna. Informasi diagnostik platform dapat tersedia melalui layanan platform; cakupan final perlu diverifikasi terhadap rilis.

## English

### Summary

AyaIlmu stores profiles and learning activity on the device. If account features are available and you choose to use them, the account service receives your email address and information needed for registration, sign-in, email confirmation and password recovery. Learning data is sent to the server when sync is explicitly enabled for that profile. Deleting device data or signing out does not by itself delete server data.

### Controller and contact

Project documents identify PT Petalytix Teknologi Indonesia as the operator. Its registered address and privacy contact must be confirmed before publication. The app lists support@petalytix.id; ownership and the request-handling process still require verification.

### Device data

Depending on the feature and platform, the app stores profile labels and IDs, profile kind, birth year, language, learning settings, answers and scores, learning times, progress, question reports, consent and trial-survey answers. Profile labels and birth years are not part of the current answer-upload contract. Reminder settings and purchased-product entitlements may also be stored.

Account sessions and information needed to continue sign-in or recovery may use the device's account storage. Passwords are sent to the authentication service when needed; they are not stored with learning records. Session information is confidential and is not part of a learning export. The new account-deletion implementation keeps a secret recovery proof separately in secure device storage, outside learning exports. This permits status checks without sign-in after account deletion. Ordinary sign-out preserves it; deleting all app data can remove that recovery access.

### Service data

- **Accounts:** email address, credentials submitted for authentication, account identifiers, confirmation status and session information. The email service processes recipients and confirmation/recovery messages. The authentication service handles passwords; the learning database stores provider/account identifiers rather than password or email columns in learning profiles.
- **Synced profiles:** account and learner IDs, local profile ID, kind/audience, language, a child-profile creator relationship where used, and adult-declaration and sync-consent records.
- **Synced answers:** answer/learner/item/session IDs, answer content including typed text, time and date, language, content and rule/app versions, scoring results and content-review status. The server stores answer copies and sequence numbers to sync and restore progress. Starting sync does not automatically upload pre-consent history.
- **Operations:** network requests include IP addresses and technical metadata. Authentication, rate limiting and email services may process these. The log inventory, staff access and retention schedule must be completed before publication.
- **Exports you choose:** Android learning export creates JSON/CSV and opens the share sheet. The current export may contain all profiles on the device, including child profiles, but excludes profile labels and birth years. Review it before choosing a service and recipient. That service's policies apply during delivery.

Account and sync data provide accounts, secure access, save and restore progress, and honor consent choices. Exports sent to the team may support content review and improvement for the purpose explained when requesting the export. No advertising or third-party analytics SDK was found in the source audit; this does not mean authentication, email, hosting or platform providers process no data.

### Choices, deletion and retention

- Signing out ends session access; it does not delete the account.
- Turning sync off stops subsequent transmission once withdrawal is received. Offline withdrawal waits to be sent. Existing server data remains.
- Local profile/all-data controls remove selected device data. They do not delete authentication-provider accounts, server data, shared exports or platform backups.
- Server learner-copy erasure is being implemented and is not available in the audited deployment. The new code erases the server learner, answers and consent records, while retaining a minimal receipt and identifier marker to prevent old retries from restoring erased data. It does not delete the authentication account. Do not promise this feature until deployment and the app flow are tested.
- Full-account deletion source now removes all owned server learner profiles, answers and consent, then separately processes removal of the sign-in identity. Minimal receipts and anti-replay tombstones remain. Native controls are being verified and have not been deployed to the audited service. A web request route, backup deletion and completion deadlines must be established and tested before public launch. Contact support with questions; do not send passwords or sign-in codes.

Local data remains until removed or changed by the user/app. Operational deletion schedules for server data, deletion receipts, logs, support exports and backups have not been verified. The published policy must state approved, implementable periods or criteria, rather than estimated numbers.

### Children, payments, backups and reminders

Android child profiles are managed through an adult profile. Audited normal sync currently supports adult learners only; full family sync must not be advertised until guardian/child flows, consent, export and deletion are accepted. The Arabic trial is for adults. Legal and store-policy reviews for children are not a compliance certification.

If purchases are enabled in the release, Google Play processes payment and the app checks product entitlements. Card data does not enter the learning database. Release billing must be tested before presenting this as an active feature.

Android may back up local data according to device settings and app backup rules. Platform backups use the platform account and are separate from AyaIlmu sync. Android reminders are scheduled on-device after the user chooses them. Platform diagnostic information may be available through platform services; final coverage must be checked against the release.

## Evidence and publication check

Reviewed source: `android/core/sync` (Contracts, HttpBackend, SyncEngine, Journal), `android/app/src/nonLab/.../feature/account`, `android/core/data/.../export/Export.kt`, `SettingsViewModel.kt`, consent resources and backup rules; `backend-umar/internal/api`, `internal/auth`, `internal/store/migrations`. Deployment evidence: 2026-11-11 launch audit, normal GoTrue accounts with confirmation required and optional learner sync, private localhost origin. Source additions are not deployment evidence.

Before publication, reconcile both languages, in-app consent, account/deletion UI, store Data safety/App Privacy forms, backup operations and the actual signed distribution configuration. Preserve the full intended product scope; unresolved features remain launch work, not silently removed promises.
