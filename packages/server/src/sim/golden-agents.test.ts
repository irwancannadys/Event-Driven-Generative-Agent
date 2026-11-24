import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeEvent } from '../test-support/describe-event';
import { playDay } from '../test-support/play-day';

// The golden day of stage 3: the complete log of one virtual day for seed 42 with the characters and
// an automatic boss (who says no to every fourth report), with the time to the second. If this test
// fails, what the characters do changed. When that is intended (new rules, other durations, a new
// reaction), review the diff and regenerate with:  UPDATE_GOLDEN=1 npm test

const GOLDEN_FILE = fileURLToPath(new URL('./__golden__/day-seed-42-agents.json', import.meta.url));

describe('golden day with the characters (seed 42)', () => {
  it('matches the log kept in the repo', () => {
    const today = playDay().log.map((event) => describeEvent(event, { seconds: true }));

    if (process.env.UPDATE_GOLDEN === '1') {
      fs.writeFileSync(GOLDEN_FILE, `${JSON.stringify(today, null, 2)}\n`);
      return;
    }

    if (!fs.existsSync(GOLDEN_FILE)) {
      throw new Error(`No golden file yet. Create it with:  UPDATE_GOLDEN=1 npm test`);
    }
    const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8')) as string[];
    expect(today).toEqual(golden);
  });
});
