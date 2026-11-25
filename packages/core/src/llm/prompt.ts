import type { LLMRequest, Purpose } from './contracts';

// What a model that reads text is told (stage 6). `context` (built from the tables by `context.ts`) says
// what happened in a few lines; it names ingredients by their name, but the answer has to use ids and
// stay inside limits that only `facts` carries. So the prompt adds those from `facts`: the model is
// asked for what the checks will accept, instead of finding out from a refusal. The wording is Indonesian
// (the café talks Indonesian), the keys of the answer are English (they are the contract).

export interface Prompt {
  system: string;
  user: string;
}

const STOCK_SYSTEM = [
  'Kamu Admin Stok sebuah kafe. Kamu mengusulkan belanja bahan supaya stok tidak habis; bos yang memutuskan.',
  'Jawab HANYA dengan satu objek JSON, tanpa teks lain, dalam bentuk:',
  '{"items":[{"ingredient_id":"<id>","qty":<bilangan bulat>}],"urgency":"low" atau "normal" atau "high","rationale":"<alasan singkat, paling banyak 200 karakter>"}',
  'Aturan:',
  '- ingredient_id harus salah satu id pada daftar bahan, dan tiap bahan paling banyak satu kali.',
  '- qty bilangan bulat lebih dari 0 dan tidak boleh melebihi ruang di rak (kapasitas dikurangi stok).',
  '- Kalau jumlah yang kurang lebih besar daripada ruang di rak, pesan sebanyak ruang di rak saja.',
  '- Usulkan hanya bahan yang memang kurang. Tulis rationale dalam bahasa Indonesia.',
].join('\n');

const REVIEW_SYSTEM = [
  'Kamu Admin Stok sebuah kafe. Tiap malam kamu meninjau hari itu dan boleh mengusulkan PALING BANYAK SATU perubahan batas minimum stok untuk satu bahan; bos yang memutuskan.',
  'Jawab HANYA dengan satu objek JSON, tanpa teks lain, dalam bentuk:',
  '{"summary":"<ringkasan hari, paling banyak 300 karakter>","change":{"ingredient_id":"<id>","min_qty":<bilangan bulat>},"rationale":"<alasan, paling banyak 200 karakter>"}',
  '"change" boleh dihilangkan kalau tidak ada yang perlu diubah.',
  'Aturan:',
  '- ingredient_id harus salah satu id pada daftar bahan, dan bukan yang bertanda TERBLOKIR.',
  '- min_qty bilangan bulat di dalam rentang yang tertulis untuk bahan itu.',
  '- Usulkan perubahan hanya untuk bahan yang menahan pesanan atau sempat habis. Kalau harinya lancar, hilangkan "change".',
  '- Tulis summary dan rationale dalam bahasa Indonesia.',
].join('\n');

const SYSTEMS: Partial<Record<Purpose, string>> = {
  stock_proposal: STOCK_SYSTEM,
  policy_review: REVIEW_SYSTEM,
};

// A small model copies what it sees, so the list shows the id as it must be written, and says so.
const LIST_HEADER =
  'Daftar bahan, dalam bentuk "ingredient_id (nama)". Tulis ingredient_id persis seperti di depan tanda kurung, tanpa awalan dan tanpa nama:';

type Fields = Record<string, unknown>;

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const records = (value: unknown): Fields[] => (Array.isArray(value) ? value.filter(isRecord) : []);

function stockList(facts: Fields | undefined): string[] {
  const lines = records(facts?.lines);
  if (lines.length === 0) return [];
  return [
    LIST_HEADER,
    ...lines.map((line) => {
      const room = Number(line.capacity_qty) - Number(line.qty);
      return `- ${String(line.ingredient_id)} (${String(line.name)}): stok ${String(line.qty)} ${String(line.unit)}, kapasitas ${String(line.capacity_qty)}, ruang di rak ${Math.max(0, room)}`;
    }),
  ];
}

function reviewList(facts: Fields | undefined): string[] {
  const ingredients = records(facts?.ingredients);
  if (ingredients.length === 0) return [];
  const blocked = new Set(
    Array.isArray(facts?.blocked) ? facts.blocked.map((id) => String(id)) : [],
  );
  return [
    LIST_HEADER,
    ...ingredients.map((item) => {
      const bounds = isRecord(item.bounds) ? item.bounds : {};
      const id = String(item.ingredient_id);
      return (
        `- ${id} (${String(item.name)}): batas sekarang ${String(item.min_qty)} ${String(item.unit)} (awal ${String(item.base_min_qty)}), ` +
        `boleh diubah ke ${String(bounds.min)} sampai ${String(bounds.max)}` +
        (blocked.has(id) ? ', TERBLOKIR: jangan diusulkan' : '')
      );
    }),
  ];
}

/** The messages for a request. Only the purposes that stage 6 puts in front of a model have one. */
export function buildPrompt(request: LLMRequest): Prompt {
  const system = SYSTEMS[request.purpose];
  if (system === undefined) throw new Error(`no prompt for the purpose "${request.purpose}"`);
  const list =
    request.purpose === 'stock_proposal' ? stockList(request.facts) : reviewList(request.facts);
  const user = [
    request.context,
    ...(list.length > 0 ? ['', ...list] : []),
    ...(request.feedback === undefined
      ? []
      : [
          '',
          `Jawabanmu sebelumnya ditolak: ${request.feedback}. Perbaiki dan jawab lagi dengan JSON saja.`,
        ]),
  ].join('\n');
  return { system, user };
}
