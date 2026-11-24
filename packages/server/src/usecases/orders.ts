import { OrderItemSchema, type OrderItem } from '@cafe/core';
import { z } from 'zod';
import { readMenu } from '../db/queries';
import { DomainError, nextId, transact, type Context } from './context';

const OrderItemsSchema = z.array(OrderItemSchema).min(1);

/**
 * Puts a walk-in order on the books (the cashier mock). Rejects unknown menu items, merges lines of the
 * same menu item (an order holds one line per menu item) and writes `order_created`.
 */
export function createOrder(ctx: Context, input: { items: OrderItem[] }): { order_id: number } {
  const parsed = OrderItemsSchema.safeParse(input.items);
  if (!parsed.success) {
    throw new DomainError(
      'invalid_order',
      'an order needs at least one item with a positive whole quantity',
    );
  }
  const known = new Set(readMenu(ctx.db).map((item) => item.id));
  for (const item of parsed.data) {
    if (!known.has(item.menu_item_id)) {
      throw new DomainError('unknown_menu_item', `unknown menu item "${item.menu_item_id}"`);
    }
  }

  const merged = new Map<string, number>();
  for (const item of parsed.data) {
    merged.set(item.menu_item_id, (merged.get(item.menu_item_id) ?? 0) + item.qty);
  }
  const items = [...merged].map(([menu_item_id, qty]) => ({ menu_item_id, qty }));

  return transact(ctx, (emit) => {
    const order_id = nextId(ctx.db, 'orders');
    emit({
      type: 'order_created',
      actor: 'world',
      origin: 'generator',
      payload: { order_id, source: 'walk_in', items },
    });
    return { order_id };
  });
}
