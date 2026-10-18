DRAFT 2026-10-17 — written by Claude; needs Umar's review and, for the privacy policy, a legal check against UU No. 27/2022 (UU PDP) before publication.

> Notes for Umar (delete this block before publishing): text for a page on petalytix.id (suggested URL [UMAR: e.g. https://petalytix.id/ayailmu/privasi]). Both languages carry the same content. Every `[UMAR: …]` needs your input. Sources: CODE_RULES §4–§5, `Entities.kt`, `Export.kt`, `SettingsViewModel.kt`, `strings.xml` (consent_*), `data_extraction_rules.xml`. One sentence in §3 describes current behaviour that you may want to change (the export includes child profiles).

---

# Kebijakan Privasi AyaIlmu

Berlaku sejak: [UMAR: tanggal terbit] · Versi 1

**Ringkasnya:** AyaIlmu tidak punya server sendiri. Semua yang kamu lakukan di aplikasi tersimpan di HP kamu. Kami tidak menerima apa pun secara otomatis, hanya file yang kamu sendiri pilih untuk dikirim ke kami. Tanpa iklan, tanpa akun, tanpa pelacak.

## 1. Siapa kami

AyaIlmu dibuat oleh PT Petalytix Teknologi Indonesia ("Petalytix", "kami"), [UMAR: alamat terdaftar]. Untuk pertanyaan privasi dan permintaan hapus data, hubungi **support@petalytix.id**.

## 2. Apa yang disimpan aplikasi, dan di mana

Semua data di bawah ini tersimpan di penyimpanan pribadi aplikasi **di HP kamu saja**. Kami tidak dapat melihatnya.

- **Profil:** label profil (teks bebas, boleh nama panggilan), jenis profil (dewasa atau anak), tahun lahir, bahasa aplikasi, lama sesi pilihan, ukuran huruf Arab, dan **ID pelajar acak** yang dibuat di HP (bukan nomor HP, email, atau ID perangkat). Tahun lahir hanya dipakai untuk memilih isi dan pengaturan anak atau dewasa.
- **Belajar:** setiap jawaban (apa yang diketuk atau diketik), waktu dan lama menjawab, nilai otomatis, bantuan yang dipakai, kemajuan, dan stiker.
- **Laporan soal («Laporkan soal»):** soal yang dilaporkan, alasannya, dan untuk profil dewasa catatan tambahan yang kamu tulis sendiri. Profil anak hanya bisa memilih alasan, tanpa menulis teks.
- **Uji coba Bahasa Arab (khusus 18+):** catatan persetujuan (versi teks dan waktunya), jawaban pertanyaan latar belakang (cara dulu belajar huruf Arab, seberapa sering membaca teks Arab, pernah belajar nahwu/sharaf atau belum, target menit per hari), dan jawaban dua survei singkat (sekitar hari ke-7 dan di akhir uji coba: kejelasan penjelasan 1–5, bagian tersulit, mau lanjut atau tidak, menit belajar per hari, hal yang membingungkan).
- **Kode penguji:** penguji uji tertutup dapat memasukkan kode untuk membuka semua unit. Kode dicocokkan di HP dengan daftar sidik (hash) yang ada di dalam aplikasi. Tidak ada akun dan tidak ada yang dikirim.
- **Pengaturan:** profil yang aktif, pengingat harian (nyala atau mati, dan jamnya), dan daftar produk yang sudah dibeli (lihat §5).

Kami tidak meminta dan tidak menyimpan nama asli (kecuali kamu sendiri mengetiknya sebagai label), email, nomor telepon, kontak, foto, lokasi, atau ID perangkat dan ID iklan.

## 3. Apa yang kami terima

**Secara otomatis: tidak ada.** Aplikasi tidak mengirim data belajar ke kami atau ke pihak lain.

Kami hanya menerima file yang **kamu kirim sendiri**. Di Pengaturan, profil dewasa dapat memilih «Ekspor data belajar». Aplikasi membuat dua file (JSON dan CSV), lalu membuka menu bagikan Android. Kamu yang memilih aplikasinya (misalnya email atau WhatsApp) dan penerimanya. Isi file:

- ID pelajar acak, jenis profil, bahasa, dan tanggal profil dibuat, **tanpa** label profil dan **tanpa** tahun lahir;
- semua jawaban dan nilai seperti di §2, termasuk teks yang diketik;
- laporan soal, jawaban latar belakang dan survei uji coba (jika ada), versi aplikasi, dan waktu ekspor.

File ekspor berisi data **semua profil di HP tersebut**, termasuk profil anak. [UMAR: putuskan apakah ekspor dibatasi ke profil dewasa yang ikut uji coba; jika aplikasi diubah, ubah kalimat ini.]

Selama dikirim, file tunduk pada kebijakan layanan yang kamu pilih (penyedia email, WhatsApp, dan sebagainya).

**Untuk apa:** hanya untuk memeriksa apakah pelajaran dan soal bekerja, lalu memperbaikinya, termasuk memeriksa jawaban ketik secara manual. Tidak untuk iklan, tidak dijual, dan tidak dibagikan ke pihak lain.

**Siapa yang melihat:** tim kursus AyaIlmu di Petalytix [UMAR: sebutkan peran, misalnya pendiri dan peninjau konten]. [UMAR: tempat file disimpan setelah diterima, misalnya kotak surat support@petalytix.id dan sebuah spreadsheet di …; jika ada yang disimpan di luar Indonesia, cek aturan transfer data UU PDP.]

**Berapa lama:** file dari uji coba dihapus **paling lambat 6 bulan setelah uji coba berakhir**. Email lain dan file di luar uji coba: [UMAR: misalnya dihapus 6 bulan setelah urusannya selesai].

## 4. Anak-anak

AyaIlmu untuk anak dan dewasa, dan mengikuti Kebijakan Keluarga (Families) Google Play.

- Saat profil dibuat, aplikasi menanyakan tahun lahir dengan pilihan netral. Anak di bawah 13 tahun diminta memanggil orang tua atau wali. Profil anak hanya bisa dibuat dari profil dewasa.
- Tidak ada iklan, tidak ada SDK pihak ketiga yang mengumpulkan data, dan tidak ada fitur sosial atau obrolan.
- Pembelian dari profil anak dilindungi pemeriksaan orang dewasa (soal hitungan dan tombol tahan).
- Uji coba Bahasa Arab hanya untuk usia 18+. Anak tidak ikut.
- Hanya profil dewasa yang dapat mengekspor data, menghapus data, atau menyalakan pengingat.

Orang tua atau wali dapat meminta penghapusan data anak seperti di §9.

## 5. Pembayaran

Paket sekali bayar diproses oleh **Google Play** dan tunduk pada Kebijakan Privasi Google. Kami tidak pernah melihat data kartu atau rekening. Aplikasi hanya bertanya kepada Google Play produk apa yang dimiliki akun Google di HP itu, lalu menyimpan daftar ID produk tersebut di HP supaya paket tetap terbuka saat offline. Google memberi kami laporan penjualan dan data pesanan [UMAR: cek di Play Console apa saja yang terlihat, misalnya nomor pesanan, produk, harga, tanggal, negara], yang kami pakai untuk pembukuan dan pengembalian dana.

## 6. Cadangan Android

Android dapat mencadangkan data aplikasi (database dan pengaturan) ke **akun Google kamu sendiri**, supaya kemajuan tidak hilang saat ganti HP. Cadangan ini dikelola Google di akunmu, dan kami tidak dapat mengaksesnya. Kamu dapat mematikan atau menghapus cadangan di pengaturan Android atau akun Google.

## 7. Data crash

AyaIlmu tidak memakai SDK laporan crash atau analitik. Jika kamu mengizinkan HP membagikan data penggunaan dan diagnostik ke Google, Google dapat menunjukkan kepada kami laporan crash dan kinerja aplikasi melalui Android Vitals di Play Console. Pengumpulan ini dilakukan dan diatur oleh Google.

## 8. Notifikasi

Pengingat harian bersifat pilihan dan **mati secara bawaan**. Hanya profil dewasa yang dapat menyalakannya, dan izin notifikasi baru diminta saat itu. Pengingat dijadwalkan di HP, tidak melalui server.

## 9. Hak kamu dan cara menghapus data

- **Di HP:** dari profil dewasa, buka Pengaturan untuk menghapus profil itu atau memilih «Hapus semua data». Menghapus aplikasi juga menghapus datanya dari HP. Cadangan di akun Google dihapus terpisah (§6).
- **Menarik persetujuan uji coba:** Pengaturan → Persetujuan uji coba → Tarik persetujuan.
- **File yang sudah dikirim ke kami:** email support@petalytix.id dan sebutkan **ID pelajar** (ada di Pengaturan, tekan lama untuk menyalin). Kami menghapusnya dalam [UMAR: misalnya 30 hari] dan mengabarimu lewat email.
- Kamu juga dapat meminta salinan atau penjelasan tentang data yang sudah kami terima.

Karena kami tidak tahu siapa kamu, kami hanya dapat menemukan file melalui ID pelajar.

## 10. Keamanan

Data di HP tersimpan di penyimpanan pribadi aplikasi, yang tidak dapat dibaca aplikasi lain. Aplikasi tidak mengenkripsinya secara tambahan, jadi lindungi HP dengan kunci layar. File yang kami terima hanya dapat dibuka tim [UMAR: misalnya akun dengan verifikasi dua langkah].

## 11. Perubahan kebijakan

Jika kebijakan ini berubah, kami memperbarui tanggal dan versi di atas. Jika perubahan memengaruhi uji coba, aplikasi akan meminta persetujuanmu lagi.

## 12. Hukum

Kami berupaya mengikuti Undang-Undang No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP). [UMAR: tinjauan hukum sebelum terbit.]

---

# AyaIlmu Privacy Policy

Effective: [UMAR: publication date] · Version 1

**In short:** AyaIlmu has no server of its own. Everything you do in the app stays on your phone. We receive nothing automatically, only files you choose to send us yourself. No ads, no accounts, no trackers.

## 1. Who we are

AyaIlmu is made by PT Petalytix Teknologi Indonesia ("Petalytix", "we"), [UMAR: registered address]. For privacy questions and deletion requests, contact **support@petalytix.id**.

## 2. What the app stores, and where

All of the data below is kept in the app's private storage **on your phone only**. We cannot see it.

- **Profiles:** a profile label (free text; a nickname is fine), profile kind (adult or child), birth year, app language, preferred session length, Arabic text size, and a **random learner ID** created on the phone (not a phone number, email or device ID). The birth year is used only to choose child or adult content and settings.
- **Learning:** every answer (what was tapped or typed), when and how long it took, the automatic score, help used, progress and stickers.
- **Question reports («Laporkan soal»):** the reported question, the reason and, on adult profiles, an optional note you write yourself. Child profiles can only pick a reason; they cannot type text.
- **Arabic trial (18+ only):** the consent record (text version and time), answers to background questions (how you first learned to read Arabic letters, how often you read Arabic text, whether you have studied Arabic grammar, your daily-minutes goal) and answers to two short surveys (around day 7 and at the end of the trial: clarity 1–5, hardest part, whether you would continue, minutes spent per day, anything confusing).
- **Tester code:** closed-test testers can enter a code that unlocks all units. The code is checked on the phone against fingerprints (hashes) built into the app. There is no account and nothing is sent.
- **Settings:** the active profile, the daily reminder (on or off, and its time) and the list of products you own (see §5).

We do not ask for or store real names (unless you type one as a label), email, phone number, contacts, photos, location, or device or advertising IDs.

## 3. What we receive

**Automatically: nothing.** The app does not send learning data to us or to anyone else.

We receive only files **you send yourself**. In Settings, an adult profile can choose «Ekspor data belajar» (Export learning data). The app creates two files (JSON and CSV) and opens the Android share sheet. You choose the app (for example email or WhatsApp) and the recipient. The files contain:

- the random learner ID, profile kind, language and the date the profile was created, **without** the profile label and **without** the birth year;
- all answers and scores described in §2, including typed text;
- question reports, Arabic-trial background and survey answers (if any), the app version and the export time.

An export contains data for **all profiles on that phone**, including child profiles. [UMAR: decide whether to limit the export to adult trial profiles; if the app changes, change this sentence.]

While a file is being sent, the policies of the service you chose apply (your email provider, WhatsApp and so on).

**Why we use it:** only to check whether the lessons and questions work and to improve them, including checking typed answers by hand. Never for ads; never sold or shared with third parties.

**Who sees it:** the AyaIlmu course team at Petalytix [UMAR: name the roles, e.g. founder and content reviewers]. [UMAR: where files are kept after receipt, e.g. the support@petalytix.id mailbox and a spreadsheet in …; if anything is stored outside Indonesia, check the UU PDP cross-border rules.]

**How long:** files from the trial are deleted **no later than 6 months after the trial ends**. Other emails and files outside the trial: [UMAR: e.g. deleted 6 months after the matter is closed].

## 4. Children

AyaIlmu is for children and adults and follows the Google Play Families policy.

- When a profile is created, the app asks for a birth year with a neutral picker. Children under 13 are asked to fetch a parent or guardian. Child profiles can only be created from an adult profile.
- No ads, no third-party SDKs that collect data, and no social or chat features.
- Purchases from a child profile are behind an adult check (an arithmetic question and a hold-to-confirm button).
- The Arabic trial is for ages 18+ only. Children do not take part.
- Only adult profiles can export data, delete data or turn on the reminder.

Parents or guardians can ask for a child's data to be deleted as described in §9.

## 5. Payments

One-time packs are processed by **Google Play** under Google's Privacy Policy. We never see card or bank details. The app only asks Google Play which products the Google account on that phone owns, and keeps that list of product IDs on the phone so packs stay unlocked offline. Google gives us sales reports and order records [UMAR: check what Play Console shows you, e.g. order number, product, price, date, country], which we use for bookkeeping and refunds.

## 6. Android backup

Android can back up the app's data (database and settings) to **your own Google account**, so progress survives a phone change. Google manages this backup in your account; we cannot access it. You can turn backup off or delete it in your Android or Google account settings.

## 7. Crash data

AyaIlmu uses no crash-reporting or analytics SDK. If you allow your phone to share usage and diagnostics data with Google, Google may show us crash and performance reports for the app through Android Vitals in Play Console. Google collects and governs that data.

## 8. Notifications

The daily reminder is optional and **off by default**. Only an adult profile can turn it on, and the notification permission is requested only then. The reminder is scheduled on the phone, not through a server.

## 9. Your rights and how to delete data

- **On the phone:** from an adult profile, open Settings to delete that profile or choose «Hapus semua data» (Delete all data). Uninstalling the app also removes its data from the phone. A backup in your Google account is deleted separately (§6).
- **Withdraw trial consent:** Settings → Persetujuan uji coba → Tarik persetujuan.
- **Files you already sent us:** email support@petalytix.id and quote your **learner ID** (in Settings; long-press to copy). We delete them within [UMAR: e.g. 30 days] and confirm by email.
- You can also ask for a copy or an explanation of the data we have received.

Because we do not know who you are, we can find your files only through the learner ID.

## 10. Security

Data on the phone is kept in the app's private storage, which other apps cannot read. The app does not add its own encryption, so protect your phone with a screen lock. Files we receive can be opened only by the team [UMAR: e.g. accounts with two-step verification].

## 11. Changes to this policy

If this policy changes, we update the date and version above. If a change affects the trial, the app asks for your consent again.

## 12. Law

We aim to follow Indonesian Law No. 27 of 2022 on Personal Data Protection (UU PDP). [UMAR: legal review before publication.]
