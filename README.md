# Event-Driven Generative Agent: Kafe Virtual

Simulasi kafe 3D di browser. Pegawai AI (kasir, koki, admin stok, pelayan Rina) bekerja otomatis, dan kamu jadi bos yang memantau lalu menyetujui atau menolak laporan.

Event-driven jadi tulang punggung (event log, antrean, replay). Generative agent jadi otak di titik keputusan (memori, inisiatif, refleksi). Semua jalan lokal dan gratis.

## Status

**Tahap 0 (persiapan) selesai.** Fondasinya sudah ada: dokumen desain, skema database, seed data, dan kontrak event bertipe beserta tesnya. Belum ada yang bisa dimainkan. Tahap berikutnya (data dan kasir mock) dimulai setelah pemilik bilang lanjut.

## Quickstart

Butuh Node 22 atau lebih baru.

```
npm install
npm test              # semua tes
npm run lint
npm run typecheck
npm run db:migrate    # membuat data/cafe.db
npm run seed          # mengisi menu, bahan, resep, langganan, pemasok
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
