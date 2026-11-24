# Event-Driven Generative Agent: Kafe Virtual

Simulasi kafe 3D di browser. Pegawai AI (kasir, koki, admin stok, pelayan Rina) bekerja otomatis, dan kamu jadi bos yang memantau lalu menyetujui atau menolak laporan.

Event-driven jadi tulang punggung (event log, antrean, replay). Generative agent jadi otak di titik keputusan (memori, inisiatif, refleksi). Semua jalan lokal dan gratis.

## Status

**Tahap 0 sampai 3 selesai.** Dunia kafe berjalan sendiri (jam virtual, pesanan dari generator), dan sekarang ada **tiga karakter berbasis aturan**: kasir mencatat pesanan, koki memasak dan mengurangi stok, admin stok mengecek rak lalu membawa laporan usulan belanja ke meja bos. **Lu jadi bosnya**: setujui atau tolak laporan lewat API, lalu pemasok tiruan mengirim (tepat waktu, telat, atau kosong), stok terisi, dan pesanan yang tertahan lanjut dimasak. Semuanya tercatat sebagai event, bisa di-replay, dan dunia pulih setelah server dimatikan. Hasilnya berupa log di terminal, API lokal, dan papan pantau `npm run watch`. Belum ada tampilan 3D (Tahap 4) dan belum ada LLM (Tahap 5 dan 6): keputusan karakter masih aturan. Tahap berikutnya dimulai setelah pemilik bilang lanjut.

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
npm run demo:stage3   # demo Tahap 3: satu hari dengan karakter dan bos otomatis
npm run dev           # server hidup: jam virtual jalan, karakter bekerja, API di http://127.0.0.1:3000
npm run watch         # (tab lain) papan pantau: siapa di mana, pesanan, stok, laporan menunggu
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
