# Raport Integrasi 2026

Aplikasi Raport Pondok Modern Al-Ghozali. Antarmuka React dan Vite mempertahankan dashboard, pengisian nilai, rekapitulasi, desain rapor, cetak, serta impor dan ekspor Excel. Vercel Functions memeriksa akun, sesi, kelas, dan mata pelajaran. Data santri disimpan di Neon PostgreSQL.

## Siapkan Neon dan akun sekolah

1. Siapkan proyek Neon dan salin **pooled connection string** dengan koneksi TLS. Gunakan branch/database yang terpisah untuk pengujian.
2. Gunakan Node.js 24, jalankan `npm ci`, lalu salin `.env.example` ke `.env.local` dan isi `DATABASE_URL` secara lokal.
3. Jalankan `npm run db:setup` untuk membuat tabel.
4. Ekstrak ZIP lama `raport-pondok.zip` ke folder di luar repositori. Di perintah di bawah, arahkan `../raport-pondok-lama` ke folder yang berisi `src/data` dari ZIP tersebut.

   ```sh
   npm run db:extract -- ../raport-pondok-lama ../santri-neon.private.json
   npm run db:import -- ../santri-neon.private.json
   ```

   Skrip ekstraksi memverifikasi sumber dari ZIP awal. Impor ulang melewati ID yang sudah ada sehingga perubahan guru tetap tersimpan. Berkas privat berisi nama, NISN, dan data nilai. Simpan di lokasi terbatas dan jangan unggah ke GitHub atau Vercel.

5. Buat akun dengan peran yang sesuai. Isi nama guru atau wali kelas sama dengan nama pada master sekolah yang berlaku.

   ```sh
   npm run account -- admin-raport admin
   npm run account -- guru-01 guru "Nama Guru Sesuai Master"
   npm run account -- wali-01 wali_kelas "Nama Wali Kelas Sesuai Master"
   ```

   Kata sandi acak muncul sekali. Sampaikan secara privat kepada pemilik akun. Menjalankan perintah untuk nama pengguna yang sama mengganti kata sandi dan mencabut sesi lama. Untuk mencabut akun, jalankan `npm run account:revoke -- guru-01`.

## Host di Vercel

1. Impor repositori ini ke Vercel dengan preset **Vite**. Gunakan Node.js 24. `vercel.json` menetapkan perintah build dan direktori `dist`.
2. Jika integrasi Neon sudah menyediakan `RAPORT_INTEGRASI_DATABASE_URL` untuk Production, aplikasi membacanya otomatis. Untuk koneksi manual, masukkan `DATABASE_URL` ke **Settings → Environment Variables** sebagai variabel sensitif untuk Production. Gunakan koneksi terpisah bila menyiapkan Preview. Jangan memakai awalan `VITE_` pada kredensial apa pun.
3. Deploy, lalu uji akun admin, guru, dan wali kelas dengan kelas berbeda. Pastikan guru bisa menyimpan nilai mapelnya dan sesi keluar menutup akses data.
4. Jika versi sebelumnya sudah tayang, hapus akses ke deployment yang memuat data lama dan nonaktifkan Google Apps Script publik sebelumnya bila masih aktif. Ganti kredensial lama yang pernah dipakai.

[Dokumentasi Vercel Functions](https://vercel.com/docs/functions) · [Variabel lingkungan Vercel](https://vercel.com/docs/environment-variables) · [Koneksi Neon](https://neon.com/docs/connect/connect-from-any-app)

## Penggunaan

Untuk mengimpor arsip lama dari browser, masuk sebagai admin dan pilih **Data Master → Impor ZIP Santri**. Pilih `raport-pondok.zip` asli dengan ukuran maksimal 3 MB. Server memeriksa arsip terhadap sumber yang sudah diaudit dan hanya menambahkan ID yang belum ada.

- **Guru** menerima daftar santri dari kelas yang diajar dan nilai mata pelajaran penugasannya.
- **Wali kelas** menerima data lengkap kelas binaannya dan dapat mengisi nilai serta sikap di kelas tersebut. Akses di kelas lain mengikuti penugasan mengajar.
- **Administrator** mengelola daftar santri, termasuk menambah, memindahkan, dan menghapus entri.
- Perubahan nilai disimpan ke database. Menu **Muat Ulang Data** mengambil data terkini dari server. Pengaturan tampilan dan kustomisasi desain masih tersimpan per browser.
- Sinkronisasi Google Sheets dan Gmail versi lama dicabut. Impor dan ekspor Excel tetap tersedia.
- Skrip impor mengambil data awal dari ZIP asli. Nilai yang hanya ada di Google Sheets lama atau profil browser perlu dimigrasikan dari sumbernya secara terpisah.

Secara lokal, jalankan `npm run dev` untuk Vercel Dev dan `npm run lint && npm run build` untuk memeriksa proyek. `npm run dev:ui` menjalankan frontend saja untuk pengerjaan tampilan.
