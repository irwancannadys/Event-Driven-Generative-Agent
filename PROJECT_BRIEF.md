# Proyek: Kafe Virtual dengan Agent AI (Event-Driven + Generative Agent)

> Dokumen ini adalah konteks lengkap proyek. Baca seluruhnya sebelum bertanya atau menulis kode.
> Pemilik proyek sudah menjelaskan ini panjang lebar dan tidak mau mengulang dari awal.
> Penjelasan ke pemilik: bahasa Indonesia santai. Kode, nama variabel, dan commit message: bahasa Inggris.
> **Revisi 2026-11-24 (review Tahap 0, disetujui pemilik):** dunia berjalan otomatis lewat generator (tanpa tombol pemicu manual), keputusan LLM dicatat sebagai event, dunia pulih dari event log saat boot, dan tabel data dibagi jadi referensi, event log, proyeksi, operasional. Alasan lengkap ada di `docs/decisions/` dan riwayat git.

## 0. Dokumen pendamping (baca setelah brief ini)

| File | Isi | Sifat |
|---|---|---|
| `PROJECT_BRIEF.md` (dokumen ini) | Apa, kenapa, prinsip desain, scope | Stabil. Perubahan harus disetujui pemilik |
| `docs/PLAN.md` | Rencana kerja detail Tahap 0 sampai 8: tugas, tes, kriteria selesai, keputusan arsitektur awal | **Referensi hidup.** Boleh diusulkan perubahannya di Tahap 0, tapi harus disetujui pemilik |
| `docs/reference/README.md` | Penjelasan prototipe visual, tata letak, apa yang boleh diambil dan apa yang jangan ditiru | Referensi |
| `docs/reference/cafe-prototype-v2.html` | Prototipe 3D mandiri (buka di browser) sebagai **gambaran** animasi dan panel | Hanya referensi visual. Pemilik akan menyesuaikan animasinya nanti |

Jika brief dan plan berbenturan, **brief menang**. Tanyakan ke pemilik.

---

## 1. Ringkasan satu paragraf

Membangun simulasi **kafe 3D di browser (Three.js)**. Karakter AI bekerja sebagai pegawai (kasir, koki, admin stok, pelayan). Pemilik proyek berperan sebagai **bos** yang hanya memantau lewat animasi dan menyetujui atau menolak laporan di meja bos. Animasi **lahir dari kejadian nyata** (pesanan masuk, stok menipis, komplain, pelanggan langganan datang), bukan dari skrip. Sebagian keputusan dibuat oleh **LLM lokal**, dan satu karakter (pelayan) punya **memori, inisiatif, dan refleksi**. Semua berjalan **lokal dan gratis** di MacBook Pro M5 24 GB.

## 2. Siapa pemilik dan apa tujuannya

**Pemilik:** Cannadys, Senior Software Engineer (9+ tahun, fokus mobile Android/iOS plus backend, familiar dengan Node.js/TypeScript dan Go), berbasis di Jakarta. Level teknis tinggi, tapi belajar generative agent dan simulasi 3D lewat proyek ini.

**Tujuan jangka pendek:** membangun sendiri sampai berjalan, supaya paham dari dalam.

**Tujuan jangka panjang:** hasilnya menjadi bahan **kursus** (bukan produk untuk dijual) tentang generative agents dengan visual 3D.
- Target murid ada dua: orang yang belum bisa coding (dibantu AI coding assistant) dan orang yang sudah bisa coding (bongkar logika agent dan backend).
- 3D dipilih karena menarik secara visual dan membuat konsep abstrak kelihatan.
- Hasilnya harus terasa berguna di dunia nyata, bukan sekadar gimmick.
- Rencana kursus: tiga proyek berurutan dari mudah ke sulit: **asisten karier** (1 karakter), **kafe** (beberapa karakter dengan memori dan inisiatif), **gudang dan toko online** (banyak karakter, antrean, bottleneck). Proyek yang dikerjakan sekarang adalah **kafe**.

**Bukan tujuan:**
- Menjual produk.
- Memprediksi perilaku manusia secara akurat. Hasil simulasi LLM adalah bahan diskusi, bukan ramalan.
- Integrasi API nyata. Semua data dan alat adalah tiruan buatan sendiri.

## 3. Konsep inti (hasil diskusi panjang)

### 3.1 Bos memantau, pegawai AI bekerja
Pemilik membuka halaman web dan melihat ruangan kafe 3D. Dia melihat karakter sedang di stasiun mana (di kasir, di kompor, di rak stok). Beberapa kali sehari, karakter berjalan ke **meja bos** untuk menyerahkan laporan. Laporan itu ditampilkan sebagai output, dan bos bisa **Setujui** atau **Tolak**. Hal yang sensitif (belanja stok, kompensasi komplain) berhenti di meja bos sampai disetujui.

### 3.2 Pola alur

```
Trigger -> Antrean event -> Agent memutuskan -> Animasi 3D dari status agent -> Laporan ke bos
          (dicatat urut)   (aturan atau LLM)
```

Contoh: pesanan masuk (trigger) -> tugas ke koki -> koki memasak (aturan) -> stok berkurang -> stok di bawah batas -> admin stok menyusun usulan belanja (LLM) -> admin berjalan ke meja bos -> bos menyetujui -> admin memperbarui stok.

### 3.3 Empat jenis trigger
1. **Data masuk:** pesanan baru lewat API kasir mock (`POST /orders`), dipanggil oleh generator dunia.
2. **Jadwal:** jam buka, jam pelanggan langganan biasa datang, rekap sore.
3. **Ambang kondisi:** stok di bawah batas minimum, antrean panjang.
4. **Generator dunia (otomatis):** pelanggan virtual yang memakai seeded RNG. Pesanan datang dengan pola jam (ramai di jam makan siang), komplain muncul karena sebab (pesanan menunggu terlalu lama, plus peluang acak), perilaku pemasok diundi dari bobot peluang. **Tidak ada tombol pemicu manual.** Masukan manusia hanya keputusan bos (Setujui/Tolak) dan kontrol waktu (pause, kecepatan, majukan waktu).

### 3.4 Event-driven vs generative agent (dan cara menggabungkannya)

| | Event-driven | Generative agent |
|---|---|---|
| Soal apa | Apa yang memicu sistem bergerak (arsitektur) | Bagaimana karakter memutuskan dan mengingat (kecerdasan) |
| Keputusan | Aturan eksplisit | LLM berdasarkan memori dan kepribadian |
| Perilaku | Bisa diprediksi dan diuji | Bisa muncul hal tak terduga |
| Biaya | Murah | Lebih mahal (panggilan LLM) |

Keduanya **bukan lawan**. Rancangan proyek ini: **event-driven menjadi tulang punggung** (event log, antrean, animasi), **generative agent menjadi otak di titik keputusan** (memori, inisiatif, refleksi). Mayoritas langkah cukup aturan biasa. LLM hanya dipakai di titik yang butuh penilaian.

## 4. Prinsip desain (wajib diikuti)

1. **Animasi adalah hasil dari event log, bukan dari skrip.** Karakter bergerak karena ada event di antrean. Keadaan dunia bisa dibangun ulang dari log (replay).
2. **State hidup di server.** Frontend 3D hanya presentasi. Tab ditutup lalu dibuka lagi, dunia tetap konsisten.
3. **Event log adalah sumber kebenaran.** Semua kejadian dan keputusan dicatat di tabel `events`.
4. **Waktu virtual.** Jangan pakai jam asli. Jam simulasi bisa dipercepat dan dimajukan, jadi satu hari bisa diuji dalam hitungan detik.
5. **LLM di balik satu interface, dua implementasi:** `FakeLLM` (jawaban deterministik, dibuat manual) dan `OllamaLLM` (model lokal). Tahap 1 sampai 5 berjalan tanpa model apa pun.
6. **Aksi LLM dibatasi ke daftar kecil (enum)** dan outputnya divalidasi dengan schema sebelum dijalankan. Output yang tidak valid atau tidak masuk akal ditolak.
7. **Fallback ke aturan.** Jika output LLM ditolak setelah retry terbatas (maksimal 2), sistem jalan pakai aturan biasa dan mencatatnya di log. Dunia kafe tidak boleh macet gara-gara model.
8. **LLM dipanggil jarang.** Hanya saat ada keputusan nyata (misalnya pelayan sedang menganggur). Satu panggilan pada satu waktu (antre), temperature rendah (0), konteks kecil.
9. **Memori di database, bukan di prompt.** Kunjungan, preferensi, dan refleksi disimpan di tabel. Ke LLM hanya dikirim ringkasan beberapa baris.
10. **Pisahkan logika dan tampilan.** Model 3D bisa diganti tanpa menyentuh otak agent.
11. **Semua panggilan LLM dicatat** (input ringkas, output, latensi, valid atau tidak) untuk debugging dan replay.
12. **Keputusan LLM dicatat sebagai event** (`agent_decided`). Replay membaca keputusan dari log dan tidak memanggil model lagi. Jam virtual tetap berjalan saat LLM berpikir (agent berstatus "mikir..."), dan jawaban dicek ulang saat diterapkan: jawaban basi atau tidak masuk akal ditolak lalu fallback ke aturan.
13. **Dunia pulih dari event log saat server boot.** Server dimatikan lalu dinyalakan lagi, dunia lanjut dari titik terakhir (proyeksi dan antrean tugas agent dibangun ulang lewat replay).

## 5. Scope versi 1 (kafe)

**Satu kafe**, jam buka 08:00 sampai 20:00 (waktu virtual).

**Karakter (4 pegawai + bos):**

| Karakter | Stasiun | Tugas |
|---|---|---|
| Kasir | Meja kasir | Mencatat pesanan, menerima komplain, membalas pelanggan setelah bos menyetujui |
| Koki | Dapur (kompor) | Memasak pesanan, mengurangi stok bahan |
| Admin stok | Rak stok | Mengecek stok, menyusun usulan belanja, memperbarui stok |
| Pelayan (Rina) | Area meja pelanggan | Menyapa, mencatat, menyiapkan meja. **Punya memori, inisiatif, refleksi** |
| Bos (pemilik) | Meja bos | Memantau, menyetujui atau menolak laporan. Tidak dikendalikan AI |

> Catatan 2026-11-24: atas permintaan pemilik, peran Pelayan (Rina) dan pelanggan langganan tidak dipakai di v1; perilaku generatif (ingatan, inisiatif, refleksi) dipindah ke Admin Stok. Lihat `docs/decisions/034-stock-admin-is-the-generative-agent.md`.

**Menu:** 5 sampai 6 item sederhana, masing-masing punya resep (bahan dan jumlah per porsi) dan waktu masak.

**Stok:** tabel bahan dengan jumlah, satuan, batas minimum, dan lead time pemesanan. Pemasok tiruan yang responsnya diundi seeded dari bobot peluang (tepat waktu, telat, kosong), dan bobotnya bisa diatur lewat konfigurasi skenario.

**Pelanggan langganan (data awal, boleh disesuaikan):**

| Nama | Biasa datang | Meja | Pesanan biasa | Kunjungan awal |
|---|---|---|---|---|
| Pak Budi | 08:30 | 1 | kopi susu kurang gula | 3 |
| Bu Sari | 12:00 | 2 | nasi goreng tanpa pedas | 2 |
| Mas Joko | 17:00 | 3 | es teh manis dan roti bakar | 1 |

**Kasir mock:** API `POST /orders` tanpa halaman web, dipanggil generator dunia lewat pintu yang sama seperti POS sungguhan.

**Panel kontrol:** pause, kecepatan waktu, majukan waktu, dan meja bos (Setujui/Tolak). Tidak ada tombol pemicu kejadian manual. Murid kursus mengubah **konfigurasi skenario** (seed, keramaian, peluang komplain, stok awal, bobot perilaku pemasok), bukan mengklik tombol.

## 6. Perilaku khusus pelayan (generative agent)

Ini bagian yang membedakan dari agent berbasis aturan biasa.

> Catatan 2026-11-24: bagian ini dipindah ke Admin Stok (prakiraan belanja, review malam, ingatan, refleksi). Lihat keputusan 034.

- **Memori:** per pelanggan langganan, tersimpan jam datang yang biasa, meja favorit, pesanan biasa, jumlah kunjungan, dan catatan refleksi.
- **Inisiatif (tanpa trigger):**
  - Sekitar 25 menit sebelum jam datang biasa pelanggan langganan, jika pelayan sedang menganggur, ia memutuskan untuk **menyiapkan meja**.
  - Jika kafe sepi dan sudah lewat sekitar 45 menit virtual sejak terakhir, ia memutuskan untuk **merapikan meja**.
- **Sapaan:** saat pelanggan langganan datang, pelayan menyapa dengan nama dan menyebut pesanan biasanya. Jika meja belum siap, ia menyiapkannya sambil menyapa.
- **Refleksi:** setelah pelanggan pergi, jika kunjungan >= 4 dan belum ada catatan, pelayan membuat refleksi (misalnya "pelanggan tetap, datang sekitar 08:30, biasanya pesan X") dan menyimpannya.
- **Keputusan inisiatif dibuat oleh LLM** (dengan `FakeLLM` pada awal). Aksi yang diizinkan: `prepare_table`, `tidy_table`, `idle`.

## 7. Titik keputusan: aturan vs LLM

> Catatan 2026-11-24: titik LLM menjadi usulan belanja, review kebijakan malam (`policy_review`), dan kategori komplain. Inisiatif pelayan jatuh (keputusan 034).

| Keputusan | Pembuat | Catatan |
|---|---|---|
| Pesanan diteruskan ke dapur, stok dikurangi | Aturan | Deterministik |
| Event stok tipis muncul | Aturan | Berdasarkan ambang |
| Usulan belanja (jumlah dan prioritas) | LLM | Output divalidasi, fallback ke aturan "pesan sampai penuh" |
| Kategori komplain dan draf balasan | LLM | Keputusan kompensasi tetap di tangan bos |
| Inisiatif pelayan (siapkan atau rapikan meja) | LLM | Fallback: aturan jam |
| Teks sapaan dan refleksi | LLM (atau template di awal) | Boleh template dulu agar bahasa Indonesia aman |

### Kontrak output LLM (usulan schema, finalkan di Tahap 0)

```jsonc
// waiter_initiative
{ "action": "prepare_table" | "tidy_table" | "idle",
  "table_id": 1 | 2 | 3,          // wajib untuk prepare_table dan tidy_table
  "regular_id": "string",         // opsional, untuk prepare_table
  "reason": "string (maks 140 karakter)" }

// stock_proposal
{ "items": [ { "ingredient_id": "string", "qty": number } ],
  "urgency": "low" | "normal" | "high",
  "rationale": "string (maks 200 karakter)" }

// complaint_triage
{ "category": "slow_service" | "wrong_order" | "quality" | "other",
  "severity": 1 | 2 | 3,
  "draft_reply": "string",
  "suggested_compensation": "none" | "discount_10" | "free_item",
  "needs_boss_decision": true | false }

// greeting_or_reflection
{ "text": "string (maks 200 karakter)" }
```

Aturan validasi: tolak ID yang tidak dikenal, nilai di luar enum, qty negatif atau tidak masuk akal, dan teks melebihi panjang. Gunakan JSON schema constrained output dari Ollama (parameter `format`) bila tersedia, **ditambah** validasi di sisi aplikasi (misalnya zod). Output valid belum tentu benar.

Catatan bahasa: model kecil bisa lebih lemah berbahasa Indonesia. Struktur dan enum memakai bahasa Inggris. Teks ucapan dimulai dari template, lalu baru dicoba teks bebas dari model dan dievaluasi.

## 8. Arsitektur

```
 Panel kontrol + meja bos (web)
            |
            v
   +----------------+       +---------------------+
   |  Server (Node) | <---> |  SQLite             |
   |  - API kasir   |       |  events, orders,    |
   |  - Event bus   |       |  stock, memories,   |
   |  - Sim clock   |       |  reports, llm_calls |
   |  - World gen.  |       +---------------------+
   |  - Agent loop  |
   |  - LLM adapter | ---> FakeLLM | OllamaLLM (localhost)
   +-------+--------+
           | WebSocket (event stream + snapshot state)
           v
   Frontend (Vite + Three.js)
   - Scene 3D (membaca event, tidak memutuskan apa pun)
   - Panel: log kejadian, ingatan Rina, laporan bos, stok
```

## 9. Model data (usulan awal, finalkan di Tahap 0)

Tabel dibagi empat golongan: **referensi** (statis, diisi seed), **event log** (sumber kebenaran), **proyeksi** (turunan event, bisa dibangun ulang lewat replay, ditulis dalam transaksi yang sama dengan event), dan **operasional** (jejak debugging). Semua waktu simulasi dalam **detik virtual**. Detail final ada di `docs/schema.md`.

Referensi:
- `menu_items` (id, name, price, cook_time_sec)
- `ingredients` (id, name, unit, min_qty, capacity_qty, lead_time_min)
- `recipe_items` (menu_item_id, ingredient_id, qty_per_portion)
- `regulars` (id, name, usual_time_min, favorite_table, usual_order)
- `suppliers_mock` (ingredient_id, weight_on_time, weight_late, weight_out)

Event log:
- `events` (id, type, sim_time, actor, origin, payload_json, created_at) **sumber kebenaran**, append-only. `origin`: generator, scheduler, rule, llm, fallback, boss, system

Proyeksi:
- `stock` (ingredient_id, qty)
- `orders` (id, status, created_at_sim, source) dan `order_items`
- `agents` (id, role, station, state)
- `agent_tasks` (id, agent_id, kind, params_json, status, ends_at_sim)
- `regular_state` (regular_id, visits, present)
- `memories` (id, agent_id, regular_id, kind, text, sim_time) kind: observation, reflection (satu-satunya tempat refleksi)
- `reports` (id, type, title, body, status, created_at_sim, decided_at_sim)
- `sim_clock` (current_sim_sec, speed)

Operasional:
- `llm_calls` (id, purpose, input_summary, output_json, valid, latency_ms, model, fallback_used)

## 10. Katalog event (awal)

> Katalog final (33 event) ada di `docs/events.md`, dan itulah yang berlaku. Tabel di bawah ini versi awal.

| Event | Pemicu | Penangan | Aturan/LLM |
|---|---|---|---|
| `order_created` | Generator dunia lewat API kasir mock | Kasir lalu koki | Aturan |
| `cooking_started` / `cooking_done` | Koki | Koki | Aturan |
| `stock_decreased` | Masakan selesai | Sistem stok | Aturan |
| `stock_low` / `stock_out` | Ambang tercapai | Admin stok | Aturan |
| `restock_proposed` | Admin stok | Meja bos | LLM |
| `report_submitted` | Karakter tiba di meja bos | Bos | Aturan |
| `report_decided` | Klik bos | Karakter terkait | Aturan |
| `restock_arrived` | Pemasok tiruan | Admin stok | Aturan |
| `complaint_received` | Generator dunia | Kasir | Aturan |
| `complaint_triaged` | Kasir | Meja bos | LLM |
| `regular_expected` | Jam virtual mendekati kebiasaan | Pelayan | Aturan (pemicu pemikiran) |
| `table_prepared` | Pelayan (inisiatif) | Tampilan | LLM |
| `table_tidied` | Pelayan (inisiatif) | Tampilan | LLM |
| `regular_arrived` | Jadwal | Pelayan | Aturan |
| `regular_greeted` | Pelayan | Tampilan | LLM atau template |
| `regular_left` | Pelanggan selesai | Pelayan | Aturan |
| `reflection_created` | Setelah kunjungan | Memori | LLM atau template |
| `sim_time_advanced` | Bos (loncat waktu) | Semua | Aturan |
| `agent_state_changed` | Agent | Tampilan | Aturan |

Setiap event minimal punya: id, tipe, waktu virtual, pelaku, dan payload.

## 11. Tampilan 3D

- Three.js di browser (Vite). **Bentuk primitif saja** (kotak, silinder, kapsul), tanpa model 3D rumit di awal. Fokus pada agent, bukan modeling.
  - Catatan 2026-11-24: atas permintaan pemilik, tampilan boleh lebih kaya dari primitif sederhana (kafe potong dengan material, cahaya, karakter berbadan lengkap). Lihat `docs/decisions/030-cutaway-cafe-and-visual-direction.md`.
- Karakter punya tiga status yang terlihat: **diam, berjalan, bekerja** (dengan label aktivitas).
- Label di atas karakter dan stasiun (diproyeksikan dari posisi 3D).
- Kamera dari atas-depan, bisa digeser terbatas.
- Panel di bawah scene: **log kejadian** (dengan label Trigger, Aturan, LLM, Inisiatif, Bos), **ingatan Rina**, **laporan di meja bos** (tombol Setujui/Tolak), **bar stok**, dan **panel kontrol waktu** (pause, kecepatan, majukan waktu).
- Rak stok di scene menampilkan jumlah kotak sesuai stok sebenarnya (visual dari state nyata, bukan dekorasi).
- Halaman tambahan (Tahap 7) di aplikasi web yang sama: **Stok**, **Menu**, dan **Laporan**. Semuanya read-only dari proyeksi yang ada, kecuali Setujui/Tolak di Laporan. Tidak ada tombol edit stok manual dan tidak ada halaman pemesanan.

**Tata letak referensi** (satuan Three.js, dari prototipe awal): meja kasir kiri belakang, dapur kanan belakang, rak stok kanan depan, meja bos kiri depan, tiga meja pelanggan di tengah, antrean pelanggan di sisi kiri. Koordinat lengkap dan prototipe yang bisa dibuka ada di `docs/reference/` (lihat `README.md` di sana, termasuk daftar apa yang **jangan** ditiru). Pemilik akan menyesuaikan animasinya nanti, jadi anggap ini gambaran, bukan spesifikasi final.

## 12. Batasan lingkungan

- **Lokal dan gratis.** Tidak ada API berbayar, tidak ada layanan cloud. Data semua buatan sendiri.
- **Mesin:** MacBook Pro M5, RAM 24 GB, penyimpanan 1 TB, macOS terbaru (di atas 26.2).
- **LLM lokal lewat Ollama.** Versi terbaru Ollama memakai MLX di Apple Silicon (preview, memanfaatkan Neural Accelerators di M5). Rekomendasi resminya Mac dengan memori lebih dari 32 GB, tapi ada laporan bisa jalan di 24 GB. Coba dulu, jika bermasalah pakai runner biasa.
- **Ukuran model realistis:** 4B sampai 9B untuk awal, 14B bila perlu, MoE 30B 4-bit mungkin muat (di bawah sekitar 18 GB) tapi mepet. Hindari dense 30B ke atas.
- Konteks dibuat kecil. Satu panggilan LLM pada satu waktu. Tutup aplikasi berat saat benchmark. Colok charger saat tes model.

### Evaluasi model (Tahap 6)
Siapkan sekitar 20 situasi uji (misalnya "Pak Budi biasanya datang 08:30, sekarang 08:10, pelayan menganggur") di `eval/llm-situations.json`. Jalankan ke 2 sampai 3 model. Ukur: persentase JSON valid, persentase aksi benar, latensi. Pilih model **terkecil** yang masih benar. Kandidat awal (cek ketersediaan terkini di library Ollama): keluarga Qwen 3.5 (4B dan 9B) dan Gemma 4 (varian 4B).

## 13. Stack (usulan, boleh dibahas di Tahap 0)

- **Bahasa:** TypeScript strict, ESM (Node LTS) di server dan frontend, supaya satu bahasa. `tsx` untuk menjalankan TS saat dev.
- **Package manager:** npm dengan workspaces.
- **Database:** SQLite lewat `better-sqlite3` (sinkron, satu proses).
- **Realtime:** WebSocket.
- **Frontend:** Vite + Three.js.
- **Validasi:** zod (skema event dan output LLM; tipe TS diturunkan dari skema).
- **Tes:** Vitest.
- **Lint dan format:** ESLint + Prettier. Aturan lint melarang `Date.now` dan `Math.random` di `core`.
- **LLM:** Ollama lokal di balik interface `LLMClient`.

Struktur repo:

```
Event-Driven-Generative-Agent/
  CLAUDE.md             # aturan kerja ringkas + pointer ke brief
  PROJECT_BRIEF.md      # dokumen ini
  packages/
    core/               # domain murni: event, agent, aturan, sim clock (tanpa I/O)
    server/             # Node: SQLite, WebSocket, API kasir mock, generator dunia, LLM adapter
    web/                # Vite + Three.js: scene 3D dan panel
  docs/
    PLAN.md
    concept.md          # konsep satu halaman
    events.md
    schema.md
    decisions/          # catatan keputusan singkat
    reference/          # prototipe visual
  data/                 # file SQLite lokal (tidak di-commit)
  eval/                 # dibuat di Tahap 6
    llm-situations.json
```

## 14. Tahapan dan kriteria selesai

> Ini ringkasannya. Tugas per tahap, strategi tes, keputusan arsitektur awal, dan peta ke bahan kursus ada di **`docs/PLAN.md`**.

| Tahap | Dikerjakan | Selesai jika |
|---|---|---|
| 0 | Persiapan: struktur repo, konsep satu halaman, daftar event final, skema database | Dokumen events dan schema disetujui pemilik, skeleton repo berjalan |
| 1 | Data dan kasir mock (menu, resep, stok), tanpa 3D, hanya log di terminal | Pesanan masuk, stok berkurang, `stock_low` muncul |
| 2 | Mesin kejadian: tabel event, jam virtual, replay, generator dunia | Satu hari simulasi bisa diputar ulang dengan hasil sama (ada tes) |
| 3 | Karakter berbasis aturan (kasir, koki, admin stok) | Mereka bekerja lewat status dan antrean tugas, terlihat di log |
| 4 | Tampilan 3D yang hanya membaca event | Animasi cocok dengan log, panel dan kontrol waktu berfungsi |
| 5 | Pelayan dengan memori dan inisiatif, pakai `FakeLLM` | Meja disiapkan tepat waktu, sapaan menyebut pesanan biasa, refleksi tercatat |
| 6 | Ganti ke LLM lokal di dua titik (inisiatif pelayan dan usulan belanja) | Output tervalidasi, bisa ditolak, fallback ke aturan terbukti lewat tes |
| 7 | Laporan ke meja bos dan konfigurasi skenario lengkap | Bisa dimainkan orang lain tanpa penjelasan panjang |
| 8 | Pengujian dan pemolesan: tes skenario satu hari, dokumentasi, catatan bagian sulit | Siap diubah menjadi bahan kursus |

**Aturan urutan:** jangan mulai dari 3D. Tahap 1 sampai 3 sudah membuktikan "otak" berjalan hanya lewat log. Tahap berikutnya hanya dimulai setelah pemilik bilang lanjut.

**Definisi selesai versi 1:** satu perintah menjalankan semuanya di lokal, dunia berjalan otomatis lewat generator, kontrol waktu dan keputusan bos berfungsi, tampilan 3D sesuai log, replay deterministik, pelayan bertindak atas inisiatif sendiri, LLM lokal terpasang di dua titik dengan fallback, tes lulus.

## 15. Aturan kerja untuk Claude Code

1. Baca brief ini dulu. Jangan minta pemilik menjelaskan ulang hal yang sudah ada di sini.
2. Kerjakan **satu tahap pada satu waktu**. Minta persetujuan sebelum pindah tahap.
3. Gunakan plan mode untuk perubahan besar. Tanyakan sebelum membuat asumsi besar.
4. Pemilik sedang **belajar**. Jelaskan alasan pilihan teknis secara singkat, jangan hanya menyerahkan kode.
5. Commit kecil dan sering. Tulis tes untuk logika inti (aturan, replay, validasi LLM).
6. **Jangan menambah fitur atau dependency di luar brief** tanpa bertanya. Tidak ada dependency berbayar atau layanan cloud.
7. Jangan menyentuh 3D atau LLM sebelum tahapnya tiba.
8. Catat keputusan penting di `docs/decisions/` dalam beberapa baris.
9. Jujur soal ketidakpastian: model lokal kecil bisa salah, hasil simulasi bukan prediksi.

## 16. Di luar scope (v1)

- Model 3D rumit atau animasi tulang (bisa jadi bonus setelah v1).
- Banyak kafe, multi-pengguna, login, atau deployment online.
- Integrasi API nyata (kasir, pembayaran, media sosial).
- Pelatihan atau fine-tuning model.
- Proyek asisten karier dan gudang (itu tahap kursus berikutnya).

## 17. Risiko dan catatan jujur

- Model lokal kecil bisa memilih aksi yang tidak masuk akal walau JSON-nya valid. Karena itu aksi dibatasi, divalidasi, dan ada fallback.
- Bahasa Indonesia pada model kecil bisa lemah. Mulai dari template untuk ucapan.
- Pemanggilan LLM yang terlalu sering membuat laptop panas dan lambat. Panggil hanya saat keputusan nyata.
- Tahap 3D paling memakan waktu. Tahan godaan memolesnya sebelum logika terbukti.
- Hasil simulasi adalah bahan diskusi, bukan ramalan. Jangan dijanjikan sebaliknya di kursus.

## 18. Pertanyaan terbuka: sudah dijawab pemilik (2026-11-24)

1. **Package manager:** npm.
2. **Struktur:** monorepo dengan npm workspaces (`packages/core`, `packages/server`, `packages/web`).
3. **Bahasa UI:** Indonesia, bisa diganti lewat config (kamus per bahasa, tanpa library). Nama event, enum, dan ID tetap Inggris.
4. **Simulator v1:** tanpa tombol pemicu kejadian. Hanya kontrol waktu (pause, kecepatan, majukan waktu) dan keputusan bos (Setujui/Tolak). Skenario diatur lewat konfigurasi.
5. **Mode "tanpa 3D":** ada (hanya log dan panel), untuk debugging dan demo.
6. **Gaya visual:** 3D primitif dengan warna per peran dan label seperti prototipe, dibuat lewat `createAvatar(role)` supaya bisa di-upgrade ke model `.glb` nanti tanpa mengubah kode lain.

## 19. Glosarium singkat

- **Event-driven:** sistem bergerak karena ada kejadian yang memicu, bukan karena skrip waktu.
- **Generative agent:** karakter dengan memori, refleksi, dan perencanaan yang keputusannya dibuat LLM.
- **Event log:** catatan berurutan semua kejadian, sumber kebenaran dunia simulasi.
- **Replay:** membangun ulang keadaan dunia dengan memutar ulang event log.
- **Fallback:** jalur aturan biasa yang dipakai ketika output LLM ditolak.
- **Waktu virtual:** jam simulasi yang bisa dipercepat dan dimajukan.
