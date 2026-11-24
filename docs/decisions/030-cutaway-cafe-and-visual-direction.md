# 030: Kafe potongan (diorama), arah visual, dan penyimpangan dari brief

Status: diterima (2026-11-24). Asal: permintaan pemilik setelah melihat tampilan 3D pertama.

## Keputusan
- Brief bagian 11 meminta "bentuk primitif saja". Pemilik meminta tampilan jauh lebih bagus dan memberi gambar acuan (kafe potong isometrik, cahaya hangat, lampu gantung, panel kayu, dinding kaca depan dengan pintu). Persetujuan rencana revisi = persetujuan penyimpangan ini; bagian 11 brief mendapat satu baris rujukan ke keputusan ini.
- Kafe digambar sebagai **diorama potongan** di atas alas, latar gelap: aula dengan **dapur dan ruang bos yang dipisah sekat kayu dan kaca dengan pintu**, pintu masuk kaca ganda di depan, pintu samping, pintu WC, pot tanaman sepanjang kaca, bangku di dinding, panel kayu dan rak di belakang kasir dengan etalase kue dan mesin espresso, papan menu, lukisan, jam, jendela, lampu gantung, dan hiasan di meja (piring, cangkir, vas, gula).
- **Tujuh meja** untuk pelanggan. Tiga di antaranya adalah meja 1 sampai 3 di domain (untuk Rina di Tahap 5); empat sisanya hanya tempat duduk tambahan. Domain tidak diubah.
- **Seragam**: semua karyawan berbaju hijau dan bercelana putih, dibedakan lewat rambut dan topi koki. Bos berjas gelap. Pelanggan berpakaian beda-beda dari nomor pesanannya.
- Cahaya hangat, tone mapping ACES, bayangan lembut, dan sedikit pantulan dari ruangan polos kecil (`RoomEnvironment`).
- Semuanya **dibuat dari kode** (bentuk dasar bermaterial PBR). Rencana awal memakai aset CC0 Poly Haven; cek jaringan membuktikan aset itu bisa diambil (522 model, 1k sekitar 0,6 sampai 2,8 MB per model), tapi gaya acuan tercapai tanpa aset, jadi repo tetap kecil dan tanpa lisensi tambahan. Aset bisa ditambahkan nanti lewat `createAvatar` dan pemuat tanpa mengubah kode lain.
- Cek visual oleh pengembang memakai Chrome for Testing yang diunduh ke folder sementara (bukan ke repo, tanpa dependency).

## Alasan
Pemilik menilai primitif balok tidak menarik untuk kursus dan meminta kafe yang terlihat seperti kafe sungguhan.

## Konsekuensi
- Tampilan lebih berat (bayangan, banyak objek), tetap lancar untuk satu ruangan. Pelanggan dibatasi 14.
- Karakter tetap bergaya game, bukan foto.
