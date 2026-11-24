# 005: Persist-then-publish

Status: diterima (2026-11-24). Asal: PLAN keputusan #5.

## Keputusan
Event ditulis ke database dulu (satu transaksi bersama proyeksinya), baru disiarkan ke subscriber dan WebSocket.

## Alasan
Log selalu menjadi sumber kebenaran. Kalau server crash di antara dua langkah itu, klien tidak pernah melihat event yang tidak ada di log.

## Konsekuensi
- Subscriber boleh terlambat, tapi tidak pernah mendahului log.
- Klien yang terputus melakukan resync dari snapshot, lalu lanjut ke aliran event.
