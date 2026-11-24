# Panduan uji manual

Panduan ini buat lu yang mau mencoba sendiri hasil tiap tahap, langkah demi langkah. Dokumen ini ikut bertambah setiap tahap selesai.

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

**Yang diharapkan:** baris terakhir seperti `Tests  NNN passed (NNN)` dan tidak ada tulisan `failed`. Kalau ada yang merah, nama tesnya menunjukkan bagian mana yang rusak.

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

**Yang dicari:** log satu hari: `day_opened` jam 08:00, pesanan datang (paling ramai sekitar jam makan siang), tiga `regular_expected` (08:05, 11:35, 16:35), beberapa `complaint_received`, lalu `day_closed` jam 20:00. Tiga baris terakhir berisi `Replay check: OK` dan `Restart check: OK`.

**Artinya:** hari yang sama bisa dijalankan sekali jalan atau diputus di tengah lalu dipulihkan, hasilnya identik.

## 4. Server hidup: `npm run dev`

### 4.1 Nyalakan

```
npm run dev
```

Biarkan terminal ini terbuka. Server memakai file `data/cafe.db` dan API di `http://127.0.0.1:3000`. Jam virtual berjalan **60 kali lebih cepat** dari jam asli (1 detik asli = 1 menit virtual).

**Yang dicari:** pesan di awal bahwa dunia dibuat (atau dipulihkan), lalu log event mengalir.

### 4.2 Pakai terminal kedua untuk `curl`

Buka tab terminal baru (server di tab pertama tetap jalan).

```
curl -s localhost:3000/time        # jam virtual sekarang, hari, kecepatan, paused
curl -s localhost:3000/menu        # menu beserta resep
curl -s localhost:3000/stock       # stok tiap bahan
curl -s -X POST localhost:3000/orders \
  -H 'content-type: application/json' \
  -d '{"items":[{"menu_item_id":"kopi_susu","qty":1}]}'
```

Pesanan manual terakhir muncul juga di log server sebagai `order_created`.

### 4.3 Kontrol waktu

```
# lebih cepat: 600x (1 detik asli = 10 menit virtual)
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"speed":600}'

# jeda dan lanjut
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"paused":true}'
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"paused":false}'

# majukan 30 menit virtual sekaligus (dicatat sebagai sim_time_advanced)
curl -s -X POST localhost:3000/time -H 'content-type: application/json' -d '{"advance_seconds":1800}'
```

**Yang dicari:** saat dijeda, log berhenti. Saat dimajukan 30 menit, semua kejadian di rentang itu muncul berurutan, tidak ada yang terlewat.

### 4.4 Uji pemulihan (inti desain kita)

1. Biarkan server jalan beberapa saat sampai ada beberapa event. Catat jam di `curl -s localhost:3000/time`.
2. Matikan server dengan **Ctrl+C**.
3. Hitung event yang tersimpan:
   ```
   sqlite3 data/cafe.db "select count(*) from events"
   ```
4. Nyalakan lagi: `npm run dev`.

**Yang dicari:** pesan bahwa dunia dipulihkan dari log, jam lanjut dari titik terakhir (bukan balik ke 07:50), dan log lanjut **tanpa event dobel** (misalnya `day_opened` tidak muncul dua kali untuk hari yang sama).

### 4.5 Uji determinisme (seed)

"Kebetulan" di simulasi ini ditentukan oleh seed, jadi dua dunia dengan seed sama harus identik.

```
rm -f data/cafe.db*
SEED=42 npm run dev        # catat 5 sampai 10 baris log pertama, lalu Ctrl+C
rm -f data/cafe.db*
SEED=42 npm run dev        # awal log harus sama persis
rm -f data/cafe.db*
SEED=7 npm run dev         # awal log berbeda
```

Cek juga setelah `rm`: jam virtual dan pesanan pertama sama untuk seed yang sama.

### 4.6 Mulai dari nol

```
rm -f data/cafe.db*
```

Lalu `npm run dev` membuat dunia baru dari awal.

## 5. Yang wajar dilihat, dan yang belum ada

- **Belum ada yang memasak.** Koki baru dibuat di Tahap 3. Pesanan yang masuk tetap berstatus `placed`, jadi stok tidak turun.
- **Komplain muncul karena itu.** Pesanan yang menunggu lebih dari 20 menit virtual bisa dikomplain (peluang 15% per pesanan, hasil undiannya tetap). Itu wajar: memang tidak ada yang melayani.
- Belum ada tampilan web (Tahap 4) dan belum ada LLM (Tahap 5 dan 6).
- Malam hari (setelah `day_closed` sampai `day_opened` hari berikutnya) tidak ada event. Percepat dengan `{"speed":3600}` atau `{"advance_seconds":...}`.

## 6. Kalau ada yang aneh

| Gejala | Kemungkinan penyebab dan cara cek |
|---|---|
| `EADDRINUSE` saat `npm run dev` | Port 3000 dipakai. Jalankan dengan `PORT=3100 npm run dev` |
| Server tidak mau nyala dan menyebut database | File `data/cafe.db` rusak atau dikunci proses lain. Matikan semua `npm run dev`, lalu `rm -f data/cafe.db*` |
| Log tidak bergerak | Mungkin sedang dijeda. Cek `curl -s localhost:3000/time` |
| Log terlalu lambat | Naikkan kecepatan: `{"speed":600}` |
| `sqlite3: command not found` | Ganti dengan `node -e` atau lewati langkah itu. Perintah ini opsional |
