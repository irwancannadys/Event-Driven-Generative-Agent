# Panduan uji manual

Panduan ini buat lu yang mau mencoba sendiri hasil tiap tahap, langkah demi langkah. Dokumen ini ikut bertambah setiap tahap selesai. Semua isinya sudah gua jalankan sendiri (termasuk Ctrl+C dan restart sungguhan) sebelum ditulis.

Semua perintah dijalankan dari folder repo (`/Users/irwancannady/lesson`) di terminal.

## 0. Persiapan (sekali saja)

```
node -v          # harus v22 atau lebih baru
npm install      # pasang dependency
```

## 1. Tes otomatis

```
npm test
```

**Yang diharapkan:** baris terakhir seperti `Tests  1156 passed (1156)` (angkanya naik tiap tahap) dan tidak ada tulisan `failed`. Kalau ada yang merah, nama tesnya menunjukkan bagian mana yang rusak.

Pemeriksaan lain yang cepat: `npm run lint`, `npm run typecheck`, `npm run format:check`. Ketiganya tidak boleh mencetak error.

## 2. Demo Tahap 1: pesanan, stok, dan replay

```
npm run demo:stage1
```

**Yang dicari di log:**

- `stock_low  ingredient_id=susu` muncul **sekali saja** (sekitar 08:37), tidak berulang.
- `stock_low` dan `stock_out` untuk `nasi` muncul bersamaan.
- `order_held` di akhir: pesanan ditahan karena nasi habis.
- Baris terakhir: `Replay check: OK`.

**Artinya:** stok berkurang sesuai resep, peringatan tidak berulang, dan state yang dibangun ulang dari log sama persis dengan state yang berjalan.

## 3. Demo Tahap 2: satu hari penuh dalam hitungan detik

```
npm run demo:stage2
```

**Yang dicari:**

- `day_opened` jam 08:00, pesanan datang (paling ramai sekitar jam makan siang), tiga `regular_expected` (08:05, 11:35, 16:35), beberapa `complaint_received`, lalu `day_closed` jam 20:00.
- Di ringkasan: grafik batang "Pesanan per jam" (jam 12 dan 13 tertinggi), sekitar 75 pesanan dan 13 komplain untuk seed 42.
- Dua baris terakhir: `Replay check: OK` dan `Restart check: OK`.

**Artinya:** hari yang sama bisa dijalankan sekali jalan atau diputus di tengah (server dimatikan jam 12:07 lalu dinyalakan lagi), dan hasilnya identik.

## 4. Demo Tahap 3: satu hari dengan karakter dan bos otomatis

```
npm run demo:stage3
```

Satu hari penuh, tapi sekarang ada kasir, koki, dan admin stok yang bekerja, dan bos yang dimainkan komputer (ia menyetujui laporan 10 menit setelah sampai di mejanya, kecuali setiap laporan keempat yang ia tolak).

**Yang dicari di log:**

- `order_created`, lalu `cooking_started` dan beberapa `stock_decreased`, lalu `cooking_done`. Pesanan sekarang benar-benar dimasak, satu per satu oleh satu koki.
- Sekitar 13:01 `stock_low ingredient_id=susu`, disusul `agent_think_requested`, `agent_decided`, `restock_proposed`, `report_submitted`, `[Bos] report_decided`, `restock_ordered` (ada `supplier=on_time` atau `late`, dan jam `eta_sim_time`), lalu nanti `restock_arrived`.
- `order_held` (pesanan ditahan karena susu kurang) dan beberapa saat kemudian `order_resumed` setelah stok datang.
- `complaint_received` yang dijawab kasir (`complaint_triaged` lalu `complaint_replied`).
- Event `agent_task_*` dan `agent_state_changed` **sengaja tidak tampil**: itu "kabel" gerak karakter, bukan cerita. Isinya tetap ada di database.

**Di ringkasan (seed 42):**

```
Pesanan: 75 masuk, 75 selesai, 0 ditahan, 0 masih diproses (3 kali sempat ditahan karena bahan kurang)
Belanja: 6 laporan ke meja bos (5 disetujui, 1 ditolak, 0 menunggu), pemasok tepat waktu 3, telat 2, kosong 0
Komplain: 4 masuk, 4 dibalas (0 lewat bos)
Replay check: OK (state hasil replay dari log sama dengan state live)
Restart check: OK (restart pukul 12:07 memberi log yang identik)
```

**Artinya:** satu laporan yang ditolak diikuti usulan baru, tiga pesanan sempat tertahan lalu lanjut, dan hasilnya sama persis walau server dimatikan di tengah (jam 12:07, saat koki sedang memasak).

## 5. Server hidup: `npm run dev`

### 5.1 Nyalakan

```
npm run dev
```

**Kalau lu masih punya `data/cafe.db` dari Tahap 2, hapus dulu: `rm -f data/cafe.db*`.** Server baru tidak crash di atas dunia lama (gua coba), tapi pesanan dan komplain yang sudah ada di dunia itu tidak punya karakter yang mengurusnya, jadi mereka tertinggal berstatus `placed` dan `received` selamanya.

Biarkan terminal ini terbuka. Server memakai file `data/cafe.db` dan API di `http://127.0.0.1:3000`. Jam virtual berjalan **60 kali lebih cepat** dari jam asli (1 detik asli = 1 menit virtual).

**Yang dicari** (setelah beberapa baris `> dev` dari npm):

```
=== Server kafe virtual ===
Database : /Users/irwancannady/lesson/data/cafe.db
API      : http://127.0.0.1:3000  (GET /time /menu /stock /orders /agents /reports, POST /orders /time /reports/:id/decision)
Realtime : ws://127.0.0.1:3000/ws  (halaman web: snapshot, event, jam)
Kecepatan: 60x (1 detik asli = 60 detik virtual)
Dunia baru dibuat: jam 07:50, hari 0, seed 42
Tekan Ctrl+C untuk berhenti. Jam virtual disimpan saat berhenti.
07:50  [Aturan]     world_initialized      seed=42 ...
```

Sekitar 10 detik kemudian muncul `day_opened` (jam 08:00), lalu pesanan masuk berkala.

### 5.2 Pakai terminal kedua untuk `curl`

Buka tab terminal baru (server di tab pertama tetap jalan).

```
curl -s localhost:3000/time        # jam virtual sekarang, hari, kecepatan, paused
curl -s localhost:3000/menu        # menu beserta resep
curl -s localhost:3000/stock       # stok tiap bahan
curl -s -X POST localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"items":[{"menu_item_id":"kopi_susu","qty":1}]}'
```

Pesanan manual terakhir muncul juga di log server sebagai `order_created`. Tambahkan `| python3 -m json.tool` di belakang `curl` kalau mau hasilnya rapi.

### 5.3 Kontrol waktu

```
# lebih cepat: 600x (1 detik asli = 10 menit virtual)
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"speed":600}'

# jeda dan lanjut
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"paused":true}'
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"paused":false}'

# majukan 30 menit virtual sekaligus (dicatat sebagai sim_time_advanced)
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"advance_seconds":1800}'
```

**Yang dicari:** saat dijeda, log berhenti dan `/time` tidak bergerak. Saat dimajukan 30 menit, baris `sim_time_advanced` muncul diikuti semua kejadian di rentang itu, berurutan, tidak ada yang terlewat. Nilai yang tidak masuk akal (mis. `{"speed":0}`) ditolak dengan HTTP 400.

### 5.4 Uji pemulihan (inti desain kita)

1. Biarkan server jalan sampai ada beberapa event. Catat jam dari `curl -s localhost:3000/time`.
2. Matikan server dengan **Ctrl+C**. Harus muncul `mematikan server...` lalu `Jam virtual disimpan. Sampai jumpa.`
3. Hitung event yang tersimpan:
   ```
   sqlite3 data/cafe.db "select count(*) from events"
   ```
4. Nyalakan lagi: `npm run dev`.

**Yang dicari:** pesan seperti

```
Dunia dipulihkan dari log: 20 event dibaca ulang, jam 10:00, hari 0, seed 42
```

Angka event harus sama dengan hasil `sqlite3` tadi, jam lanjut dari titik terakhir (bukan balik ke 07:50), dan log lanjut **tanpa event dobel** (`day_opened` tidak muncul dua kali untuk hari yang sama).

Dua hal yang **sengaja tidak** dipulihkan: kecepatan kembali ke `SPEED` (atau 60), dan server selalu mulai tidak dijeda. Itu pengaturan menjalankan, bukan bagian dari dunia.

### 5.5 Uji determinisme (seed)

"Kebetulan" di simulasi ini ditentukan oleh seed, jadi dua dunia dengan seed sama harus identik. Pakai kecepatan tinggi biar cepat kelihatan.

```
rm -f data/cafe.db*
SEED=42 SPEED=3600 npm run dev     # catat 5 sampai 10 baris pertama setelah day_opened, lalu Ctrl+C
rm -f data/cafe.db*
SEED=42 SPEED=3600 npm run dev     # baris yang sama persis (jam dan isi pesanan)
rm -f data/cafe.db*
SEED=7  SPEED=3600 npm run dev     # pesanan berbeda
```

Satu hal yang juga bisa dicoba: nyalakan dunia dengan `SEED=42`, matikan, lalu nyalakan lagi dengan `SEED=999` **tanpa** menghapus `data/cafe.db`. Log tetap menyebut `seed 42`: dunia yang sudah ada memakai seed yang tersimpan di log-nya, bukan seed dari pengaturan.

### 5.6 Mulai dari nol

```
rm -f data/cafe.db*
```

Lalu `npm run dev` membuat dunia baru dari awal.

### 5.7 Pengaturan lain (opsional)

Semua lewat variabel lingkungan atau file `.env` (salin dari `.env.example`):

| Variabel | Arti | Default |
|---|---|---|
| `PORT` | port API | 3000 |
| `SPEED` | detik virtual per detik asli (1 sampai 3600) | 60 |
| `SEED` | seed dunia **baru** | 42 |
| `CROWD_PCT` | keramaian, 100 = hari biasa, 200 = dua kali lipat (server mulai di 150 supaya sering ada kejadian; di atas 250 satu koki tertinggal berjam-jam) | 150 |
| `COMPLAINT_CHANCE_PCT` | peluang pesanan yang menunggu sampai batas waktu komplain jadi komplain | 15 |
| `COMPLAINT_WAIT_MIN` | menit virtual menunggu sebelum pesanan bisa dikomplain (1 sampai 1440) | 20 |
| `LLM_PROVIDER` | `fake` (FakeLLM, skrip), `off` (aturan saja) atau `ollama` (model sungguhan, lihat bagian 11) | fake |
| `OLLAMA_URL` / `OLLAMA_MODEL` / `OLLAMA_TIMEOUT_SEC` | alamat Ollama, model yang ditanya, dan detik asli menunggu satu jawaban (hanya untuk `ollama`) | `http://127.0.0.1:11434` / `qwen3:4b` / 60 |
| `STOCK_FORECAST` | `on` atau `off`: Admin Stok memperkirakan dan memesan jam 10:00 dan 15:00 | on |

Nilai yang salah (mis. `SPEED=abc`) membuat server menolak nyala dengan pesan yang menyebut nama variabelnya.

## 6. Tahap 3 langsung: karakter bekerja dan lu jadi bos

Ini inti Tahap 3. Buka **tiga tab terminal**, semuanya di folder repo.

### 6.1 Siapkan

```
rm -f data/cafe.db*        # tab 1: dunia baru
npm run dev                # tab 1: server (biarkan jalan)
npm run watch              # tab 2: papan pantau (biarkan jalan)
```

Tab 3 buat perintah `curl`. Papan di tab 2 digambar ulang tiap detik. Kalau server belum nyala, papan bilang `Belum bisa menyambung ke server...` dan menyambung sendiri begitu server siap. Kalau lu pakai port lain (`PORT=3100`), jalankan juga `PORT=3100 npm run watch`.

Percepat dunia biar tidak menunggu lama (600x: satu detik asli = 10 menit virtual):

```
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"speed":600}'
```

### 6.2 Lihat karakter bekerja

Setelah `day_opened` (08:00) dan pesanan mulai masuk, papan menampilkan seperti ini (cuplikan asli dari jalan sungguhan, bagian atasnya):

```
=== Cand's Coffee ===  hari 0, 13:11  ·  kecepatan 600x
────────────────────────────────────────────────────────────────────────
KARAKTER
  Kasir           Kasir      bekerja: mencatat pesanan (sampai 13:11)
  Koki            Dapur      bekerja: memasak (sampai 13:23), antre 4
  Admin Stok      Rak Stok   berjalan ke Rak Stok (sampai 13:12)
  Rina (pelayan)  Meja 2     idle

PESANAN
  menunggu 5 · dimasak 1 · ditahan (bahan kurang) 0
    #31 12:47 nasi_goreng×2  [dimasak]
    #32 12:50 kopi_susu×1  [menunggu]
...
```

**Yang dicari:** kasir `bekerja: mencatat pesanan` selama 45 detik virtual, lalu koki `bekerja: memasak` sampai jam yang tertulis. `antre 4` artinya koki punya empat tugas lagi di belakang yang sedang ia kerjakan. Pesanan bergeser dari `menunggu` ke `dimasak`, lalu ke daftar `selesai terakhir`. Stok di bagian STOK turun sesuai resep. Satu koki saja, jadi di jam makan siang pesanan mengantre.

Datanya yang sama bisa dilihat mentah:

```
curl -s localhost:3000/agents | python3 -m json.tool
curl -s 'localhost:3000/orders?status=held'
```

### 6.3 Sampai ada laporan di meja bos

Dunia normal memunculkan laporan pertama sendiri (sekitar pukul 13:00, ketika susu menyentuh batas minimum): pada 600x itu sekitar 30 detik asli. Admin stok jalan ke rak, mengecek (90 detik virtual), memutuskan, jalan ke meja bos, dan menyerahkan laporan. Di papan, baris `Admin Stok` berganti-ganti: `berjalan ke Rak Stok`, `bekerja: mengecek stok`, `berjalan ke Meja Bos`, `bekerja: menyerahkan laporan`.

**Jalan pintas** kalau lu tidak mau menunggu sampai siang: pesan 10 kopi susu lewat kasir mock (susu langsung menyentuh batasnya). Laporan sampai di meja bos sekitar 7 menit virtual kemudian.

```
curl -s -X POST localhost:3000/orders -H 'content-type: application/json' \
  -d '{"items":[{"menu_item_id":"kopi_susu","qty":10}]}'
```

Begitu laporan sampai, papan punya bagian ini, lengkap dengan perintah yang tinggal lu salin:

```
MEJA BOS  (1 laporan menunggu keputusan lu)
  #1 [belanja] Usul belanja: Susu
     Urgensi: normal.
     Susu: pesan 5000 ml (stok 1000 dari 6000).
     setujui: curl -s -X POST http://127.0.0.1:3000/reports/1/decision -H 'content-type: application/json' -d '{"decision":"approved"}'
     tolak  : curl -s -X POST http://127.0.0.1:3000/reports/1/decision -H 'content-type: application/json' -d '{"decision":"rejected"}'
```

Daftarnya juga ada di `curl -s 'localhost:3000/reports?status=submitted' | python3 -m json.tool`.

### 6.4 Jadi bos: setujui

```
curl -s -X POST localhost:3000/reports/1/decision -H 'content-type: application/json' -d '{"decision":"approved"}'
```

**Yang dicari:** balasan berisi laporan dengan `"status":"approved"`. Di log server muncul `[Bos] report_decided report_id=1 decision=approved`. Admin stok jalan balik ke rak dan memesan ke pemasok (60 detik virtual), lalu muncul `restock_ordered ... supplier=on_time eta_sim_time=HH:MM`. Susu butuh sekitar 2 jam virtual (12 detik asli pada 600x): di jalan gua `restock_ordered` jatuh pukul 13:13 dengan `eta_sim_time=15:13`, dan tepat 15:13 muncul `[Trigger] restock_arrived`. Di `curl -s localhost:3000/stock` susu naik lagi dan `"low":false` (gua lihat 4950 ml, bukan 6000, karena koki sudah memakai sebagian selama dua jam itu).

Pemasoknya diundi dari bobot di tabel `suppliers_mock`, hasilnya tetap untuk seed yang sama: `on_time` (tepat), `late` (lebih lambat dari biasanya), atau `out` (kosong: `restock_failed`, lalu admin menyiapkan usulan baru).

Kalau ada pesanan yang tadinya `ditahan (bahan kurang)` (lihat `curl -s 'localhost:3000/orders?status=held'`), begitu stok datang muncul `order_resumed` dan pesanan itu dimasak.

### 6.5 Jadi bos: tolak

Pakai laporan berikutnya:

```
curl -s -X POST localhost:3000/reports/2/decision -H 'content-type: application/json' -d '{"decision":"rejected"}'
```

**Yang dicari:** `report_decided ... decision=rejected` dan tidak ada `restock_ordered`. Admin menunggu 1 jam virtual (papan: `bekerja: menunggu sebelum cek ulang`), mengecek lagi, dan kalau stok masih tipis menyerahkan **laporan baru** (id berikutnya).

### 6.6 Salah pakai (gua sudah coba semuanya)

| Perintah | Hasil |
|---|---|
| keputusan untuk laporan yang tidak ada (`/reports/99/decision`) | `404` `report_not_found` |
| memutuskan laporan yang sama dua kali | `409` `report_not_submitted` |
| memutuskan laporan yang admin belum sampaikan (masih dibawa jalan) | `409` yang sama |
| `{"decision":"maybe"}` atau JSON rusak | `400` |
| `GET /reports?status=waiting` | `400` `invalid_query` |

### 6.7 Uji pemulihan dengan karakter

1. Tunggu sampai koki sedang memasak (papan: `bekerja: memasak (sampai ...)`). Catat `curl -s localhost:3000/agents`: id tugas koki.
2. **Ctrl+C** di tab 1. Harus muncul `mematikan server...` lalu `Jam virtual disimpan. Sampai jumpa.` Papan di tab 2 bilang tidak bisa menyambung.
3. `npm run dev` lagi. Harus muncul `Dunia dipulihkan dari log: N event dibaca ulang, jam ...`, dan papan menyambung sendiri.

**Yang dicari:** koki masih mengerjakan **tugas yang sama** (id sama di `/agents`), pesanannya sama, laporan yang menunggu di meja bos tetap ada, dan setelah waktu lewat `cooking_done` muncul tepat satu kali untuk pesanan itu. Gua uji ini di proses sungguhan: restart di tengah tugas memasak, hasilnya tidak ada pesanan yang dimasak dua kali.

### 6.8 Kalau lu tidak mengklik

Laporan yang dibiarkan menunggu terus menunggu (aturan v1, keputusan 024). Bahan itu tidak dipesan, jadi pesanan yang butuh bahan itu `ditahan (bahan kurang)` dan menumpuk di papan. Itu **wajar**, bukan bug: itulah akibat bos yang tidak bekerja. Setujui laporannya, dan pesanan yang tertahan lanjut sendiri.

### 6.9 Komplain yang sampai ke bos

Aturan kasir: menunggu kurang dari 40 menit dijawab sendiri (permintaan maaf), 40 sampai 60 menit mengusulkan diskon 10%, lebih dari itu item gratis. Dua yang terakhir harus disetujui bos. Karena komplain muncul tepat di batas `COMPLAINT_WAIT_MIN` (bawaan 20 menit), geser batasnya dan percepat dunia, jadi tidak perlu menunggu:

```
rm -f data/cafe.db*
COMPLAINT_WAIT_MIN=45 COMPLAINT_CHANCE_PCT=100 npm run dev          # tab 1 (65 untuk item gratis)
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"speed":600}'   # tab 3
```

Pada 600x, komplain pertama tiba di meja bos sendiri sekitar pukul 14:00 (gua ukur 38 detik asli), tanpa lu ngapa-ngapain. Mau lebih cepat lagi: pesan 10 nasi goreng (dimasak 80 menit, jadi pasti terlambat) dan majukan waktu `{"advance_seconds":3600}`. Papan menampilkan:

```
MEJA BOS  (1 laporan menunggu keputusan lu)
  #1 [komplain] Komplain: layanan lambat (pesanan #1)
     Pesanan #1 menunggu 46 menit. Usul balasan: Mohon maaf atas keterlambatan pesanan #1. Kami beri diskon 10% untuk pesanan berikutnya. Kompensasi usulan: diskon 10% untuk pesanan berikutnya.
     setujui: curl -s -X POST http://127.0.0.1:3000/reports/1/decision -H 'content-type: application/json' -d '{"decision":"approved"}'
     tolak  : curl -s -X POST http://127.0.0.1:3000/reports/1/decision -H 'content-type: application/json' -d '{"decision":"rejected"}'
```

**Yang dicari:** kasir berjalan ke meja bos membawa laporan (papan: `berjalan ke Meja Bos`, lalu `bekerja: menyerahkan laporan`), dan **pelanggan belum dijawab sampai lu memutuskan**. Setujui: kasir kembali ke mejanya dan `complaint_replied ... compensation=discount_10` muncul. Tolak: `compensation=none`. Batas 65 menit memberi `free_item`.

Gua uji keempatnya di server sungguhan (45 menit disetujui, 45 menit ditolak, 65 menit, dan satu hari biasa dengan 100% peluang komplain): semuanya selesai dalam hitungan detik asli.

## 7. Yang wajar dilihat, dan yang belum ada

- **Koki kewalahan di jam makan siang.** Ada satu koki dan pesanan sekitar 14 per jam, jadi antrean menumpuk dan komplain "layanan lambat" muncul. Itu perilaku yang wajar dan bahan pelajaran tentang bottleneck, bukan bug. Kasir menjawab komplain sendiri dengan template permohonan maaf.
- **Komplain ringan dijawab kasir sendiri.** Di pengaturan bawaan komplain muncul di menit ke-20 menunggu, dan kasir (kurang dari 40 menit) langsung membalas dengan permintaan maaf tanpa menyusahkan bos. Mau lihat komplain yang sampai ke meja bos? Lihat bagian 6.9.
- Teks laporan dan balasan komplain masih **template**. Sejak Tahap 5 Admin Stok memakai `FakeLLM` (skrip) untuk belanja dan review malam (bagian 10), dan sejak Tahap 6 bisa memakai model sungguhan lewat Ollama (bagian 11); kasir dan koki tetap aturan.
- Rina (pelayan) ada di papan di Meja 2 dan memang tetap diam: perannya dibuang dari Tahap 5 (keputusan 034). Status `Mikir...` dipakai Admin Stok saat menunggu model sungguhan (bagian 11).
- Tampilan 3D ada sejak Tahap 4 (lihat bagian 9).
- Setelah `day_closed` (20:00) sampai `day_opened` hari berikutnya tidak ada pesanan baru, tapi karakter menyelesaikan sisa tugasnya. Percepat dengan `{"speed":3600}` atau `{"advance_seconds":...}`.

## 8. Kalau ada yang aneh

| Gejala | Kemungkinan penyebab dan cara cek |
|---|---|
| `EADDRINUSE` saat `npm run dev` | Port 3000 dipakai. Jalankan dengan `PORT=3100 npm run dev` (dan ganti port di perintah `curl`) |
| `SPEED must be between 1 and 3600` (atau variabel lain) | Nilai di `.env` atau di perintah salah. Pesannya menyebut variabel yang bermasalah |
| Server tidak mau nyala dan menyebut database | File `data/cafe.db` rusak atau dikunci proses lain. Matikan semua `npm run dev`, lalu `rm -f data/cafe.db*` |
| Log tidak bergerak | Mungkin sedang dijeda. Cek `curl -s localhost:3000/time` |
| Log terlalu lambat | Naikkan kecepatan: `{"speed":600}` |
| `sqlite3: command not found` | Langkah itu opsional. Lewati saja |
| `watch` bilang `Belum bisa menyambung ke server` | Server belum nyala atau port-nya beda. Nyalakan `npm run dev`, atau samakan: `PORT=3100 npm run watch` (atau `CAFE_API_URL=http://127.0.0.1:3100`) |
| Laporan tidak kunjung muncul | Belum ada bahan yang menyentuh batas minimum. Percepat dunia (`{"speed":600}`) atau pakai jalan pintas 10 kopi susu (bagian 6.3) |
| `409` saat menyetujui laporan | Laporan belum sampai di meja bos (admin masih jalan) atau sudah diputuskan. Lihat yang siap: `curl -s 'localhost:3000/reports?status=submitted'` |
| Pesanan `ditahan` tidak lanjut | Laporan belanjanya belum diklik, atau pemasok `late` atau `out`. Cek `curl -s localhost:3000/reports` dan baris `restock_ordered ... supplier=` di log |
| Banyak pesanan `placed` dan `received` yang tidak bergerak dari hari lama | Itu sisa dunia Tahap 2. `rm -f data/cafe.db*` lalu nyalakan lagi |

## 9. Tahap 4: halaman web dengan kafe 3D

Sejak Tahap 4 lu **tidak perlu `curl`** lagi: semuanya bisa dilihat dan diklik di browser.

### 9.1 Nyalakan (dua tab)

```
rm -f data/cafe.db*     # dunia baru (wajib kalau masih ada dunia lama: event dan kolom pesanan berubah di revisi ini)
npm run dev             # tab 1: server, biarkan jalan
npm run web             # tab 2: halaman, biarkan jalan
```

Buka alamat yang dicetak tab 2 (biasanya `http://localhost:5173`; kalau port itu terpakai Vite pindah ke 5174, dan seterusnya). Restart server (tab 1) setiap kali kode server berubah, karena protokolnya ikut berubah.

### 9.2 Yang dicari

- **Pojok atas:** pita teal tua dengan logo hitam-putih (cangkir kopi dengan uap) dan nama **Cand's Coffee** ("Coffee" berwarna amber) di kiri, dan di kanan pil berisi titik hijau (koneksi hidup) dan jam virtual. Palet warnanya dari token yang lu berikan (teal tua, amber, mint, abu kehijauan); tampilannya terang dan tidak ikut mode gelap sistem.
- **Pil jam** membuka menu **Kontrol waktu** (gelap, senada pita): status koneksi dan kecepatan, Jeda, kecepatan (1x sampai 3600x, yang aktif berwarna amber), majukan waktu, dan tautan Panel saja. Menu tetap terbuka selagi lu menekan beberapa kontrol; klik di mana saja di luar menu atau tekan Escape untuk menutupnya. Klik **600x** supaya cepat.
- **Sidebar kanan:** **Meja bos** (kartu gelap dengan pil "N menunggu"; tiap usulan punya baris bahan dengan jumlah yang dipesan dan tombol **Setujui** mint dan **Tolak** berbingkai), **Stok** (bar per bahan, chip Habis / Rendah / Aman, dan jumlah yang habis dan rendah di pojok) dan **Kejadian** (log dengan filter Semua / Aturan / Trigger / LLM / Bos; jamnya hanya tampil di baris pertama tiap menit). Klik judul Stok atau Kejadian untuk melipatnya (panah ▾ dan ▸); lipatan diingat di browser.
- **Kartu di bawah gambar:** **Pesanan** (angka besar yang menunggu, bar, tiga kotak Menunggu / Dimasak / Ditahan, jumlah selesai di pojok), **Komplain**, **Karakter** (lingkaran huruf, nama, tempat dan sampai jam berapa, pil Idle atau tugasnya; "N dari 4 bekerja" di pojok) dan **Admin Stok** (lihat bagian 10). Kartu setinggi isinya sendiri.
- **Gambar besar di kiri:** kafe potong di atas alas. Dapur (kanan belakang) dan ruang bos (kiri belakang) dipisah sekat kaca dengan pintu. Pintu masuk kaca di depan, tujuh meja, kasir di tengah belakang dengan etalase dan papan menu, rak stok di belakang, bangku, lukisan, tanaman, lampu gantung.
- **Karyawan** berbaju hijau dan bercelana putih (koki bertopi putih), bos berjas gelap di ruangnya. Label di atas kepala menyebut nama dan sedang apa. Ada cewek (kasir dan Rina: rambut panjang atau sanggul, bibir merah) dan cowok (admin stok, koki berjenggot, bos). Pelanggan juga campur: ada yang berambut panjang atau dikuncir, ada yang berjenggot.
- **Rina (pelayan) diam.** Dia ada di denah dan di panel Karakter sebagai dekor dan cuma idle di mejanya: ingatan, inisiatif, dan refleksi dikerjakan Admin Stok (keputusan 034).
- **Langkah kaki** mengikuti jarak yang ditempuh: ayunan kaki dan tangan sesuai panjang langkah, dan berhenti begitu karakter berhenti. Di kecepatan sangat tinggi ayunannya dibatasi supaya tidak berkedip.
- **Pelanggan** masuk lewat pintu depan (log: "Pelanggan masuk ke kafe"), berjalan ke kasir selama 200 detik virtual (sepelan karyawan), dan **sampai di kasir tepat saat log mencatat "Pesanan #N masuk"**. Saat itu label kasir jadi "bekerja: mencatat pesanan" dan pelanggan berdiri di depannya sampai kasir selesai (bukan semenit tetap). Lalu ia duduk atau berdiri menunggu, mengambil pesanan di **jendela dapur** (piringnya muncul di sana), dan pulang. Gelembung `!` merah = komplain, "Menunggu bahan" = pesanan ditahan, "Siap!" hijau = masakan selesai. Lebih dari 20 orang jadi tulisan "+N antre". Keramaian bawaan (`CROWD_PCT=150`) membuat pesanan masuk lebih rapat.
- **Admin stok** jalan ke rak, ke ruang bos lewat pintunya, menaruh **kertas laporan** di meja bos, lalu pulang. Kotak di **rak stok** berkurang sesuai stok (merah-oranye = hampir habis).
- **Komplain:** kartu sendiri di sebelah Pesanan. Tiap komplain menunjukkan pesanannya, penyebabnya (layanan lambat, pesanan salah, kualitas), posisinya (**dicatat kasir**, **menunggu keputusan bos**, **dibalas**), berapa lama menunggu atau dibalas dalam berapa lama, dan kompensasinya (usulan kasir selagi menunggu bos, yang diberikan setelah dibalas). Yang menangani tetap kasir, sesuai brief. Untuk melihatnya cepat: `COMPLAINT_CHANCE_PCT=100 COMPLAINT_WAIT_MIN=10 npm run dev`, lalu **+1 jam** beberapa kali.
- **Setujui/Tolak** ada di kartu Meja bos (ganti `curl`). Karyawan yang tidak sedang bekerja tertulis `Idle`.
- **Geser** gambar dengan mouse: kiri-kanan memutar kamera sedikit, **atas-bawah** menurunkan atau mengangkat kamera (dari sejajar meja sampai hampir tegak lurus dari atas). Seluruh kafe tetap masuk gambar di semua sudut.
- Latar gambar dan alas kafe memakai warna `scene-bg` dari token lu (abu kehijauan muda).

### 9.3 Uji ketahanan

1. **Refresh** halaman: dunia sama, log terisi sejak awal.
2. **Jeda** lalu **Lanjut**: semua karakter dan pelanggan berhenti dan jalan lagi.
3. **+1 jam**: semua langsung loncat ke posisi yang benar, tanpa karakter menembus dinding.
4. **Ctrl+C di tab 1**: banner merah "Terputus" di atas gambar dan jam berhenti. Nyalakan lagi: halaman menyambung sendiri dan dunia lanjut.
5. Tambahkan `?view=panel` di alamat: hanya panel (tanpa 3D). `?view=3d` kembali ke gambar.

### 9.4 Yang wajar

- Karakter bergaya game, bukan foto. Warna dan terang-gelap bisa disetel: kirim screenshot.
- Empat dari tujuh meja hanya tempat duduk tambahan; domain hanya mengenal tiga meja.
- Kalau lu melihat pelanggan "melompat", cek dulu apakah waktu baru dimajukan: itu wajar.
- Pesanan manual lewat `curl` (`POST /orders`) tidak punya pelanggan yang masuk lewat pintu: pelanggannya langsung muncul di kasir. Pesanan dari generator selalu didahului pelanggan yang masuk.
- Karyawan bisa berjalan menembus pelanggan yang sedang berdiri (jalurnya hanya menghindari perabot, belum menghindari orang).
- Gua sudah mengaudit gerak lawan log selama satu hari penuh (`tools/scene-audit.test.ts`, di keramaian 100% dan 250%): kasir yang "mencatat" pesanan X selalu punya pelanggan X berdiri di depannya, kasir tidak pernah idle selagi ada yang menunggu dicatat, pelanggan masuk lewat pintu dan sampai tepat saat pesanan tercatat, tak ada yang berjalan menembus perabot atau melompat, dan tak ada dua pelanggan di titik yang sama. Itu bukan jaminan bebas bug: kalau lu lihat yang janggal, kirim screenshot dan jamnya.
- Rina tidak mengantar makanan (keputusan 034): pelanggan mengambil sendiri di jendela dapur.

## 10. Tahap 5: Admin Stok yang merencanakan dan belajar

Admin Stok sekarang punya tiga kebiasaan baru, semuanya lewat `FakeLLM`: **memperkirakan** pemakaian bahan dan memesan sebelum habis (jam 10:00 dan 15:00, hanya kalau sedang idle), **mereview** hari itu tiap malam dan mengusulkan **paling banyak satu** perubahan batas minimum bahan ke Meja bos, dan **belajar**: malam berikutnya dia menilai apakah perubahan yang lu setujui membantu, lalu menulis catatan. Usulan yang ditolak atau tidak membantu tidak diulang.

Penting: `FakeLLM` adalah skrip yang jawabannya tetap dan punya pendapat sendiri (pesan 10% lebih banyak, batas minimum 2x), bukan model. Yang dites di sini adalah **rangkaiannya** (data, usulan, persetujuan, perubahan, hasil); kualitas model baru di Tahap 6.

### 10.1 Demo satu perintah

```
npm run demo:stage5            # 4 hari, Admin Stok belajar, bos otomatis menyetujui
npm run demo:stage5 -- --off   # pembanding: tanpa prakiraan, bos menolak semua usulan kebijakan
```

**Yang diharapkan** (seed 42):

- Baris berlabel `[LLM]`: `restock_proposed` (prakiraan jam 10:00 dan 15:00 maupun saat stok tipis), `daily_review_created` dan `policy_proposed` jam 20:03, lalu `policy_changed` (bos otomatis menyetujui) dan `memory_created` jenis `reflection` malam berikutnya.
- Bagian "Per hari" dan "Kebijakan yang berlaku" (Susu 1000 jadi 2000 ml, Gula 300 jadi 600 g) dan "Catatan Admin Stok".
- Dengan belajar: jumlah **9 kali ditahan, 27 komplain, stok habis 8 menit**. Dengan `-- --off`: **16 kali ditahan, 27 komplain, stok habis 126 menit**, dan catatan "Bos menolak usul ... Jangan diulang".
- Dua baris terakhir `Replay check: OK` dan `Restart check: OK`.

### 10.2 Eksperimen: apakah benar membaik?

```
npm run experiment:stage5                # keramaian 100%, 7 hari, 12 seed (±30 detik)
npm run experiment:stage5 -- 150 7 12    # keramaian, jumlah hari, jumlah seed
```

Mencetak empat varian (tanpa belajar, hanya prakiraan, hanya kebijakan, keduanya). Hasil gua ada di [keputusan 036](decisions/036-what-the-learning-admin-achieves.md): pesanan ditahan turun ±35% (keramaian 100%) dan ±49% (150%), stok habis turun ±79% dan ±64%, **komplain tidak berubah** (kemacetan ada di satu koki, bukan di bahan). Di 2 dari 12 seed kafe yang belajar justru menahan lebih banyak pesanan. Itu hasil simulasi, bukan prediksi bisnis sungguhan.

### 10.3 Lihat di halaman web dan jadi bos

```
rm -f data/cafe.db*     # dunia baru (migrasi 0003 membangun ulang tabel laporan)
npm run dev             # tab 1
npm run web             # tab 2
```

1. Buka halaman, pilih **3600x** di menu waktu (satu hari ±24 detik asli).
2. Kartu **Admin Stok** (di bawah gambar) awalnya bilang "Belum ada review". Setelah ±20:00 hari 0 isinya berubah: **Review hari** (ringkasan, ada label LLM), **Kebijakan berlaku**, dan **Catatan** (pengamatan malam itu).
3. Di log (filter **LLM**) terlihat `restock_proposed` dari prakiraan jam 10:00 dan 15:00, lalu `daily_review_created` dan `policy_proposed` sekitar 20:03.
4. Di **Meja bos** muncul laporan **Usul kebijakan: batas minimum Susu 1000 jadi 2000 ml** (di server bawaan, seed 42, malam pertama). Klik **Setujui**: log mencatat `policy_changed`, kartu Admin Stok menulis di **Kebijakan berlaku** bahwa batas Susu berubah dari 1000 ke 2000 ml, dan Susu sekarang ditandai **Rendah** lebih awal di kartu Stok. Klik **Tolak** pada usulan lain: tidak ada yang berubah, dan langsung muncul catatan "Bos menolak usul ... Jangan diulang".
5. Biarkan sampai malam berikutnya: ada catatan **Refleksi** yang menilai perubahan tadi ("membantu" atau "tidak membantu", dengan angka sebelum dan sesudah).

Cara lain tanpa halaman: `curl -s 'localhost:3000/reports?status=submitted'`, lalu `curl -s -X POST localhost:3000/reports/<id>/decision -H 'content-type: application/json' -d '{"decision":"approved"}'` dan `curl -s localhost:3000/stock` (`min_qty` berlaku, `base_min_qty` nilai awal).

Tidak setiap malam ada usulan: Admin Stok hanya mengusulkan kalau ada bahan yang jelas bermasalah, dan hanya satu bahan per malam.

### 10.4 Uji pemulihan

Ctrl+C di tab 1, nyalakan lagi dengan `npm run dev`. Server mencetak `Dunia dipulihkan dari log ...`, dan kebijakan yang sudah lu setujui tetap berlaku (batas Susu tetap 2000). Gua uji persis begini di server sungguhan (di database scratchpad, kecepatan 3600x): laporan kebijakan muncul, disetujui lewat API, snapshot WebSocket membawa batas baru dan ingatan, lalu mati dan nyala lagi.

### 10.5 Mematikan bagian-bagiannya

- `LLM_PROVIDER=off npm run dev`: semua keputusan label `[Aturan]`, tidak ada panggilan model.
- `STOCK_FORECAST=off npm run dev`: Admin Stok tidak berpikir jam 10:00 dan 15:00; review malam tetap jalan.

Pakai dunia baru (`rm -f data/cafe.db*`) supaya perbandingannya bersih.

### 10.6 Yang wajar

- `FakeLLM` selalu menjawab dengan pola yang sama, jadi usulannya terasa "kaku". Itu bukan bug.
- Hari 0 belum punya riwayat, jadi prakiraan baru bermakna dari hari 1 (rata-rata jam yang sama dari maksimal 3 hari terakhir).
- Kartu Admin Stok kosong sebelum hari 0 tutup, itu normal.
- Rina tetap diam (keputusan 034).

## 11. Tahap 6: model lokal lewat Ollama

Sampai Tahap 5 Admin Stok dijawab `FakeLLM`, skrip yang menjawab seketika. Sekarang kafe bisa bertanya ke **model sungguhan yang jalan di Mac lu** (Ollama, gratis, tanpa internet). Model butuh beberapa detik, jadi Admin Stok "mikir..." selagi jam virtual terus jalan, jawabannya diperiksa, dan kalau salah atau model mati, aturan yang memutuskan. Bawaan `npm run dev` tetap `fake`; model sungguhan hanya nyala kalau lu minta.

### 11.1 Siapkan Ollama (sekali)

```
ollama serve            # tab sendiri (atau buka aplikasi Ollama), biarkan jalan
ollama pull qwen3:4b    # ±2,5 GB, sekali saja
ollama list             # qwen3:4b harus ada
```

### 11.2 Ukur modelnya

```
npm run eval:llm -- --model qwen3:4b      # ±2 menit: 20 situasi dari eval/llm-situations.json
```

**Yang diharapkan** (di mesin gua, Apple M5): tabel dengan `semua  20  100%  90%  100%  0%` (JSON valid, benar di coba pertama, benar dalam tiga coba, jatuh ke aturan) dan latensi p50 sekitar 3 sampai 4 detik, p95 sekitar 5. Model lain: `--model llama3.2:3b` (benar 75%, sering menulis bahan dobel di usulan belanja) dan `--model qwen3:8b` (sama baik, 5,2 GB). Opsi: `--runs 3` (hasilnya sama karena temperature 0, jadi tidak perlu), `--only stock_proposal` atau `--only policy_review`, `--verbose`. Perbandingan lengkap dan caranya ada di [keputusan 038](decisions/038-which-local-model.md).

"Benar" artinya lolos pemeriksaan aturan (bahan dikenal, jumlah muat di rak, batas dalam rentang, tidak basi), **bukan** bahwa usulannya yang paling bijak.

`npm run eval:situations` membuat ulang `eval/llm-situations.json` dari hari simulasi (perlu kalau pertanyaan Admin Stok berubah; tes menjaga file itu sama dengan hasil pembangkitnya).

### 11.3 Kafe dengan model sungguhan

```
rm -f data/cafe.db*                        # dunia baru
LLM_PROVIDER=ollama npm run dev            # tab 1 (atau isi LLM_PROVIDER=ollama di .env)
npm run web                                # tab 2
```

Banner server mencetak `Model    : qwen3:4b lewat Ollama (...)`. Pilih **600x** di menu waktu supaya cepat. Yang dicari:

- Kartu **Karakter**: Admin Stok berstatus **Mikir...** selama model bekerja (2 sampai 5 detik asli). Label di atas kepalanya juga "Admin Stok · mikir...". Itu terjadi saat ada bahan tipis (di seed 42 sekitar 09:50), saat prakiraan jam 10:00 dan 15:00, dan di review malam sekitar 20:03.
- Log (filter **LLM**): `agent_decided` berasal dari LLM, lalu `restock_proposed` atau `daily_review_created`. Cap jamnya **lebih lambat** dari saat dia mulai mikir: jam virtual jalan terus. Di 600x tiga detik asli adalah 30 menit virtual, dan di 3600x tiga jam virtual (review jam 20:03 bisa tertulis lewat tengah malam). Itu perilaku, bukan bug.
- Selama dia mikir, tugas lain yang antre menunggu; begitu jawaban dipakai, dia lanjut kerja.
- Setiap panggilan tercatat di tabel `llm_calls` (latensi, model, valid atau tidak). Melihatnya (server boleh tetap jalan):
  `node -e "const D=require('better-sqlite3');console.table(new D('data/cafe.db',{readonly:true}).prepare('SELECT id,purpose,valid,latency_ms,model,fallback_used FROM llm_calls').all())"`

Satu hari penuh di 600x yang gua jalankan: 4 usulan belanja dan 1 review, semuanya `valid=1`, tanpa fallback, latensi 2,4 sampai 5,1 detik.

### 11.4 Uji pemulihan: server mati di tengah mikir

Kartu **Karakter** menunjukkan "Mikir..." hanya beberapa detik, jadi tekan **Ctrl+C di tab 1 tepat saat itu** (coba lagi kalau meleset). Nyalakan lagi dengan perintah yang sama:

- Banner: `Pemikiran Admin Stok yang terputus saat server berhenti diselesaikan aturan: 1`.
- Log: `agent_decided ... fallback_reason=timeout` (aturan yang memutuskan) lalu `restock_proposed`, dan Admin Stok kembali kerja (tidak macet di "Mikir...").
- Model **tidak** ditanya ulang saat nyala; nyalakan sekali lagi dan tidak ada yang berubah.

### 11.5 Kalau Ollama mati atau modelnya tidak ada

Kafe tidak macet. Coba: `LLM_PROVIDER=ollama OLLAMA_URL=http://127.0.0.1:9 npm run dev` (tidak ada yang mendengar di sana) atau `OLLAMA_MODEL=model-yang-tidak-ada`. Setiap keputusan Admin Stok dicoba tiga kali, gagal dalam sekejap, lalu aturan memutuskan: log `agent_decided ... fallback_reason=timeout attempts=3`, `llm_calls` berisi tiga baris `valid=0 model=unavailable` (yang terakhir `fallback_used=1`), dan usulannya sama seperti kalau modelnya `off`. Alamat yang bukan http atau https ditolak server dengan pesan yang menyebut `OLLAMA_URL`.

### 11.6 Yang wajar

- **Model kecil bisa salah.** Jawaban yang ditolak (bahan tak dikenal, jumlah melebihi ruang di rak) dikirim balik dengan alasannya, sampai tiga kali; setelah itu aturan yang memutuskan. Itu desainnya.
- **Lolos pemeriksaan bukan berarti bijak.** Alasan yang ditulis model kadang membingungkan; yang dijaga aturan adalah bahan, jumlah, dan rentang, dan bos tetap yang menyetujui.
- **Hasil dengan model tidak bisa diulang persis** di mesin lain (temperature 0 dan seed belum menjamin itu). Yang selalu sama: replay (membaca log), semua tes, dan golden (`FakeLLM`).
- Panggilan pertama setelah model dimuat ke memori lebih lama dari biasanya.
- Kasir dan koki tetap aturan. Triase komplain lewat model baru di Tahap 7.

