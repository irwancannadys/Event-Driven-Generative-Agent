import { describe, expect, it } from 'vitest';
import { AGENT_IDS, DISTANCE_TENTHS, STATION_IDS } from '@cafe/core';
import { BOSS_SPOT, STATION_SPOTS, standingPoint } from './registry';

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
