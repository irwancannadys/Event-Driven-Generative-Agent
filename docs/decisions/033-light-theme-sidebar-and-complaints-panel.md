# 033: Tema terang teal, menu kontrol waktu, sidebar yang bisa dilipat, dan panel Komplain

Status: diterima (2026-11-24). Asal: revisi Tahap 4 (putaran 3), permintaan pemilik: "tema kok coklat gelap, bikin lebih lighty", "panel kontrol taro di sidebar dan bisa show hide", "bikin section sendiri soal komplain".

## Keputusan
- **Tema selalu terang**: tanpa `prefers-color-scheme: dark` (halaman dulu ikut mode gelap sistem dan jadi coklat gelap). Versi pertama krem dan persik membuat mata sakit (pemilik), jadi paletnya diganti ke **teal**: latar putih kehijauan (`#eff6f6`), kartu putih, teks `#16292b` dan abu kehijauan `#4a6366`, teal tua `#0f766e` untuk tombol aktif dan `#0b4f4a` untuk judul, amber dan merah hanya untuk peringatan dan komplain. Latar gambar 3D gradien teal muda dan alas kafe abu-teal.
- **Kartu status dihapus dan kontrol waktu adalah menu**: atas halaman hanya logo dan nama **Cand's Coffee** (dulu "Kafe Virtual") dan satu tombol berisi titik koneksi dan jam. Tombol itu membuka menu (status, Jeda, kecepatan, majukan waktu, Panel saja). Menu tetap terbuka selagi dipakai dan menutup dengan klik di luar atau Escape. Kontrol dipakai sesekali, jadi tidak perlu memakai tempat di sidebar.
- **Kartu putih polos** dengan bayangan tipis (versi berwarna per kartu dicoba dan terlalu ramai) dan latar gambar yang lebih redup. **Logo hitam-putih** (satu-satunya yang bukan teal), terinspirasi glif kamera Instagram: kotak bulat berbingkai dengan cincin (cangkir dilihat dari atas) dan satu titik uap, dibuat dari CSS. **Komplain** pindah ke baris kartu di bawah gambar, di sebelah Pesanan; kartu di baris itu setinggi isinya sendiri (`align-items: start`), jadi hanya Meja Bos yang memanjang.
- **Sidebar** berisi Kejadian dan Stok; masing-masing bisa dilipat dengan klik judulnya, dan yang terlipat diingat di `localStorage` (semua pemakaiannya boleh gagal, halaman lalu mulai dengan semua terbuka).
- **Komplain** punya kartu sendiri. Snapshot membawa komplain yang terbuka dan yang dibalas dua jam virtual terakhir (`complaints`, menggantikan `open_complaints`): penyebab, status (`received`, `triaged`, `replied`), waktu terima dan balas, kompensasi (usulan kasir sampai dibalas, lalu yang diberikan). Halaman mengikutinya dari event `complaint_*`, dan tes silang terhadap snapshot menjalankan juga satu hari dengan tunggu panjang supaya komplain yang menunggu bos ikut dibandingkan.
- **Yang menangani komplain tetap kasir** (sesuai brief). Pelanggan yang komplain tetap di tempatnya dengan gelembung "!"; Rina yang ke meja pelanggan adalah bagian Tahap 5.

## Konsekuensi
- Tidak ada mode gelap. Kalau nanti dibutuhkan, itu satu blok variabel warna di `style.css`.
- Waiter yang mengantar makanan juga ditunda ke Tahap 5, karena butuh meja yang dikenal domain dan event `order_served`.
