# 010: Keputusan LLM adalah event

Status: diterima (2026-11-24). Asal: PLAN keputusan #10 (hasil review Tahap 0).

## Keputusan
Setiap keputusan agent dicatat sebagai event `agent_decided` (source: rule, llm, atau fallback). Jam virtual **jalan terus** saat LLM berpikir, dan agent berstatus "mikir...". Jawaban dicek ulang saat diterapkan: jawaban basi atau tidak masuk akal ditolak lalu fallback ke aturan.

## Alasan
- Replay membaca keputusan dari log dan tidak memanggil model lagi, jadi dunia yang melibatkan LLM tetap bisa diputar ulang.
- Jam yang berhenti membuat seluruh kafe terlihat freeze selama 1 sampai 5 detik.

## Konsekuensi
- Perlu pengecekan "basi" saat menerapkan jawaban (kondisi dunia bisa berubah selama menunggu).
- `FakeLLM` instan, jadi jalur async dibuktikan di Tahap 6.
