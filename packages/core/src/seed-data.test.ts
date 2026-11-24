import { describe, expect, it } from 'vitest';
import {
  INGREDIENTS,
  INITIAL_STOCK,
  INITIAL_VISITS,
  MENU_ITEMS,
  RECIPE_ITEMS,
  REGULARS,
  SUPPLIERS,
} from './seed-data';
import { SECONDS_PER_DAY, timeOfDay } from './time';

const menuIds = new Set(MENU_ITEMS.map((item) => item.id));
const ingredientIds = new Set(INGREDIENTS.map((ingredient) => ingredient.id));

function isUnique(ids: string[]): boolean {
  return new Set(ids).size === ids.length;
}

describe('seed data consistency', () => {
  it('has 5 to 6 menu items with unique ids', () => {
    expect(MENU_ITEMS.length).toBeGreaterThanOrEqual(5);
    expect(MENU_ITEMS.length).toBeLessThanOrEqual(6);
    expect(isUnique(MENU_ITEMS.map((item) => item.id))).toBe(true);
    expect(isUnique(INGREDIENTS.map((ingredient) => ingredient.id))).toBe(true);
  });

  it('only references menu items and ingredients that exist', () => {
    for (const recipe of RECIPE_ITEMS) {
      expect(menuIds.has(recipe.menu_item_id), recipe.menu_item_id).toBe(true);
      expect(ingredientIds.has(recipe.ingredient_id), recipe.ingredient_id).toBe(true);
    }
  });

  it('gives every menu item at least one recipe line, with no duplicate lines', () => {
    for (const item of MENU_ITEMS) {
      expect(
        RECIPE_ITEMS.some((recipe) => recipe.menu_item_id === item.id),
        item.id,
      ).toBe(true);
    }
    const keys = RECIPE_ITEMS.map((recipe) => `${recipe.menu_item_id}/${recipe.ingredient_id}`);
    expect(isUnique(keys)).toBe(true);
  });

  it('keeps integer quantities and sane stock levels', () => {
    for (const ingredient of INGREDIENTS) {
      const label = ingredient.id;
      expect(Number.isInteger(ingredient.min_qty), label).toBe(true);
      expect(ingredient.capacity_qty, label).toBeGreaterThanOrEqual(ingredient.min_qty);
      expect(ingredient.initial_qty, label).toBeGreaterThan(ingredient.min_qty);
      expect(ingredient.initial_qty, label).toBeLessThanOrEqual(ingredient.capacity_qty);
    }
    expect(Object.keys(INITIAL_STOCK).sort()).toEqual([...ingredientIds].sort());
  });

  it('matches the regulars described in the brief', () => {
    expect(REGULARS.map((regular) => regular.id)).toEqual(['pak_budi', 'bu_sari', 'mas_joko']);
    expect(REGULARS.map((regular) => regular.usual_time_sec)).toEqual([
      timeOfDay(8, 30),
      timeOfDay(12),
      timeOfDay(17),
    ]);
    expect(REGULARS.map((regular) => regular.favorite_table)).toEqual([1, 2, 3]);
    expect(INITIAL_VISITS).toEqual({ pak_budi: 3, bu_sari: 2, mas_joko: 1 });
  });

  it('gives regulars valid times and usual orders', () => {
    for (const regular of REGULARS) {
      expect(regular.usual_time_sec, regular.id).toBeGreaterThanOrEqual(0);
      expect(regular.usual_time_sec, regular.id).toBeLessThan(SECONDS_PER_DAY);
      expect(regular.usual_order.items.length, regular.id).toBeGreaterThan(0);
      for (const line of regular.usual_order.items) {
        expect(menuIds.has(line.menu_item_id), `${regular.id}/${line.menu_item_id}`).toBe(true);
      }
    }
  });

  it('has one valid supplier entry per ingredient', () => {
    expect(SUPPLIERS.map((supplier) => supplier.ingredient_id).sort()).toEqual(
      [...ingredientIds].sort(),
    );
    for (const supplier of SUPPLIERS) {
      const total = supplier.weight_on_time + supplier.weight_late + supplier.weight_out;
      expect(total, supplier.ingredient_id).toBeGreaterThan(0);
      expect(supplier.late_multiplier_pct, supplier.ingredient_id).toBeGreaterThanOrEqual(100);
    }
  });
});
