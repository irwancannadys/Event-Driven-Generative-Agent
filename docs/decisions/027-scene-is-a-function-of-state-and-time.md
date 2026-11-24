# 027: Adegan adalah fungsi dari (state, waktu virtual)

Status: diterima (2026-11-24). Asal: rencana Tahap 4.

## Keputusan
- Posisi dan pose karakter dihitung **tiap frame** dari state karakter dan waktu virtual saat itu, bukan dari antrean animasi yang dijalankan satu per satu.
  - Berjalan: lurus dari `from_station` ke stasiun tujuan, progres `(sekarang - mulai) / (ETA - mulai)` dibatasi 0 sampai 1.
  - Bekerja dan diam: berdiri di stasiunnya (bekerja dengan gerak kecil dan label tugas).
- Waktu virtual di klien diekstrapolasi dari pesan `clock` terakhir (keputusan 026) dan beku saat jeda.
- Tampilan lain mengikuti prinsip yang sama: kotak di rak stok dari jumlah stok, tumpukan kertas di meja bos dari jumlah laporan yang menunggu.

## Alasan
Loncat waktu (`sim_time_advanced`), pause, ganti kecepatan, refresh, dan sambung ulang semuanya menjadi benar **tanpa kode khusus**: state-nya berubah, fungsinya menjawab posisi yang sesuai. Karakter juga selalu tiba tepat di ETA yang dicatat server, walau jarak di layar sedikit berbeda dari tabel jarak domain (keputusan 003).

## Konsekuensi
- Jalur jalan lurus antar stasiun (tanpa menghindari perabot). Cukup untuk Tahap 4, bisa diganti titik-titik jalur di registry stasiun tanpa mengubah state.
- Fungsi posisi murni, jadi dites tanpa browser. Tampilan 3D sendiri hanya bisa dinilai dengan melihatnya.
