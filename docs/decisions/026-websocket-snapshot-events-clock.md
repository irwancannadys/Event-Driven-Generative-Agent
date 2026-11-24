# 026: WebSocket: snapshot, events, dan clock

Status: diterima (2026-11-24). Asal: rencana Tahap 4.

## Keputusan
- Server membuka WebSocket di jalur `/ws` (library `ws`, di server HTTP yang sama dengan API). Klien tidak mengirim apa-apa: kontrol (Setujui/Tolak, waktu) tetap lewat HTTP yang sudah ada.
- Tiga jenis pesan dari server, semuanya JSON:
  - `{"kind":"snapshot","snapshot":{...}}` satu kali, tepat setelah tersambung. Isinya: waktu (`TimeView`), agent (stasiun, status, tugas aktif dengan `started_at_sim` dan `ends_at_sim`, `from_station` bila sedang jalan, jumlah tugas antre), stok, jumlah pesanan per status, laporan yang belum diputuskan (`drafted` dan `submitted`), 200 event terakhir, dan `last_event_id`.
  - `{"kind":"events","events":[...]}` satu batch per langkah, **setelah commit** (persist-then-publish, keputusan 005), urutannya urutan penulisan.
  - `{"kind":"clock","time":{...}}` tiap 250 ms dan setiap kali kontrol waktu berubah. Ini bukan event (keputusan 021): jam dan kecepatan adalah pengaturan menjalankan.
- **Tanpa celah dan tanpa duplikat:** server berjalan satu utas, jadi snapshot dibuat dan klien didaftarkan ke `EventBus` dalam satu putaran yang sama. Event yang sudah di-commit ada di snapshot, yang sesudahnya dikirim sebagai `events`. `last_event_id` membuat klien membuang event yang sudah dimilikinya.
- Asal sebuah perjalanan (`from_station`) tidak disimpan di proyeksi. Ia diambil dari event `agent_state_changed` sebelumnya milik agent itu (status berjalan selalu mencatat stasiun **tujuan**), dan snapshot menghitungnya dari dua event terakhir di log. Tidak ada perubahan skema atau katalog event.
- Klien yang lambat atau putus tidak boleh mengganggu klien lain atau menggagalkan commit: kesalahan kirim ditangkap.

## Alasan
State hidup di server (invarian brief). Klien yang baru dibuka, di-refresh, atau tersambung ulang selalu mulai dari snapshot dan menerapkan aliran event sesudahnya, jadi tidak ada jalur khusus "pemulihan" di klien.

## Konsekuensi
- Pesan `clock` sering, tapi kecil. Klien mengekstrapolasi jam virtual di antara dua pesan dan menyetel ulang tiap pesan datang.
- Dengan 200 event terakhir di snapshot, log di halaman terisi sejak awal, bukan kosong setelah refresh.
