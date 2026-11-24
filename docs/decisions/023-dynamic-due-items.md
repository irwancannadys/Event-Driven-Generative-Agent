# 023: Timer dinamis di VirtualClock

Status: diterima (2026-11-24). Asal: rencana Tahap 3. Memperluas keputusan 020.

## Keputusan
- `VirtualClock` memanggil `due(after, upTo)` yang mengembalikan **kelompok item paling awal** di `(after, upTo]`, memprosesnya, lalu mengulang sampai tidak ada lagi. Sebelumnya `due` dipanggil sekali dengan seluruh jendela.
- Ada dua macam item: **statis** (jadwal buka dan tutup, `regular_expected`, kedatangan pesanan, pengecekan komplain: fungsi murni dari seed dan waktu) dan **dinamis** (`task_end` untuk akhir tugas agent, `restock_arrival` untuk kedatangan pemasok).
- Item dinamis **dibaca dari proyeksi** (`agent_tasks.ends_at_sim` untuk tugas aktif, `restock_orders.eta_sim` untuk pesanan berstatus `ordered`), jadi pulih setelah restart tanpa menyimpan apa pun di luar log.
- Item dinamis yang waktunya sudah lewat (kasus pinggir setelah crash) dianggap **jatuh tempo sekarang**. Ada pengaman batas putaran per `advance`, supaya bug tidak menjadi loop tak berujung.
- Urutan seri di detik yang sama: `day_opened`, `regular_expected`, `restock_arrival`, `task_end`, `order_arrival`, `complaint_check`, `day_closed`.
- Item statis dihitung sekali per `advance` lewat sumber ber-cache, supaya putaran berulang tidak menghitung ulang jendela yang sama.

## Alasan
Akhir tugas baru diketahui saat tugas dimulai, jadi tidak bisa dihitung di muka seperti jadwal statis. Karena sumbernya proyeksi, tetap berlaku "log adalah kebenaran".

## Konsekuensi
- Item di detik yang sama dengan jam sekarang tidak boleh dibuat oleh handler lewat timer (kelompok seri berikutnya dilewati). Perubahan seketika dilakukan lewat reaksi di dalam langkah yang sama (keputusan 022).
- Hasil tetap sama berapa pun `advance` dipecah, dan tes restart diulang untuk dunia dengan agent.
