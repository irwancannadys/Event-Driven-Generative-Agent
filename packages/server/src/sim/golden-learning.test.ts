import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FAKE_SCRIPT, FakeLLM, makeScenario } from '@cafe/core';
import { openSeededMemoryDb } from '../db/memory';
import { listEvents } from '../events/store';
import { bootSimulation } from './simulation';
import { AutoBoss } from '../test-support/auto-boss';
import { describeEvent } from '../test-support/describe-event';

// The golden days of stage 5: what the stock admin decides and learns over four days of seed 42, with the
// scenario table of FakeLLM and a boss who approves everything. Only the events of the learning are kept
// (the whole log is the golden of stage 3), with the time to the second. If this test fails, what she decides
// or learns changed. When that is intended, review the diff and regenerate with:  UPDATE_GOLDEN=1 npm test

const GOLDEN_FILE = fileURLToPath(
  new URL('./__golden__/days-seed-42-learning.json', import.meta.url),
);
const LEARNING = new Set([
  'agent_decided',
  'daily_review_created',
  'policy_proposed',
  'policy_changed',
  'memory_created',
  'restock_proposed',
  'report_decided',
]);

describe('golden days of the learning stock admin (seed 42)', () => {
  it('matches the log kept in the repo', () => {
    const db = openSeededMemoryDb();
    const sim = bootSimulation({
      db,
      scenario: makeScenario(42),
      llm: new FakeLLM(DEFAULT_FAKE_SCRIPT),
    });
    new AutoBoss(sim, { decide: () => 'approved' }).advanceTo(4 * 86400);
    const days = listEvents(db)
      .filter((event) => LEARNING.has(event.type))
      .map(
        (event) =>
          `d${Math.floor(event.sim_time / 86400)} ${describeEvent(event, { seconds: true })}`,
      );

    if (process.env.UPDATE_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(days, null, 2)}\n`);
      return;
    }
    if (!fs.existsSync(GOLDEN_FILE)) {
      throw new Error('No golden file yet. Create it with:  UPDATE_GOLDEN=1 npm test');
    }
    expect(days).toEqual(JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) as string[]);
  });
});
