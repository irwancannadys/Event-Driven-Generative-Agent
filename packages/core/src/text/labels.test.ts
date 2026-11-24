import { describe, expect, it } from 'vitest';
import { AGENT_NAME_ID, LABEL_KEYS, STATION_NAME_ID, TASK_NAME_ID, taskName } from './labels';

describe('label dictionary', () => {
  it('has a text for every agent, station and task label', () => {
    for (const id of LABEL_KEYS.agents) expect(AGENT_NAME_ID[id], id).toBeTruthy();
    for (const id of LABEL_KEYS.stations) expect(STATION_NAME_ID[id], id).toBeTruthy();
    for (const id of LABEL_KEYS.tasks) expect(TASK_NAME_ID[id], id).toBeTruthy();
  });

  it('has no text that appears twice for different stations or agents', () => {
    expect(new Set(Object.values(STATION_NAME_ID)).size).toBe(LABEL_KEYS.stations.length);
    expect(new Set(Object.values(AGENT_NAME_ID)).size).toBe(LABEL_KEYS.agents.length);
  });

  it('falls back to a plain word or the key itself', () => {
    expect(taskName('cooking')).toBe('memasak');
    expect(taskName(null)).toBe('bekerja');
    expect(taskName('something_new')).toBe('something_new');
  });
});
