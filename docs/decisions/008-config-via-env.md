# 008: Konfigurasi lewat .env

Status: diterima (2026-11-24). Asal: PLAN keputusan #8.

## Keputusan
Konfigurasi lewat `.env`: `LLM_PROVIDER=fake|ollama`, nama model, timeout, bahasa UI, dan nanti konfigurasi skenario (seed, keramaian, peluang komplain).

## Alasan
Ganti provider atau skenario tanpa mengubah kode. Cocok untuk murid yang cuma mengubah angka.

## Konsekuensi
- `.env` tidak di-commit. `.env.example` dicatat di repo.
- Nilai default aman: `LLM_PROVIDER=fake`, supaya tahap awal jalan tanpa model.
