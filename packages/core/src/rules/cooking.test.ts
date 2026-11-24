import { describe, expect, it } from 'vitest';
import { INITIAL_STOCK, MENU_ITEMS, RECIPE_ITEMS } from '../seed-data';
import { cookDurationSec, ingredientNeeds, planCooking } from './cooking';

describe('ingredientNeeds', () => {
  it('multiplies the recipe by the number of portions', () => {
    expect(ingredientNeeds([{ menu_item_id: 'kopi_susu', qty: 1 }], RECIPE_ITEMS)).toEqual({
      kopi: 18,
      susu: 150,
      gula: 10,
    });
    expect(ingredientNeeds([{ menu_item_id: 'kopi_susu', qty: 3 }], RECIPE_ITEMS)).toEqual({
      kopi: 54,
      susu: 450,
      gula: 30,
    });
  });

  it('sums an ingredient shared by several lines', () => {
    const needs = ingredientNeeds(
      [
        { menu_item_id: 'kopi_susu', qty: 2 },
        { menu_item_id: 'es_teh_manis', qty: 1 },
      ],
      RECIPE_ITEMS,
    );
    // gula: 2 x 10 (kopi susu) + 1 x 20 (es teh manis)
    expect(needs).toEqual({ kopi: 36, susu: 300, gula: 40, teh: 5 });
  });

  it('returns nothing for an empty order', () => {
    expect(ingredientNeeds([], RECIPE_ITEMS)).toEqual({});
  });

  it('rejects a menu item that has no recipe', () => {
    expect(() => ingredientNeeds([{ menu_item_id: 'ghost', qty: 1 }], RECIPE_ITEMS)).toThrow(
      /No recipe for menu item "ghost"/,
    );
  });
});

describe('cookDurationSec', () => {
  it('is the sum of qty x cook time over all lines', () => {
    expect(cookDurationSec([{ menu_item_id: 'kopi_susu', qty: 2 }], MENU_ITEMS)).toBe(360);
    expect(
      cookDurationSec(
        [
          { menu_item_id: 'nasi_goreng', qty: 1 },
          { menu_item_id: 'roti_bakar', qty: 2 },
        ],
        MENU_ITEMS,
      ),
    ).toBe(480 + 2 * 300);
  });

  it('rejects an unknown menu item', () => {
    expect(() => cookDurationSec([{ menu_item_id: 'ghost', qty: 1 }], MENU_ITEMS)).toThrow(
      /Unknown menu item "ghost"/,
    );
  });
});

describe('planCooking', () => {
  it('decrements every ingredient when all are available, sorted by id', () => {
    const plan = planCooking(
      { susu: 150, kopi: 18, gula: 10 },
      { susu: 2500, kopi: 1200, gula: 1200 },
    );
    expect(plan).toEqual({
      ok: true,
      decrements: [
        { ingredient_id: 'gula', qty: 10, new_qty: 1190 },
        { ingredient_id: 'kopi', qty: 18, new_qty: 1182 },
        { ingredient_id: 'susu', qty: 150, new_qty: 2350 },
      ],
    });
  });

  it('allows using up the stock exactly', () => {
    expect(planCooking({ nasi: 200 }, { nasi: 200 })).toEqual({
      ok: true,
      decrements: [{ ingredient_id: 'nasi', qty: 200, new_qty: 0 }],
    });
  });

  it('is all or nothing: one short ingredient means no decrements at all', () => {
    const plan = planCooking({ nasi: 200, telur: 1 }, { nasi: 4000, telur: 0 });
    expect(plan).toEqual({
      ok: false,
      missing: [{ ingredient_id: 'telur', needed: 1, available: 0 }],
    });
  });

  it('reports every shortage, sorted by id', () => {
    const plan = planCooking({ susu: 150, kopi: 18 }, { susu: 100, kopi: 5 });
    expect(plan).toEqual({
      ok: false,
      missing: [
        { ingredient_id: 'kopi', needed: 18, available: 5 },
        { ingredient_id: 'susu', needed: 150, available: 100 },
      ],
    });
  });

  it('treats an ingredient missing from the stock as zero', () => {
    expect(planCooking({ mie: 100 }, {})).toEqual({
      ok: false,
      missing: [{ ingredient_id: 'mie', needed: 100, available: 0 }],
    });
  });

  it('does not change its inputs', () => {
    const needs = { susu: 150 };
    const stock = { susu: 2500 };
    planCooking(needs, stock);
    expect(needs).toEqual({ susu: 150 });
    expect(stock).toEqual({ susu: 2500 });
  });

  it('can cook one portion of every menu item from the starting stock', () => {
    for (const item of MENU_ITEMS) {
      const needs = ingredientNeeds([{ menu_item_id: item.id, qty: 1 }], RECIPE_ITEMS);
      expect(planCooking(needs, INITIAL_STOCK).ok, item.id).toBe(true);
    }
  });
});
