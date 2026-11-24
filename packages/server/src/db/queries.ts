import type { OrderItem, RecipeLine } from '@cafe/core';
import type { Db } from './database';

// Read-only queries shared by the use cases and the HTTP API.

export interface MenuItemRow {
  id: string;
  name: string;
  price: number;
  cook_time_sec: number;
}

export interface StockRow {
  ingredient_id: string;
  name: string;
  unit: 'g' | 'ml' | 'pcs';
  qty: number;
  min_qty: number;
  capacity_qty: number;
  low_flagged: boolean;
  out_flagged: boolean;
}

export function readMenu(db: Db): MenuItemRow[] {
  return db
    .prepare('SELECT id, name, price, cook_time_sec FROM menu_items ORDER BY id')
    .all() as MenuItemRow[];
}

export function readRecipe(db: Db): RecipeLine[] {
  return db
    .prepare(
      `SELECT menu_item_id, ingredient_id, qty_per_portion
       FROM recipe_items ORDER BY menu_item_id, ingredient_id`,
    )
    .all() as RecipeLine[];
}

/** Current stock per ingredient (empty until the world is initialized). */
export function readStock(db: Db): StockRow[] {
  const rows = db
    .prepare(
      `SELECT s.ingredient_id, i.name, i.unit, s.qty, i.min_qty, i.capacity_qty,
              s.low_flagged, s.out_flagged
       FROM stock s JOIN ingredients i ON i.id = s.ingredient_id
       ORDER BY s.ingredient_id`,
    )
    .all() as (Omit<StockRow, 'low_flagged' | 'out_flagged'> & {
    low_flagged: number;
    out_flagged: number;
  })[];
  return rows.map((row) => ({
    ...row,
    low_flagged: row.low_flagged === 1,
    out_flagged: row.out_flagged === 1,
  }));
}

export interface OrderRow {
  id: number;
  status: 'placed' | 'held' | 'cooking' | 'done';
}

export function readOrder(db: Db, orderId: number): OrderRow | undefined {
  return db.prepare('SELECT id, status FROM orders WHERE id = ?').get(orderId) as
    OrderRow | undefined;
}

export function readOrderItems(db: Db, orderId: number): OrderItem[] {
  return db
    .prepare('SELECT menu_item_id, qty FROM order_items WHERE order_id = ? ORDER BY menu_item_id')
    .all(orderId) as OrderItem[];
}
