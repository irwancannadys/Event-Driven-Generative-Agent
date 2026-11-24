# 024: Usulan belanja dan triase komplain berbasis aturan

Status: diterima (2026-11-24). Asal: rencana Tahap 3.

## Keputusan
- **Usulan belanja ("isi sampai penuh"):** satu laporan memuat semua bahan yang tipis atau habis dan **belum tercakup** (usulan belum diputuskan, usulan disetujui yang belum dipesan, atau pesanan belanja yang masih berjalan). Jumlah = `capacity_qty` dikurangi stok sekarang. Urgensi `high` jika ada bahan yang habis, selain itu `normal`.
- **Satu `restock_ordered` per bahan:** pemasok tiruan per bahan (bobot dan lead time di `suppliers_mock` dan `ingredients`). Satu laporan bisa menghasilkan beberapa pesanan belanja. Pemasok kosong menghasilkan `restock_ordered` (tanpa ETA) lalu `restock_failed` di detik yang sama, dan admin menyiapkan usulan baru.
- **Laporan ditolak bos:** admin menunggu 1 jam virtual, lalu mengecek lagi. Tanpa ini satu penolakan menghentikan belanja selamanya, karena penanda `stock_low` hanya menyala sekali.
- **Laporan yang tidak diklik menunggu terus** (v1, keputusan 013). Pesanan yang butuh bahan itu tertahan sampai bos memutuskan.
- **Triase komplain** (hanya `slow_service` di Tahap 3): tunggu kurang dari 40 menit berarti tanpa kompensasi dan tanpa lapor bos, kurang dari 60 menit diskon 10% (lapor bos), selebihnya item gratis (lapor bos). Kompensasi baru berlaku bila bos setuju. `wrong_order` dan `quality` ditunda.
- Stasiun asal pelayan Rina: `table_2`. Barisnya dibuat saat `world_initialized`, perilakunya baru di Tahap 5.
- `AutoBoss` (menyetujui laporan otomatis) hanya ada di tes dan demo, bukan fitur produk.

## Alasan
Aturan ini adalah fallback yang disyaratkan brief dan sekaligus acuan tes. LLM di Tahap 6 menggantikan keputusannya lewat jalur `agent_decided` yang sama, dengan validasi dan fallback ke aturan ini.

## Konsekuensi
- Teks laporan dan balasan dibuat dari template berbahasa Indonesia dan disimpan sebagai string final di payload event (keputusan 015).
- Pada keramaian normal satu koki kewalahan di jam makan siang, jadi komplain `slow_service` muncul. Itu perilaku wajar dan bahan pelajaran, penyetelannya ada di konfigurasi skenario (Tahap 7).
- Dunia yang dibuat sebelum Tahap 3 tidak kompatibel (pesanan lama tanpa tugas). Hapus `data/cafe.db*` sekali.
- **Batas yang ditemukan saat uji nyata, lalu diatasi:** komplain `slow_service` muncul tepat di batas tunggu (`complaintWaitSec`, bawaan 20 menit) dan kasir butuh 1 menit untuk mencatat, jadi dengan pengaturan bawaan triase selalu menilai tingkat 1 (kurang dari 40 menit). Tingkat 2 dan 3 (kompensasi, lapor bos) baru tercapai dengan batas 40 menit atau lebih. Pemilik meminta pengaturannya dibuka: variabel lingkungan `COMPLAINT_WAIT_MIN` (menit, 1 sampai 1440, bawaan 20). Bawaannya tidak diubah supaya golden day Tahap 2 tetap sama.
