// Texts of the page in Indonesian (decision 028). Names of events, enums and ids stay English; the
// names of characters, stations and tasks live in the dictionary of core (`text/labels.ts`).
export const ID = {
  'app.title': 'Kafe Virtual',

  'status.connecting': 'Menyambung ke server...',
  'status.open': 'Tersambung',
  'status.closed': 'Terputus, mencoba lagi...',
  'clock.day': 'Hari',
  'clock.speed': 'kecepatan',
  'clock.paused': 'JEDA',
  'clock.disconnected': 'berhenti (terputus)',
  'waiting.world': 'Menunggu data dunia dari server...',

  'scene.boss': 'Bos (kamu)',
  'customer.upset': '!',
  'customer.ready': 'Siap!',
  'customer.held': 'Menunggu bahan',
  'customer.queueMore': 'antre',
  'scene.lost':
    'Gambar 3D terhenti (WebGL hilang). Muat ulang halaman kalau tidak kembali sendiri.',
  'view.panelOnly': 'Panel saja',
  'view.scene': 'Tampilan 3D',
  'view.noWebgl': 'Browser ini tidak mendukung 3D (WebGL): hanya panel yang tampil.',
  'scene.unavailable': 'Tampilan 3D tidak bisa dibuat di browser ini. Panel tetap jalan.',

  'panel.agents': 'Karakter',
  'panel.orders': 'Pesanan',
  'panel.log': 'Kejadian',
  'panel.stock': 'Stok',
  'panel.boss': 'Meja Bos',
  'panel.time': 'Kontrol waktu',
  'panel.complaints': 'Komplain',

  'agent.until': 'sampai',
  'orders.placed': 'menunggu',
  'orders.cooking': 'dimasak',
  'orders.held': 'ditahan',
  'orders.done': 'selesai',

  'log.empty': 'Belum ada kejadian.',
  'log.trigger': 'Trigger',
  'log.rule': 'Aturan',
  'log.llm': 'LLM',
  'log.initiative': 'Inisiatif',
  'log.boss': 'Bos',

  'complaints.empty': 'Belum ada komplain.',
  'complaints.summary.open': 'terbuka',
  'complaints.summary.answered': 'dibalas',
  'complaint.order': 'Pesanan',
  'complaint.received': 'dicatat kasir',
  'complaint.triaged': 'menunggu keputusan bos',
  'complaint.replied': 'dibalas',
  'complaint.cause.slow_service': 'layanan lambat',
  'complaint.cause.wrong_order': 'pesanan salah',
  'complaint.cause.quality': 'kualitas',
  'complaint.offer.none': 'tanpa kompensasi',
  'complaint.offer.discount_10': 'diskon 10%',
  'complaint.offer.free_item': 'item gratis',
  'complaint.offered': 'usul',
  'complaint.waiting': 'sudah menunggu',
  'complaint.answeredIn': 'dibalas dalam',

  'stock.low': 'RENDAH',
  'stock.out': 'HABIS',

  'boss.empty': 'Tidak ada laporan yang menunggu.',
  'boss.approve': 'Setujui',
  'boss.reject': 'Tolak',
  'boss.onTheWay': 'dibawa ke meja bos',

  'time.pause': 'Jeda',
  'time.resume': 'Lanjut',
  'time.speed': 'Kecepatan',
  'time.advance': 'Majukan',
  'time.advance.600': '+10 menit',
  'time.advance.1800': '+30 menit',
  'time.advance.3600': '+1 jam',

  'error.network': 'Server tidak bisa dihubungi.',
  'error.report_not_found': 'Laporan itu tidak ada.',
  'error.report_not_submitted': 'Laporan itu sudah diputuskan, atau belum sampai di meja bos.',
  'error.invalid': 'Permintaan ditolak server.',
} as const;

export type TextKey = keyof typeof ID;
