# 007: Migrasi SQL berurutan

Status: diterima (2026-11-24). Asal: PLAN keputusan #7.

## Keputusan
Migrasi berupa file SQL berurutan (`0001_init.sql`, dst.) plus runner kecil yang mencatat file yang sudah dijalankan di tabel `schema_migrations`.

## Alasan
Sederhana dan transparan. Murid bisa membaca SQL-nya langsung, tanpa ORM.

## Konsekuensi
- Migrasi yang sudah dijalankan tidak diedit. Perubahan skema = file baru.
- Tes memastikan migrasi aman dijalankan dua kali.
