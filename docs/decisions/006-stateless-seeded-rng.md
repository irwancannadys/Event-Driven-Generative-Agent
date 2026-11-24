# 006: RNG tanpa state

Status: diterima (2026-11-24). Asal: PLAN keputusan #6, diperjelas saat diskusi.

## Keputusan
Semua kerandoman lewat fungsi murni `rand(seed, key)`. `key` berisi waktu sim dan tujuan undian (mis. `order_arrival@28800`). Bukan generator berurutan yang menyimpan posisi.

## Alasan
Replay, restart, dan tes menjadi deterministik tanpa perlu menyimpan posisi RNG. Undian yang sama selalu memberi hasil sama.

## Konsekuensi
- Tiap undian wajib punya `key` yang stabil dan unik.
- Di `core` dilarang `Math.random`, `Date.now`, dan `new Date()` tanpa argumen (dijaga lint).
