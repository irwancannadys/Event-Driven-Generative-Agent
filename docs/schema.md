# Skema database (final, menunggu persetujuan pemilik)

SQLite lewat `better-sqlite3`. Migrasi awal: `0001_init.sql` (Langkah 10). Daftar event yang menggerakkan tabel-tabel ini ada di [`events.md`](events.md). Keputusan terkait: [`decisions/`](decisions/), terutama 009, 011, dan 012.

## 1. Konvensi

- **Waktu simulasi:** kolom berakhiran `_sim` atau bernama `sim_time` adalah INTEGER detik virtual sejak hari 0 pukul 00:00. Hanya `created_at` (diagnosa) yang memakai waktu asli (TEXT ISO).
- **Jumlah (qty):** INTEGER (gram, ml, pcs). Tidak ada pecahan, supaya tidak ada selisih float.
- **ID:** entitas dinamis (pesanan, laporan, dst.) memakai INTEGER yang dialokasikan dalam transaksi yang sama dengan event pembuatnya (`MAX(id) + 1`) dan dibawa di payload, jadi replay menghasilkan ID yang sama. Entitas statis memakai TEXT slug (`kopi_susu`, `susu`, `pak_budi`).
- **JSON:** disimpan sebagai TEXT dengan `CHECK (json_valid(...))`.
- `PRAGMA foreign_keys = ON`.
- **Empat golongan tabel:**
  1. **Referensi:** statis, diisi seed, bukan hasil event.
  2. **Event log:** sumber kebenaran, append-only.
  3. **Proyeksi:** turunan event, boleh dihapus dan dibangun ulang.
  4. **Operasional:** jejak debugging dan pengaturan runtime, bukan turunan event.

## 2. Referensi (diisi seed)

**`menu_items`**: `id` TEXT PK, `name` TEXT, `price` INTEGER (rupiah), `cook_time_sec` INTEGER > 0 (detik virtual).

**`ingredients`**: `id` TEXT PK, `name` TEXT, `unit` TEXT (`g`, `ml`, `pcs`), `min_qty` INTEGER >= 0, `capacity_qty` INTEGER >= `min_qty` (target aturan "isi sampai penuh"), `lead_time_sec` INTEGER > 0.

**`recipe_items`**: `menu_item_id` FK, `ingredient_id` FK, `qty_per_portion` INTEGER > 0. PK gabungan keduanya.

**`regulars`**: `id` TEXT PK, `name` TEXT, `usual_time_sec` INTEGER (detik sejak 00:00 hari itu, 0 sampai 86399), `favorite_table` INTEGER 1 sampai 3, `usual_order_json` TEXT (`{"items":[{"menu_item_id","qty"}],"note":"kurang gula"}`).

**`suppliers_mock`**: `ingredient_id` PK FK, `weight_on_time`, `weight_late`, `weight_out` (INTEGER >= 0, jumlahnya > 0), `late_multiplier_pct` INTEGER >= 100 (mis. 200 = lead time dua kali lipat saat telat). Perilaku diundi seeded (decision 006) berdasarkan bobot ini.

## 3. Event log

**`events`**

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | Urutan global, tidak pernah dipakai ulang |
| `type` | TEXT NOT NULL | Divalidasi zod di aplikasi (tidak di-`CHECK`, supaya daftarnya tidak ganda) |
| `sim_time` | INTEGER NOT NULL | Detik virtual |
| `actor` | TEXT NOT NULL | `cashier`, `cook`, `stock_admin`, `waiter`, `boss`, `world`, `system` |
| `origin` | TEXT NOT NULL | `CHECK` salah satu: `generator`, `scheduler`, `rule`, `llm`, `fallback`, `boss`, `system` |
| `payload_json` | TEXT NOT NULL | `CHECK (json_valid(payload_json))` |
| `created_at` | TEXT NOT NULL | Default waktu asli. Tidak dipakai logika |

- Indeks: `(sim_time, id)` dan `(type)`.
- **Append-only dipaksa trigger:** `BEFORE UPDATE` dan `BEFORE DELETE` pada `events` memanggil `RAISE(ABORT, ...)`.

## 4. Proyeksi (dibangun dari event)

**`stock`**: `ingredient_id` PK FK, `qty` INTEGER >= 0, `low_flagged` 0/1, `out_flagged` 0/1. Penanda membuat `stock_low` dan `stock_out` idempoten; direset saat `restock_arrived` mengangkat `qty` di atas `min_qty`.

**`orders`**: `id` INTEGER PK, `status` (`placed`, `held`, `cooking`, `done`), `source` (`walk_in`, `regular`), `regular_id` FK nullable, `table_id` 1 sampai 3 nullable, `created_at_sim`, `done_at_sim` nullable, `customer_id` nullable (pelanggan yang masuk dan memesan; keputusan 032), `recorded_at_sim` nullable (saat kasir selesai mencatat dan koki diberi pesanannya).

**`order_items`**: `order_id` FK, `menu_item_id` FK, `qty` INTEGER > 0. PK gabungan.

**`agents`**: `id` TEXT PK (`cashier`, `cook`, `stock_admin`, `waiter`), `role` TEXT, `station` TEXT (StationId), `state` (`idle`, `walking`, `working`, `thinking`). Stasiun asal: kasir `cashier`, koki `kitchen`, admin stok `stock_shelf`, pelayan `table_2`. Selama berjalan, `station` adalah posisi sekarang atau tujuan (saat `walking`).

**`agent_tasks`**: `id` INTEGER PK, `agent_id` FK, `kind` (`goto`, `work`), `params_json` (station, label, ref), `status` (`queued`, `active`, `done`), `duration_sim_sec`, `started_at_sim` nullable, `ends_at_sim` nullable. Urutan antrean = urutan `id`. `ends_at_sim` dipakai klien untuk interpolasi animasi.

**`reports`**: `id` INTEGER PK, `type` (`restock`, `complaint`), `title`, `body`, `status` (`drafted`, `submitted`, `approved`, `rejected`), `subject_json` (item usulan belanja, atau `complaint_id`), `created_at_sim`, `submitted_at_sim` nullable, `decided_at_sim` nullable. Bos hanya melihat laporan berstatus `submitted` (sudah sampai di meja).

**`restock_orders`**: `id` INTEGER PK (= `restock_id`), `report_id` FK, `items_json`, `supplier` (`on_time`, `late`, `out`), `status` (`ordered`, `arrived`, `failed`), `ordered_at_sim`, `eta_sim` nullable, `arrived_at_sim` nullable.

**`complaints`**: `id` INTEGER PK, `order_id` FK, `cause` (`slow_service`, `wrong_order`, `quality`), `status` (`received`, `triaged`, `replied`), `category` nullable, `severity` nullable (1 sampai 3), `suggested_compensation` nullable, `report_id` FK nullable, `final_compensation` nullable, `received_at_sim`, `replied_at_sim` nullable.

**`regular_state`**: `regular_id` PK FK, `visits` INTEGER >= 0 (diisi `initial_visits`, naik di `regular_arrived`), `present` 0/1.

**`cafe_tables`**: `id` INTEGER PK (1 sampai 3), `state` (`empty`, `prepared`, `occupied`), `regular_id` FK nullable, `last_tidied_sim` nullable (dipakai aturan "rapikan meja kalau sepi sekitar 45 menit").

**`memories`**: `id` INTEGER PK, `agent_id` TEXT, `regular_id` FK nullable, `kind` (`observation`, `reflection`), `text` TEXT, `sim_time`. Refleksi hanya ada di sini (kolom `insight_text` di `regulars` dibuang). V1 hanya membuat `reflection`.

### Event ke proyeksi

| Event | Tabel yang berubah |
|---|---|
| `world_initialized` | Kosongkan semua proyeksi, isi `stock`, `regular_state`, `agents` (idle di stasiun asal), `cafe_tables` (empty) |
| `order_created` | `orders` (placed, `customer_id`), `order_items` |
| `order_held` / `order_resumed` | `orders.status` (held / placed) |
| `agent_task_assigned` (label `cooking`, ref pesanan) | `orders.recorded_at_sim` (sekali, saat pertama) |
| `cooking_started` / `cooking_done` | `orders.status` (cooking / done), `done_at_sim` |
| `stock_decreased` | `stock.qty` |
| `stock_low` / `stock_out` | `stock.low_flagged` / `out_flagged` |
| `restock_proposed` | `reports` (drafted) |
| `report_submitted` / `report_decided` | `reports.status`, `submitted_at_sim`, `decided_at_sim` |
| `restock_ordered` | `restock_orders` (ordered) |
| `restock_arrived` | `restock_orders` (arrived), `stock.qty` bertambah, penanda direset |
| `restock_failed` | `restock_orders` (failed) |
| `complaint_received` | `complaints` (received) |
| `complaint_triaged` | `complaints` (triaged), `reports` (drafted) bila ada laporan |
| `complaint_replied` | `complaints` (replied), `final_compensation` |
| `regular_arrived` | `regular_state` (visits + 1, present), `cafe_tables` (occupied) |
| `regular_left` | `regular_state.present = 0`, `cafe_tables` (empty) |
| `table_prepared` | `cafe_tables` (prepared) |
| `table_tidied` | `cafe_tables.last_tidied_sim` |
| `reflection_created` | `memories` (reflection) |
| `agent_task_assigned` | `agent_tasks` (queued) |
| `agent_state_changed` | `agents.state`, `agents.station`, `agent_tasks` (active, `started_at_sim`, `ends_at_sim`) |
| `agent_task_finished` | `agent_tasks` (done) |
| `day_opened`, `day_closed`, `sim_time_advanced`, `customer_arrived`, `regular_expected`, `regular_greeted`, `agent_think_requested`, `agent_decided` | Tidak mengubah proyeksi (hanya tercatat di log) |

## 5. Operasional

**`llm_calls`**: `id` INTEGER PK, `purpose`, `input_summary` TEXT, `output_json` TEXT nullable, `valid` 0/1, `latency_ms` INTEGER, `model` TEXT, `fallback_used` 0/1, `sim_time` INTEGER, `created_at`. Dirujuk `agent_decided.llm_call_id`. Tidak dipakai replay.

**`sim_clock`**: satu baris (`id = 1`): `current_sim_sec`, `speed` (detik virtual per detik asli, default 60), `paused` 0/1. Disimpan berkala dan saat shutdown.

**`schema_migrations`**: `name` TEXT PK, `applied_at` TEXT. Dibuat oleh runner migrasi.

## 6. Replay dan boot

1. Server membuka database dan menjalankan migrasi.
2. Jika `events` kosong: seed referensi, tulis `world_initialized`.
3. Jika tidak: kosongkan proyeksi, lalu terapkan event berurutan mulai dari `world_initialized` terakhir.
4. Jam sim = nilai terbesar antara `sim_clock.current_sim_sec` dan `sim_time` event terakhir. Jam boleh mundur sedikit setelah crash, aman karena generator dan scheduler deterministik.
5. Antrean tugas agent diambil dari `agent_tasks` berstatus `queued` atau `active`.

## 7. Pertanyaan terbuka untuk Tahap 1

- ~~Proyeksi lewat SQL langsung atau reducer murni di memori?~~ **Terjawab di Tahap 1:** SQL langsung lewat satu fungsi `applyEvent` di `server`, aturan murni di `core` (lihat [`decisions/019`](decisions/019-sql-projections-with-pure-rules.md)).
- Snapshot untuk mempercepat replay belum dibutuhkan di v1 (satu hari simulasi jumlah event-nya kecil).

## 8. Perbedaan dari brief dan rencana (mohon dikonfirmasi saat review)

- `ingredients.lead_time_min` jadi **`lead_time_sec`** (satu satuan waktu, decision 009). `ingredients.qty` pindah ke tabel proyeksi `stock`.
- `ingredients` dapat kolom **`capacity_qty`**. `suppliers_mock` jadi **bobot peluang** plus `late_multiplier_pct`.
- `regulars`: `visits` pindah ke `regular_state`, `insight_text` dibuang, `usual_order` jadi `usual_order_json` (butuh item terstruktur untuk membuat pesanan).
- `usual_time_min` jadi **`usual_time_sec`**.
- `reports`: status ditambah `drafted` dan `submitted`, kolom `subject_json` ditambah.
- `agents.current_task_json` diganti tabel **`agent_tasks`**.
- **Tabel baru** yang ketahuan perlu saat event didetailkan: `restock_orders`, `complaints`, `cafe_tables`.
- **`sim_clock` digolongkan operasional**, bukan proyeksi seperti di rencana, karena jam di antara dua event tidak bisa diturunkan dari log.
- `events.origin` ditambah (sudah disetujui di rencana).
