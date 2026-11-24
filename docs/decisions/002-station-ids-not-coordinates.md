# 002: Posisi karakter di domain pakai ID stasiun

Status: diterima (2026-11-24). Asal: PLAN keputusan #2.

## Keputusan
Domain memakai ID stasiun, bukan koordinat: `cashier`, `kitchen`, `stock_shelf`, `boss_desk`, `table_1`, `table_2`, `table_3`. Koordinat 3D dan arah hadap hanya ada di registry di `web`.

## Alasan
Domain tetap bersih dari urusan 3D. Layout atau model boleh diganti tanpa menyentuh otak agent.

## Konsekuensi
- `core` punya daftar ID stasiun dan tabel jarak (lihat 003).
- `web` punya registry ID stasiun ke koordinat dan arah hadap (data, bukan hardcode).
