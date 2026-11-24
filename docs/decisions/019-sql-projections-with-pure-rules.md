# 019: Proyeksi lewat SQL, aturan murni di core

Status: diterima (2026-11-24). Asal: pertanyaan terbuka di `schema.md` bagian 7, diputuskan saat menyusun Tahap 1.

## Keputusan
- **`core` memutuskan.** Fungsi murni tanpa database menjawab "apa yang harus terjadi" (kebutuhan bahan, rencana masak, sinyal ambang stok).
- **`server` menjalankan.** Ia membaca state dari tabel, memanggil aturan di `core`, lalu menulis event dan proyeksinya.
- **Proyeksi ditulis lewat SQL langsung**, oleh satu fungsi `applyEvent(db, event)` di `server`. Saat live maupun saat replay, fungsi yang sama yang dipakai.
- `appendEvent` wajib dipanggil di dalam transaksi, jadi event dan proyeksinya tertulis bersama atau tidak sama sekali (lihat 012).

## Alasan
- Hanya ada **satu** implementasi proyeksi. Replay tinggal menjalankan `applyEvent` yang sama, jadi live dan replay tidak bisa menyimpang.
- `CHECK` dan foreign key di SQLite menjadi jaring pengaman (mis. stok tidak bisa negatif).
- Aturan murni tetap bisa dites cepat tanpa database.
- Alternatifnya, reducer murni di memori yang disalin ke tabel, lebih "bersih" tetapi menyimpan dua salinan state yang harus selalu sama.

## Konsekuensi
- `applyEvent` memeriksa konsistensi (mis. `stock_decreased` harus cocok dengan stok sekarang) dan melempar error bila tidak cocok.
- Event yang proyeksinya belum dibuat dilempar sebagai `ProjectionNotImplementedError`, tidak diabaikan diam-diam. Tiap tahap berikutnya menambah penanganannya.
- Tes proyeksi memakai SQLite di memori (cepat).
- Jam untuk `sim_time` di Tahap 1 adalah `ManualClock` sementara, diganti `SimClock` sungguhan di Tahap 2 tanpa mengubah kontrak event.
