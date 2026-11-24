import { describe, expect, it } from 'vitest';
import { AGENT_IDS, DISTANCE_TENTHS, STATION_IDS } from '@cafe/core';
import {
  BOSS_SPOT,
  DOOR,
  ORDER_SPOT,
  PICKUP_SPOT,
  STATION_SPOTS,
  WAITING_SPOTS,
  standingPoint,
  waitingSpot,
} from './registry';

describe('station registry', () => {
  it('has a place to stand for every station of the domain, inside the room', () => {
    expect(Object.keys(STATION_SPOTS).sort()).toEqual([...STATION_IDS].sort());
    for (const spot of [...Object.values(STATION_SPOTS), BOSS_SPOT]) {
      expect(Math.abs(spot.x)).toBeLessThan(9);
      expect(spot.z).toBeGreaterThan(-4.5);
      expect(spot.z).toBeLessThan(5.5);
    }
  });

  it('keeps the distances on screen close to the walk distances of the domain', () => {
    // The walk takes as long as the domain says, whatever the picture looks like (decision 027), but if
    // the room differs too much a character would sprint or crawl. Within 50% either way is fine.
    for (const from of STATION_IDS) {
      for (const to of STATION_IDS) {
        if (from === to) continue;
        const a = STATION_SPOTS[from];
        const b = STATION_SPOTS[to];
        const onScreen = Math.hypot(a.x - b.x, a.z - b.z);
        const ratio = onScreen / (DISTANCE_TENTHS[from][to] / 10);
        expect(ratio, `${from} to ${to}`).toBeGreaterThan(0.5);
        expect(ratio, `${from} to ${to}`).toBeLessThan(1.5);
      }
    }
  });

  it('gives every character its own place at the boss desk, along the desk', () => {
    const places = AGENT_IDS.map((agent) => standingPoint('boss_desk', agent));
    expect(new Set(places.map((place) => place.x)).size).toBe(AGENT_IDS.length);
    expect(new Set(places.map((place) => place.z)).size).toBe(1);
  });

  it('is the same place for everybody at any other station', () => {
    for (const station of STATION_IDS.filter((id) => id !== 'boss_desk')) {
      expect(standingPoint(station, 'cook')).toEqual(standingPoint(station, 'waiter'));
    }
  });
});

describe('the places of the customers', () => {
  it('lie inside the room: the door on the left wall, the rest on the floor', () => {
    for (const spot of [DOOR, ORDER_SPOT, PICKUP_SPOT, ...WAITING_SPOTS]) {
      expect(Math.abs(spot.x)).toBeLessThanOrEqual(9);
      expect(spot.z).toBeGreaterThan(-4.5);
      expect(spot.z).toBeLessThan(5);
    }
    expect(DOOR.x).toBeLessThan(ORDER_SPOT.x);
  });

  it('put the customer in front of the cashier, who faces it, and in front of the cook at the counter', () => {
    const cashier = STATION_SPOTS.cashier;
    expect(ORDER_SPOT.z).toBe(cashier.z);
    expect(ORDER_SPOT.x).toBeLessThan(cashier.x); // on the queue side, where the cashier looks
    expect(PICKUP_SPOT.z).toBe(STATION_SPOTS.kitchen.z);
    expect(PICKUP_SPOT.x).toBeLessThan(STATION_SPOTS.kitchen.x);
  });

  it('have twelve places to wait: six seats at the tables and six to stand', () => {
    expect(WAITING_SPOTS).toHaveLength(12);
    expect(WAITING_SPOTS.filter((spot) => spot.seat)).toHaveLength(6);
  });

  it('keep the same place for the same order, and spread orders over the places', () => {
    expect(waitingSpot(41)).toEqual(waitingSpot(41));
    const first = new Set(
      Array.from({ length: 12 }, (_, id) => `${waitingSpot(id).x},${waitingSpot(id).z}`),
    );
    expect(first.size).toBe(12);
  });

  it('let the customers beyond the twelve places stand a little apart from the first ones', () => {
    const standing = 6; // an order that lands on a standing place
    expect(waitingSpot(standing).x).not.toBe(waitingSpot(standing + 12).x);
    expect(waitingSpot(standing + 12).z).toBe(waitingSpot(standing).z);
    const seat = 0; // seats do not move
    expect(waitingSpot(seat)).toEqual(waitingSpot(seat + 12));
  });
});
