# 025: Kontrol bos lewat API, papan pantau, dan bos otomatis untuk tes

Status: diterima (2026-11-24). Asal: Tahap 3.

## Keputusan
- **Satu-satunya masukan manusia ke dunia** (selain kontrol waktu) adalah `POST /reports/:id/decision` dengan `{"decision":"approved"|"rejected"}`. Use case `decideReport` menulis `report_decided` (actor `boss`, origin `boss`) di dalam satu langkah, jadi reaksi karakter (admin memesan, kasir membalas) ikut tertulis di transaksi yang sama. Panel web Tahap 4 memakai endpoint yang sama.
- Hanya laporan berstatus `submitted` yang bisa diputuskan: **404** kalau tidak ada, **409** kalau masih disusun (`drafted`, admin belum sampai di meja bos) atau sudah diputuskan.
- Endpoint baca untuk melihat dunia: `GET /agents`, `GET /orders` (`?status=`, `?limit=`, default 100 terbaru), `GET /reports` (`?status=`). Ini di luar daftar tugas awal brief, tapi tanpa ini bos tidak bisa bekerja di uji manual.
- `npm run watch` adalah klien API biasa (polling 1 detik, tanpa akses database), dan `formatDashboard` adalah fungsi murni. Kamus kata (Kasir, Dapur, "mencatat pesanan", ...) ada di `core` (`text/labels.ts`) supaya web Tahap 4 memakainya juga.
- **`AutoBoss`** (hanya di `test-support`, dipakai tes harian dan `demo:stage3`) tidak menyimpan state: ia membaca laporan yang menunggu dari database dan melihat mejanya pada **setiap menit virtual penuh (absolut)**. Akibatnya keputusan jatuh di momen yang sama berapa pun waktu dipotong, dan restart di tengah tidak mengubah apa pun.

## Alasan
Satu pintu masuk manusia menjaga invarian "tanpa trigger manual" (keputusan 013). Memutuskan lewat use case yang sama dengan aturan lain berarti jalur uji dan jalur nyata tidak berbeda. Bos otomatis yang melihat meja di grid absolut menjaga sifat "hasil tidak bergantung cara waktu dipotong" (keputusan 020) tetap berlaku untuk tes yang melibatkan manusia.

## Konsekuensi
- Bos yang tidak pernah mengklik membuat belanja macet dan pesanan yang butuh bahan itu tertahan (keputusan 024). Ini disengaja untuk v1.
- Kalau ada dua klien yang memutuskan laporan yang sama, yang kedua mendapat 409.
