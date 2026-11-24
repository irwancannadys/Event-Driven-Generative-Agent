# @cafe/web

Halaman browser (Vite + Three.js). Membaca aliran event dari server lewat WebSocket dan menampilkannya, tidak membuat keputusan apa pun (keputusan 026 sampai 028).

```
npm run dev     # tab 1: server (dunia, karakter, API, WebSocket)
npm run web     # tab 2: halaman, buka http://localhost:5173
```

Vite meneruskan `/api/*` ke API server (awalan `/api` dibuang) dan `/ws` ke WebSocket-nya. Alamat server: `CAFE_API_URL`, atau `http://127.0.0.1:PORT` dengan `PORT` dari `.env` di root repo (3000 bawaannya).

Isi `src/` bertambah per langkah Tahap 4: `net/` (koneksi), `state/` (state klien, murni), `i18n/` (kamus teks), `panels/`, `scene/` (3D).
