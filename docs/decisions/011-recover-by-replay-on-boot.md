# 011: Pemulihan lewat replay saat boot

Status: diterima (2026-11-24). Asal: PLAN keputusan #11 (hasil review Tahap 0).

## Keputusan
Saat boot, server memutar ulang event log untuk membangun ulang proyeksi dan antrean tugas agent. Dunia lanjut dari titik terakhir.

## Alasan
Server sering restart saat ngoding. Tanpa ini, dunia ter-reset tiap file disimpan, dan event log yang sudah tercatat tidak terpakai.

## Konsekuensi
- Semua hal yang mengubah dunia harus jadi event, termasuk tugas agent.
- Jam sim saat boot = nilai terbesar antara `sim_clock` yang tersimpan dan `sim_time` event terakhir. Boleh mundur sedikit setelah crash, aman karena generator dan scheduler deterministik (lihat 006).
- Snapshot untuk mempercepat replay belum dibutuhkan di v1.
