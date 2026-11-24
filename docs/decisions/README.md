# Keputusan arsitektur

Satu file per keputusan, beberapa baris tiap file. Brief menang jika ada benturan (lihat `PROJECT_BRIEF.md`).

| # | Keputusan |
|---|---|
| [001](001-server-owns-character-time.md) | Server memegang waktu gerak karakter |
| [002](002-station-ids-not-coordinates.md) | Posisi karakter di domain pakai ID stasiun |
| [003](003-walk-time-from-distance-table.md) | Durasi jalan dari tabel jarak |
| [004](004-sqlite-with-better-sqlite3.md) | SQLite lewat better-sqlite3 |
| [005](005-persist-then-publish.md) | Persist-then-publish |
| [006](006-stateless-seeded-rng.md) | RNG tanpa state |
| [007](007-sequential-sql-migrations.md) | Migrasi SQL berurutan |
| [008](008-config-via-env.md) | Konfigurasi lewat .env |
| [009](009-virtual-seconds-as-time-unit.md) | Satuan waktu = detik virtual |
| [010](010-llm-decisions-are-events.md) | Keputusan LLM adalah event |
| [011](011-recover-by-replay-on-boot.md) | Pemulihan lewat replay saat boot |
| [012](012-events-are-truth-tables-are-projections.md) | Event log = kebenaran, tabel lain = proyeksi |
| [013](013-autonomous-world-no-manual-triggers.md) | Dunia otonom, tanpa trigger manual |
| [014](014-walk-in-customers-are-anonymous.md) | Pelanggan biasa bersifat anonim |
| [015](015-ui-language-configurable.md) | Bahasa UI bisa dikonfigurasi |
| [016](016-3d-primitives-behind-create-avatar.md) | Visual 3D primitif lewat createAvatar |
| [017](017-tooling-npm-workspaces-typescript.md) | Tooling: npm workspaces dan TypeScript |
| [018](018-extra-readonly-pages.md) | Halaman tambahan read-only (Stok, Menu, Laporan) |
| [019](019-sql-projections-with-pure-rules.md) | Proyeksi lewat SQL, aturan murni di core |
| [020](020-pure-time-engine.md) | Mesin waktu: sumber murni, jam virtual, seed dari log |
| [021](021-pacing-and-time-controls.md) | Pacing dan kontrol waktu |
| [022](022-agents-task-queue-and-atomic-steps.md) | Agent, antrean tugas, dan langkah atomik dengan reaksi |
| [023](023-dynamic-due-items.md) | Timer dinamis di VirtualClock |
| [024](024-rule-based-restock-and-complaints.md) | Usulan belanja dan triase komplain berbasis aturan |
| [025](025-boss-api-watch-and-auto-boss.md) | Kontrol bos lewat API, papan pantau, dan bos otomatis untuk tes |
| [026](026-websocket-snapshot-events-clock.md) | WebSocket: snapshot, events, dan clock |
| [027](027-scene-is-a-function-of-state-and-time.md) | Adegan adalah fungsi dari (state, waktu virtual) |
| [028](028-web-stack-proxy-and-no-framework.md) | Stack web: Vite, Three.js, proxy, DOM tanpa framework |
| [029](029-customers-drawn-from-orders.md) | Pelanggan digambar dari event pesanan |
| [030](030-cutaway-cafe-and-visual-direction.md) | Kafe potongan (diorama), arah visual, dan penyimpangan dari brief |
| [031](031-video-page-layout-adaptive-camera-and-routes.md) | Layout halaman ala video, kamera adaptif, dan jalur jalan |
| [032](032-customers-arrive-before-they-order.md) | Pelanggan masuk dulu, baru memesan (`customer_arrived`) |
| [033](033-light-theme-sidebar-and-complaints-panel.md) | Tema terang, sidebar yang bisa dilipat, dan panel Komplain |
| [034](034-stock-admin-is-the-generative-agent.md) | Admin Stok menjadi agent generatif (menggantikan Rina di Tahap 5) |
| [035](035-decision-pipeline-with-fake-llm.md) | Pipa keputusan agent: FakeLLM instan, validasi, ulang, fallback aturan |
| [036](036-what-the-learning-admin-achieves.md) | Apa yang dicapai Admin Stok yang belajar (hasil eksperimen) |
