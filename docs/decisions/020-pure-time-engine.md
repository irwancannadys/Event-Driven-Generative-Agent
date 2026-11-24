# 020: Mesin waktu: sumber murni, jam virtual, seed dari log

Status: diterima (2026-11-24). Asal: rencana Tahap 2.

## Keputusan
- Semua urusan "kapan apa terjadi" (jadwal buka dan tutup, `regular_expected`, kedatangan pesanan, pengecekan komplain) dihitung oleh **fungsi murni di `core`** dari dua hal saja: `seed` dan waktu virtual absolut (`dueItems(after, upTo, scenario)`).
- `VirtualClock` (juga di `core`) memproses item yang jatuh tempo **satu per satu, berurutan**, dengan `now()` diset ke waktu item saat handler jalan.
- `server` hanya menjalankan handler tiap item (tulis event lewat use case) dan menyuntikkan clock ke use case.
- **Seed dunia diambil dari `world_initialized` di log**, bukan dari `.env`, setelah dunia pertama dibuat.
- Generator pesanan memanggil use case `createOrder` langsung (pintu yang sama dengan `POST /orders`).

## Alasan
- Karena item dihitung dari waktu absolut, `advance(1800)` sama persis dengan 30 kali `advance(60)`, dan menghitung ulang setelah restart memberi hasil yang sama (keputusan 006 dan 011).
- Tes tidak perlu database atau jam asli untuk membuktikan perilaku waktu.
- Seed yang berubah di tengah jalan akan membuat generator tidak cocok dengan log yang sudah ada.

## Konsekuensi
- Belum ada timer dinamis (mis. akhir tugas agent). Itu butuh agent dan datang di Tahap 3, dengan memperluas `VirtualClock`.
- Di Tahap 2 belum ada yang memasak: pesanan dari generator menumpuk berstatus `placed`, dan komplain `slow_service` muncul karena itu. Ini wajar, bukan bug.
- Mengubah algoritma RNG atau jadwal mengubah log yang dihasilkan, jadi file golden di repo ikut berubah (sengaja, ditinjau lalu diregenerasi).
