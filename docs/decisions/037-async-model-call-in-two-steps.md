# 037: Model sungguhan memakai dua langkah: bertanya di luar transaksi, menerapkan di langkah baru

Status: diterima (2026-11-25). Asal: Tahap 6, keputusan 010, 022, dan 035.

## Keputusan
- **Langkah A** (di dalam reaksi yang ada): tulis `agent_think_requested` dan `agent_state_changed` ke `thinking`, serahkan pertanyaan ke `Thinker` (antrean satu panggilan sekaligus, FIFO, di `server`), lalu selesai. Tidak ada panggilan jaringan di dalam transaksi SQLite.
- **Langkah B** (saat jawaban datang, selalu di antara dua detak jam): satu `transact` yang **memvalidasi ulang terhadap dunia saat itu**, menulis semua baris `llm_calls` dari percobaan, `agent_decided`, efeknya (usulan belanja, review, usulan kebijakan), tugas lapor, mengembalikan agent ke `idle`, lalu `kick`.
- **Jalur sinkron tidak berubah.** Client instan (`FakeLLM`) atau tanpa client tetap satu langkah dan tanpa status `thinking`, jadi golden dan tes Tahap 1 sampai 5 tidak berubah.
- **Jam virtual tidak berhenti** (keputusan 010). Event langkah B memakai cap waktu virtual saat jawaban diterapkan. Timeout dihitung dalam detik **asli** (`OLLAMA_TIMEOUT_SEC`, bawaan 60).
- **Basi:** usulan belanja yang bahannya sudah tercakup laporan atau pesanan lain saat jawaban datang jatuh ke fallback `stale`; review yang harinya sudah ditinjau tidak ditulis dua kali.
- **Yatim setelah restart:** `agent_think_requested` tanpa `agent_decided` yang menunjuknya diselesaikan saat boot lewat **jalur aturan** (`origin: fallback`, `fallback_reason: timeout`). Model tidak dipanggil saat boot atau replay.
- **Tanpa event baru dan tanpa migrasi.** Urutan think, `thinking`, decided sudah ada di `docs/events.md`.

## Alasan
- Transaksi better-sqlite3 sinkron, jadi jawaban yang butuh beberapa detik tidak bisa menunggu di dalamnya. Pemecahan dua langkah mempertahankan "satu langkah = satu transaksi" (keputusan 022) tanpa menghentikan jam.
- Janji (promise) selalu berjalan di antara dua detak `VirtualClock`, jadi langkah B tidak pernah menyela langkah lain.
- Replay hanya menerapkan event dan tidak menjalankan reaksi, jadi ia tidak bisa memanggil model.

## Konsekuensi
- Di kecepatan tinggi "mikir" memanjang dalam waktu virtual: panggilan 3 detik adalah 3 menit virtual di 60x dan 3 jam di 3600x, jadi review jam 20:03 bisa tertulis lewat tengah malam. Itu perilaku, bukan bug.
- Menjalankan dunia dengan model tidak bisa diulang persis (temperature 0 dan seed tidak menjamin hasil sama antar mesin). Yang tetap deterministik: replay, tes (client palsu), dan golden (`FakeLLM`).
- `kick` dan penjadwal prakiraan harus tahu agent yang sedang berpikir.
