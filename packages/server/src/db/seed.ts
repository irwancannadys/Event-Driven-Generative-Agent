import { INGREDIENTS, MENU_ITEMS, RECIPE_ITEMS, REGULARS, SUPPLIERS } from '@cafe/core';
import type { Db } from './database';

export interface SeedCounts {
  menu_items: number;
  ingredients: number;
  recipe_items: number;
  regulars: number;
  suppliers_mock: number;
}

/**
 * Upserts the reference tables (menu, ingredients, recipes, regulars, suppliers).
 * Safe to run repeatedly. It only adds and updates rows: rows removed from the seed data stay in the database.
 * Projection tables (stock, orders, ...) are not touched, they are built from events.
 */
export function seedReferenceData(db: Db): SeedCounts {
  const insertMenuItem = db.prepare(`
    INSERT INTO menu_items (id, name, price, cook_time_sec)
    VALUES (@id, @name, @price, @cook_time_sec)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, price = excluded.price, cook_time_sec = excluded.cook_time_sec
  `);
  const insertIngredient = db.prepare(`
    INSERT INTO ingredients (id, name, unit, min_qty, capacity_qty, lead_time_sec)
    VALUES (@id, @name, @unit, @min_qty, @capacity_qty, @lead_time_sec)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, unit = excluded.unit, min_qty = excluded.min_qty,
      capacity_qty = excluded.capacity_qty, lead_time_sec = excluded.lead_time_sec
  `);
  const insertRecipeItem = db.prepare(`
    INSERT INTO recipe_items (menu_item_id, ingredient_id, qty_per_portion)
    VALUES (@menu_item_id, @ingredient_id, @qty_per_portion)
    ON CONFLICT (menu_item_id, ingredient_id) DO UPDATE SET
      qty_per_portion = excluded.qty_per_portion
  `);
  const insertRegular = db.prepare(`
    INSERT INTO regulars (id, name, usual_time_sec, favorite_table, usual_order_json)
    VALUES (@id, @name, @usual_time_sec, @favorite_table, @usual_order_json)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, usual_time_sec = excluded.usual_time_sec,
      favorite_table = excluded.favorite_table, usual_order_json = excluded.usual_order_json
  `);
  const insertSupplier = db.prepare(`
    INSERT INTO suppliers_mock
      (ingredient_id, weight_on_time, weight_late, weight_out, late_multiplier_pct)
    VALUES (@ingredient_id, @weight_on_time, @weight_late, @weight_out, @late_multiplier_pct)
    ON CONFLICT (ingredient_id) DO UPDATE SET
      weight_on_time = excluded.weight_on_time, weight_late = excluded.weight_late,
      weight_out = excluded.weight_out, late_multiplier_pct = excluded.late_multiplier_pct
  `);

  db.transaction(() => {
    for (const item of MENU_ITEMS) insertMenuItem.run(item);
    for (const ingredient of INGREDIENTS) {
      // initial_qty is not a column: it feeds the world_initialized event instead.
      insertIngredient.run({
        id: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        min_qty: ingredient.min_qty,
        capacity_qty: ingredient.capacity_qty,
        lead_time_sec: ingredient.lead_time_sec,
      });
    }
    for (const recipe of RECIPE_ITEMS) insertRecipeItem.run(recipe);
    for (const regular of REGULARS) {
      insertRegular.run({
        id: regular.id,
        name: regular.name,
        usual_time_sec: regular.usual_time_sec,
        favorite_table: regular.favorite_table,
        usual_order_json: JSON.stringify(regular.usual_order),
      });
    }
    for (const supplier of SUPPLIERS) insertSupplier.run(supplier);
  })();

  return countRows(db);
}

function countRows(db: Db): SeedCounts {
  const count = (table: keyof SeedCounts): number =>
    db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
  return {
    menu_items: count('menu_items'),
    ingredients: count('ingredients'),
    recipe_items: count('recipe_items'),
    regulars: count('regulars'),
    suppliers_mock: count('suppliers_mock'),
  };
}
