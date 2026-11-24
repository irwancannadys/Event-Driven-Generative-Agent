# 028: Stack web: Vite, Three.js, proxy, DOM tanpa framework

Status: diterima (2026-11-24). Asal: rencana Tahap 4.

## Keputusan
- `packages/web`: Vite + TypeScript (strict, `lib: DOM`) + Three.js. Dependency baru, semuanya gratis dan sudah disebut brief: `vite`, `three` (versi dikunci persis, minor-nya bisa mengubah API), `@types/three`; di server `ws` dan `@types/ws`.
- Vite memakai **proxy**: `/api/*` diteruskan ke API server (awalan `/api` dibuang) dan `/ws` ke WebSocket server. Tidak ada CORS dan API server tidak berubah. Alamat server bisa diganti lewat `CAFE_API_URL` (bawaan `http://127.0.0.1:3000`).
- Dijalankan di dua tab: `npm run dev` (server) dan `npm run web` (halaman, `http://localhost:5173`). Satu perintah untuk semuanya ditunda ke Tahap 8.
- **DOM biasa tanpa framework.** Logika (state klien, jam virtual, posisi, view model panel, kalimat log) ditulis sebagai modul murni yang dites di Vitest tanpa browser, dan DOM atau Three.js hanya lapisan tipis di atasnya. Tanpa jsdom.
- Teks UI lewat kamus i18n (`id` bawaan, `?lang=` untuk ganti), nama event, enum, dan ID tetap Inggris (keputusan 015). Nama karakter, stasiun, dan tugas memakai kamus di `core` (`text/labels.ts`).
- Koordinat stasiun hanya ada di `web` (keputusan 002), dari tata letak `docs/reference/`.

## Alasan
Satu bahasa dan satu alat tes di seluruh repo. Tanpa framework berarti tanpa dependency dan tanpa konsep tambahan buat murid kursus, dan memisahkan logika dari tampilan (invarian 10 brief) jadi nyata: apa pun yang menentukan "apa yang terlihat" bisa dites.

## Konsekuensi
- Tampilan 3D tidak bisa dites otomatis. Yang dites adalah state, posisi, dan graf objek Three.js (tanpa renderer).
- Versi Vite harus cocok dengan Vitest yang sudah terpasang di root; kalau bentrok, dipakai versi Vite yang cocok dan dicatat di sini.
