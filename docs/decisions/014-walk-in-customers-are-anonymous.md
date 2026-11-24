# 014: Pelanggan biasa bersifat anonim

Status: diterima (2026-11-24). Asal: diskusi review Tahap 0.

## Keputusan
Pelanggan non-langganan (walk-in) anonim dan tanpa memori. Mereka hanya muncul sebagai order (`source: walk_in`). Antrean visual di `web` diturunkan dari order yang belum selesai.

## Alasan
Memori dan inisiatif hanya untuk pelanggan langganan. Memberi identitas ke semua pelanggan melebarkan scope tanpa menambah pelajaran.

## Konsekuensi
- Tidak ada tabel pelanggan biasa.
- Hanya 3 langganan yang punya profil, state, dan memori.
