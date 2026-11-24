# CLAUDE.md

Proyek: kafe virtual dengan agent AI (event-driven + generative agent).

- Konteks lengkap, prinsip desain, dan scope: [`PROJECT_BRIEF.md`](PROJECT_BRIEF.md)
- Rencana kerja Tahap 0 sampai 8: [`docs/PLAN.md`](docs/PLAN.md)
- Visual referensi (bukan arsitektur): [`docs/reference/`](docs/reference/)

Baca brief dan plan sebelum bekerja. Jika keduanya berbenturan, **brief menang**: tanyakan ke pemilik.

## Aturan kerja

1. Jangan minta pemilik menjelaskan ulang hal yang sudah ada di brief.
2. **Satu tahap pada satu waktu.** Setelah tahap selesai, berhenti dan tunggu pemilik bilang "lanjut".
3. Di dalam tahap: **satu langkah = satu commit kecil**. Jelaskan singkat apa dan kenapa, lalu tunggu "lanjut" (kecuali pemilik bilang "gas sampai langkah N" atau "sampai tahap selesai", maka jalan terus dan berhenti hanya kalau ada yang ngeblok).
4. Gunakan plan mode untuk perubahan besar. Tanyakan sebelum membuat asumsi besar.
5. Pemilik sedang **belajar**: jelaskan alasan pilihan teknis secara singkat. Penjelasan pakai bahasa Indonesia santai. Kode, nama variabel, dan commit message pakai bahasa Inggris.
6. Tulis tes untuk logika inti (aturan, replay, validasi LLM). Tes tidak boleh bergantung pada jam asli atau jaringan.
7. **Jangan menambah fitur atau dependency di luar brief** tanpa bertanya. Tidak ada dependency berbayar atau layanan cloud.
8. Jangan menyentuh 3D (Tahap 4) atau LLM (Tahap 5 dan 6) sebelum tahapnya tiba.
9. Catat keputusan penting di `docs/decisions/` dalam beberapa baris.
10. Jujur soal ketidakpastian: model lokal kecil bisa salah, hasil simulasi bukan prediksi.
11. Jangan `git push`, dan jangan mengubah isi `PROJECT_BRIEF.md` atau `docs/PLAN.md` (selain mencentang tugas), tanpa persetujuan pemilik.
12. Pemilik menguji sendiri hasil tiap tahap. Setelah tahap selesai, perbarui `docs/testing.md` (panduan uji manual) dan **jalankan sendiri langkah-langkahnya** (proses sungguhan, bukan hanya tes otomatis) sebelum menyatakan selesai. File sementara dari uji manual ditaruh di folder scratchpad, bukan `/tmp`.

## Invarian desain (jangan dilanggar)

Daftar lengkapnya ada di brief bagian 4. Yang paling sering tergoda dilanggar:

- **Event log (`events`) adalah sumber kebenaran.** Tabel lain adalah proyeksi, ditulis dalam transaksi yang sama dengan append event.
- **Proyeksi hanya ditulis lewat `applyEvent`** (SQL, di `server`), dan `appendEvent` wajib di dalam transaksi. `core` memutuskan apa yang harus terjadi (fungsi murni), `server` mencatatnya (keputusan 019). Event yang proyeksinya belum dibuat melempar `ProjectionNotImplementedError`: tahap berikutnya wajib menambahkannya.
- **State hidup di server.** `web` hanya presentasi dan tidak membuat keputusan.
- **Satu langkah = satu transaksi** (keputusan 022): kejadian yang jatuh tempo atau klik bos ditulis bersama semua reaksi berantai karakter, commit sekali, baru dipublikasikan. Karakter bereaksi pada **event** (`agents/reactions.ts`), bukan lewat callback. Akhir tugas agent dan kedatangan pemasok dibaca dari proyeksi (keputusan 023), jangan disimpan di memori.
- **Waktu virtual dalam detik (integer).** Di `packages/core` dilarang `Date.now()`, `Math.random()`, dan `new Date()` tanpa argumen (dijaga lint).
- **"Kapan apa terjadi" adalah fungsi murni dari (seed, waktu absolut)** (`dueItems`, `rand(seed, key)` di `core`, keputusan 020). Jam (`VirtualClock`) memproses item berurutan, jadi hasilnya sama berapa pun granularitas `advance` dan setelah restart. Seed dunia dibaca dari `world_initialized` di log, bukan dari `.env`. Kecepatan dan pause (`Pacer`) bukan event (keputusan 021).
- **`packages/core` tanpa I/O:** tidak ada fs, jaringan, atau `process`.
- **Keputusan LLM dicatat sebagai event** (`agent_decided`). Replay membaca log dan tidak memanggil model. LLM selalu lewat `LLMClient`, outputnya divalidasi, dan ada fallback ke aturan.
- **Tanpa trigger manual.** Dunia berjalan lewat generator dunia. Masukan manusia hanya Setujui/Tolak di meja bos dan kontrol waktu.
- Posisi karakter di domain pakai **ID stasiun**, bukan koordinat. Koordinat hanya di `web`.

## Peta repo

- `packages/core`: domain murni (event, aturan masak dan ambang stok, usulan belanja dan triase komplain, rencana tugas agent, teks template dan kamus kata Indonesia, label log, RNG tanpa state, jadwal dan generator dunia, `VirtualClock` dengan item dinamis).
- `packages/server`: Node, SQLite, migrasi, seed, event store dan proyeksi (`applyEvent`), use case (pesanan, memasak, keputusan bos), simulasi (`bootSimulation`: jam virtual, generator, pemulihan saat boot), mesin agent dan reaksi karakter (`agents/`: kasir, koki, admin stok), `Pacer`, API (kasir mock, kontrol waktu, bos: `/agents` `/orders` `/reports`, `node:http`), event bus, log terminal, papan pantau (`watch/`), `npm run dev`. WebSocket menyusul.
- `packages/web`: stub sampai Tahap 4.
- `tools/`: tes untuk tooling (aturan lint, tes drift `docs/events.md` terhadap kode).
- `docs/`: plan, konsep, katalog event, skema, keputusan, referensi.
- `data/`: file SQLite lokal (tidak di-commit).

## Perintah

```
npm install
npm test              # vitest
npm run lint          # eslint
npm run typecheck     # tsc di tiap package
npm run format        # prettier --write (kode dan config saja, bukan docs)
npm run format:check
npm run db:migrate    # buat atau perbarui data/cafe.db
npm run seed          # isi tabel referensi (menu, bahan, resep, langganan, pemasok)
npm run demo:stage1   # demo Tahap 1 di database memori (pesanan lewat API, log, replay check)
npm run demo:stage2   # demo Tahap 2: satu hari penuh, replay check dan restart check
npm run demo:stage3   # demo Tahap 3: satu hari dengan karakter dan bos otomatis, replay check dan restart check
npm run dev           # server hidup: dunia, karakter, jam virtual, API di :3000 (lihat docs/testing.md)
npm run watch         # papan pantau live (karakter, pesanan, stok, laporan di meja bos); `-- --once` cetak sekali
```

Golden test satu hari ada di `packages/server/src/sim/__golden__/`: `day-seed-42.json` (dunia tanpa karakter, `agents: false`) dan `day-seed-42-agents.json` (dunia dengan karakter dan `AutoBoss`, waktu sampai detik). Kalau hasilnya memang sengaja berubah, tinjau diff-nya lalu regenerasi dengan `UPDATE_GOLDEN=1 npm test`.

`bootSimulation` menjalankan karakter secara bawaan. Tes yang mengandalkan "belum ada yang memasak" (Tahap 2) memakai `agents: false`. `AutoBoss` dan `playDay` (`test-support/`) hanya untuk tes dan demo, bukan fitur produk.

`docs/events.md` adalah kontrak event: ubah dokumen dan skema zod di `packages/core` bersamaan, tes drift akan gagal kalau keduanya berbeda.

## Konvensi

- TypeScript strict, ESM, `moduleResolution: Bundler` (import tanpa ekstensi `.js`). Dijalankan lewat `tsx`, tanpa build.
- Antarpackage mengimpor lewat nama workspace (`@cafe/core`).
- Teks UI berbahasa Indonesia lewat kamus i18n. Nama event, enum, dan ID tetap Inggris.
- Git: identitas author di-set lokal di repo ini. Branch `main`, remote `origin` sudah dipasang.
