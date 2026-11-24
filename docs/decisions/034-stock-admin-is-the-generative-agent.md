# 034: Admin Stok menjadi agent generatif (menggantikan Rina di Tahap 5)

Status: diterima (2026-11-24). Asal: pemilik menilai peran Rina (pelayan) hanya animasi, bukan hal nyata, dan memilih dua ide yang dampaknya terukur di bisnis kafe.

## Keputusan
- **Tahap 5 berpindah dari pelayan ke Admin Stok.** Tiga pilar "generative agent" tetap ada: **ingatan**, **inisiatif**, **refleksi**. Yang berubah hanya siapa yang memilikinya dan apa yang diputuskannya.
- **Prakiraan permintaan dan belanja otomatis (inisiatif):** Admin Stok memperkirakan pemakaian bahan dari riwayat dan mengusulkan belanja sebelum stok habis. Ia berpikir hanya saat idle, pada jadwal tetap (10:00 dan 15:00), dengan keputusan `stock_proposal`.
- **Penasihat bos (review malam):** saat kafe tutup Admin Stok membaca log hari itu, menulis ringkasan, dan mengusulkan paling banyak satu perubahan kebijakan (batas minimum satu bahan) dengan keputusan `policy_review`. Usulan masuk Meja Bos sebagai laporan jenis `policy`. Setujui mengubah kebijakan kafe lewat event `policy_changed`; Tolak dicatat sebagai pelajaran.
- **Ingatan dan refleksi:** tabel `memories` menyimpan pengamatan harian dan refleksi hasil usulan (metrik sebelum lawan sesudah). Pelajaran masuk konteks keputusan berikutnya, jadi usulan yang gagal atau ditolak tidak diulang.
- **Kerangka LLM tetap dibangun di Tahap 5** (`FakeLLM`, validasi, fallback ke aturan, `llm_calls`), karena Tahap 6 membutuhkannya.
- **Dibuang dari v1:** pelayan yang menyiapkan meja, menyapa, dan mengantar makanan; pelanggan langganan (Pak Budi, Bu Sari, Mas Joko); dan 7 meja di domain. Rina tetap ada di kafe sebagai dekor yang diam (`idle`). Event `regular_*`, `table_*`, dan `reflection_created` tidak dipakai di v1. Menghapus Rina sepenuhnya adalah langkah terpisah kalau pemilik mau.
- **Brief dan PLAN:** `docs/PLAN.md` bagian Tahap 5 ditulis ulang, ringkasan Tahap 6 disesuaikan (model lokal di titik `stock_proposal` dan `policy_review`), dan `PROJECT_BRIEF.md` bagian 5, 6, dan 7 mendapat satu baris catatan yang menunjuk keputusan ini. Isi brief selebihnya tidak diubah.

## Alasan
- Keputusan Admin Stok punya **dampak bisnis yang terukur** (stok habis, pesanan ditahan, komplain), tidak hanya gerak karakter. Pola "AI membaca data, mengusulkan, manusia menyetujui, sistem berubah, dampak terukur" sama dengan pemakaian AI di bisnis sungguhan.
- Tidak butuh karakter, meja, atau jarak baru. Memakai kontrak `stock_proposal` yang sudah ada dan satu kontrak baru.

## Konsekuensi
- Katalog event bertambah 4 (`daily_review_created`, `policy_proposed`, `policy_changed`, `memory_created`) dan ada migrasi baru. Tahap 5 menjadi sekitar 12 langkah.
- `FakeLLM` adalah skrip: pembelajaran di Tahap 5 membuktikan **rangkaiannya** (data, usulan, persetujuan, perubahan, hasil), bukan kualitas model. Kualitas model dievaluasi di Tahap 6. Hasil simulasi bukan prediksi bisnis sungguhan.
