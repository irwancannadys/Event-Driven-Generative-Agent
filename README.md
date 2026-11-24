# Event-Driven Generative Agent: Kafe Virtual

Simulasi kafe 3D di browser. Pegawai AI (kasir, koki, admin stok, pelayan Rina) bekerja otomatis, dan kamu jadi bos yang memantau lalu menyetujui atau menolak laporan.

Event-driven jadi tulang punggung (event log, antrean, replay). Generative agent jadi otak di titik keputusan (memori, inisiatif, refleksi). Semua jalan lokal dan gratis.

## Status

**Tahap 0 (persiapan), 1 (data dan kasir mock), dan 2 (mesin kejadian, waktu virtual, replay) selesai.** Dunia kafe berjalan sendiri: jam virtual, pesanan datang dari generator, komplain muncul kalau pesanan menunggu, dan semuanya tercatat sebagai event. State bisa dibangun ulang dari log (replay), dan server yang mati lalu nyala melanjutkan dunia dari log. Hasilnya berupa log di terminal dan API lokal (`npm run dev`). Belum ada karakter yang memasak (Tahap 3) dan belum ada tampilan web (Tahap 4). Tahap berikutnya dimulai setelah pemilik bilang lanjut.

## Quickstart

Butuh Node 22 atau lebih baru.

```
npm install
npm test              # semua tes
npm run lint
npm run typecheck
npm run db:migrate    # membuat data/cafe.db
npm run seed          # mengisi menu, bahan, resep, langganan, pemasok
npm run demo:stage1   # demo Tahap 1: pesanan, stok turun, stock_low, replay check
npm run demo:stage2   # demo Tahap 2: satu hari penuh dalam hitungan detik
npm run dev           # server hidup: jam virtual jalan, API di http://127.0.0.1:3000
```

Panduan mencoba sendiri langkah demi langkah (termasuk uji pemulihan setelah Ctrl+C): [`docs/testing.md`](docs/testing.md).

## Dokumen

| File | Isi |
|---|---|
| [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) | Apa, kenapa, prinsip desain, scope |
| [`docs/PLAN.md`](docs/PLAN.md) | Rencana kerja Tahap 0 sampai 8 |
| [`docs/concept.md`](docs/concept.md) | Konsep satu halaman (mulai dari sini) |
| [`docs/events.md`](docs/events.md) | Katalog 33 event (kontrak) |
| [`docs/schema.md`](docs/schema.md) | Skema database |
| [`docs/testing.md`](docs/testing.md) | Panduan uji manual tiap tahap |
| [`docs/decisions/`](docs/decisions/) | Catatan keputusan arsitektur |
| [`docs/reference/`](docs/reference/) | Prototipe visual (hanya gambaran, bukan arsitektur) |
