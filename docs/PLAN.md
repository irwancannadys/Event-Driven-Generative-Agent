# PLAN.md: Rencana Kerja Detail (Tahap 0 sampai 8)

> Ini **rencana referensi**, bukan kontrak kaku. Konteks, tujuan, dan prinsip ada di `PROJECT_BRIEF.md` (baca itu dulu).
> Pada **Tahap 0**, Claude Code boleh mengusulkan perubahan pada rencana ini (urutan, pilihan tool, pemecahan tugas), tapi **perubahan harus disetujui pemilik** sebelum dipakai.
> Dokumen ini hidup: centang tugas yang selesai, catat penyimpangan di `docs/decisions/`.

---

## 0. Cara memakai dokumen ini

1. Kerjakan **satu tahap pada satu waktu**. Setiap tahap punya tujuan, tugas, hasil jadi, tes, dan kriteria selesai.
2. Sebelum memulai tahap, ringkas rencana tahap itu dan minta persetujuan.
3. Setelah tahap selesai: jalankan semua tes, tulis catatan singkat di bagian "Catatan pelajaran" (bahan kursus), lalu **berhenti dan tunggu pemilik bilang lanjut**.
4. Jika menemukan konflik antara rencana ini dan prinsip di brief, **prinsip di brief menang**. Tanyakan ke pemilik.

## 1. Keputusan arsitektur yang harus diputuskan paling awal (Tahap 0)

| # | Keputusan | Usulan awal | Alasan |
|---|---|---|---|
| 1 | Siapa yang memegang waktu gerak karakter? | **Server.** Tugas karakter (jalan, kerja) punya durasi dalam waktu virtual. Klien hanya menginterpolasi animasi | Jika klien yang menentukan kapan tugas selesai, replay dan tes jadi tidak deterministik |
| 2 | Posisi karakter di domain | Pakai **ID stasiun** (kasir, dapur, rak, meja bos, meja 1 sampai 3), bukan koordinat. Koordinat hanya ada di frontend | Domain tetap bersih dari urusan 3D |
| 3 | Durasi jalan antar stasiun | Tabel jarak antar stasiun di `core` (jarak dibagi kecepatan) | Deterministik dan mudah dites |
| 4 | Library SQLite | Pilih yang sinkron dan sederhana (mis. better-sqlite3 atau SQLite bawaan Node bila stabil) | Satu proses, tanpa server database |
| 5 | Persist-then-publish | Event ditulis ke DB dulu, baru disiarkan ke subscriber dan WebSocket | Log selalu jadi sumber kebenaran |
| 6 | Aleatorik | Semua kerandoman lewat **seeded RNG** | Replay dan tes deterministik |
| 7 | Migrasi DB | File SQL berurutan plus runner kecil | Sederhana dan transparan |
| 8 | Format konfigurasi | `.env` untuk `LLM_PROVIDER=fake\|ollama`, nama model, timeout | Ganti provider tanpa ubah kode |

## 2. Strategi pengujian (berlaku semua tahap)

- **Unit test** untuk aturan murni di `core` (stok, ambang, jadwal, validasi).
- **Golden test** untuk skenario satu hari: urutan event hasil simulasi dibandingkan dengan file acuan.
- **Replay test:** state dari live run sama dengan state dari replay event log.
- **Contract test** untuk schema output LLM (valid, tidak valid, enum salah, ID tidak dikenal, teks terlalu panjang).
- **Mock Ollama** dengan fixture untuk tes `OllamaLLM` (JSON rusak, timeout, jawaban tidak masuk akal), tanpa model sungguhan.
- Tes tidak boleh bergantung pada jam asli atau jaringan.

## 3. Tahap-tahap

### Tahap 0: Persiapan

**Tujuan:** pondasi repo dan dokumen desain siap sebelum satu baris logika bisnis ditulis.

**Tugas:**
- [ ] `git init`, `.gitignore`, lisensi (opsional), README singkat
- [ ] Pilih tool: package manager, TypeScript strict, linter, formatter, test runner
- [ ] Workspaces: `packages/core`, `packages/server`, `packages/web`
- [ ] `CLAUDE.md` ringkas (aturan kerja dari brief bagian 15, pointer ke brief dan plan)
- [ ] `docs/events.md`: katalog event final (tipe, payload, pemicu, penangan, aturan atau LLM)
- [ ] `docs/schema.md` dan file migrasi SQL awal
- [ ] Data seed: menu (5 sampai 6), bahan, resep, pelanggan langganan, pemasok tiruan
- [ ] Definisi tipe TypeScript untuk event (discriminated union), `LLMClient`, schema output LLM
- [ ] Spesifikasi `SimClock` (tick, kecepatan, `advance(minutes)`, deterministik)
- [ ] `docs/decisions/001-...` untuk keputusan bagian 1
- [ ] Skrip: `dev`, `test`, `lint`, `seed`

**Hasil jadi:** repo yang bisa `install`, `test` (tes sepele lulus), dan `seed`; dokumen events dan schema disetujui.

**Selesai jika:** pemilik menyetujui `events.md`, `schema.md`, dan keputusan arsitektur.

**Catatan pelajaran (kursus):** apa itu event-driven, kenapa desain event dulu sebelum kode.

---

### Tahap 1: Data dan kasir mock (tanpa 3D)

**Tujuan:** pesanan masuk, stok berkurang sesuai resep, dan event stok tipis muncul. Hanya log di terminal.

**Tugas:**
- [ ] Lapisan data: repositori menu, bahan, stok, pesanan
- [ ] Use case `createOrder`: validasi item ada, hitung kebutuhan bahan
- [ ] Use case `completeCooking` (sementara dipicu manual): kurangi stok dalam satu transaksi
- [ ] Deteksi `stock_low` dan `stock_out` yang **idempoten** (muncul sekali sampai stok diisi ulang)
- [ ] Kebijakan stok kurang: pesanan **ditahan**, bukan hilang
- [ ] Kasir mock: API HTTP minimal (`POST /orders`, `GET /menu`, `GET /stock`) dan satu halaman web sederhana atau CLI
- [ ] Log terminal yang rapi per kejadian

**Tes:** hitungan stok per resep, `stock_low` hanya sekali, pesanan ditahan saat stok habis, transaksi atomik.

**Selesai jika:** menjalankan skrip demo menghasilkan urutan log yang benar: pesanan, masak, stok turun, `stock_low`.

**Catatan pelajaran:** aturan vs LLM (belum ada LLM, semua aturan), idempotensi.

---

### Tahap 2: Mesin kejadian, waktu virtual, replay

**Tujuan:** semua kejadian lewat satu jalur yang tercatat, dan satu hari bisa diputar ulang dengan hasil sama.

**Tugas:**
- [ ] Tabel `events` append-only dan penulis event
- [ ] Event bus dalam proses (persist-then-publish)
- [ ] `SimClock`: jam virtual, kecepatan, `advance(minutes)` yang memproses semua jadwal yang terlewat secara berurutan
- [ ] Penjadwal event berbasis waktu (buka kafe, `regular_expected`, tutup)
- [ ] Proyeksi: `replay(events) -> state` (stok, pesanan, laporan)
- [ ] Seeded RNG dan pelarangan `Math.random` / `Date.now` di `core` (aturan lint atau tes)
- [ ] Refaktor Tahap 1 agar semua perubahan state lewat event

**Tes:** golden test satu hari terskrip; replay sama dengan live; `advance(30)` menghasilkan event yang sama berapa pun granularitas tick-nya.

**Selesai jika:** tes golden dan replay lulus.

**Catatan pelajaran:** kenapa event log jadi sumber kebenaran, nilai replay untuk debugging.

---

### Tahap 3: Karakter berbasis aturan

**Tujuan:** kasir, koki, dan admin stok bekerja sendiri lewat aturan. Belum ada 3D dan belum ada LLM.

**Tugas:**
- [ ] Model agent: peran, stasiun saat ini, status (`idle`, `walking`, `working`), antrean tugas
- [ ] Jenis tugas: `goto(station)`, `work(duration, label)`, `do(action)`
- [ ] Durasi jalan dari tabel jarak (keputusan #3)
- [ ] Penangan: kasir (catat pesanan), koki (masak dan kurangi stok), admin stok (cek stok, usulan belanja berbasis aturan "isi sampai penuh")
- [ ] Alur laporan: `report_submitted` (karakter tiba di meja bos), `report_decided` (setuju/tolak lewat API)
- [ ] Pemasok tiruan (tepat waktu, telat, kosong) dan `restock_arrived`
- [ ] Alur komplain berbasis aturan (balasan templat) dengan laporan ke bos
- [ ] Event `agent_state_changed` dengan ETA untuk tampilan
- [ ] Tampilan CLI "watch" yang mencetak status agent

**Tes:** skenario skrip (pesanan, masak, stok tipis, laporan, setuju, restock), banyak pesanan sekaligus (antre), stok habis menahan pesanan lalu diproses setelah restock.

**Selesai jika:** satu hari terskrip berjalan penuh hanya lewat log, dan tes lulus.

**Catatan pelajaran:** state machine agent, serah-terima antar karakter.

---

### Tahap 4: Tampilan 3D (hanya membaca event)

**Tujuan:** apa yang terjadi di log tampil sebagai animasi. Tampilan tidak membuat keputusan.

**Tugas:**
- [ ] WebSocket server: kirim snapshot state saat klien terhubung, lalu aliran event
- [ ] Klien `web`: penyimpan state yang menerapkan event; resync dari snapshot saat reconnect
- [ ] Scene Three.js dari primitif, mengikuti tata letak di `docs/reference/` (boleh disesuaikan)
- [ ] Registri stasiun: ID stasiun ke koordinat 3D (hanya di frontend)
- [ ] Entitas agent: status ke animasi (jalan: interpolasi antar stasiun sesuai ETA; kerja: label dan gerak kecil; diam)
- [ ] Label karakter dan stasiun (proyeksi 3D ke layar)
- [ ] Rak stok yang menampilkan jumlah kotak sesuai stok nyata
- [ ] Panel: log kejadian (label Trigger/Aturan/LLM/Inisiatif/Bos), laporan meja bos (Setujui/Tolak ke API), bar stok, panel simulator (tombol memicu event lewat API)
- [ ] Kamera yang bisa digeser terbatas
- [ ] Mode "tanpa 3D" (hanya panel) untuk debugging

**Tes:** tes tampilan ringan untuk penerapan event ke state klien (tanpa render); uji manual: satu hari terskrip sama dengan log; refresh halaman memulihkan keadaan.

**Selesai jika:** animasi cocok dengan log, refresh tidak merusak dunia, simulator berfungsi.

**Catatan pelajaran:** memisahkan logika dan tampilan, kenapa animasi dari event.

---

### Tahap 5: Pelayan dengan memori dan inisiatif (FakeLLM)

**Tujuan:** Rina bertindak atas inisiatif sendiri dan mengingat pelanggan, tanpa model sungguhan.

**Tugas:**
- [ ] Tabel `regulars` dan `memories` serta repositori
- [ ] Loop berpikir pelayan: berjalan hanya saat pelayan menganggur dan pada interval tertentu
- [ ] Pembuat konteks: ringkasan beberapa baris (jam sekarang, pelanggan yang dekat jadwalnya, kebiasaan, kondisi kafe)
- [ ] Antarmuka `LLMClient` dan `FakeLLM` yang jawabannya berasal dari tabel skenario (deterministik)
- [ ] Schema `waiter_initiative` dan validator (zod atau setara)
- [ ] Pelaksana aksi: `prepare_table`, `tidy_table`, `idle` menjadi tugas agent
- [ ] Event: `regular_expected`, `table_prepared`, `table_tidied`, `regular_arrived`, `regular_greeted`, `regular_left`, `reflection_created`
- [ ] Aturan refleksi: kunjungan >= 4 dan belum ada catatan, buat refleksi dan simpan
- [ ] Sapaan: pakai templat berisi nama dan pesanan biasa
- [ ] Fallback aturan jika output tidak valid
- [ ] Panel "Ingatan Rina" di tampilan

**Tes:** sekitar 25 menit sebelum jam biasa, meja disiapkan; kedatangan disapa dengan pesanan benar; refleksi muncul pada kunjungan ke-4; output FakeLLM tidak valid memicu fallback; tidak ada panggilan berpikir saat pelayan sibuk.

**Selesai jika:** perilaku inisiatif, sapaan, dan refleksi terlihat jelas di log dan tampilan.

**Catatan pelajaran:** memori, inisiatif, refleksi; kenapa memori ada di DB.

---

### Tahap 6: LLM lokal di dua titik

**Tujuan:** ganti `FakeLLM` dengan model lokal untuk **inisiatif pelayan** dan **usulan belanja**, dengan pengaman lengkap.

**Tugas:**
- [ ] Pasang Ollama, uji model kandidat
- [ ] `eval/llm-situations.json` (sekitar 20 situasi) dan skrip evaluasi yang mencetak: persentase JSON valid, persentase aksi benar, latensi
- [ ] Bandingkan 2 sampai 3 model (mulai 4B sampai 9B), pilih yang **terkecil dan masih benar**
- [ ] `OllamaLLM`: parameter `format` (JSON schema), temperature 0, timeout, antrean satu panggilan sekaligus
- [ ] Retry maksimal 2 dengan umpan balik galat validasi, lalu **fallback aturan** dan catat
- [ ] Tabel `llm_calls` (tujuan, ringkasan input, output, valid, latensi, model, fallback)
- [ ] Saklar lewat `.env` (`LLM_PROVIDER=fake|ollama`)
- [ ] Status "mikir..." di tampilan selama menunggu
- [ ] Terapkan ke `waiter_initiative` dan `stock_proposal`

**Tes:** mock Ollama (JSON rusak, timeout, ID tidak dikenal, enum salah) memicu fallback yang benar; tes kontrak schema.

**Selesai jika:** dengan model lokal, kafe tetap jalan; saat model sengaja dirusak, sistem fallback tanpa macet; hasil evaluasi tercatat.

**Catatan pelajaran:** structured output, kenapa valid belum tentu benar, memilih ukuran model.

---

### Tahap 7: Laporan lengkap dan simulator

**Tujuan:** bisa dimainkan orang lain tanpa penjelasan panjang.

**Tugas:**
- [ ] Triase komplain lewat LLM (schema `complaint_triage`) dengan fallback templat
- [ ] Panel simulator lengkap: pesanan, jam ramai, stok habis, komplain, langganan datang, majukan waktu, kecepatan waktu, perilaku pemasok
- [ ] Tombol reset hari dan muat ulang data seed
- [ ] README quickstart (instal, jalankan, pakai simulator)
- [ ] Uji coba dengan satu orang lain, catat titik bingung

**Selesai jika:** orang lain bisa menjalankan dan memainkan dalam sekitar 10 menit.

---

### Tahap 8: Pengujian dan pemolesan

**Tujuan:** v1 stabil dan dokumentasinya siap menjadi bahan kursus.

**Tugas:**
- [ ] Tes e2e satu hari penuh (golden log)
- [ ] Tes regresi replay
- [ ] Cek performa (memori, panas, latensi LLM)
- [ ] Dokumentasi: diagram arsitektur, keputusan, cara menambah karakter atau event baru
- [ ] Kumpulkan "Catatan pelajaran" tiap tahap menjadi kerangka materi kursus
- [ ] Daftar bagian kasar dan utang teknis
- [ ] Tandai rilis `v1.0` dan buat backlog untuk proyek berikutnya (asisten karier, gudang)

**Selesai jika:** tes lulus, dokumentasi lengkap, pemilik puas dengan v1.

## 4. Pemetaan tahap ke bahan kursus

| Tahap | Konsep yang bisa diajarkan |
|---|---|
| 0 | Event-driven, desain sebelum kode |
| 1 | Aturan vs LLM, idempotensi |
| 2 | Event log, waktu virtual, replay |
| 3 | State machine agent, serah-terima antar karakter |
| 4 | Memisahkan logika dan tampilan, animasi dari event |
| 5 | Memori, inisiatif, refleksi |
| 6 | Structured output, fallback, memilih model lokal |
| 7 | Desain simulator dan pengalaman pengguna |
| 8 | Pengujian, dokumentasi, mengemas jadi kursus |

Jalur murid pemula (dibantu AI coding assistant) bisa memakai tahap 0 sampai 4 sebagai versi "template yang diikuti". Jalur murid yang sudah bisa coding membongkar tahap 2 sampai 6.

## 5. Daftar risiko dan pengaman

| Risiko | Pengaman |
|---|---|
| Model kecil memilih aksi tidak masuk akal | Aksi dibatasi enum, validasi, fallback aturan |
| Bahasa Indonesia model lemah | Struktur dan enum berbahasa Inggris, ucapan mulai dari templat |
| Laptop panas atau lambat | LLM dipanggil jarang, satu panggilan sekaligus, konteks kecil |
| Tampilan menyedot waktu | Tahap 4 setelah logika terbukti, primitif saja |
| Replay tidak deterministik | Seeded RNG, larang `Date.now` dan `Math.random` di `core`, golden test |
| Lingkup melebar | Daftar "di luar scope" di brief, tanya sebelum menambah |
