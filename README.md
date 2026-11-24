# Event-Driven Generative Agent: Kafe Virtual

Simulasi kafe 3D di browser. Pegawai AI (kasir, koki, admin stok, pelayan Rina) bekerja otomatis, dan kamu jadi bos yang memantau lalu menyetujui atau menolak laporan.

Event-driven jadi tulang punggung (event log, antrean, replay). Generative agent jadi otak di titik keputusan (memori, inisiatif, refleksi). Semua jalan lokal dan gratis.

## Status

**Tahap 0 (persiapan) dan Tahap 1 (data dan kasir mock) selesai.** Pesanan masuk lewat API, stok berkurang sesuai resep, `stock_low` dan `stock_out` muncul sekali saja, pesanan ditahan kalau bahan kurang, dan semuanya tercatat sebagai event. Hasilnya berupa log di terminal (`npm run demo:stage1`). Belum ada jam virtual, karakter, atau tampilan web. Tahap berikutnya dimulai setelah pemilik bilang lanjut.

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
```

## Dokumen

| File | Isi |
|---|---|
| [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) | Apa, kenapa, prinsip desain, scope |
| [`docs/PLAN.md`](docs/PLAN.md) | Rencana kerja Tahap 0 sampai 8 |
| [`docs/concept.md`](docs/concept.md) | Konsep satu halaman (mulai dari sini) |
| [`docs/events.md`](docs/events.md) | Katalog 33 event (kontrak) |
| [`docs/schema.md`](docs/schema.md) | Skema database |
| [`docs/decisions/`](docs/decisions/) | Catatan keputusan arsitektur |
| [`docs/reference/`](docs/reference/) | Prototipe visual (hanya gambaran, bukan arsitektur) |
