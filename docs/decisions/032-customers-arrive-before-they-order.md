# 032: Pelanggan masuk dulu, baru memesan (`customer_arrived`)

Status: diterima (2026-11-24). Asal: revisi Tahap 4, keluhan pemilik: "kasir 'mencatat' saat orang baru masuk pintu, tapi sudah 'menganggur' saat orang itu sampai di kasir".

## Masalah
Pelanggan digambar dari `order_created`, di detik yang sama kasir mulai mencatat. Jalan dari pintu ke kasir butuh ±200 detik virtual dengan kecepatan karyawan, jadi gambar selalu terlambat dari log. Mempercepat pelanggan hanya memindahkan masalahnya (kaki tidak mengejar, dan tetap tiba setelah kasir selesai). Selama gambar diturunkan dari event yang terjadi **di detik yang sama** dengan kerja karyawan, pelanggan tidak mungkin sudah ada di tempat.

## Keputusan
- Event baru `customer_arrived` (generator, pelaku `world`, payload `{ customer_id }`): pelanggan walk-in masuk lewat pintu. Pesanannya (`order_created`) tercatat **`WALK_IN_SEC` = 200 detik virtual kemudian**, saat pelanggan sampai di kasir, jadi kasir mulai "mencatat" tepat saat pelanggan ada di depannya.
- Generator (`dueItems`) membuat dua item dari undian yang sama: `customer_arrival` di waktu A dan `order_arrival` di A + `WALK_IN_SEC`. Tetap fungsi murni dari (seed, waktu absolut) (keputusan 020), jadi loncat waktu dan restart tidak mengubah apa-apa. Pelanggan terakhir masuk cukup awal supaya pesanannya tercatat sebelum kafe tutup.
- `customer_id` unik dan tetap: `menit_ke * 100 + urutan` (`customerIdOf`). Ia dibawa di `customer_arrived` dan di `order_created` (opsional: pesanan manual lewat `POST /orders` tidak punya pelanggan yang masuk).
- Tidak ada tabel baru: `customer_arrived` hanya tercatat di log (proyeksi kosong), dan diteruskan lewat WebSocket.
- `WALK_IN_SEC` ada di `core` (`stations.ts`) dan dijaga dekat dengan panjang jalur pintu ke titik pesan di denah oleh tes di `web` (pola keputusan 031).

## Konsekuensi
- Katalog event jadi 34 (`docs/events.md`), golden test berubah: pesanan yang sama dengan isi yang sama, bergeser 3 sampai 4 menit, tiap pesanan didahului satu `customer_arrived`.
- Waktu tunggu pesanan dihitung sejak pesanan tercatat (di kasir), bukan sejak pelanggan di pintu.
- Pesanan manual muncul langsung di kasir (tanpa jalan masuk). Itu hanya untuk demo dan tes.
- Pelanggan yang mengambil pesanan sendiri di jendela dapur (bukan diantar Rina) tetap berlaku sampai Tahap 5.
