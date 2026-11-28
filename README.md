# Raport Integrasi — Vercel dan Sites

Versi Vercel kini memakai antarmuka terbaru yang sama dengan Raport Pondok di Sites: navigasi di kiri, satu area kerja, rapor formal ringkas, akun massal dengan PIN otomatis, admin dari data guru, Excel akun, dan Ubah PIN saya.

## Data dan login

Frontend Vercel mengakses API pusat Sites melalui `api/raport.ts`. Siswa, nilai, penugasan, akun, dan PIN memakai database Sites yang sama; perubahan tersimpan langsung untuk kedua alamat aplikasi. Backend tetap memeriksa sesi dan kewenangan pada setiap permintaan.

Guru, wali kelas, dan admin tambahan masuk menggunakan nama dan PIN yang sama dengan Sites. Link pribadi dapat dibagikan dari masing-masing alamat. Sesi browser terpisah untuk setiap domain. Pemilik tetap dapat menggunakan **Akses pemilik dengan ChatGPT** melalui Sites. Di Vercel, tab **Super admin** menyediakan **Daftar super admin** sekali dengan Google, lalu **Masuk dengan Google**.

Pendaftaran Google hanya menerima email pemilik yang sudah ditetapkan, `lionxmumtaz@gmail.com`, dengan email terverifikasi dan ID Google yang tetap. Pengunjung lain tidak dapat mendaftarkan diri sebagai super admin. Pendaftaran menyimpan profil tanpa membuat sesi login; tombol masuk digunakan setelah pendaftaran berhasil. Pemilik Google dihitung sebagai pemilik yang sama dalam batas 10 admin. Admin tambahan tetap dipilih dari data guru dan memakai PIN.

## Mengaktifkan Google di Vercel

1. Buat OAuth client bertipe **Web application** pada Google Cloud / Google Auth Platform. Atur consent screen dengan scope `openid`, `email`, dan `profile`. Bila aplikasi berstatus Testing, tambahkan email pemilik sebagai test user.
2. Daftarkan **Authorized redirect URI** persis:

   `https://raport-integrasi-2627.vercel.app/auth/google/callback`

   `https://raport-integrasi-2026.vercel.app/auth/google/callback`

3. Simpan `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di environment **Production** proyek Vercel `raport-integrasi-2627` dan `raport-integrasi-2026` jika keduanya akan dipakai. Pastikan masing-masing proyek memiliki `RAPORT_PROXY_KEY` yang sama dengan backend Sites; jangan mengganti atau mengungkap nilainya. Jangan memakai awalan `VITE_` atau menaruh secret dalam source/percakapan.
4. Redeploy Vercel, lalu buka tab **Super admin**, pilih **Daftar super admin**, dan selesaikan verifikasi Google. Setelah berhasil, pilih **Masuk dengan Google**.

Kode tidak memasang kredensial Google contoh. Selama `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, atau `RAPORT_PROXY_KEY` belum diisi secara valid, `GET /api/google?action=status` mengembalikan `configured:false` dan tombol Google dinonaktifkan dengan pesan pengaturan belum selesai. Alur Google memerlukan pengujian langsung oleh pemilik setelah konfigurasi; pengujian otomatis memakai identitas dan kunci sintetis.

Origin dan callback Google hanya menerima dua domain produksi yang disebutkan di atas (allowlist di `server/googleOAuth.ts`). Jika domain produksi diganti, perbarui allowlist, pengujian, serta Authorized redirect URI di Google. Preview deployment tidak dapat dipakai sebagai callback alternatif.

Tidak ada impor ulang atau penghapusan database Neon lama. Skrip dan backend Neon terdahulu masih berada dalam riwayat Git; endpoint Vercel aktif sekarang meneruskan permintaan ke Sites. Folder `sites/` menyimpan salinan source Sites.

## Keamanan koneksi

- API Vercel meneruskan hanya endpoint rapor yang ditentukan dan cookie sesi PIN/Google aplikasi. Header identitas ChatGPT, kredensial Vercel, serta cookie lain tidak diteruskan.
- Perubahan data hanya menerima Origin aplikasi yang sama. Ukuran body dan tipe berkas diperiksa sebelum diteruskan.
- `RAPORT_PROXY_KEY` adalah secret server 64 karakter heksadesimal yang sama pada Vercel dan runtime Sites. Tanda tangan HMAC dengan waktu kedaluwarsa menjaga identitas IP untuk pembatasan percobaan PIN; tanda tangan ini tidak memberikan hak akses akun.
- PIN tetap diperiksa, di-hash, dan disimpan oleh backend Sites. Secret dan database produksi tidak dimasukkan ke repositori atau frontend.
- OAuth Google menggunakan authorization code, PKCE S256, state dan nonce, serta validasi tanda tangan ID token Google (issuer, audience, expiry, email terverifikasi). Flow cookie dienkripsi dan kedaluwarsa 10 menit. ID token Google tidak disimpan atau dikirim ke browser.
- Pendaftaran dan sesi Google disimpan pada tabel D1 tambahan melalui RPC HMAC dengan hash body, batas waktu, dan pencegahan replay. Cookie Google acak 256 bit bersifat HttpOnly, Secure, SameSite=Lax; database menyimpan hash token dan sesi kedaluwarsa 8 jam. Logout dan pergantian metode login mencabut sesi sebelumnya.
- Backend Sites hanya menerima sesi Google melalui permintaan bridge yang ditandatangani. Login ChatGPT dan PIN di Sites tetap tersedia. Migrasi Google hanya menambahkan tabel, tanpa mengubah siswa, nilai, atau akun yang sudah ada.

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
