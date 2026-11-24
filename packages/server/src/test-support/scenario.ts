import type { Event } from '@cafe/core';
import { ev } from './events';

/**
 * A realistic sequence of events for tests: a cooked coffee, a big nasi goreng order that empties the
 * rice (low + out together, plus low eggs), and a later order that has to be held.
 */
export function scenarioEvents(): Event[] {
  return [
    // Order 1: one kopi susu, cooked and done.
    ev.orderCreated(1, [{ menu_item_id: 'kopi_susu', qty: 1 }], 28860),
    ev.cookingStarted(1, 180, 28860),
    ev.stockDecreased(1, 'gula', 10, 1190, 28860),
    ev.stockDecreased(1, 'kopi', 18, 1182, 28860),
    ev.stockDecreased(1, 'susu', 150, 2350, 28860),
    ev.cookingDone(1, 29040),
    // Order 2: 20 nasi goreng use up the rice (4000 -> 0) and bring the eggs to their minimum (30 -> 10).
    ev.orderCreated(2, [{ menu_item_id: 'nasi_goreng', qty: 20 }], 29100),
    ev.cookingStarted(2, 9600, 29100),
    ev.stockDecreased(2, 'nasi', 4000, 0, 29100),
    ev.stockDecreased(2, 'telur', 20, 10, 29100),
    ev.stockLow('nasi', 0, 1000, 29100),
    ev.stockOut('nasi', 29100),
    ev.stockLow('telur', 10, 10, 29100),
    ev.cookingDone(2, 38700),
    // Order 3: one more nasi goreng cannot be cooked and is held.
    ev.orderCreated(3, [{ menu_item_id: 'nasi_goreng', qty: 1 }], 38760),
    ev.orderHeld(3, [{ ingredient_id: 'nasi', needed: 200, available: 0 }], 38760),
  ];
}
