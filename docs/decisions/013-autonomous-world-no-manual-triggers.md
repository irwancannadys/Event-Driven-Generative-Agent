# 013: Dunia otonom, tanpa trigger manual

Status: diterima (2026-11-24). Asal: diskusi review Tahap 0.

## Keputusan
Dunia berjalan otomatis lewat **generator dunia** (seeded): pesanan datang dengan pola jam, komplain muncul karena sebab (pesanan menunggu lama plus peluang acak), perilaku pemasok diundi dari bobot. Tombol untuk manusia hanya: Setujui/Tolak di meja bos, serta kontrol waktu (pause, kecepatan, majukan waktu).

## Alasan
Lebih event-driven dan lebih realistis daripada tombol "pesanan masuk". Murid mengubah konfigurasi skenario, bukan mengklik tombol.

## Konsekuensi
- Generator dunia dibangun di Tahap 2. Tahap 1 memakai skrip demo.
- Tes butuh `AutoBoss` (skrip yang menyetujui laporan), hanya di tes.
- Laporan yang tidak diklik menunggu terus di v1.
