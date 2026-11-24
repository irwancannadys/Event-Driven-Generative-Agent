# 035: Pipa keputusan agent: FakeLLM instan, validasi, ulang, fallback aturan

Status: diterima (2026-11-24). Asal: Tahap 5 (keputusan 034) dan keputusan 010.

## Keputusan
- Satu fungsi, `decide()` di `server` (`agents/decide.ts`), dipakai semua keputusan agent: menulis `agent_think_requested`, bertanya ke model, memeriksa jawabannya (`validateDecision` di `core`), bertanya ulang dengan pesan galat (paling banyak dua kali ulang, jadi tiga percobaan), lalu **fallback ke aturan**, dan menulis `agent_decided` dengan `origin`: `llm` (model menjawab dengan benar), `fallback` (model gagal, aturan memutuskan, dengan `fallback_reason` dan `attempts`), atau `rule` (tidak ada model).
- **`FakeLLM` instan** (`completeNow`), jadi pertanyaan dan jawaban ditulis dalam **satu langkah atomik** (keputusan 022). Jalur asinkron untuk model sungguhan (jam jalan terus selagi menunggu, jawaban dicek ulang saat diterapkan) baru dibuktikan di Tahap 6, sesuai keputusan 010. `LLMClient.complete` yang asinkron tetap ada di kontrak.
- `LLMRequest` boleh membawa `facts`, keadaan yang sama sebagai data, supaya `FakeLLM` tidak mengurai teks. Model sungguhan membaca `context` dan mengabaikan `facts`.
- `FakeLLM` menjawab dari **tabel skenario** (`FakeLine`: untuk keputusan apa, dalam situasi apa, jawabannya apa). Tabel bawaan dunia yang berjalan (`DEFAULT_FAKE_SCRIPT`) berperan sebagai model yang berpendapat sendiri (memesan sepersepuluh lebih banyak, meminta batas minimum dua kali lipat, sedangkan aturan satu setengah kali). Tes menulis tabel sendiri, termasuk jawaban yang sengaja salah.
- **Setiap panggilan model dicatat di `llm_calls`** (ringkasan masukan, keluaran, valid atau tidak, latensi, model, apakah memicu fallback). Tabel itu operasional, bukan proyeksi: replay tidak membangunnya dan **tidak memanggil model**; keputusan dibaca dari log. Tes membuktikannya.
- **`LLM_PROVIDER=fake|off`** (bawaan `fake` untuk `npm run dev`). `off` dan `bootSimulation` tanpa `llm` membuat aturan memutuskan sendiri, persis seperti sebelumnya, sehingga tes dan golden Tahap 1 sampai 4 tidak berubah.
- Jawaban yang melempar galat (model tidak menjawab) dihitung sebagai percobaan gagal dengan alasan `timeout`.

## Alasan
- Satu jalur untuk semua keputusan membuat fallback, pencatatan, dan replay seragam, dan murid kursus membaca satu file untuk memahami pola "model mengusulkan, aturan menjaga".
- Output yang valid belum tentu benar (brief bagian 7): pemeriksaan dunia (bahan dikenal, jumlah muat di rak, usulan tidak basi, batas minimum dalam rentang) ada di `core` supaya bisa dites tanpa model.

## Konsekuensi
- Migrasi 0003 membangun ulang `llm_calls` supaya `policy_review` boleh menjadi tujuan.
- Keputusan belanja yang sudah ada (`stock_low`) ikut jalur ini; hasil `FakeLLM` bawaan untuk stok tipis sama jumlahnya dengan aturan "isi sampai penuh" tetapi `origin`-nya `llm`.
