# Konsep satu halaman

## Apa ini

Simulasi kafe 3D di browser. Empat pegawai AI (kasir, koki, admin stok, pelayan Rina) bekerja sendiri. Kamu jadi **bos**: memantau lewat layar dan menyetujui atau menolak laporan di meja bos. Semuanya lokal dan gratis.

Tujuannya belajar bagaimana **event-driven** (apa yang menggerakkan sistem) bertemu **generative agent** (bagaimana karakter memutuskan dan mengingat). Event-driven jadi tulang punggung. LLM hanya dipanggil di titik yang butuh penilaian.

## Alur

```
Pemicu  ->  Event log  ->  Agent memutuskan  ->  Animasi 3D  ->  Laporan ke bos
            (dicatat urut)  (aturan atau LLM)   (dari status)    (Setujui/Tolak)
```

Pemicu ada empat jenis, dan **tidak ada yang berupa tombol manual**:

1. **Data masuk:** pesanan lewat API kasir (`POST /orders`), dipanggil generator dunia.
2. **Jadwal:** buka dan tutup kafe, jam langganan biasa datang.
3. **Ambang kondisi:** stok di bawah batas.
4. **Generator dunia:** pelanggan virtual yang datang, komplain, perilaku pemasok (semua seeded).

Satu-satunya masukan manusia: keputusan bos dan kontrol waktu (pause, kecepatan, majukan waktu).

## Tiga lapis kode

```
 web (browser)  <-- WebSocket -->  server (Node)  --  SQLite
 layar saja:                       memegang dunia:     events (kebenaran)
 3D, log, tombol bos               jam virtual, agent,  + tabel proyeksi
                                   generator dunia
                                         |
                                  memakai `core` = aturan dan tipe murni, tanpa I/O
```

`web` tidak pernah memutuskan apa pun. Ia hanya membaca event dan menampilkannya.

## Event, state, replay

Anggap event seperti action di Redux dan state seperti hasil reducer:

```
state = events.reduce(apply, stateAwal)
```

- **Event** adalah fakta yang sudah terjadi (`order_created`), tidak diubah dan tidak dihapus.
- **State** (stok sekarang, pesanan, laporan) adalah turunan event. Tabelnya cuma salinan agar cepat dibaca.
- **Replay** menjalankan ulang `reduce` dari awal. Hasilnya selalu sama. Dipakai untuk tes, debugging, dan memulihkan dunia saat server restart.
- Keputusan LLM **juga dicatat sebagai event**, jadi replay membaca keputusannya dan tidak memanggil model lagi.

## Siapa memutuskan apa

| Siapa | Contoh | Label di log |
|---|---|---|
| Generator dunia, jadwal | pesanan datang, langganan tiba | Trigger |
| Aturan | pesanan ke dapur, stok berkurang, `stock_low` | Aturan |
| LLM | usulan belanja, inisiatif Rina, triase komplain | LLM |
| Rina, tanpa disuruh | menyiapkan meja, merapikan meja, refleksi | Inisiatif |
| Bos (kamu) | Setujui atau Tolak laporan | Bos |

Jika output LLM tidak valid, basi, atau tidak masuk akal, sistem jatuh ke aturan biasa dan mencatatnya. Dunia kafe tidak boleh macet gara-gara model.

## Satu siklus contoh

```
08:12  order_created         kopi susu x1                      Trigger
08:12  cooking_started       order 1                           Aturan
08:12  stock_decreased       susu -200 ml, sisa 400            Aturan
08:15  cooking_done          order 1                           Aturan
08:15  stock_low             susu (sisa 400, batas 500)        Aturan
08:15  agent_think_requested admin stok, usulan belanja        Aturan
08:16  agent_decided         pesan susu 2000 ml                LLM
08:16  restock_proposed      laporan untuk bos                 LLM
08:18  report_submitted      laporan sampai di meja bos        Aturan
08:20  report_decided        disetujui                         Bos (klik kamu)
08:20  restock_ordered       pemasok: telat, tiba 10:20        Trigger
10:20  restock_arrived       susu +2000 ml                     Trigger
```

Baris mana pun bisa direplay. Animasi 3D hanya menampilkan baris-baris ini (admin stok berjalan ke rak lalu ke meja bos, dan seterusnya).

## Istilah singkat

- **Waktu virtual:** jam simulasi dalam integer detik. Bisa dipercepat, dijeda, dimajukan.
- **Proyeksi:** tabel turunan event, bisa dibangun ulang kapan saja.
- **Fallback:** jalur aturan biasa saat output LLM ditolak.
- **Seed:** angka awal yang membuat "kebetulan" simulasi selalu sama.
