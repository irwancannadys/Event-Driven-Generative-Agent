# 021: Pacing dan kontrol waktu

Status: diterima (2026-11-24). Asal: rencana Tahap 2.

## Keputusan
- **Kecepatan dan pause bukan event.** Keduanya hanya mengatur seberapa sering server memanggil `advance`. Hanya loncat waktu dari bos yang jadi event (`sim_time_advanced`).
- `Pacer` di `server` menggerakkan jam berdasarkan waktu asli: `tick(elapsedMs)` menambah `speed x detik asli` dan membawa sisa pecahan. Kecepatan dibatasi **1 sampai 3600** (detik virtual per detik asli), default **60**.
- Kontrol lewat API lokal: `GET /time` dan `POST /time` (`speed`, `paused`, `advance_seconds`), hanya di `127.0.0.1`. Dipakai ulang panel web di Tahap 4.
- Jam awal dunia baru: **07:50 hari 0**, supaya `day_opened` muncul 10 menit virtual kemudian.
- Jam disimpan di `sim_clock` berkala dan saat shutdown. Saat boot, jam = nilai terbesar antara `sim_clock.current_sim_sec` dan `sim_time` event terakhir (keputusan 011).

## Alasan
Pace real-time adalah urusan menjalankan, bukan urusan dunia: dunia hanya tahu waktu virtual. Menjadikannya event akan mengotori log dan merusak replay.

## Konsekuensi
- **Kasus pinggir saat crash:** jika server mati tepat di antara dua item yang jatuh tempo di detik yang sama, item kedua terlewat setelah restart. Memutar jam mundur untuk menutupnya akan membuat event dobel, yang lebih buruk. Sangat jarang dan deterministik.
- Kecepatan tinggi memproses banyak item per tick. Batas 3600 menjaga satu tick tetap ringan.
