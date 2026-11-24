# 022: Agent, antrean tugas, dan langkah atomik dengan reaksi

Status: diterima (2026-11-24). Asal: rencana Tahap 3.

## Keputusan
- Setiap agent punya **antrean tugas** (`agent_tasks`). Jenis tugas hanya `goto(stasiun)` dan `work(durasi, label)`. Durasi jalan dari tabel jarak (keputusan 003).
- Tugas bergerak lewat event: `agent_task_assigned` (masuk antrean), `agent_state_changed` (mulai, membawa ETA), `agent_task_finished` (selesai). Jika agent menganggur dan antrean ada, tugas berikutnya langsung dimulai.
- Efek sebuah tugas muncul lewat **reaksi atas event**, bukan callback (mis. koki mendengar `agent_task_finished` untuk tugas memasak, lalu menulis `cooking_done`).
- Satu **langkah** (satu item jatuh tempo, atau satu klik bos) ditulis dalam **satu transaksi bersama semua reaksi berantainya**. `transact` bisa bersarang: use case yang dipanggil di dalam langkah ikut bergabung dan tidak publish sendiri. Antrean reaksi dikuras (FIFO) sebelum commit, baru event dipublish.
- Stok dikurangi **saat tugas memasak dimulai**, lewat hook "sebelum mulai": bahan cukup berarti `cooking_started` dan `stock_decreased`, kurang berarti `order_held` dan tugas langsung selesai.

## Alasan
- Server yang mati di tengah tidak boleh meninggalkan serah-terima setengah jalan (tugas selesai tapi `cooking_done` belum tertulis), karena pemulihan hanya membaca log.
- Urutan reaksi FIFO dan tetap membuat hasil deterministik, jadi replay dan restart tetap identik.

## Konsekuensi
- Kegagalan di reaksi mana pun membatalkan seluruh langkah (event dan proyeksi), dan error naik ke atas.
- Jam virtual mengulang item yang gagal pada `advance` berikutnya (lihat 023).
- Status `thinking` belum dipakai. Keputusan aturan seketika, jadi `agent_think_requested` dan `agent_decided` ditulis berurutan di detik yang sama. Saat LLM masuk (Tahap 6) jalurnya sudah ada.
- Ini menutup kasus pinggir crash di keputusan 021 untuk karya agent, karena satu detik yang sama tidak lagi bisa terpotong di tengah satu langkah.
