# 004: SQLite lewat better-sqlite3

Status: diterima (2026-11-24). Asal: PLAN keputusan #4.

## Keputusan
Database: SQLite lewat `better-sqlite3` (sinkron, satu proses).

## Alasan
Sederhana, matang, tanpa server database. `node:sqlite` bawaan Node 22 masih eksperimental, jadi hanya jadi cadangan.

## Konsekuensi
- Butuh binary native untuk arm64. Dicek di Langkah 10 Tahap 0. Jika gagal, pindah ke `node:sqlite`.
- API sinkron cocok dengan transaksi "append event + terapkan proyeksi" (lihat 012).
