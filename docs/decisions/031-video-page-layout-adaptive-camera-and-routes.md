# 031: Layout halaman ala video, kamera adaptif, dan jalur jalan

Status: diterima (2026-11-24). Asal: revisi Tahap 4.

## Keputusan
- **Halaman ala video**: gambar 3D (16:9) besar di kiri; di bawahnya Karakter, Pesanan, dan Meja Bos; di kanan Kejadian (log) dengan tinggi tetap yang bisa digulir, dan Stok di bawahnya. Di layar sempit semuanya menumpuk.
- **Kamera adaptif**: sudut pandang vertikal bertambah saat gambar lebih sempit dari 16:9, supaya lebar ruangan tetap sama. Jarak, tinggi, dan sudut dicari dengan mencoba banyak nilai terhadap titik-titik yang harus selalu masuk gambar; tes memeriksa framing di rasio 1,4 sampai 3 dan di empat sudut putar.
- **Jalur jalan**: karakter dan pelanggan berjalan mengitari meja dan konter dan lewat pintu sekat, bukan lurus menembus. Pencari jalur murni: kisi 0,4 unit di atas lantai, A*, lalu jalurnya diluruskan. Hasilnya sama setiap kali, jadi posisi tetap fungsi murni dari state dan waktu (keputusan 027).
- Lama berjalan tetap dari domain (keputusan 003): karakter tiba tepat di ETA, dan hanya kecepatan di layar yang menyesuaikan panjang jalur.
- Denah disusun supaya jalur yang benar-benar dipakai Tahap 3 (kasir ke meja bos, rak ke meja bos) panjangnya dekat dengan tabel jarak domain (rasio 0,78 sampai 0,92). Jalur antar meja untuk Rina (Tahap 5) belum dicocokkan.

## Konsekuensi
- Tabel jarak domain dan denah 3D adalah dua hal berbeda yang dijaga dekat lewat tes, bukan disatukan.
