import { describe, expect, it } from 'vitest';
import { STATION_IDS } from './ids';
import { DISTANCE_TENTHS, walkDurationSec } from './stations';

describe('station distances', () => {
  it('has a distance for every pair of stations', () => {
    for (const from of STATION_IDS) {
      expect(Object.keys(DISTANCE_TENTHS[from]).sort()).toEqual([...STATION_IDS].sort());
    }
  });

  it('is symmetric with a zero diagonal', () => {
    for (const from of STATION_IDS) {
      expect(DISTANCE_TENTHS[from][from]).toBe(0);
      for (const to of STATION_IDS) {
        expect(DISTANCE_TENTHS[from][to], `${from} -> ${to}`).toBe(DISTANCE_TENTHS[to][from]);
      }
    }
  });

  it('turns distance into whole virtual seconds', () => {
    expect(walkDurationSec('cashier', 'cashier')).toBe(0);
    expect(walkDurationSec('table_1', 'table_2')).toBe(48);
    expect(walkDurationSec('cashier', 'boss_desk')).toBe(132);
    for (const from of STATION_IDS) {
      for (const to of STATION_IDS) {
        expect(Number.isInteger(walkDurationSec(from, to)), `${from} -> ${to}`).toBe(true);
      }
    }
  });
});
