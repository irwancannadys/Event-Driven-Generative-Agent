# 009: Satuan waktu = detik virtual

Status: diterima (2026-11-24). Asal: PLAN keputusan #9 (hasil review Tahap 0).

## Keputusan
Semua waktu di domain adalah **integer detik virtual** sejak hari 0 pukul 00:00. Menit, jam, dan nomor hari diturunkan. Jam buka 08:00 = 28800. Tiap tugas agent punya `duration_sim_sec`.

## Alasan
Draf awal mencampur menit (`current_sim_minute`, `advance(minutes)`) dan detik (`cook_time_sec`, durasi jalan). Satu satuan menghindari konversi dan bug pembulatan.

## Konsekuensi
- Jumlah stok juga integer (gram, ml, pcs), tanpa pecahan, supaya tidak ada selisih float.
- `lead_time_min` di skema jadi `lead_time_sec`. `advance(30)` menit jadi `advance(1800)`.
