# 029: Pelanggan digambar dari event pesanan

Status: diterima (2026-11-24). Asal: revisi Tahap 4 setelah uji pemilik.

## Keputusan
- Satu pesanan walk-in = satu pelanggan anonim (keputusan 014). **Tidak ada event baru dan tidak ada perilaku domain baru**: semua yang terlihat dari seorang pelanggan berasal dari apa yang terjadi pada pesanannya.
- Alurnya, dihitung sebagai fungsi murni dari (pesanan, waktu virtual) seperti karyawan (keputusan 027): masuk lewat pintu kaca depan saat `order_created`, jalan ke depan kasir dan berdiri sekitar satu menit, pindah ke tempat tunggu (satu dari 14 kursi di tujuh meja atau enam tempat berdiri, tetap per nomor pesanan), saat `cooking_done` jalan ke jendela dapur, mengambil gelas (piringnya tadi muncul di jendela), lalu pulang lewat pintu.
- Gelembung di atas kepala: `!` merah dari `complaint_received` sampai `complaint_replied`, "Menunggu bahan" saat pesanan `held`, "Siap!" saat masakan selesai.
- Snapshot WebSocket diperluas: `recent_orders` (semua pesanan yang belum selesai dan yang selesai 20 menit virtual terakhir, paling banyak 200 terbaru) dan `open_complaints`. State klien menyimpan `customers` dari event yang sama, dan tes silang membuktikan keduanya sama di 1238 titik satu hari.
- Paling banyak 20 pelanggan digambar sekaligus (satu per tempat menunggu), sisanya jadi tulisan "+N antre". Yang dipilih: yang sedang pulang, lalu yang komplain, lalu yang paling lama menunggu (yang terbaru dihitung dulu), supaya pelanggan yang log-nya sedang ramai dibicarakan tidak hilang dari gambar.
- Pelanggan berjalan 8 detik virtual per unit denah (karyawan 20). Pesanan masuk saat pelanggan berada di pintu dan kasir selesai mencatat 45 detik kemudian, jadi pelanggan yang berjalan sepelan karyawan akan tiba di kasir jauh setelah log bilang pesanannya sudah dicatat (ditemukan lewat audit gerak lawan log). Titik pesan, ambil, dan tunggu digeser sedikit per nomor pesanan supaya dua pelanggan tidak berdiri di titik yang sama.

## Alasan
Tanpa pelanggan, kasir dan koki hanya berdiri dan "interaksi" tidak ada. Menggambarnya dari event yang sudah ada menjaga invarian: tampilan hanya membaca.

## Konsekuensi
- Kasir mencatat pesanan sejak T0, padahal pelanggan baru tiba di depannya beberapa puluh detik kemudian. Selisihnya kecil dan hanya visual.
- Pelanggan langganan (`source: regular`) tidak digambar di sini: mereka milik Tahap 5 bersama Rina.
