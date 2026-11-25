# 038: Model lokal yang dipakai: `qwen3:4b`, dan apa yang diukur untuk memilihnya

Status: diterima (2026-11-25). Asal: Tahap 6 (keputusan 037), PLAN "pilih yang terkecil dan masih benar".

## Keputusan
- Bawaan `OLLAMA_MODEL` adalah **`qwen3:4b`** (2,5 GB). `qwen3:8b` (5,2 GB) tidak memberi keuntungan yang terukur di sini, dan `llama3.2:3b` (2,0 GB) terlalu sering salah untuk usulan belanja.
- Id bahan yang boleh dipakai masuk ke skema JSON sebagai `enum` (Ollama hanya membiarkan model menulis salah satunya). Pesan penolakan untuk id yang tak dikenal menyebut id yang ada. Daftar bahan di prompt menulis id di depan tanda kurung dan menjelaskan cara menulisnya.
- Yang dicari model adalah jawaban yang **lolos pemeriksaan aturan** (`validateDecision`), bukan jawaban terbaik. "Benar" di bawah berarti itu.

## Cara mengukur
`npm run eval:llm -- --model <nama>` menanyakan 20 situasi dari `eval/llm-situations.json` (6 stok tipis, 6 prakiraan, 8 review malam; dibangkitkan dari hari simulasi seed 11 sampai 18) lewat loop yang sama dengan kafe (`askUntilValid`: tiga kali coba, tiap penolakan dijelaskan). Satu panggilan pemanasan (memuat model) tidak dihitung. Mesin: Apple M5, 24 GB, Ollama 0.40.18 (Metal).

Hasil akhir (prompt dan skema yang sekarang):

| Model | Situasi | JSON valid | Benar di coba pertama | Benar (dalam 3 coba) | Fallback aturan | Latensi p50 | p95 |
|---|---|---|---|---|---|---|---|
| `llama3.2:3b` | 20 lama | 70% | 65% | 75% | 25% | 1,7 dtk | 9,2 dtk |
| | 20 baru | 75% | 70% | 75% | 25% | 3,4 dtk | 9,5 dtk |
| `qwen3:4b` | 20 lama | 100% | 90% | 100% | 0% | 3,4 dtk | 4,9 dtk |
| | 20 baru | 100% | 95% | 100% | 0% | 4,1 dtk | 5,0 dtk |
| `qwen3:8b` | 20 lama | 100% | 95% | 100% | 0% | 3,2 dtk | 4,9 dtk |
| | 20 baru | 100% | 100% | 100% | 0% | 3,8 dtk | 4,7 dtk |

"20 baru" adalah situasi dari seed 21 sampai 28 yang tidak dipakai untuk menyetel apa pun (dibangkitkan dengan cara yang sama, tidak disimpan di file). `llama3.2:3b` gagal hanya di usulan belanja (benar 58%, di kedua set): ia menulis bahan yang sama dua kali, dan skema tidak bisa melarang itu. Untuk review malam ia benar 100%.

## Riwayat penyetelan (supaya angkanya tidak tampak lebih mulus dari kenyataan)
1. **Pengukuran pertama** (daftar `id=susu (Susu)`, id bebas): `llama3.2:3b` benar 55% (menyalin `id=susu` mentah-mentah, `unknown_id`), `qwen3:4b` dan `qwen3:8b` benar 100% setelah ulang, 90% di coba pertama. Tiga putaran memberi hasil identik per situasi (temperature 0 dan seed tetap), jadi sebenarnya hanya 20 sampel per model.
2. **Penyetelan 1** (daftar `susu (Susu)`, aturan "pesan sebanyak ruang di rak"): `llama3.2:3b` naik ke 75% pada stok, tetapi **`qwen3:8b` turun** ke 85% (menulis `"Susu"` dan mengulangnya tiga kali), `qwen3:4b` tidak berubah. Satu perubahan kata bisa membantu satu model dan merugikan yang lain.
3. **Penyetelan 2** (yang sekarang): `enum` id di skema dan penolakan yang menyebut id yang sah. Id yang salah tidak mungkin lagi; sisa kegagalan adalah jumlah yang melebihi ruang di rak (model menyalin angka "kurang" dari konteks) dan bahan ganda, yang diperbaiki percobaan ulang atau jatuh ke aturan.

Penyetelan dilakukan pada 20 situasi lama, karena itu 20 situasi baru dipakai sebagai pembanding; hasilnya sama baik, jadi penyetelan tampak tidak sekadar menghafal.

## Yang tidak diukur, dan batasnya
- **Mutu**, bukan hanya kelulusan: sebuah usulan bisa lolos semua pemeriksaan dan tetap kurang bijak. Contoh: alasan yang ditulis `qwen3:4b` kadang membingungkan ("Susu stok 1000 ml kurang 5000 dari batas 1000"). Aturan tetap penjaga: jumlah dan bahan sudah dibatasi, dan bos yang menyetujui.
- **Sampel kecil**: 20 situasi per set, satu mesin, satu versi Ollama. Selisih 5% adalah satu situasi. `temperature 0` dan seed membuat hasil di mesin ini berulang, belum tentu di mesin lain.
- **Latensi tidak naik dengan ukuran** di sini (`qwen3:8b` tidak lebih lambat dari `qwen3:4b`); sebabnya tidak diselidiki. Panggilan pertama setelah model dimuat lebih lama dan tidak dihitung.
- Di kecepatan tinggi satu jawaban 3 sampai 5 detik adalah menit atau jam virtual (keputusan 037).

## Konsekuensi
- `LLM_PROVIDER=ollama` memakai `qwen3:4b` kecuali `OLLAMA_MODEL` mengatakan lain; `eval:llm` bisa dijalankan ulang untuk model lain.
- Kalau pertanyaan Admin Stok berubah, `eval/llm-situations.json` dibuat ulang (`npm run eval:situations`); tes menjaga file itu sama dengan hasil pembangkitnya.
