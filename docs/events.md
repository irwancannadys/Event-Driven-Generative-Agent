# Katalog event (final, menunggu persetujuan pemilik)

Daftar event adalah **kontrak** antara `core`, `server`, `web`, dan LLM. Dokumen ini jadi acuan skema zod di `packages/core` (ada tes yang memastikan keduanya tidak berbeda). Latar belakang konsep: [`concept.md`](concept.md). Keputusan terkait: [`decisions/`](decisions/).

Jumlah: **34 event** (21 dari brief, 13 baru, ditandai `*`).

## 1. Konvensi

Setiap event adalah satu baris di tabel `events`:

| Kolom | Isi |
|---|---|
| `id` | Integer autoincrement. Menentukan urutan global. Event dengan `sim_time` sama diurutkan menurut `id` |
| `type` | Salah satu dari 34 tipe di bawah |
| `sim_time` | Integer detik virtual sejak hari 0 pukul 00:00 (`28800` = jam buka 08:00 hari 0) |
| `actor` | Siapa pelakunya: `cashier`, `cook`, `stock_admin`, `waiter`, `boss`, `world` (pelanggan, pemasok), atau `system` |
| `origin` | Apa yang menyebabkannya: `generator`, `scheduler`, `rule`, `llm`, `fallback`, `boss`, `system` |
| `payload` | JSON, divalidasi zod sebelum ditulis |
| `created_at` | Waktu asli, hanya untuk diagnosa. **Tidak pernah dipakai logika atau replay** |

Tipe bersama yang dipakai payload:

```ts
type SimTime = number; // integer detik virtual
type Qty = number; // integer (gram, ml, pcs), tanpa pecahan
type AgentId = 'cashier' | 'cook' | 'stock_admin' | 'waiter';
type StationId =
  | 'cashier' | 'kitchen' | 'stock_shelf' | 'boss_desk' | 'table_1' | 'table_2' | 'table_3';
type TableId = 1 | 2 | 3;
type OrderItem = { menu_item_id: string; qty: number };
type StockLine = { ingredient_id: string; qty: Qty };
type ReportDraft = { report_id: number; title: string; body: string };
type Purpose =
  | 'waiter_initiative' | 'stock_proposal' | 'complaint_triage' | 'greeting' | 'reflection';
type Compensation = 'none' | 'discount_10' | 'free_item';
```

Aturan umum:

- **Satu langkah domain = satu transaksi** yang menulis beberapa event sekaligus plus proyeksinya (mis. `cooking_started` lalu `stock_decreased` per bahan).
- ID entitas baru (`order_id`, `report_id`, `complaint_id`, `restock_id`, `task_id`) dibuat saat menulis event dan dibawa di payload, jadi replay menghasilkan ID yang sama.
- Teks yang dibaca manusia dari template atau LLM (`text`, `draft_reply`, `title`, `body`) disimpan sebagai **string final** di payload. Replay tidak merender ulang. Label tugas (`label`) disimpan sebagai **kunci i18n**.
- ID yang tidak dikenal (bahan, menu, langganan, meja) ditolak saat validasi.

## 2. Katalog

| Event | Origin | Pelaku | Pemicu | Penangan | Aturan/LLM |
|---|---|---|---|---|---|
| `world_initialized` * | system | system | Boot pertama di DB kosong (setelah seed), atau reset hari | Proyeksi: stok, state langganan, agent | Aturan |
| `day_opened` * | scheduler | system | Jam 08:00 | Generator dunia, agent | Aturan |
| `day_closed` * | scheduler | system | Jam 20:00 | Generator dunia berhenti | Aturan |
| `sim_time_advanced` | boss | boss | Bos memajukan waktu | Semua jadwal terlewat diproses berurutan; `web` | Aturan |
| `customer_arrived` * | generator | world | Pelanggan walk-in masuk lewat pintu; pesanannya tercatat `WALK_IN_SEC` (200 detik virtual, jalan dari pintu ke kasir) kemudian (keputusan 032) | Tampilan (pelanggan berjalan ke kasir) | Aturan |
| `order_created` | generator atau rule | world atau waiter | Generator lewat `POST /orders` (walk_in) saat pelanggan sampai di kasir, atau pelayan mencatat pesanan langganan | Kasir atau pelayan, lalu koki | Aturan |
| `order_held` * | rule | cook | Bahan tidak cukup saat mulai memasak | Admin stok | Aturan |
| `order_resumed` * | rule | system | `restock_arrived` dan bahan kini cukup | Koki | Aturan |
| `cooking_started` | rule | cook | Koki mulai memasak dan bahan cukup | Koki | Aturan |
| `stock_decreased` | rule | cook | Tepat setelah `cooking_started`, satu per bahan | Sistem stok | Aturan |
| `cooking_done` | rule | cook | Tugas memasak selesai | Kasir atau pelayan (pesanan siap) | Aturan |
| `stock_low` | rule | system | Stok turun ke batas minimum atau kurang; sekali sampai stok diisi ulang | Admin stok | Aturan |
| `stock_out` | rule | system | Stok mencapai 0; sekali sampai stok diisi ulang | Admin stok | Aturan |
| `restock_proposed` | rule, llm, atau fallback | stock_admin | Hasil keputusan `stock_proposal` | Admin stok (jalan ke meja bos) | LLM, fallback aturan "isi sampai penuh" |
| `report_submitted` | rule | cashier atau stock_admin | Karakter tiba di meja bos | Bos | Aturan |
| `report_decided` | boss | boss | Bos klik Setujui atau Tolak | Admin stok atau kasir | Aturan |
| `restock_ordered` * | generator | stock_admin | Bos menyetujui usulan; pemasok tiruan menentukan perilakunya (undian seeded) | Pemasok tiruan | Aturan |
| `restock_arrived` | generator | world | Waktu tiba pemasok tercapai | Admin stok, sistem stok | Aturan |
| `restock_failed` * | generator | world | Pemasok kosong | Admin stok | Aturan |
| `complaint_received` | generator | world | Pesanan menunggu melewati batas, plus undian peluang | Kasir | Aturan |
| `complaint_triaged` | rule, llm, atau fallback | cashier | Hasil keputusan `complaint_triage` | Kasir (ke meja bos bila perlu) | LLM, fallback template |
| `complaint_replied` * | rule | cashier | Bos memutuskan, atau triase tidak butuh bos | Tampilan | Aturan |
| `regular_expected` | scheduler | system | 25 menit virtual sebelum jam biasa langganan | Pelayan (pemicu pemikiran) | Aturan |
| `regular_arrived` | scheduler | world | Jam biasa ditambah jitter kecil (seeded) | Pelayan | Aturan |
| `regular_greeted` | rule, llm, atau fallback | waiter | Pelayan menyapa | Tampilan | LLM atau template |
| `regular_left` | rule | world | Pelanggan selesai makan | Pelayan | Aturan |
| `table_prepared` | rule, llm, atau fallback | waiter | Tugas siapkan meja selesai | Tampilan | LLM (inisiatif), fallback aturan jam |
| `table_tidied` | rule, llm, atau fallback | waiter | Tugas rapikan meja selesai | Tampilan | LLM (inisiatif), fallback aturan jam |
| `reflection_created` | rule, llm, atau fallback | waiter | Setelah `regular_left`, kunjungan >= 4 dan belum ada refleksi | Memori | LLM atau template |
| `agent_think_requested` * | scheduler atau rule | agent terkait | Agent menganggur dan ada yang perlu dipikirkan, atau event pemicu (mis. `stock_low`) | Penangan keputusan | Aturan |
| `agent_decided` * | rule, llm, atau fallback | agent terkait | Keputusan selesai (atau fallback dipakai) | Pelaksana aksi | Aturan atau LLM |
| `agent_task_assigned` * | rule | agent terkait | Penangan menambah tugas ke antrean agent | Mesin agent | Aturan |
| `agent_task_finished` * | rule | agent terkait | Durasi tugas habis | Penangan peran (koki, kasir, dst.) | Aturan |
| `agent_state_changed` | rule | agent terkait | Status agent berubah | Tampilan | Aturan |

## 3. Payload

### Dunia dan waktu

```ts
world_initialized: { seed: number; initial_stock: Record<string, Qty>; initial_visits: Record<string, number> }
day_opened: { day: number }
day_closed: { day: number }
sim_time_advanced: { from: SimTime; to: SimTime }
```

### Pesanan dan dapur

```ts
customer_arrived: { customer_id: number }   // unik dan tetap: dari menit dan urutan kedatangan
order_created: {
  order_id: number;
  source: 'walk_in' | 'regular';
  customer_id?: number;  // pelanggan yang tadi masuk (customer_arrived); kosong untuk pesanan manual
  regular_id?: string;   // wajib jika source = regular
  table_id?: TableId;    // wajib jika source = regular
  items: OrderItem[];    // minimal 1
}
order_held: { order_id: number; missing: { ingredient_id: string; needed: Qty; available: Qty }[] }
order_resumed: { order_id: number }
cooking_started: { order_id: number; duration_sim_sec: number }
stock_decreased: { ingredient_id: string; qty: Qty; new_qty: Qty; order_id: number }
cooking_done: { order_id: number }
stock_low: { ingredient_id: string; qty: Qty; min_qty: Qty }
stock_out: { ingredient_id: string }
```

### Belanja dan pemasok

```ts
restock_proposed: { report: ReportDraft; items: StockLine[]; urgency: 'low' | 'normal' | 'high'; rationale: string }
report_submitted: { report_id: number }
report_decided: { report_id: number; decision: 'approved' | 'rejected' }
restock_ordered: {
  restock_id: number;
  report_id: number;
  items: StockLine[];
  supplier: 'on_time' | 'late' | 'out';
  eta_sim_time: SimTime | null;   // null jika supplier = out
}
restock_arrived: { restock_id: number; items: StockLine[] }
restock_failed: { restock_id: number; reason: 'supplier_out' }
```

### Komplain

```ts
complaint_received: { complaint_id: number; order_id: number; cause: 'slow_service' | 'wrong_order' | 'quality' }
complaint_triaged: {
  complaint_id: number;
  category: 'slow_service' | 'wrong_order' | 'quality' | 'other';
  severity: 1 | 2 | 3;
  draft_reply: string;
  suggested_compensation: Compensation;
  needs_boss_decision: boolean;
  report?: ReportDraft;   // ada jika dan hanya jika needs_boss_decision
}
complaint_replied: { complaint_id: number; compensation: Compensation; reply_text: string }
```

### Langganan dan Rina

```ts
regular_expected: { regular_id: string; table_id: TableId; expected_at: SimTime }
regular_arrived: { regular_id: string; table_id: TableId }
regular_greeted: { regular_id: string; text: string }
regular_left: { regular_id: string; table_id: TableId }
table_prepared: { table_id: TableId; regular_id?: string }
table_tidied: { table_id: TableId }
reflection_created: { regular_id: string; text: string }
```

### Agent

```ts
agent_think_requested: {
  agent_id: AgentId;
  purpose: Purpose;
  subject?: { regular_id?: string; ingredient_ids?: string[]; complaint_id?: number };
}
agent_decided: {
  agent_id: AgentId;
  purpose: Purpose;
  think_event_id: number;          // id event agent_think_requested yang dijawab
  decision: Decision;              // lihat di bawah
  llm_call_id?: number;            // jika origin = llm
  fallback_reason?: FallbackReason; // jika origin = fallback
  attempts?: number;
}
agent_task_assigned: {
  agent_id: AgentId;
  task_id: number;
  kind: 'goto' | 'work';
  station?: StationId;             // wajib untuk goto
  label?: string;                  // kunci i18n untuk work, mis. 'cooking'
  duration_sim_sec: number;
  ref?: { type: 'order' | 'report' | 'complaint' | 'restock' | 'table' | 'regular'; id: number | string };
}
agent_task_finished: { agent_id: AgentId; task_id: number }
agent_state_changed: {
  agent_id: AgentId;
  state: 'idle' | 'walking' | 'working' | 'thinking';
  station: StationId;              // posisi sekarang (idle, working) atau tujuan (walking)
  task_id?: number;
  label?: string;
  eta_sim_time?: SimTime;
}
```

`Decision` mengikuti kontrak output LLM di brief bagian 7, per `purpose`:

```ts
waiter_initiative: { action: 'prepare_table' | 'tidy_table' | 'idle'; table_id?: TableId; regular_id?: string; reason: string /* maks 140 */ }
stock_proposal: { items: StockLine[]; urgency: 'low' | 'normal' | 'high'; rationale: string /* maks 200 */ }
complaint_triage: { category; severity; draft_reply; suggested_compensation; needs_boss_decision } // sama seperti payload complaint_triaged
greeting: { text: string /* maks 200 */ }
reflection: { text: string /* maks 200 */ }

type FallbackReason =
  | 'invalid_json' | 'invalid_enum' | 'unknown_id' | 'out_of_range' | 'too_long' | 'timeout' | 'stale';
```

## 4. Contoh urutan: bahan menipis sampai restock

```
cooking_started        order 5                                     rule
stock_decreased        susu -200, sisa 400                         rule
cooking_done           order 5                                     rule
stock_low              susu 400 <= batas 500                       rule
agent_think_requested  stock_admin, stock_proposal                 rule
agent_state_changed    stock_admin thinking                        rule
agent_decided          stock_proposal (items, urgency)             llm
restock_proposed       laporan "Usul belanja susu"                 llm
agent_task_assigned    stock_admin goto boss_desk                  rule
agent_task_finished    stock_admin goto boss_desk                  rule
report_submitted       laporan sampai di meja bos                  rule
report_decided         approved                                    boss
restock_ordered        supplier late, eta 10:20                    generator
restock_arrived        susu +2000                                  generator
order_resumed          (jika ada pesanan tertahan)                 rule
```

## 5. Aturan penting

- **`stock_low` dan `stock_out` idempoten.** Masing-masing muncul sekali per bahan sampai stok diisi ulang melewati batas. Penanda ada di proyeksi `stock`.
- **Bahan dikurangi saat `cooking_started`.** Pengecekan dan pengurangan terjadi atomik dalam satu transaksi, jadi dua pesanan tidak bisa menghabiskan stok yang sama. Jika kurang: `order_held`, bukan `cooking_started`.
- **Pesanan tertahan diproses lagi** (FIFO) saat `restock_arrived` dengan `order_resumed`, jika bahan kini cukup.
- **`world_initialized` memulai "epoch" baru.** Menerapkannya mengosongkan proyeksi. Replay mulai dari `world_initialized` terakhir. Event lama tidak dihapus (append-only).
- **Kontrol waktu (pause, kecepatan) bukan event.** Itu hanya mengatur kecepatan jam real. Hanya loncat waktu yang jadi event (`sim_time_advanced`).
- **Efek samping tugas lewat penangan event, bukan callback.** Misalnya koki mendengar `agent_task_finished` untuk tugas memasak, lalu menulis `cooking_done`.
- **Satu keputusan satu hasil.** `agent_decided` mencatat keputusan, event hasil (`restock_proposed`, `table_prepared`, dst.) mencatat efeknya di dunia.
- **Satu langkah, satu transaksi.** Satu item jatuh tempo (atau satu klik bos) dan semua reaksi berantainya (event turunan) ditulis dalam satu transaksi, urutannya FIFO. Hasilnya: server yang mati tidak pernah meninggalkan serah-terima setengah jalan (keputusan 022).
- **Satu `restock_ordered` per bahan.** Pemasok tiruan per bahan, jadi satu laporan bisa menghasilkan beberapa pesanan belanja, masing-masing dengan `restock_id` sendiri (keputusan 024).
- **`agent_state_changed` menandai mulainya tugas.** Untuk `walking`, `station` adalah tujuan dan `eta_sim_time` waktu tiba. Untuk `working`, `station` adalah posisi sekarang. `idle` tidak membawa `task_id`.

## 6. Label di panel log

| Label | Aturan |
|---|---|
| Inisiatif | `agent_decided` dengan `purpose = waiter_initiative`, `table_prepared`, `table_tidied`, `reflection_created` |
| Bos | `origin = boss` |
| LLM | `origin = llm` |
| Trigger | `origin = generator` atau `scheduler` |
| Aturan | selain di atas (`rule`, `fallback`, `system`) |

Kondisi di atas dicek dari atas ke bawah, label pertama yang cocok dipakai. Event infrastruktur tidak tampil di log secara default: `agent_task_assigned`, `agent_task_finished`, `agent_state_changed`.

Di kode, label berupa kunci netral (`trigger`, `rule`, `llm`, `initiative`, `boss`) lewat `logLabel` di `packages/core/src/events/log-label.ts`. Teks yang tampil ("Trigger", "Aturan", dst.) diambil dari kamus bahasa (keputusan 015).

## 7. Perbedaan dari brief (mohon dikonfirmasi saat review)

- **Bahan dikurangi saat `cooking_started`**, bukan saat masakan selesai (brief bagian 10). Alasan: pengecekan dan pengurangan atomik, tanpa risiko dua pesanan menghabiskan stok yang sama.
- **12 event baru:** `world_initialized`, `day_opened`, `day_closed`, `order_held`, `order_resumed`, `restock_ordered`, `restock_failed`, `complaint_replied`, `agent_think_requested`, `agent_decided`, `agent_task_assigned`, `agent_task_finished`.
- **Keputusan dan hasil dipisah.** `agent_decided` adalah keputusannya, `restock_proposed` dan sejenisnya adalah efeknya.
- **`agent_think_requested` bisa dipicu aturan**, tidak hanya scheduler (mis. admin stok berpikir setelah `stock_low`).
- **Jenis tugas hanya `goto` dan `work`.** `do` di PLAN Tahap 3 dihapus karena efek samping tugas lewat penangan event.
- **Memori `observation` tidak dipakai di v1.** Hanya `reflection` yang dibuat (lewat `reflection_created`). Kolom `kind` tetap menampung `observation` bila dibutuhkan nanti.
- **Teks dari template atau LLM disimpan sebagai string final**, bukan kunci i18n, kecuali `label` tugas.
