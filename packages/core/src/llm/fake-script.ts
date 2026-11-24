import type { LLMRequest } from './contracts';
import type { FakeLine } from './fake-llm';
import type { StockContextLine } from './context';

// What `FakeLLM` answers when nobody wrote it another script: the scenario table of the running world. It
// plays a model with opinions of its own, so that the log shows a decision that is not just the rule: it
// orders a tenth more than what is missing, and it asks for a minimum twice as high where the rule asks for
// one and a half times. (A test that needs a particular answer, or a bad one, writes its own table.)

const ORDER_MARGIN_PCT = 110;
const REVIEW_RAISE_PCT = 200;

interface ReviewIngredientFacts {
  ingredient_id: string;
  name: string;
  min_qty: number;
  held: number;
  stockout_sec: number;
  bounds: { min: number; max: number };
}

function stockAnswer(request: LLMRequest) {
  const lines = (request.facts?.lines ?? []) as StockContextLine[];
  const wanted = lines.filter((line) => line.shortfall > 0);
  const items = wanted.map((line) => ({
    ingredient_id: line.ingredient_id,
    qty: Math.min(
      line.capacity_qty - line.qty,
      Math.ceil((line.shortfall * ORDER_MARGIN_PCT) / 100),
    ),
  }));
  const urgent = wanted.some((line) => line.qty <= 0 || (line.expected ?? 0) >= line.qty);
  return {
    items,
    urgency: urgent ? 'high' : 'normal',
    rationale:
      `Pesan ${wanted.map((line) => line.name).join(', ')} supaya cukup sampai pengiriman berikutnya.`.slice(
        0,
        200,
      ),
  };
}

function reviewAnswer(request: LLMRequest) {
  const facts = request.facts ?? {};
  const blocked = new Set((facts.blocked ?? []) as string[]);
  const ingredients = (facts.ingredients ?? []) as ReviewIngredientFacts[];
  const summary = String(facts.summary ?? '');
  const ranked = ingredients
    .filter(
      (item) => !blocked.has(item.ingredient_id) && (item.held >= 2 || item.stockout_sec >= 900),
    )
    .sort((a, b) => b.held - a.held || b.stockout_sec - a.stockout_sec);
  for (const item of ranked) {
    const asked = Math.min(item.bounds.max, Math.ceil((item.min_qty * REVIEW_RAISE_PCT) / 100));
    if (asked > item.min_qty) {
      return {
        summary,
        change: { ingredient_id: item.ingredient_id, min_qty: asked },
        rationale: `${item.name} sering menahan pesanan: batas minimum perlu lebih tinggi.`,
      };
    }
  }
  return { summary, rationale: 'Tidak ada yang perlu diubah.' };
}

export const DEFAULT_FAKE_SCRIPT: readonly FakeLine[] = [
  { purpose: 'stock_proposal', answer: stockAnswer },
  { purpose: 'policy_review', answer: reviewAnswer },
];
