# 018: Halaman tambahan read-only (Stok, Menu, Laporan)

Status: diterima (2026-11-24). Asal: diskusi setelah review events dan schema.

## Keputusan
Selain dashboard, aplikasi web yang sama punya tiga halaman tambahan: **Stok** (level, batas, status pesanan belanja), **Menu** (daftar, harga, resep), dan **Laporan** (riwayat plus Setujui/Tolak untuk yang menunggu). Semuanya read-only dari proyeksi yang sudah ada. Dibangun di **Tahap 7**.

## Alasan
Datanya sudah ada (`stock`, `restock_orders`, `menu_items`, `recipe_items`, `reports`), jadi tidak perlu event atau tabel baru. Dashboard dan tahap-tahap logika tidak terganggu.

## Konsekuensi
- "Update stok" terjadi lewat alur yang ada (usulan belanja, bos Setujui, pemasok kirim). Tidak ada edit stok manual, jadi tidak ada event `stock_adjusted` (selaras dengan 013).
- Kasir hanya API, jadi halaman Menu cuma menampilkan daftar dan tidak bisa memesan.
