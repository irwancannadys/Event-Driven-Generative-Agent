import { describe, expect, it } from 'vitest';
import { createInitializedDb, createTestDb } from '../test-support/world';
import { readMenu, readRecipe, readStock } from './queries';

describe('read queries', () => {
  it('reads the menu and the recipe lines in a stable order', () => {
    const db = createTestDb();
    const menu = readMenu(db);
    expect(menu).toHaveLength(6);
    expect(menu.map((item) => item.id)).toEqual([...menu.map((item) => item.id)].sort());
    expect(menu.find((item) => item.id === 'kopi_susu')).toEqual({
      id: 'kopi_susu',
      name: 'Kopi Susu',
      price: 18000,
      cook_time_sec: 180,
    });
    expect(readRecipe(db)).toHaveLength(13);
  });

  it('has no stock before the world is initialized', () => {
    expect(readStock(createTestDb())).toEqual([]);
  });

  it('joins stock with the ingredient details once the world exists', () => {
    const stock = readStock(createInitializedDb());
    expect(stock).toHaveLength(8);
    expect(stock.find((row) => row.ingredient_id === 'susu')).toEqual({
      ingredient_id: 'susu',
      name: 'Susu',
      unit: 'ml',
      qty: 2500,
      min_qty: 1000,
      capacity_qty: 6000,
      low_flagged: false,
      out_flagged: false,
    });
  });
});
