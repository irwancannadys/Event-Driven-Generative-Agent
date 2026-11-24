# 003: Durasi jalan dari tabel jarak

Status: diterima (2026-11-24). Asal: PLAN keputusan #3.

## Keputusan
`core` punya tabel jarak antar stasiun. Durasi jalan = jarak dibagi kecepatan jalan, dibulatkan ke integer detik virtual.

## Alasan
Deterministik dan mudah dites. Tidak bergantung pada kecepatan render.

## Konsekuensi
- Angka jarak diisi manual dari layout referensi (`docs/reference/README.md`). Mengubah layout 3D tidak otomatis mengubah durasi jalan.
- Nilai kecepatan dan jarak ditentukan di Tahap 3.
