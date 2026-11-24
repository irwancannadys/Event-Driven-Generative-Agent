import { describe, expect, it } from 'vitest';
import { Group } from 'three';
import type { StockLevel } from '@cafe/core';
import {
  MAX_BOXES,
  MAX_PAPERS,
  PapersView,
  ShelfView,
  boxCount,
  paperCount,
  shelfPlacements,
} from './shelf';

const row = (
  ingredient_id: string,
  qty: number,
  capacity_qty = 1000,
  min_qty = 200,
): StockLevel => ({
  ingredient_id,
  name: ingredient_id,
  unit: 'g',
  qty,
  min_qty,
  capacity_qty,
  low: qty <= min_qty,
  out: qty === 0,
});

describe('boxCount', () => {
  it('follows how full the stock is, from none when it is gone up to the most', () => {
    expect([0, 1, 250, 251, 500, 750, 1000].map((qty) => boxCount(qty, 1000))).toEqual([
      0,
      1,
      1,
      2,
      2,
      3,
      MAX_BOXES,
    ]);
  });

  it('never gives more than the most, nor a box for an empty or broken stock', () => {
    expect(boxCount(5000, 1000)).toBe(MAX_BOXES);
    expect(boxCount(-5, 1000)).toBe(0);
    expect(boxCount(10, 0)).toBe(0);
  });
});

describe('shelfPlacements', () => {
  const stock = ['gula', 'kopi', 'mie', 'nasi', 'roti', 'susu', 'teh', 'telur'].map((id) =>
    row(id, 1000),
  );

  it('gives every ingredient its own place, four on the lower board and four on the upper one', () => {
    const places = shelfPlacements(stock);
    expect(places).toHaveLength(8 * MAX_BOXES);
    const lower = places.filter((place) => place.y < 1.9);
    const upper = places.filter((place) => place.y > 1.9);
    expect(new Set(lower.map((place) => place.ingredient))).toEqual(
      new Set(['gula', 'kopi', 'mie', 'nasi']),
    );
    expect(new Set(upper.map((place) => place.ingredient))).toEqual(
      new Set(['roti', 'susu', 'teh', 'telur']),
    );
    expect(new Set(places.map((place) => `${place.ingredient}:${place.z}`)).size).toBe(8);
  });

  it('keeps an ingredient where it is when the stock of another changes', () => {
    const before = shelfPlacements(stock).filter((place) => place.ingredient === 'susu');
    const changed = stock.map((entry) =>
      entry.ingredient_id === 'kopi' ? row('kopi', 100) : entry,
    );
    expect(shelfPlacements(changed).filter((place) => place.ingredient === 'susu')).toEqual(before);
  });

  it('puts boxes side by side and then on top of each other, resting on the board', () => {
    const [first, second, third] = shelfPlacements([row('gula', 1000)]);
    expect(first && second && third).toBeTruthy();
    expect(first?.x).not.toBe(second?.x);
    expect(first?.z).toBe(second?.z);
    expect(first?.y).toBeCloseTo(1.05 + 0.175);
    expect((third?.y ?? 0) - (first?.y ?? 0)).toBeGreaterThan(0.35);
  });

  it('shows less when the stock is less, and marks what is low, and leaves a gap for what is gone', () => {
    const places = shelfPlacements([row('gula', 1000), row('kopi', 150), row('mie', 0)]);
    const of = (id: string) => places.filter((place) => place.ingredient === id);
    expect(of('gula')).toHaveLength(MAX_BOXES);
    expect(of('kopi')).toHaveLength(1);
    expect(of('mie')).toHaveLength(0);
    expect(of('gula').some((place) => place.low)).toBe(false);
    expect(of('kopi').every((place) => place.low)).toBe(true);
  });

  it('does not depend on the order the stock comes in', () => {
    expect(shelfPlacements([...stock].reverse())).toEqual(shelfPlacements(stock));
  });
});

describe('ShelfView', () => {
  it('fills the group with the boxes, and leaves the scene alone while the stock stays the same', () => {
    const group = new Group();
    const view = new ShelfView(group);
    view.update([row('gula', 1000), row('kopi', 500)]);
    expect(group.children).toHaveLength(MAX_BOXES + 2);
    const first = group.children[0];
    view.update([row('gula', 1000), row('kopi', 500)]);
    expect(group.children[0]).toBe(first); // not rebuilt
    view.update([row('gula', 1000), row('kopi', 100)]);
    expect(group.children).toHaveLength(MAX_BOXES + 1);
    view.update([row('gula', 0)]);
    expect(group.children).toHaveLength(0);
  });
});

describe('papers on the boss desk', () => {
  it('has a paper per waiting report, up to four', () => {
    expect([0, 1, 3, 4, 9].map(paperCount)).toEqual([0, 1, 3, MAX_PAPERS, MAX_PAPERS]);
    expect(paperCount(-1)).toBe(0);
  });

  it('stacks them on the desk and follows the number of reports', () => {
    const group = new Group();
    const view = new PapersView(group);
    view.update(2);
    expect(group.children).toHaveLength(2);
    expect(group.children[1]?.position.y).toBeGreaterThan(group.children[0]?.position.y ?? 9);
    expect(group.children[0]?.position.y).toBeGreaterThan(0.9); // above the desk top
    view.update(0);
    expect(group.children).toHaveLength(0);
    view.update(7);
    expect(group.children).toHaveLength(MAX_PAPERS);
  });
});
