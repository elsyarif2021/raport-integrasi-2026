# Raport Pondok — versi Sites

Source aplikasi Raport Integrasi Pondok Modern Al-Ghozali yang sudah diterbitkan sebagai Sites versi 8. Situs aktif: https://raport-pondok.abumumtaz.chatgpt.site/.

## Fitur akun

- Guru dan wali kelas masuk melalui nama, PIN, dan link pribadi. Nama langsung tampil saat link dibuka.
- Guru hanya menerima kelas dan mata pelajaran penugasannya. Wali kelas mengelola kelas binaannya; kelas lain mengikuti penugasan mengajar.
- Administrator membuat akun massal dari master guru. PIN awal 8 digit dibuat acak dan unik oleh server. Hasil Excel memuat nama, peran, kelas, mapel, PIN, dan link.
- Administrator tambahan dipilih dari data guru. Akun guru yang diangkat menjadi admin mempertahankan PIN dan link, lalu masuk ulang untuk mengaktifkan peran baru.
- Batas 10 admin termasuk akun pemilik berlaku untuk seluruh jalur akun. Akun pemilik menggunakan identitas ChatGPT yang diverifikasi platform.
- Guru, wali kelas, dan admin tambahan mengganti PIN sendiri melalui **Ubah PIN saya** dengan PIN lama serta konfirmasi PIN baru. Server memeriksa PIN lama, membatasi percobaan, dan mencabut seluruh sesi setelah perubahan.
- PIN disimpan sebagai hash PBKDF2 dengan salt. Penanda keunikan menggunakan HMAC; hasil pembuatan massal untuk melanjutkan proses disimpan terenkripsi dan kedaluwarsa setelah 24 jam. PIN mentah tidak disimpan di browser storage.

## Tampilan dan data

Panel kiri menampilkan fitur sesuai peran, dengan satu area kerja di tengah. Tampilan mendukung HP, tablet, dan desktop. Rapor memiliki tampilan formal ringkas dan toolbar ekspor terpusat. Input nilai, rekap, sikap, desain, PDF, cetak, serta impor/ekspor Excel tetap tersedia.

Data santri, nilai, peran akun, dan sesi produksi tersimpan di Cloudflare D1. Repositori tidak berisi salinan database produksi. Berkas ZIP santri asli dapat diimpor melalui **Data santri → Impor ZIP Santri**; checksum dan literal datanya diperiksa tanpa menjalankan JavaScript dari arsip. Impor hanya menambahkan ID yang belum ada.

Perubahan nilai memakai pemeriksaan versi dan transaksi atomik untuk mencegah konflik antar pengguna. Pengaturan kop dan desain tetap tersimpan per browser.

## Pengembangan

Jalankan dari folder ini:

```sh
cd sites
npm ci
npm run typecheck
npm test
npm run build
```

Node.js 24 dianjurkan; minimum 22.13. Build menghasilkan Worker pada `dist/server/index.js` dan frontend pada `dist/client/`. `npm run dev` menjalankan Vite dan Worker lokal. Identitas ChatGPT harus diverifikasi platform; tidak ada bypass login pengembangan.

Manifest Sites berada di `.openai/hosting.json`. Schema dan migrasi D1 tersedia di `db/` dan `drizzle/`. Terapkan migrasi yang belum berjalan saat publikasi. Jangan menghapus atau mengimpor ulang tabel data produksi.

Runtime membutuhkan secret **RAPORT_PIN_BULK_KEY** berupa 64 karakter heksadesimal untuk penanda keunikan PIN dan enkripsi hasil massal. Nilainya dikelola melalui pengaturan runtime Sites, tidak ditaruh dalam Git atau variabel berawalan `VITE_`. Pertahankan key yang sudah digunakan. Secret opsional `RAPORT_IMPORT_TOKEN` hanya dipakai untuk endpoint pemeliharaan impor, bukan login pengguna.

Pengujian API memakai data sintetis. Pengujian arsip asli bersifat opsional jika fixture privat tidak tersedia. Kode Sites ini tidak menggunakan backend Neon atau endpoint `api/raport.ts` di root repositori. Mengunggah folder ini ke GitHub tidak menyalin database atau mengubah deployment Vercel.
