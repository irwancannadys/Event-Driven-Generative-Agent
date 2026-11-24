# PLAN.md: Rencana Kerja Detail (Tahap 0 sampai 8)

> Ini **rencana referensi**, bukan kontrak kaku. Konteks, tujuan, dan prinsip ada di `PROJECT_BRIEF.md` (baca itu dulu).
> Pada **Tahap 0**, Claude Code boleh mengusulkan perubahan pada rencana ini (urutan, pilihan tool, pemecahan tugas), tapi **perubahan harus disetujui pemilik** sebelum dipakai.
> Dokumen ini hidup: centang tugas yang selesai, catat penyimpangan di `docs/decisions/`.
> **Revisi 2026-11-24 (review Tahap 0, disetujui pemilik):** keputusan arsitektur #9 sampai #12 ditambah, #4 dan #6 diperjelas, dan tahap 0, 1, 2, 3, 4, 5, 6, 7 disesuaikan (generator dunia, event-first sejak Tahap 1, tanpa trigger manual).

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
| 4 | Library SQLite | **better-sqlite3** (sinkron, binary arm64 tersedia). `node:sqlite` bawaan Node 22 masih eksperimental, jadi hanya jadi fallback bila instalasi gagal | Satu proses, tanpa server database |
| 5 | Persist-then-publish | Event ditulis ke DB dulu, baru disiarkan ke subscriber dan WebSocket | Log selalu jadi sumber kebenaran |
| 6 | Aleatorik | Semua kerandoman lewat **RNG tanpa-state**: fungsi murni `rand(seed, key)` (key mis. waktu sim + tujuan undian), bukan generator berurutan | Replay, restart, dan tes deterministik, tanpa perlu menyimpan posisi RNG |
| 7 | Migrasi DB | File SQL berurutan plus runner kecil | Sederhana dan transparan |
| 8 | Format konfigurasi | `.env` untuk `LLM_PROVIDER=fake\|ollama`, nama model, timeout | Ganti provider tanpa ubah kode |
| 9 | Satuan waktu | Semua waktu di domain dalam **detik virtual** (integer); menit dan jam diturunkan. Tiap tugas agent punya `duration_sim_sec`. Aturan frontend untuk loncat waktu (fast-forward atau snap) diputuskan di Tahap 4 | Satu satuan, tidak ada campuran menit dan detik |
| 10 | Keputusan LLM | Dicatat sebagai event `agent_decided` (source: rule, llm, fallback). Jam virtual **jalan terus** saat LLM berpikir (agent berstatus "mikir..."). Jawaban dicek ulang saat diterapkan; jawaban basi atau tidak masuk akal ditolak lalu fallback. Replay membaca keputusan dari log, tidak memanggil model | Dunia tidak freeze di mata pengguna, replay tetap deterministik |
| 11 | Pemulihan setelah restart | Saat boot, server **replay event log** untuk membangun ulang proyeksi dan antrean tugas agent | Dunia tidak ter-reset tiap server restart (sering terjadi saat ngoding) |
| 12 | Event log vs tabel | `events` = sumber kebenaran. Tabel lain = **proyeksi**, ditulis dalam transaksi yang sama dengan append event. Tabel referensi (menu, resep, profil langganan) statis dari seed | Tidak ada dua sumber kebenaran |

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
- [x] `git init`, `.gitignore`, lisensi (opsional, dilewati), README singkat
- [x] Pilih tool: package manager, TypeScript strict, linter, formatter, test runner
- [x] Workspaces: `packages/core`, `packages/server`, `packages/web`
- [x] `CLAUDE.md` ringkas (aturan kerja dari brief bagian 15, pointer ke brief dan plan)
- [x] `docs/events.md`: katalog event final (tipe, payload, pemicu, penangan, aturan atau LLM)
- [x] `docs/schema.md` dan file migrasi SQL awal
- [x] Data seed: menu (5 sampai 6), bahan, resep, pelanggan langganan, pemasok tiruan
- [x] Skema zod untuk event (discriminated union, tipe TS diturunkan), `LLMClient`, schema output LLM, plus tes drift terhadap `docs/events.md`
- [x] Interface dan spesifikasi `SimClock` (detik virtual, kecepatan, `advance(seconds)`, deterministik). Implementasi di Tahap 2
- [x] `docs/concept.md`: konsep satu halaman
- [x] `docs/decisions/001-...` untuk keputusan bagian 1
- [x] Skrip: `test`, `lint`, `typecheck`, `db:migrate`, `seed` (`dev` ditunda ke Tahap 1, belum ada yang bisa dijalankan)

**Hasil jadi:** repo yang bisa `install`, `test` (tes sepele lulus), dan `seed`; dokumen events dan schema disetujui.

**Selesai jika:** pemilik menyetujui `events.md`, `schema.md`, dan keputusan arsitektur.

**Catatan pelajaran (kursus):** apa itu event-driven, kenapa desain event dulu sebelum kode.

Hasil Tahap 0, bahan untuk materi:

- Event adalah fakta yang sudah terjadi dan tidak diubah. State adalah hasil `reduce` atas event, dan replay menjalankannya ulang (lihat `docs/concept.md`).
- Daftar event adalah **kontrak** antarbagian. Dokumen dijaga agar tidak berbeda dari kode oleh satu tes drift (`tools/events-doc.test.ts`). Tes itu terbukti gagal saat dokumen sengaja dirusak.
- Keputusan yang tampak kecil membuka pertanyaan arsitektur: satuan waktu, siapa memegang waktu gerak, bagaimana LLM bisa direplay. Semuanya ditulis di `docs/decisions/` supaya bisa dijelaskan ke murid.
- Determinisme dijaga secara mekanis, bukan janji: lint melarang `Date.now` dan `Math.random` di `core`, `core` tanpa tipe Node, semua jumlah integer (tanpa float), RNG tanpa state.
- Skema memvalidasi bentuk **dan** aturan lintas-field (origin yang boleh, ETA pemasok, `fallback_reason` hanya untuk fallback). Valid belum tentu benar: pengecekan terhadap kondisi dunia dilakukan saat keputusan diterapkan.
- Tooling bisa mengejutkan: TypeScript 7 belum didukung `typescript-eslint`, jadi TypeScript ditahan di 6.0 (lihat keputusan 017). Catat versi dan alasannya.
- Proses: berhenti di gerbang review dokumen sebelum menulis kode yang bergantung padanya mencegah kerja ulang.

---

### Tahap 1: Data dan kasir mock (tanpa 3D)

**Tujuan:** pesanan masuk, stok berkurang sesuai resep, dan event stok tipis muncul. Hanya log di terminal.

**Tugas:**
- [ ] Lapisan data: repositori menu, bahan, stok, pesanan
- [ ] Use case `createOrder`: validasi item ada, hitung kebutuhan bahan
- [ ] Use case `completeCooking` (sementara dipicu manual): kurangi stok dalam satu transaksi
- [ ] Deteksi `stock_low` dan `stock_out` yang **idempoten** (muncul sekali sampai stok diisi ulang)
- [ ] Kebijakan stok kurang: pesanan **ditahan**, bukan hilang
- [ ] **Event-first:** setiap perubahan state = append ke tabel `events` + terapkan proyeksi dalam satu transaksi (tidak ada refaktor di Tahap 2)
- [ ] Kasir mock: API HTTP minimal (`POST /orders`, `GET /menu`, `GET /stock`), tanpa halaman web (nanti dipanggil generator dunia di Tahap 2). Skrip demo membuat pesanan lewat API
- [ ] Log terminal yang rapi per kejadian

**Tes:** hitungan stok per resep, `stock_low` hanya sekali, pesanan ditahan saat stok habis, transaksi atomik.

**Selesai jika:** menjalankan skrip demo menghasilkan urutan log yang benar: pesanan, masak, stok turun, `stock_low`.

**Catatan pelajaran:** aturan vs LLM (belum ada LLM, semua aturan), idempotensi.

---

### Tahap 2: Mesin kejadian, waktu virtual, replay

**Tujuan:** semua kejadian lewat satu jalur yang tercatat, dan satu hari bisa diputar ulang dengan hasil sama.

**Tugas:**
- [ ] Penulis event lengkap (tabel `events` sudah ada sejak Tahap 0, append-only lewat trigger SQLite)
- [ ] Event bus dalam proses (persist-then-publish)
- [ ] `SimClock`: jam virtual (detik), kecepatan, `advance(seconds)` yang memproses semua jadwal yang terlewat secara berurutan
- [ ] Penjadwal event berbasis waktu (buka kafe, `regular_expected`, tutup, dan `agent_think_requested` untuk agent yang menganggur)
- [ ] **Generator dunia** (seeded): pesanan dengan pola jam, komplain karena sebab (pesanan menunggu lama plus peluang acak), undian perilaku pemasok. Semua jadi event berasal `generator` lewat API kasir mock
- [ ] Proyeksi: `replay(events) -> state` (stok, pesanan, laporan) dan **pemulihan saat boot** (bangun ulang proyeksi dan antrean tugas agent dari log)
- [ ] RNG tanpa-state `rand(seed, key)` dan pelarangan `Math.random` / `Date.now` di `core` (aturan lint)

**Tes:** golden test satu hari terskrip; replay sama dengan live; boot ulang dari log menghasilkan state yang sama; seed yang sama menghasilkan event generator yang sama; `advance(1800)` (30 menit) menghasilkan event yang sama berapa pun granularitas tick-nya.

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
- [ ] Putuskan perilaku laporan yang tidak diklik (v1: menunggu). `AutoBoss` (skrip yang menyetujui laporan) hanya dipakai di tes
- [ ] Pemasok tiruan (tepat waktu, telat, kosong; diundi seeded dari bobot di `suppliers_mock`) dan `restock_arrived`
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
- [ ] `createAvatar(role)` mengembalikan objek 3D plus `play(status)`. Kode lain hanya memanggil itu, jadi primitif bisa diganti model `.glb` tanpa mengubah yang lain. Posisi dan arah hadap stasiun jadi data di registry
- [ ] Aturan loncat waktu (`sim_time_advanced`): animasi di-fast-forward atau di-snap ke posisi akhir
- [ ] Kamus i18n (`id` default, bisa diganti lewat config, tanpa library). Nama event, enum, dan ID tetap Inggris
- [ ] Rak stok yang menampilkan jumlah kotak sesuai stok nyata
- [ ] Panel: log kejadian (label Trigger/Aturan/LLM/Inisiatif/Bos), laporan meja bos (Setujui/Tolak ke API), bar stok, panel kontrol waktu (pause, kecepatan, majukan waktu)
- [ ] Kamera yang bisa digeser terbatas
- [ ] Mode "tanpa 3D" (hanya panel) untuk debugging

**Tes:** tes tampilan ringan untuk penerapan event ke state klien (tanpa render); uji manual: satu hari terskrip sama dengan log; refresh halaman memulihkan keadaan.

**Selesai jika:** animasi cocok dengan log, refresh tidak merusak dunia, kontrol waktu berfungsi.

**Catatan pelajaran:** memisahkan logika dan tampilan, kenapa animasi dari event.

---

### Tahap 5: Pelayan dengan memori dan inisiatif (FakeLLM)

**Tujuan:** Rina bertindak atas inisiatif sendiri dan mengingat pelanggan, tanpa model sungguhan.

**Tugas:**
- [ ] Tabel `regulars` dan `memories` serta repositori
- [ ] Pemikiran pelayan dipicu event `agent_think_requested` dari scheduler, hanya saat pelayan menganggur (bukan polling)
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
- [ ] `eval/llm-situations.json` (sekitar 20 situasi) dan skrip evaluasi yang mencetak: persentase JSON valid, persentase aksi benar, latensi. "Aksi benar" untuk `waiter_initiative` = cocok dengan jawaban yang diharapkan; untuk `stock_proposal` = lolos pemeriksaan berbasis aturan (semua bahan yang tipis masuk, qty <= kapasitas, tidak ada bahan nyasar), bukan mencocokkan angka persis
- [ ] Bandingkan 2 sampai 3 model (mulai 4B sampai 9B), pilih yang **terkecil dan masih benar**
- [ ] `OllamaLLM`: parameter `format` (JSON schema), temperature 0, timeout, antrean satu panggilan sekaligus
- [ ] Retry maksimal 2 dengan umpan balik galat validasi, lalu **fallback aturan** dan catat
- [ ] Tabel `llm_calls` (tujuan, ringkasan input, output, valid, latensi, model, fallback)
- [ ] Saklar lewat `.env` (`LLM_PROVIDER=fake|ollama`)
- [ ] Status "mikir..." di tampilan selama menunggu; jam virtual tetap jalan, dan jawaban dicek ulang saat diterapkan (keputusan #10)
- [ ] Terapkan ke `waiter_initiative` dan `stock_proposal`

**Tes:** mock Ollama (JSON rusak, timeout, ID tidak dikenal, enum salah) memicu fallback yang benar; jawaban basi (kondisi berubah saat menunggu) ditolak lalu fallback; tes kontrak schema.

**Selesai jika:** dengan model lokal, kafe tetap jalan; saat model sengaja dirusak, sistem fallback tanpa macet; hasil evaluasi tercatat.

**Catatan pelajaran:** structured output, kenapa valid belum tentu benar, memilih ukuran model.

---

### Tahap 7: Laporan lengkap dan konfigurasi skenario

**Tujuan:** bisa dimainkan orang lain tanpa penjelasan panjang.

**Tugas:**
- [ ] Triase komplain lewat LLM (schema `complaint_triage`) dengan fallback templat
- [ ] Panel kontrol lengkap (pause, kecepatan, majukan waktu) dan **konfigurasi skenario** (seed, keramaian, peluang komplain, stok awal, bobot perilaku pemasok). Tanpa tombol pemicu kejadian manual
- [ ] Halaman tambahan di aplikasi web yang sama, semuanya read-only dari proyeksi yang sudah ada: **Stok** (level, batas, status pesanan belanja; stok hanya berubah lewat alur Setujui laporan), **Menu** (daftar, harga, resep; tanpa bisa memesan), **Laporan** (riwayat semua laporan, plus Setujui/Tolak untuk yang menunggu). Tanpa event baru
- [ ] Tombol reset hari dan muat ulang data seed
- [ ] README quickstart (instal, jalankan, ubah skenario)
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
| 7 | Desain konfigurasi skenario dan pengalaman pengguna |
| 8 | Pengujian, dokumentasi, mengemas jadi kursus |

Jalur murid pemula (dibantu AI coding assistant) bisa memakai tahap 0 sampai 4 sebagai versi "template yang diikuti". Jalur murid yang sudah bisa coding membongkar tahap 2 sampai 6.

## 5. Daftar risiko dan pengaman

| Risiko | Pengaman |
|---|---|
| Model kecil memilih aksi tidak masuk akal | Aksi dibatasi enum, validasi, fallback aturan |
| Bahasa Indonesia model lemah | Struktur dan enum berbahasa Inggris, ucapan mulai dari templat |
| Laptop panas atau lambat | LLM dipanggil jarang, satu panggilan sekaligus, konteks kecil |
| Tampilan menyedot waktu | Tahap 4 setelah logika terbukti, primitif saja |
| Replay tidak deterministik | RNG tanpa-state `rand(seed, key)`, keputusan LLM dicatat sebagai event, larang `Date.now` dan `Math.random` di `core`, golden test |
| Lingkup melebar | Daftar "di luar scope" di brief, tanya sebelum menambah |
