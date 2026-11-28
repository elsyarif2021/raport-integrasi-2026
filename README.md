# Raport Integrasi — Vercel dan Sites

Versi Vercel kini memakai antarmuka terbaru yang sama dengan Raport Pondok di Sites: navigasi di kiri, satu area kerja, rapor formal ringkas, akun massal dengan PIN otomatis, admin dari data guru, Excel akun, dan Ubah PIN saya.

## Data dan login

Frontend Vercel mengakses API pusat Sites melalui `api/raport.ts`. Siswa, nilai, penugasan, akun, dan PIN memakai database Sites yang sama; perubahan tersimpan langsung untuk kedua alamat aplikasi. Backend tetap memeriksa sesi dan kewenangan pada setiap permintaan.

Guru, wali kelas, dan admin tambahan masuk menggunakan nama dan PIN yang sama dengan Sites. Link pribadi dapat dibagikan dari masing-masing alamat. Sesi browser terpisah untuk setiap domain. Pemilik yang memakai ChatGPT membuka **Akses pemilik dengan ChatGPT** untuk masuk melalui Sites; dari sana pemilik dapat mengatur akun PIN.

Tidak ada impor ulang atau penghapusan database Neon lama. Skrip dan backend Neon terdahulu masih berada dalam riwayat Git; endpoint Vercel aktif sekarang meneruskan permintaan ke Sites. Folder `sites/` menyimpan salinan source Sites.

## Keamanan koneksi

- API Vercel meneruskan hanya endpoint rapor yang ditentukan dan cookie sesi PIN. Header identitas ChatGPT, kredensial Vercel, serta cookie lain tidak diteruskan.
- Perubahan data hanya menerima Origin aplikasi yang sama. Ukuran body dan tipe berkas diperiksa sebelum diteruskan.
- `RAPORT_PROXY_KEY` adalah secret server 64 karakter heksadesimal yang sama pada Vercel dan runtime Sites. Tanda tangan HMAC dengan waktu kedaluwarsa menjaga identitas IP untuk pembatasan percobaan PIN; tanda tangan ini tidak memberikan hak akses akun.
- PIN tetap diperiksa, di-hash, dan disimpan oleh backend Sites. Secret dan database produksi tidak dimasukkan ke repositori atau frontend.

## Pengembangan dan deployment

Gunakan Node.js 24:

```sh
npm ci --include=dev
npm run typecheck
npm test
npm run build
```

`npm run dev` menjalankan frontend Vite. Build menghasilkan `dist/`. Vercel menggunakan `vercel.json` di root dengan install command eksplisit, output `dist`, dan fungsi `api/raport.ts`.

Set `RAPORT_PROXY_KEY` pada environment Production Vercel dan runtime Sites, lalu deploy kedua layanan. Jangan mengganti key hanya di salah satu sisi. `GET /api/raport?action=bridge-status` memeriksa koneksi bertanda tangan tanpa menampilkan data akun. Browser tidak memerlukan akses langsung lintas domain.

Pengujian memakai data sintetis dan menjalankan alur PIN terhadap API bersama. Pengujian ZIP santri asli bersifat opsional bila fixture privat tidak tersedia. Tidak ada bypass login pengembangan.
