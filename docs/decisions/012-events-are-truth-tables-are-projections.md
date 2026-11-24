# 012: Event log = kebenaran, tabel lain = proyeksi

Status: diterima (2026-11-24). Asal: PLAN keputusan #12 (hasil review Tahap 0).

## Keputusan
Tabel `events` adalah sumber kebenaran dan append-only (trigger SQLite menolak UPDATE dan DELETE). Tabel lain adalah **proyeksi**, ditulis dalam transaksi yang sama dengan append event. Tabel referensi (menu, resep, profil langganan) statis dari seed.

## Alasan
Draf awal punya `events` sebagai kebenaran tetapi juga tabel mutable seperti `ingredients.qty`. Itu dua sumber kebenaran yang bisa berbeda.

## Konsekuensi
- Proyeksi boleh dihapus dan dibangun ulang dari log kapan saja.
- Entitas baru (pesanan, laporan) membawa ID di payload event, jadi replay menghasilkan ID yang sama.
- Tahap 1 sudah event-first, jadi tidak ada refaktor di Tahap 2.
