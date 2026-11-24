# 036: Apa yang dicapai Admin Stok yang belajar (hasil eksperimen)

Status: diterima (2026-11-24). Asal: Tahap 5 (keputusan 034), langkah "eksperimen jujur".

## Cara mengukur
`npm run experiment:stage5 -- <keramaian> <hari> <seed>` memainkan hari-hari yang sama untuk 12 seed dengan empat varian, dan menjumlahkan tiga angka dari log (`dayMetrics`): berapa kali pesanan ditahan karena bahan kurang, berapa menit sebuah bahan habis, dan berapa komplain. Bos otomatis menyetujui semua laporan belanja; usulan kebijakan disetujui hanya di varian yang memilikinya.

| Varian | Isinya |
|---|---|
| tanpa belajar | aturan saja, tanpa prakiraan, bos menolak usulan kebijakan (kafe Tahap 3) |
| hanya prakiraan | Admin Stok memperkirakan dan memesan jam 10:00 dan 15:00, usulan kebijakan ditolak |
| hanya kebijakan | review malam dan usulan batas minimum, bos menyetujui, tanpa prakiraan |
| keduanya | semuanya (kafe yang belajar) |

## Hasil (rata-rata per seed, 7 hari, 12 seed)

Keramaian 100%:

| Varian | Pesanan ditahan | Stok habis (menit) | Komplain |
|---|---|---|---|
| tanpa belajar | 47,6 | 704,6 | 46,3 |
| hanya prakiraan | 50,5 | 355,4 | 47,9 |
| hanya kebijakan | 25,2 | 301,9 | 45,3 |
| keduanya | 31,1 | 149,8 | 46,2 |

Keramaian 150% (bawaan `npm run dev`):

| Varian | Pesanan ditahan | Stok habis (menit) | Komplain |
|---|---|---|---|
| tanpa belajar | 162,4 | 1393,4 | 112,1 |
| hanya prakiraan | 138,8 | 734,9 | 111,3 |
| hanya kebijakan | 80,0 | 652,6 | 112,3 |
| keduanya | 83,5 | 496,4 | 112,2 |

Jumlah seed yang pesanan ditahannya lebih sedikit daripada tanpa belajar: di keramaian 100%, prakiraan saja 6 dari 12, kebijakan saja 12 dari 12, keduanya 10 dari 12; di 150%, 10, 12, dan 12 dari 12.

## Yang bisa disimpulkan, dan yang tidak
- **Kafe yang belajar menahan lebih sedikit pesanan dan kehabisan bahan jauh lebih singkat**: pesanan ditahan turun sekitar 35% (keramaian 100%) dan 49% (150%), menit stok habis turun sekitar 79% dan 64%.
- **Pengubah terbesar untuk pesanan ditahan adalah kebijakan** (batas minimum yang dinaikkan setelah bos menyetujui), bukan prakiraan. **Prakiraan terutama memendekkan waktu stok habis** dan hampir tidak mengurangi pesanan ditahan sendirian (50,5 lawan 47,6 di keramaian 100%). Gabungan keduanya paling rendah di menit stok habis, tetapi sedikit lebih banyak menahan pesanan daripada kebijakan saja di keramaian 100% (31,1 lawan 25,2). Gua belum tahu penyebabnya; dugaan: usulan prakiraan yang menutupi sebuah bahan membuat usulan stok-tipis untuk bahan itu dilewati.
- **Komplain tidak berubah** (46,3 lawan 46,2; 112,1 lawan 112,2). Komplain datang dari menunggu lebih dari 20 menit, dan kemacetan ada di satu koki, bukan di bahan. Bahan bukan pengungkit untuk komplain di dunia ini.
- Di dua seed dari dua belas (keramaian 100%) kafe yang belajar menahan **lebih banyak** pesanan walau waktu stok habisnya jauh lebih pendek (seed 1: 45 jadi 87, seed 12: 39 jadi 41). Jadi hasilnya bukan jaminan di setiap hari, dan "ditahan" dihitung per kejadian (satu pesanan bisa ditahan lebih dari sekali).
- Jadwal prakiraan lain (09:00 dan 13:00, atau 09:00, 12:00, dan 16:00) dicoba dan tidak mengubah kesimpulan, jadi jadwal 10:00 dan 15:00 dipertahankan.
- `FakeLLM` adalah skrip dengan pendapat sendiri (dua kali batas minimum, sepersepuluh lebih banyak belanja); angka-angka ini mengukur **rangkaiannya**, bukan kualitas model. Model lokal dievaluasi di Tahap 6. Ini hasil simulasi dengan generator pelanggan dan pemasok tiruan, bukan prediksi bisnis sungguhan.

## Konsekuensi
- Cerita untuk kursus: "AI mengusulkan, manusia memutuskan, sistem berubah, dampaknya terukur" benar untuk pesanan ditahan dan stok habis, dan sama pentingnya: ada metrik (komplain) yang tidak bergerak, dan itu ditulis apa adanya.
- Kalau nanti komplain ingin dikurangi, pengungkitnya ada di kapasitas dapur, bukan di bahan.
