# 015: Bahasa UI bisa dikonfigurasi

Status: diterima (2026-11-24). Asal: diskusi review Tahap 0.

## Keputusan
Teks UI berbahasa Indonesia secara default, bisa diganti lewat config (`UI_LANG`). Implementasi: satu kamus per bahasa (`id`, `en`), tanpa library. Nama event, enum, dan ID tetap Inggris.

## Alasan
Target murid Indonesia, tapi kursus bisa dialihbahasakan. Kamus sederhana cukup.

## Konsekuensi
- Teks yang dibuat template (sapaan, balasan komplain) juga per bahasa dan disimpan sebagai string final di payload event, jadi replay tidak merender ulang.
- Bahasa teks bebas dari LLM dievaluasi di Tahap 6.
- Implementasi di Tahap 4.
