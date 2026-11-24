# Referensi Visual: Prototipe Kafe 3D

> Folder ini berisi **prototipe visual** yang dibuat saat tahap diskusi. Pemilik akan **menyesuaikan animasinya** nanti, jadi anggap ini **gambaran**, bukan kode yang harus disalin.
> Untuk konteks proyek, baca `PROJECT_BRIEF.md`. Untuk rencana kerja, baca `docs/PLAN.md`.

## File

- `cafe-prototype-v2.html`: satu file HTML mandiri. Buka dengan klik dua kali di browser. Butuh internet sekali untuk memuat Three.js dari CDN (versi r128). Proyek asli memakai Three.js dari npm.

## Apa yang diperlihatkan prototipe ini

- **Tata letak ruangan** dan posisi stasiun.
- **Karakter dari primitif** (silinder badan, bola kepala, kotak hidung sebagai penanda arah hadap).
- **Model tugas karakter:** antrean tugas berisi `goto`, `work`, dan `do`. Status yang tampil: `diam`, `jalan`, atau label aktivitas (mis. "memasak").
- **Label** di atas karakter dan stasiun (diproyeksikan dari posisi 3D ke layar).
- **Panel:** log kejadian dengan label (Trigger, Aturan, LLM (simulasi), Inisiatif, Bos), laporan di meja bos dengan tombol Setujui dan Tolak, bar stok, dan panel "Ingatan Rina".
- **Panel simulator:** pesanan masuk, stok habis, pelanggan komplain, langganan datang, majukan 30 menit.
- **Rak stok** menampilkan kotak sesuai jumlah stok (visual dari state nyata).
- **Alur yang sudah ada:** pesanan, kasir, koki, stok turun, `stock_low`, admin ke rak lalu ke meja bos, laporan, setuju lalu restock; komplain, kasir ke meja bos, laporan, setuju; pelanggan langganan datang sesuai kebiasaan, Rina menyiapkan meja lebih dulu, menyapa, lalu refleksi.

## Tata letak (satuan Three.js, sumbu x ke kanan, z ke arah kamera)

| Objek | Posisi (x, z) | Catatan |
|---|---|---|
| Meja kasir | (-5, -3.6) | Kasir berdiri di (-5.4, -2.2), menghadap antrean di kiri |
| Dapur | (5, -3.6) | Koki berdiri di (5, -2.2); panci di atas kompor bergoyang saat memasak |
| Rak stok (2 papan) | (6.9, 2.6) | Admin stok berdiri di (5.6, 2.6); kotak stok tersusun di papan |
| Meja bos | (-5.5, 3) | Bos duduk di (-5.5, 1.7) menghadap meja; karakter menyerahkan laporan dari z sekitar 4.4 |
| Meja pelanggan 1, 2, 3 | (-2.4, -0.5), (0, -0.5), (2.4, -0.5) | Penanda "siap" berupa piring dan cangkir |
| Rina (pelayan) | Posisi awal (0.6, 2.4) | Berdiri di depan meja saat melayani |
| Antrean pelanggan biasa | x = -7.2, z mulai -2.2, jarak 0.9 | Muncul dari kiri |
| Pelanggan langganan | Muncul dari (-9.5, 0) | Berjalan ke belakang meja pilihannya, duduk, lalu pergi |

Kamera: perspektif, sekitar (13 sin az, 8, 13 cos az) melihat ke (0, 0.6, 0.5), `az` dibatasi sekitar -0.5 sampai 0.5, digeser dengan drag.

Warna: lantai kayu hangat, dinding krem, karakter berbeda warna per peran (kasir oranye kemerahan, koki hijau, admin stok ungu, Rina kuning, bos gelap).

## Apa yang BOLEH diambil dari prototipe

- Tata letak dan proporsi ruangan.
- Cara menampilkan label dan status.
- Susunan panel (log, ingatan, laporan, stok, simulator) dan label di log.
- Gagasan "status karakter menentukan animasi".

## Apa yang JANGAN ditiru (prototipe sengaja menyederhanakan)

| Di prototipe | Di proyek asli |
|---|---|
| State (stok, laporan, memori) hidup di browser | State hidup di **server**, klien hanya membaca |
| Alur digerakkan `setTimeout` dan `setInterval` | Digerakkan **event log** dan **waktu virtual** di server |
| Aturan dan tampilan bercampur di satu file | `core` (domain murni), `server`, `web` terpisah |
| Posisi karakter berupa koordinat | Domain memakai **ID stasiun**; koordinat hanya di frontend |
| Durasi gerak ditentukan klien | Durasi tugas ditentukan **server**, klien menginterpolasi |
| Teks "LLM (simulasi)" berupa string tetap | Lewat `LLMClient` (`FakeLLM` lalu `OllamaLLM`) dengan validasi dan fallback |
| `Math.random` dan jam asli | Seeded RNG dan `SimClock` |
| Satu file besar | Modul terpisah dan teruji |

## Pemetaan prototipe ke arsitektur target

| Bagian prototipe | Rumah barunya |
|---|---|
| Antrean tugas agent (`G`, `Wk`, `Do`) | `core`: model agent dan tugas |
| `cook()`, `stockEv()`, `decide()` | `core`: aturan dan penangan event |
| Log dan label | `web`: panel log dari aliran event |
| `updRack()`, `updRep()` | `web`: render dari state klien |
| Tombol simulator | `web` memanggil API `server` yang menghasilkan event |
| Panel ingatan Rina | `web` membaca tabel `regulars` dan `memories` lewat snapshot |
