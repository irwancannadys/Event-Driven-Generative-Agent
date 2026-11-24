# 017: Tooling: npm workspaces dan TypeScript

Status: diterima (2026-11-24). Asal: diskusi review Tahap 0 dan Langkah 3 sampai 4.

## Keputusan
- npm workspaces: `@cafe/core`, `@cafe/server`, `@cafe/web`.
- TypeScript strict, ESM, `moduleResolution: Bundler`, tanpa build (`tsx` untuk menjalankan, `tsc --noEmit` untuk cek tipe). `core` sengaja tanpa tipe Node.
- Vitest, ESLint (flat config) dan Prettier.
- TypeScript **ditahan di 6.0.x**.

## Alasan
- npm sudah ada di mesin murid. Tiga package menjaga batas `core` (murni), `server`, `web`.
- TypeScript 7 sempat terpasang, tapi `typescript-eslint` baru mendukung versi di bawah 6.1, jadi kita pakai 6.0.3.

## Konsekuensi
- Cek ulang kompatibilitas `typescript-eslint` dengan TypeScript 7 sebelum menaikkan versi.
- `tsx` adalah tambahan di luar daftar awal brief (implikasi dari "TypeScript di Node") dan sudah disetujui lewat rencana Tahap 0.
