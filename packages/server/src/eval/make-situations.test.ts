import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITUATIONS_FILE } from './situations';
import { collectSituations, makeSituations, spread } from './make-situations';

describe('spread', () => {
  it('takes items evenly over the list, the first one included', () => {
    expect(spread([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5)).toEqual([0, 2, 4, 6, 8]);
  });

  it('takes the whole list when it is not longer than asked', () => {
    expect(spread([1, 2], 5)).toEqual([1, 2]);
    expect(spread([], 3)).toEqual([]);
  });
});

describe('collectSituations', () => {
  const options = { seeds: [11], days: 2, crowdPct: 150 } as const;
  const found = collectSituations(options);

  it('keeps every first question of the admin, with the world at that moment', () => {
    expect(found.length).toBeGreaterThan(0);
    for (const situation of found) {
      expect(situation.request.context.length).toBeGreaterThan(0);
      expect(Object.keys(situation.world.ingredients)).toHaveLength(8);
    }
    expect(found.some((s) => s.purpose === 'policy_review')).toBe(true);
    expect(found.some((s) => s.purpose === 'stock_proposal')).toBe(true);
  });

  it('is the same for the same seeds', () => {
    expect(collectSituations(options)).toEqual(found);
  });

  it('gives each situation a name that tells where it comes from', () => {
    for (const situation of found) expect(situation.id).toMatch(/^(stock|review)-s11-\d\d$/);
  });
});

describe('the file of situations', () => {
  it(
    'is what the generator makes: when the questions of the admin change, make it again (npm run eval:situations)',
    { timeout: 60_000 },
    () => {
      const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
      const file = JSON.parse(readFileSync(path.join(repoRoot, SITUATIONS_FILE), 'utf8')) as {
        situations: unknown;
      };
      expect(makeSituations()).toEqual(file.situations);
    },
  );
});
