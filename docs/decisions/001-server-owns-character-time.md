# 001: Server memegang waktu gerak karakter

Status: diterima (2026-11-24). Asal: PLAN keputusan #1.

## Keputusan
Tugas karakter (jalan, kerja) punya durasi dalam waktu virtual yang ditentukan **server**. Klien hanya menginterpolasi animasi berdasarkan ETA yang dikirim server.

## Alasan
Kalau klien yang menentukan kapan tugas selesai, hasil replay dan tes jadi tidak deterministik (tergantung kecepatan render dan tab aktif atau tidak).

## Konsekuensi
- Server mengirim `eta_sim_time` lewat `agent_state_changed`.
- Loncat waktu (`sim_time_advanced`) butuh aturan di frontend: fast-forward atau snap. Diputuskan di Tahap 4.
