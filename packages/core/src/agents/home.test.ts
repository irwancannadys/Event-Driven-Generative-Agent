import { describe, expect, it } from 'vitest';
import { AGENT_IDS, STATION_IDS } from '../ids';
import { AGENT_HOME_STATION, RESTOCK_RETRY_SEC, TASK_DURATION_SEC, TASK_LABELS } from './home';

describe('agent homes and durations', () => {
  it('gives every agent a real station to stand at', () => {
    expect(Object.keys(AGENT_HOME_STATION).sort()).toEqual([...AGENT_IDS].sort());
    for (const station of Object.values(AGENT_HOME_STATION)) {
      expect(STATION_IDS).toContain(station);
    }
  });

  it('puts the staff at their own station and Rina among the tables', () => {
    expect(AGENT_HOME_STATION).toEqual({
      cashier: 'cashier',
      cook: 'kitchen',
      stock_admin: 'stock_shelf',
      waiter: 'table_2',
    });
  });

  it('uses whole, positive durations in virtual seconds', () => {
    for (const [label, seconds] of Object.entries(TASK_DURATION_SEC)) {
      expect(Number.isInteger(seconds), label).toBe(true);
      expect(seconds, label).toBeGreaterThan(0);
    }
    expect(RESTOCK_RETRY_SEC).toBe(3600);
  });

  it('only knows fixed durations for labels that exist (cooking is as long as the recipe)', () => {
    for (const label of Object.keys(TASK_DURATION_SEC)) {
      expect(TASK_LABELS as readonly string[]).toContain(label);
    }
    expect(Object.keys(TASK_DURATION_SEC)).not.toContain('cooking');
    expect(new Set(TASK_LABELS).size).toBe(TASK_LABELS.length);
  });
});
