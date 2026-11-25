# Event-Driven Generative Agent: Kafe Virtual

Simulasi kafe 3D di browser. Pegawai AI (kasir, koki, admin stok; pelayan Rina hanya dekor) bekerja otomatis, dan kamu jadi bos yang memantau lalu menyetujui atau menolak laporan.

Event-driven jadi tulang punggung (event log, antrean, replay). Generative agent jadi otak di titik keputusan (memori, inisiatif, refleksi). Semua jalan lokal dan gratis.

## Status

**Tahap 0 sampai 5 selesai, Tahap 6 selesai dan menunggu uji pemilik.** Dunia kafe berjalan sendiri (jam virtual, pesanan dari generator), tiga karakter berbasis aturan bekerja (kasir, koki, admin stok), dan lu jadi bosnya: setujui atau tolak laporan. Sekarang semuanya terlihat di **halaman web**: kafe 3D berbentuk diorama dengan dapur dan ruang bos yang terpisah, karyawan berseragam, pelanggan yang masuk, menunggu, mengambil pesanan, dan pulang, plus panel log, stok, dan meja bos dengan tombol Setujui/Tolak dan kontrol waktu. Halaman hanya membaca aliran event dari server (WebSocket), jadi refresh tidak merusak dunia. Semua tercatat sebagai event, bisa di-replay, dan dunia pulih setelah server dimatikan. Di Tahap 5 Admin Stok belajar (lewat `FakeLLM`, skrip tanpa model sungguhan): memperkirakan pemakaian bahan dan memesan sebelum habis, mereview hari tiap malam dengan satu usulan perubahan batas minimum untuk lu setujui, dan menilai apakah usulan kemarin membantu. Di Tahap 6 Admin Stok bisa memakai **model sungguhan yang jalan di komputer sendiri** lewat Ollama (`LLM_PROVIDER=ollama`, bawaan `qwen3:4b`): model mikir beberapa detik selagi jam virtual jalan, jawabannya diperiksa, dan kalau salah atau model mati, aturan yang memutuskan. Tahap berikutnya dimulai setelah pemilik bilang lanjut.

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
npm run demo:stage5   # demo Tahap 5: 4 hari, Admin Stok belajar (`-- --off` = pembanding tanpa belajar)
npm run experiment:stage5   # eksperimen beberapa seed: apakah belajar membuat kafe lebih baik
npm run eval:llm -- --model qwen3:4b   # nilai model lokal (Ollama) pada 20 situasi kafe
npm run dev           # server hidup: jam virtual jalan, karakter bekerja, API di http://127.0.0.1:3000
npm run web           # (tab lain) halaman web dengan kafe 3D, buka http://localhost:5173
npm run watch         # (tab lain) papan pantau di terminal: siapa di mana, pesanan, stok, laporan
```

Panduan mencoba sendiri langkah demi langkah (termasuk uji pemulihan setelah Ctrl+C): [`docs/testing.md`](docs/testing.md).

## Dokumen

| File | Isi |
|---|---|
| [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md) | Apa, kenapa, prinsip desain, scope |
| [`docs/PLAN.md`](docs/PLAN.md) | Rencana kerja Tahap 0 sampai 8 |
| [`docs/concept.md`](docs/concept.md) | Konsep satu halaman (mulai dari sini) |
| [`docs/events.md`](docs/events.md) | Katalog 38 event (kontrak) |
| [`docs/schema.md`](docs/schema.md) | Skema database |
| [`docs/testing.md`](docs/testing.md) | Panduan uji manual tiap tahap |
| [`docs/decisions/`](docs/decisions/) | Catatan keputusan arsitektur |
| [`docs/reference/`](docs/reference/) | Prototipe visual (hanya gambaran, bukan arsitektur) |
