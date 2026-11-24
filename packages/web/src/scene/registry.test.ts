import { describe, expect, it } from 'vitest';
import { AGENT_IDS, DISTANCE_TENTHS, STATION_IDS } from '@cafe/core';
import { findPath, pathLength } from './navigation';
import {
  BOSS_SPOT,
  DOOR,
  KITCHEN,
  OFFICE,
  ORDER_SPOT,
  PICKUP_SPOT,
  ROOM,
  STATION_SPOTS,
  TABLES,
  WAITING_SPOTS,
  standingPoint,
  waitingSpot,
} from './registry';

const inside = (spot: { x: number; z: number }) =>
  spot.x > ROOM.xMin && spot.x < ROOM.xMax && spot.z > ROOM.zMin && spot.z < ROOM.zMax;

describe('station registry', () => {
  it('has a place to stand for every station of the domain, inside the room', () => {
    expect(Object.keys(STATION_SPOTS).sort()).toEqual([...STATION_IDS].sort());
    for (const spot of [...Object.values(STATION_SPOTS), BOSS_SPOT])
      expect(inside(spot)).toBe(true);
  });

  it('has the cashier, the shelf and the boss desk within reach of each other, as the domain says', () => {
    // Those are the places the staff walk between today. The walk takes as long as the domain says,
    // whatever the room looks like (decision 027), but if the way is much longer than the domain thinks,
    // a character would sprint. A little slower or faster than the table is fine.
    for (const [a, b] of [
      ['cashier', 'boss_desk'],
      ['stock_shelf', 'boss_desk'],
      ['cashier', 'stock_shelf'],
    ] as const) {
      const way = pathLength(
        findPath(standingPoint(a, 'stock_admin'), standingPoint(b, 'stock_admin')),
      );
      const ratio = way / (DISTANCE_TENTHS[a][b] / 10);
      expect(ratio, `${a} to ${b}`).toBeGreaterThan(0.5);
      expect(ratio, `${a} to ${b}`).toBeLessThan(1.5);
    }
  });

  it('puts the boss desk inside the office, and the stations of the cook in the kitchen', () => {
    expect(STATION_SPOTS.boss_desk.x).toBeLessThan(OFFICE.xMax);
    expect(STATION_SPOTS.boss_desk.z).toBeLessThan(OFFICE.zMax);
    expect(STATION_SPOTS.kitchen.x).toBeGreaterThan(KITCHEN.xMin);
    expect(STATION_SPOTS.kitchen.z).toBeLessThan(KITCHEN.zMax);
  });

  it('gives every character its own place at the boss desk, along the desk', () => {
    const places = AGENT_IDS.map((agent) => standingPoint('boss_desk', agent));
    expect(new Set(places.map((place) => place.z)).size).toBe(AGENT_IDS.length);
    expect(new Set(places.map((place) => place.x)).size).toBe(1);
  });

  it('is the same place for everybody at any other station', () => {
    for (const station of STATION_IDS.filter((id) => id !== 'boss_desk')) {
      expect(standingPoint(station, 'cook')).toEqual(standingPoint(station, 'waiter'));
    }
  });

  it('has seven tables for the customers, three of them the tables of the domain', () => {
    expect(TABLES).toHaveLength(7);
    for (const station of ['table_1', 'table_2', 'table_3'] as const) {
      const spot = STATION_SPOTS[station];
      expect(TABLES.some((table) => Math.abs(table.x - spot.x) < 0.01 && spot.z > table.z)).toBe(
        true,
      );
    }
  });
});

describe('the places of the customers', () => {
  it('lie inside the room, the door in the glass front', () => {
    for (const spot of [DOOR, ORDER_SPOT, PICKUP_SPOT, ...WAITING_SPOTS])
      expect(inside(spot)).toBe(true);
    expect(DOOR.z).toBeGreaterThan(5.5);
  });

  it('put the customer in front of the cashier, who faces it, and at the hatch of the kitchen', () => {
    expect(ORDER_SPOT.x).toBe(STATION_SPOTS.cashier.x);
    expect(ORDER_SPOT.z).toBeGreaterThan(STATION_SPOTS.cashier.z); // on the side of the hall
    expect(PICKUP_SPOT.z).toBe(KITCHEN.hatchZ);
    expect(PICKUP_SPOT.x).toBeLessThan(KITCHEN.xMin);
  });

  it('have twenty places to wait: fourteen seats at the tables and six to stand', () => {
    expect(WAITING_SPOTS).toHaveLength(20);
    expect(WAITING_SPOTS.filter((spot) => spot.seat)).toHaveLength(14);
  });

  it('keep the same place for the same order, and spread orders over the places', () => {
    expect(waitingSpot(41)).toEqual(waitingSpot(41));
    const first = new Set(
      Array.from({ length: 20 }, (_, id) => `${waitingSpot(id).x},${waitingSpot(id).z}`),
    );
    expect(first.size).toBe(20);
  });

  it('let the customers beyond the twenty places stand a little apart from the first ones', () => {
    const standing = 14; // an order that lands on a standing place
    expect(waitingSpot(standing).z).not.toBe(waitingSpot(standing + 20).z);
    expect(waitingSpot(standing + 20).x).toBe(waitingSpot(standing).x);
    expect(waitingSpot(0)).toEqual(waitingSpot(20)); // seats do not move
  });
});
