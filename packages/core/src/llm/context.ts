import { formatClock, type SimTime } from '../time';
import type { DayMetrics } from '../rules/day-metrics';
import { policyBounds } from '../rules/policy';
import { reviewFacts, troubleOf, type PolicyIngredient } from '../rules/policy-review';
import { DEFAULT_TEXT, type TextSet } from '../text';

// What the stock admin tells a model about her situation (brief principle 9: memory lives in the tables,
// only a summary of a few lines goes to the model). Each builder gives the text for a model that reads
// text and the same thing as data (`facts`) for the model that does not: `FakeLLM`.

export interface BuiltContext {
  context: string;
  facts: Record<string, unknown>;
}

export interface StockContextLine {
  ingredient_id: string;
  name: string;
  unit: string;
  qty: number;
  min_qty: number;
  capacity_qty: number;
  /** The forecast demand until the delivery, `null` for a proposal that does not come from a forecast. */
  expected: number | null;
  /** What is missing. For a forecast: demand plus minimum, less stock. Otherwise: the room on the shelf. */
  shortfall: number;
}

export function stockContext(input: {
  kind: 'forecast' | 'low_stock';
  now: SimTime;
  lines: readonly StockContextLine[];
}): BuiltContext {
  const intro =
    input.kind === 'forecast'
      ? `Pukul ${formatClock(input.now)}. Cek sebelum jam sibuk: apa yang perlu dipesan sebelum habis?`
      : `Pukul ${formatClock(input.now)}. Ada bahan yang tipis: apa yang perlu dipesan?`;
  const lines = input.lines.map(
    (line) =>
      `- ${line.name}: stok ${line.qty} ${line.unit}, batas ${line.min_qty}, kapasitas ${line.capacity_qty}` +
      (line.expected === null ? '' : `, perkiraan pakai ${line.expected}`) +
      `, kurang ${Math.max(0, line.shortfall)}`,
  );
  return {
    context: [intro, ...lines].join('\n'),
    facts: { kind: input.kind, now: input.now, lines: input.lines },
  };
}

export function reviewContext(input: {
  metrics: DayMetrics;
  ingredients: readonly PolicyIngredient[];
  /** Notes the stock admin keeps: what she tried before and how it went. */
  lessons: readonly string[];
  /** Ingredients that must not be proposed again. */
  blocked: readonly string[];
  text?: TextSet;
}): BuiltContext {
  const text = input.text ?? DEFAULT_TEXT;
  const summary = text.reviewSummary(reviewFacts(input.metrics, input.ingredients));
  const ingredients = input.ingredients.map((ingredient) => ({
    ...ingredient,
    ...troubleOf(input.metrics, ingredient),
    bounds: policyBounds(ingredient.base_min_qty, ingredient.capacity_qty),
  }));
  const lines = ingredients.map(
    (item) =>
      `- ${item.name}: batas ${item.min_qty} (awal ${item.base_min_qty}), menahan ${item.held} pesanan, habis ${Math.round(item.stockout_sec / 60)} menit`,
  );
  return {
    context: [
      summary,
      ...lines,
      ...(input.lessons.length > 0
        ? ['Catatan:', ...input.lessons.map((note) => `- ${note}`)]
        : []),
      'Usulkan paling banyak satu perubahan batas minimum, atau tidak ada.',
    ].join('\n'),
    facts: {
      kind: 'review',
      day: input.metrics.day,
      summary,
      ingredients,
      blocked: [...input.blocked],
    },
  };
}
