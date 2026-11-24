# 033: Tema terang, sidebar yang bisa dilipat, dan panel Komplain

Status: diterima (2026-11-24). Asal: revisi Tahap 4 (putaran 3), permintaan pemilik: "tema kok coklat gelap, bikin lebih lighty", "panel kontrol taro di sidebar dan bisa show hide", "bikin section sendiri soal komplain".

## Keputusan
- **Tema selalu terang**: tanpa `prefers-color-scheme: dark` (halaman dulu ikut mode gelap sistem dan jadi coklat gelap). Krem dan putih dengan hijau daun (warna seragam) sebagai aksen dan coklat kopi untuk judul. Latar gambar 3D krem-persik dan alas kafe berwarna pasir.
- **Sidebar**: kontrol waktu pindah ke atas sidebar; atas halaman hanya status koneksi dan jam. Kontrol waktu, Kejadian, Komplain, dan Stok masing-masing bisa dilipat dengan klik judulnya; yang terlipat diingat di `localStorage` (semua pemakaiannya boleh gagal, halaman lalu mulai dengan semua terbuka).
- **Komplain** punya bagian sendiri. Snapshot membawa komplain yang terbuka dan yang dibalas dua jam virtual terakhir (`complaints`, menggantikan `open_complaints`): penyebab, status (`received`, `triaged`, `replied`), waktu terima dan balas, kompensasi (usulan kasir sampai dibalas, lalu yang diberikan). Halaman mengikutinya dari event `complaint_*`, dan tes silang terhadap snapshot menjalankan juga satu hari dengan tunggu panjang supaya komplain yang menunggu bos ikut dibandingkan.
- **Yang menangani komplain tetap kasir** (sesuai brief). Pelanggan yang komplain tetap di tempatnya dengan gelembung "!"; Rina yang ke meja pelanggan adalah bagian Tahap 5.

## Konsekuensi
- Tidak ada mode gelap. Kalau nanti dibutuhkan, itu satu blok variabel warna di `style.css`.
- Waiter yang mengantar makanan juga ditunda ke Tahap 5, karena butuh meja yang dikenal domain dan event `order_served`.
