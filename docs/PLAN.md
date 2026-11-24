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

**Pembagian tugas (keputusan 019):** aturan murni (apa yang harus terjadi) ada di `core`, sedangkan `server` membaca state, menulis event, dan menerapkan proyeksi lewat SQL. Proyeksi ditulis oleh satu fungsi `applyEvent`, dipakai juga saat replay.

**Tugas:**
- [x] Aturan murni di `core`: kebutuhan bahan dari resep, durasi masak (jumlah `qty x cook_time_sec` semua item), rencana masak (semua bahan cukup atau tidak sama sekali), sinyal ambang stok
- [x] Event store dan proyeksi di `server`: `appendEvent` (validasi zod, wajib dalam transaksi) dan `applyEvent` (SQL). Event yang proyeksinya belum dibuat dilempar sebagai error
- [x] Use case `createOrder`: validasi item ada, gabungkan baris menu yang sama, alokasi ID, tulis `order_created`
- [x] Use case `startCooking` (dipicu skrip demo, karena karakter baru ada di Tahap 3): cek bahan, lalu `cooking_started` + `stock_decreased` per bahan dalam satu transaksi, atau `order_held` jika bahan kurang
- [x] Use case `completeCooking`: menandai pesanan selesai (`cooking_done`)
- [x] Deteksi `stock_low` dan `stock_out` yang **idempoten** (muncul sekali sampai stok diisi ulang)
- [x] Kebijakan stok kurang: pesanan **ditahan**, bukan hilang
- [x] **Event-first:** setiap perubahan state = append ke tabel `events` + terapkan proyeksi dalam satu transaksi (tidak ada refaktor di Tahap 2)
- [x] Jam sementara `ManualClock` untuk `sim_time` (diganti `SimClock` sungguhan di Tahap 2)
- [x] Rebuild proyeksi dari log (`rebuildProjections`) dan snapshot untuk membandingkan state live dengan hasil replay
- [x] Kasir mock: API HTTP minimal lewat `node:http` (`POST /orders`, `GET /menu`, `GET /stock`), bind ke `127.0.0.1`, tanpa halaman web (nanti dipanggil generator dunia di Tahap 2). Skrip demo membuat pesanan lewat API
- [x] Log terminal yang rapi per kejadian, dengan label sesuai `docs/events.md` bagian 6
- [x] Skrip demo `npm run demo:stage1`

**Ditunda ke Tahap 3:** baris `agents` di proyeksi (posisi awal pelayan belum diputuskan), proyeksi `restock_*`, dan `order_resumed`.

**Tes:** hitungan stok per resep, `stock_low` hanya sekali, pesanan ditahan saat stok habis, transaksi atomik (kegagalan di tengah tidak meninggalkan efek parsial), replay dari log menghasilkan state yang sama dengan state live.

**Selesai jika:** menjalankan skrip demo menghasilkan urutan log yang benar: pesanan, masak, stok turun, `stock_low` (sekali), `stock_out`, `order_held`, dan "Replay check: OK".

**Catatan pelajaran:** aturan vs LLM (belum ada LLM, semua aturan), idempotensi.

Hasil Tahap 1, bahan untuk materi:

- **Aturan vs LLM:** semua keputusan Tahap 1 (masak atau tahan, kapan `stock_low` muncul) adalah aturan murni. Deterministik, murah, dan bisa dites tanpa model. LLM baru nanti menambah titik yang butuh penilaian.
- **Pisahkan "memutuskan" dari "mencatat":** `core` hanya menjawab apa yang harus terjadi (fungsi murni), `server` membaca state dan menuliskan hasilnya (keputusan 019). Aturan jadi gampang dites tanpa database.
- **Idempotensi di dua lapis:** aturan di `core` tidak mengeluarkan `stock_low` dua kali, dan proyeksi juga menolak penanda yang sudah menyala. Satu lapis bisa bocor oleh bug, dua lapis tidak.
- **Atomik:** event dan proyeksinya ditulis dalam satu transaksi, dan memasak itu semua-atau-tidak-sama-sekali. Tanpa transaksi, kegagalan di tengah meninggalkan sisa (contohnya ada di tes).
- **Proyeksi yang curiga:** `applyEvent` menolak event yang bertentangan dengan state (mis. `stock_decreased` yang tidak cocok dengan stok sekarang). Bug ketahuan saat itu juga, bukan berminggu-minggu kemudian.
- **Event-first membuat replay hampir gratis:** satu `applyEvent` dipakai saat live dan saat replay, jadi "Replay check" di demo membuktikan keduanya sama.
- **Persist-then-publish:** log terminal hanya melihat event yang sudah ter-commit.

---

### Tahap 2: Mesin kejadian, waktu virtual, replay

**Tujuan:** semua kejadian lewat satu jalur yang tercatat, dunia berjalan sendiri lewat jam virtual dan generator, dan satu hari bisa diputar ulang dengan hasil sama. Server yang mati lalu nyala melanjutkan dunia dari log.

**Pembagian tugas (keputusan 020 dan 021):** bagian murni "kapan apa terjadi" ada di `core` (`VirtualClock`, jadwal, generator, RNG), sedangkan `server` menjalankan handler-nya. Pacing real-time (kecepatan, pause) ada di `server` dan bukan event.

**Tugas:**
- [x] RNG tanpa state `rand(seed, key)` di `core` (lint sudah melarang `Math.random` dan `Date.now`)
- [x] `VirtualClock`: jam virtual (detik), `advance(seconds)` memproses semua jadwal yang terlewat secara berurutan, hasil sama berapa pun granularitas tick-nya
- [x] Jadwal dan generator dunia (seeded, murni): buka dan tutup kafe, `regular_expected`, pesanan dengan pola jam, komplain `slow_service` (pesanan menunggu lama plus undian per pesanan), undian perilaku pemasok (fungsi murni, dipakai Tahap 3)
- [x] Event bus dalam proses (persist-then-publish); terminal log berlangganan
- [x] Proyeksi `complaint_received`
- [x] Simulasi di `server`: `bootSimulation` (dunia baru, atau **pemulihan saat boot** lewat replay log), handler jadwal dan generator (generator memakai use case `createOrder`, pintu yang sama dengan `POST /orders`), `skipTime` (`sim_time_advanced`), penyimpanan jam di `sim_clock`
- [x] `Pacer`: kecepatan 1 sampai 3600, pause, resume; `tick` bisa dipanggil manual oleh tes
- [x] Kontrol waktu di API: `GET /time` dan `POST /time` (`speed`, `paused`, `advance_seconds`)
- [x] Konfigurasi (`PORT`, `SPEED`, `SEED`, `CROWD_PCT`, `COMPLAINT_CHANCE_PCT`) dan `npm run dev`
- [x] Golden test satu hari dan `npm run demo:stage2` (Replay check dan Restart check)
- [x] `docs/testing.md`: panduan uji manual

**Ditunda ke Tahap 3 dan seterusnya:** timer dinamis (akhir tugas agent), `agent_think_requested` dari scheduler, proyeksi `restock_*`, `regular_arrived` dan `regular_left`. Di Tahap 2 belum ada yang memasak, jadi pesanan dari generator menumpuk berstatus `placed` dan komplain muncul karena itu.

**Tes:** golden test satu hari; replay sama dengan live; boot ulang dari log menghasilkan state yang sama; **restart di tengah hari memberi log identik** dengan jalan sekali jalan; seed yang sama menghasilkan event generator yang sama; `advance(1800)` (30 menit) menghasilkan event yang sama berapa pun granularitas tick-nya.

**Selesai jika:** tes golden dan replay lulus, restart di tengah hari terbukti identik, dan `npm run dev` nyala, merespons `curl`, dan pulih setelah dimatikan.

**Catatan pelajaran:** kenapa event log jadi sumber kebenaran, nilai replay untuk debugging.

Hasil Tahap 2, bahan untuk materi:

- **Waktu sebagai fungsi murni:** "kapan apa terjadi" dihitung dari `(seed, waktu absolut)`, bukan dari state yang diingat. Akibatnya hasil sama berapa pun jam dipecah (`advance(1800)` = 30 kali `advance(60)`) dan aman dihitung ulang setelah restart.
- **RNG tanpa state:** `rand(seed, key)` tidak punya posisi yang harus disimpan. Tiap undian butuh key yang stabil, dan nilai-nilai acuannya dikunci oleh tes supaya algoritma tidak berubah diam-diam.
- **Replay dan pemulihan bukan fitur tambahan:** keduanya memakai jalur yang sama dengan jalur live (`applyEvent`). Karena itu "restart di tengah hari memberi log identik" bisa dibuktikan, dan dibuktikan di delapan titik berbeda (termasuk tepat saat kafe buka dan lintas pergantian hari), bukan satu kasus.
- **Golden file:** log satu hari disimpan di repo. Perubahan aturan jadi diff yang bisa ditinjau, dan algoritma tidak bisa berubah tanpa ketahuan. Golden test terbukti gagal saat satu angka bobot menu diubah.
- **Pacing bukan urusan dunia:** kecepatan dan pause tidak jadi event, dan dihitung dengan bilangan bulat (milidetik virtual) supaya kecepatan rendah tidak kena drift desimal.
- **Seed hidup di log:** seed yang dipakai dunia diambil dari `world_initialized`, bukan dari `.env`. Mengubah `.env` di tengah jalan tidak bisa merusak dunia yang sudah ada.
- **Uji proses nyata menangkap hal yang tidak ditangkap tes otomatis:** Ctrl+C sungguhan, port, dan urutan keluaran di terminal. Uji nyata menemukan baris `world_initialized` yang tampil sebelum banner, dan kolom log yang geser untuk nama event yang panjang.
- **Batas yang disadari:** belum ada yang memasak, jadi pesanan menumpuk dan komplain muncul karena itu. Itu ditulis terang-terangan di panduan uji, bukan disembunyikan.

---

### Tahap 3: Karakter berbasis aturan

**Tujuan:** kasir, koki, dan admin stok bekerja sendiri lewat aturan, dan bos (pemilik) menyetujui atau menolak laporan. Belum ada 3D dan belum ada LLM, tapi keputusan sudah memakai jalur `agent_think_requested` dan `agent_decided` yang nanti dipakai LLM.

**Pembagian tugas (keputusan 022 sampai 024):** `core` memegang aturan murni (rencana tugas, usulan belanja, triase komplain, teks template). `server` memegang mesin agent: satu langkah (item jatuh tempo atau klik bos) ditulis dalam **satu transaksi bersama semua reaksi berantainya**. Akhir tugas agent dan kedatangan pemasok adalah **item dinamis** yang dibaca dari proyeksi.

**Tugas:**
- [x] Aturan murni di `core`: stasiun asal tiap agent, durasi tugas, perencana tugas (`goto` hanya bila perlu, `finalStation`)
- [x] Keputusan aturan di `core`: usulan belanja "isi sampai penuh", triase komplain, teks template Indonesia
- [x] `VirtualClock` dengan item dinamis (akhir tugas agent dan kedatangan pemasok dibaca dari proyeksi, item yang sudah lewat waktunya jatuh tempo sekarang)
- [x] Langkah atomik: `transact` bersarang dan antrean reaksi yang dikuras sebelum commit
- [x] Proyeksi untuk event Tahap 3 (agents, antrean tugas, laporan, pesanan belanja, komplain, pesanan dilanjutkan)
- [x] Mesin agent: peran, stasiun, status (`idle`, `walking`, `working`), antrean tugas; jenis tugas `goto` dan `work` (tanpa `do`); durasi jalan dari tabel jarak; hook sebelum mulai untuk memasak
- [x] Reaksi pesanan: kasir mencatat, koki memasak (stok dikurangi saat tugas memasak dimulai), `cooking_done`
- [x] Reaksi belanja: admin mengecek, usulan "isi sampai penuh", laporan sampai di meja bos (`report_submitted`), keputusan bos (`report_decided` lewat API), pemesanan per bahan, pemasok tiruan (tepat waktu, telat, kosong; diundi seeded dari bobot `suppliers_mock`), `restock_arrived`, pesanan tertahan dilanjutkan FIFO (`order_resumed`)
- [x] Penolakan bos: admin menunggu 1 jam virtual, lalu mengecek lagi dan mengusulkan ulang bila masih tipis
- [x] Alur komplain berbasis aturan (balasan template), lapor ke bos bila butuh kompensasi
- [x] Perilaku laporan yang tidak diklik: menunggu (v1). `AutoBoss` hanya dipakai di tes dan demo
- [x] Event `agent_state_changed` dengan ETA untuk tampilan
- [x] API: `GET /agents`, `GET /orders`, `GET /reports`, `POST /reports/:id/decision`
- [x] Tampilan CLI `npm run watch` yang mencetak status agent dan laporan yang menunggu
- [x] Golden test satu hari dengan `AutoBoss`, `npm run demo:stage3`, panduan uji Tahap 3 di `docs/testing.md`

**Ditunda:** penyebab komplain `wrong_order` dan `quality` (Tahap 3 hanya `slow_service`), status `thinking` (menunggu LLM di Tahap 6), perilaku Rina (Tahap 5).

**Tes:** skenario skrip (pesanan, masak, stok tipis, laporan, setuju, restock), banyak pesanan sekaligus (antre), stok habis menahan pesanan lalu diproses setelah restock, tiga perilaku pemasok, restart di banyak titik memberi log identik.

**Selesai jika:** satu hari terskrip (dengan `AutoBoss`) berjalan penuh hanya lewat log dan tes lulus, dan `npm run dev` nyala dengan bos (lu) bisa menyetujui laporan lewat API.

**Catatan pelajaran:** state machine agent, serah-terima antar karakter.

Hasil Tahap 3, bahan untuk materi:

- **Satu langkah = satu transaksi:** satu kejadian (item jatuh tempo atau klik bos) ditulis bersama **semua reaksi berantainya** dalam satu transaksi, dan baru dipublikasikan setelah commit. Serah-terima antar karakter jadi semua-atau-tidak-sama-sekali: tidak ada "tugas selesai tapi `cooking_done` belum tertulis". Dibuktikan dengan restart di 20 titik berbeda dan tiap 37 menit sepanjang satu hari penuh, hasilnya log identik.
- **Reaksi atas event, bukan callback:** koki "mendengar" `agent_task_finished` untuk tugas memasak, lalu menulis `cooking_done`. Tiap karakter hanya punya peta "event apa memicu apa", dijalankan FIFO, jadi urutannya deterministik dan bisa dibaca dari log.
- **State machine agent yang kecil:** status `idle`, `walking`, `working`, antrean tugas, dan hanya dua jenis tugas (`goto` dan `work`). ETA ditulis di event, jadi tampilan 3D di Tahap 4 cukup menginterpolasi tanpa bertanya apa pun ke server.
- **Timer dinamis dari proyeksi:** akhir tugas dan kedatangan pemasok tidak disimpan di memori, tapi dibaca dari tabel (`agent_tasks`, `restock_orders`) setiap jam bergerak. Karena itu pemulihan setelah restart tidak butuh kode khusus.
- **Hook "sebelum mulai":** stok dicek dan dikurangi saat tugas memasak benar-benar mulai, bukan saat ditugaskan. Pesanan yang antre di belakang baru ditahan ketika gilirannya tiba dan bahannya ternyata kurang. Itu perilaku yang benar, dan yang tadinya terlihat seperti bug di papan pantau.
- **Aturan sebagai fallback LLM:** jalur `agent_think_requested` lalu `agent_decided` sudah dipakai oleh aturan. Di Tahap 6 LLM hanya menggantikan pengambil keputusannya, bukan alurnya.
- **Bos manusia tanpa trigger manual:** satu-satunya masukan adalah Setujui/Tolak. Untuk tes, bos otomatis melihat mejanya tiap menit absolut supaya hasilnya tidak bergantung cara waktu dipotong. Percobaan pertama (cek di awal lompatan) tidak melihat laporan yang muncul di tengah lompatan: bug yang ketahuan saat menjalankan satu hari penuh, bukan di tes kecil.
- **Uji nyata menemukan hal yang tes otomatis tidak:** dunia lama dari Tahap 2 ternyata tidak crash tapi meninggalkan pesanan yatim, dan jalur komplain-ke-bos tidak bisa tercapai dengan pengaturan bawaan (komplain selalu muncul di menit ke-20, jadi kasir selalu menilai ringan). Yang kedua diatasi dengan pengaturan `COMPLAINT_WAIT_MIN`, lalu diuji ulang di server sungguhan dengan waktu digeser (bukan ditunggu).
- **Batas yang disadari:** satu koki kewalahan di jam makan siang (komplain "layanan lambat" muncul, itu bahan pelajaran tentang bottleneck), laporan yang tidak diklik menahan belanja, teks laporan dan balasan masih template, dan hanya komplain `slow_service`.

---

### Tahap 4: Tampilan 3D (hanya membaca event)

**Tujuan:** apa yang terjadi di log tampil sebagai animasi. Tampilan tidak membuat keputusan.

**Tugas:**
- [x] WebSocket server: kirim snapshot state saat klien terhubung, lalu aliran event
- [x] Klien `web`: penyimpan state yang menerapkan event; resync dari snapshot saat reconnect
- [x] Scene Three.js dari primitif, mengikuti tata letak di `docs/reference/` (boleh disesuaikan)
- [x] Registri stasiun: ID stasiun ke koordinat 3D (hanya di frontend)
- [x] Entitas agent: status ke animasi (jalan: interpolasi antar stasiun sesuai ETA; kerja: label dan gerak kecil; diam)
- [x] Label karakter dan stasiun (proyeksi 3D ke layar)
- [x] `createAvatar(role)` mengembalikan objek 3D plus `play(status)`. Kode lain hanya memanggil itu, jadi primitif bisa diganti model `.glb` tanpa mengubah yang lain. Posisi dan arah hadap stasiun jadi data di registry
- [x] Aturan loncat waktu (`sim_time_advanced`): animasi di-fast-forward atau di-snap ke posisi akhir
- [ ] Kamus i18n (`id` default, bisa diganti lewat config, tanpa library). Nama event, enum, dan ID tetap Inggris
- [x] Rak stok yang menampilkan jumlah kotak sesuai stok nyata
- [x] Panel: log kejadian (label Trigger/Aturan/LLM/Inisiatif/Bos), laporan meja bos (Setujui/Tolak ke API), bar stok, panel kontrol waktu (pause, kecepatan, majukan waktu)
- [x] Kamera yang bisa digeser terbatas
- [x] Mode "tanpa 3D" (hanya panel) untuk debugging

**Tes:** tes tampilan ringan untuk penerapan event ke state klien (tanpa render); uji manual: satu hari terskrip sama dengan log; refresh halaman memulihkan keadaan.

**Selesai jika:** animasi cocok dengan log, refresh tidak merusak dunia, kontrol waktu berfungsi.

**Catatan pelajaran:** memisahkan logika dan tampilan, kenapa animasi dari event.

Hasil Tahap 4, bahan untuk materi:

- **Adegan adalah fungsi dari (state, waktu)**: posisi karakter dihitung tiap frame, tidak ada antrean animasi. Loncat waktu, jeda, ganti kecepatan, dan refresh benar tanpa kode khusus, dan tes bisa memeriksa jalan di awal, tengah, akhir, dan setelah loncat tanpa browser.
- **Snapshot lalu aliran, tanpa celah**: server satu utas, jadi snapshot dan pendaftaran klien terjadi di putaran yang sama. `last_event_id` membuat klien membuang event yang sudah ada. Tes silang membuktikan state halaman sama dengan snapshot server di 1238 titik sehari penuh, dan sengaja merusak satu aturan membuktikan tes itu benar-benar gagal.
- **Memisahkan logika dari tampilan**: view model panel, state, posisi, dan pencari jalur murni dan dites di Node. DOM dan Three.js lapisan tipis, dan DOM palsu kecil menguji sambungannya tanpa jsdom.
- **Uji pemilik menemukan yang tidak ditemukan tes**: pelanggan tidak ada (celah rencana, bukan bug), "interaksi" tidak terlihat karena tugas kasir kurang dari 1 detik asli di 60x, dan tampilan balok tidak menarik. Mata untuk cek visual (Chrome sementara) membuat poles tampilan jadi cepat.
- **Denah mengikuti domain**: kasir ke ruang bos tadinya 2,5 kali lebih panjang dari tabel jarak (karakter akan ngebut). Denah disusun ulang (ruang bos di sebelah kasir) sampai rasionya 0,78 sampai 0,92, dan pencari jalur membuat mereka mengitari meja dan lewat pintu.
- **Tes menemukan masalah framing** di kamera awal (titik serah kepotong di sudut putar), jadi kamera dicari dengan menghitung terhadap titik-titik penting, bukan ditebak.
- **Batas yang disadari**: karakter bergaya game (bukan foto), hanya bahasa Indonesia (struktur kamus ada, pemilih bahasa belum), empat dari tujuh meja belum bagian dari domain, dan tampilan 3D sendiri hanya dinilai lewat screenshot dan mata pemilik.

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
