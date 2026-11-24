import { describe, expect, it } from 'vitest';
import { simTime } from '../time';
import type { DemandSample } from './demand';
import {
  FORECAST_COVER_SEC,
  proposeForecastRestock,
  readForecast,
  type ForecastCandidate,
} from './forecast-restock';

const at = (day: number, hours: number, minutes = 0) => simTime(day, hours, minutes);
const candidate = (overrides: Partial<ForecastCandidate> = {}): ForecastCandidate => ({
  ingredient_id: 'susu',
  name: 'Susu',
  unit: 'ml',
  qty: 2000,
  min_qty: 1000,
  capacity_qty: 6000,
  lead_time_sec: 2 * 3600,
  low: false,
  out: false,
  ...overrides,
});
const sample = (time: number, ingredient_id: string, qty: number): DemandSample => ({
  time,
  ingredient_id,
  qty,
});

// Day 0: 3000 ml of milk are asked for between 10:00 and 14:00 (the lead time of 2 hours plus the 2 hours of cover).
const history = [sample(at(0, 10, 30), 'susu', 1000), sample(at(0, 12), 'susu', 2000)];
const NOW = at(1, 10);

describe('proposeForecastRestock', () => {
  it('is 4 hours to look ahead: the lead time of the ingredient and the cover after the delivery', () => {
    expect(FORECAST_COVER_SEC).toBe(2 * 3600);
  });

  it('orders what is missing: the demand and the minimum, less what is on the shelf', () => {
    const proposal = proposeForecastRestock([candidate()], new Set(), history, NOW);
    // 3000 demand + 1000 minimum - 2000 in stock = 2000
    expect(proposal?.items).toEqual([{ ingredient_id: 'susu', qty: 2000 }]);
    expect(proposal?.urgency).toBe('high'); // 3000 is more than the 2000 on the shelf: it would run out first
    expect(proposal?.rationale).toContain('Susu 3000 ml');
  });

  it('is only normal in urgency when the stock would last for the demand but not for the minimum', () => {
    const proposal = proposeForecastRestock([candidate({ qty: 3500 })], new Set(), history, NOW);
    // 3000 + 1000 - 3500 = 500; 3500 > 3000, so it does not run out before the delivery
    expect(proposal?.items).toEqual([{ ingredient_id: 'susu', qty: 500 }]);
    expect(proposal?.urgency).toBe('normal');
  });

  it('never orders more than fits on the shelf', () => {
    const proposal = proposeForecastRestock(
      [candidate({ qty: 500, capacity_qty: 1500 })],
      new Set(),
      history,
      NOW,
    );
    expect(proposal?.items).toEqual([{ ingredient_id: 'susu', qty: 1000 }]);
  });

  it('orders nothing when the shelf lasts, and nothing for an ingredient that is already covered', () => {
    expect(proposeForecastRestock([candidate({ qty: 5000 })], new Set(), history, NOW)).toBeNull();
    expect(proposeForecastRestock([candidate()], new Set(['susu']), history, NOW)).toBeNull();
  });

  it('has nothing to say on the first day, when there is no history', () => {
    expect(
      proposeForecastRestock([candidate({ qty: 100 })], new Set(), history, at(0, 10)),
    ).toBeNull();
  });

  it('proposes several ingredients in one proposal, sorted by id, and leaves out the ones that have enough', () => {
    const samples = [...history, sample(at(0, 11), 'kopi', 600)];
    const proposal = proposeForecastRestock(
      [
        candidate({ ingredient_id: 'susu', name: 'Susu' }),
        candidate({
          ingredient_id: 'kopi',
          name: 'Kopi',
          unit: 'g',
          qty: 100,
          min_qty: 300,
          capacity_qty: 2000,
        }),
        candidate({ ingredient_id: 'teh', name: 'Teh', qty: 500, min_qty: 100, capacity_qty: 500 }),
      ],
      new Set(),
      samples,
      NOW,
    );
    expect(proposal?.items).toEqual([
      { ingredient_id: 'kopi', qty: 800 }, // 600 + 300 - 100
      { ingredient_id: 'susu', qty: 2000 },
    ]);
    expect(proposal?.report.title).toContain('Kopi');
  });

  it('writes a rationale that fits the contract of the model, however many ingredients there are', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      candidate({ ingredient_id: `bahan_${index}`, name: `Bahan nomor ${index}`, qty: 0 }),
    );
    const samples = many.map((entry) => sample(at(0, 11), entry.ingredient_id, 900));
    const proposal = proposeForecastRestock(many, new Set(), samples, NOW);
    expect(proposal?.rationale.length).toBeLessThanOrEqual(200);
  });
});

describe('readForecast', () => {
  it('gives the demand and the shortfall of every ingredient, or nothing on the first day', () => {
    expect(readForecast([candidate()], history, NOW)).toEqual([
      { ingredient_id: 'susu', expected: 3000, shortfall: 2000 },
    ]);
    expect(readForecast([candidate()], history, at(0, 10))).toBeNull();
  });
});
