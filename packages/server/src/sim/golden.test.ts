import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SECONDS_PER_DAY, makeScenario } from '@cafe/core';
import { openSeededMemoryDb } from '../db/memory';
import { listEvents } from '../events/store';
import { describeEvent } from '../test-support/describe-event';
import { bootSimulation } from './simulation';

// The golden day: the complete log of one virtual day for seed 42, kept in the repo as a file.
// If this test fails, the generated world changed. When that is intended (new rules, new weights, a
// different random algorithm), review the diff and regenerate with:  UPDATE_GOLDEN=1 npm test

const GOLDEN_FILE = fileURLToPath(new URL('./__golden__/day-seed-42.json', import.meta.url));

function playTheDay(): string[] {
  const db = openSeededMemoryDb();
  const simulation = bootSimulation({ db, agents: false, scenario: makeScenario(42) });
  simulation.clock.advance(SECONDS_PER_DAY - simulation.clock.now());
  return listEvents(db).map((event) => describeEvent(event));
}

describe('golden day (seed 42)', () => {
  it('matches the log kept in the repo', () => {
    const today = playTheDay();

    if (process.env.UPDATE_GOLDEN === '1') {
      fs.mkdirSync(fileURLToPath(new URL('./__golden__/', import.meta.url)), { recursive: true });
      fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(today, null, 2)}\n`);
      return;
    }

    if (!fs.existsSync(GOLDEN_FILE)) {
      throw new Error(`No golden file yet. Create it with:  UPDATE_GOLDEN=1 npm test`);
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) as string[];
    expect(today).toEqual(golden);
  });

  it('is a day worth checking: a full opening, orders, regulars, complaints and a closing', () => {
    const day = playTheDay();
    const count = (type: string) => day.filter((line) => line.split(' ')[1] === type).length;
    expect(count('world_initialized')).toBe(1);
    expect(count('day_opened')).toBe(1);
    expect(count('day_closed')).toBe(1);
    expect(count('regular_expected')).toBe(3);
    expect(count('order_created')).toBeGreaterThan(50);
    expect(count('complaint_received')).toBeGreaterThan(0);
  });
});
