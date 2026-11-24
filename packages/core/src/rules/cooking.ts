import type { OrderItem } from '../schema-parts';

// Pure rules for cooking an order. They only answer "what should happen"; reading the stock and
// writing events is the server's job (decision 019).

export interface RecipeLine {
  menu_item_id: string;
  ingredient_id: string;
  qty_per_portion: number;
}

export interface MenuCookTime {
  id: string;
  cook_time_sec: number;
}

/** Quantity needed per ingredient id. */
export type Needs = Record<string, number>;

export interface StockDecrement {
  ingredient_id: string;
  qty: number;
  new_qty: number;
}

export interface MissingIngredient {
  ingredient_id: string;
  needed: number;
  available: number;
}

export type CookingPlan =
  { ok: true; decrements: StockDecrement[] } | { ok: false; missing: MissingIngredient[] };

/** Total ingredients an order needs, summed over its lines and the recipe of each menu item. */
export function ingredientNeeds(items: readonly OrderItem[], recipe: readonly RecipeLine[]): Needs {
  const needs: Needs = {};
  for (const item of items) {
    const lines = recipe.filter((line) => line.menu_item_id === item.menu_item_id);
    if (lines.length === 0) throw new Error(`No recipe for menu item "${item.menu_item_id}"`);
    for (const line of lines) {
      needs[line.ingredient_id] =
        (needs[line.ingredient_id] ?? 0) + item.qty * line.qty_per_portion;
    }
  }
  return needs;
}

/** One cook works through the order in sequence, so the duration is the sum over all portions. */
export function cookDurationSec(
  items: readonly OrderItem[],
  menu: readonly MenuCookTime[],
): number {
  let total = 0;
  for (const item of items) {
    const entry = menu.find((candidate) => candidate.id === item.menu_item_id);
    if (!entry) throw new Error(`Unknown menu item "${item.menu_item_id}"`);
    total += item.qty * entry.cook_time_sec;
  }
  return total;
}

/**
 * Decides whether an order can be cooked with the current stock. All or nothing: if any ingredient
 * is short, nothing is decremented and every shortage is reported. Results are sorted by ingredient id
 * so the same input always produces the same events. An ingredient missing from `stock` counts as 0.
 */
export function planCooking(needs: Needs, stock: Readonly<Record<string, number>>): CookingPlan {
  const decrements: StockDecrement[] = [];
  const missing: MissingIngredient[] = [];
  for (const ingredient_id of Object.keys(needs).sort()) {
    const needed = needs[ingredient_id] ?? 0;
    if (needed <= 0) continue;
    const available = stock[ingredient_id] ?? 0;
    if (needed > available) {
      missing.push({ ingredient_id, needed, available });
    } else {
      decrements.push({ ingredient_id, qty: needed, new_qty: available - needed });
    }
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, decrements };
}
