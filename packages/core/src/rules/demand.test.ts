import { describe, expect, it } from 'vitest';
import { RECIPE_ITEMS } from '../seed-data';
import { simTime } from '../time';
import { FORECAST_LOOKBACK_DAYS, demandSamples, forecastDemand, type DemandSample } from './demand';

const recipe = RECIPE_ITEMS.map((line) => ({
  menu_item_id: line.menu_item_id,
  ingredient_id: line.ingredient_id,
  qty_per_portion: line.qty_per_portion,
}));

const at = (day: number, hours: number, minutes = 0) => simTime(day, hours, minutes);
const sample = (time: number, ingredient_id: string, qty: number): DemandSample => ({
  time,
  ingredient_id,
  qty,
});

describe('demandSamples', () => {
  it('turns every order into what it asks of each ingredient, at the time it came in', () => {
    const [first] = demandSamples(
      [{ sim_time: at(0, 12), items: [{ menu_item_id: 'kopi_susu', qty: 2 }] }],
      recipe,
    );
    expect(first).toMatchObject({ time: at(0, 12) });
    const total = demandSamples(
      [{ sim_time: 5, items: [{ menu_item_id: 'kopi_susu', qty: 2 }] }],
      recipe,
    );
    const kopiSusu = RECIPE_ITEMS.filter((line) => line.menu_item_id === 'kopi_susu');
    expect(total.map((entry) => [entry.ingredient_id, entry.qty]).sort()).toEqual(
      kopiSusu.map((line) => [line.ingredient_id, line.qty_per_portion * 2]).sort(),
    );
  });

  it('says so when an order has a menu item without a recipe', () => {
    expect(() =>
      demandSamples([{ sim_time: 0, items: [{ menu_item_id: 'durian', qty: 1 }] }], recipe),
    ).toThrow(/No recipe/);
  });
});

describe('forecastDemand', () => {
  it('has no forecast on the first day: there is no past to look at', () => {
    expect(forecastDemand([sample(at(0, 11), 'susu', 500)], at(0, 10), 7200)).toBeNull();
  });

  it('adds up what the same hours asked on a past day', () => {
    const samples = [
      sample(at(0, 10, 30), 'susu', 300),
      sample(at(0, 11), 'susu', 500),
      sample(at(0, 11), 'kopi', 40),
      sample(at(0, 9), 'susu', 999), // before the window
      sample(at(0, 13), 'susu', 999), // after it
    ];
    expect(forecastDemand(samples, at(1, 10), 2 * 3600)).toEqual({ susu: 800, kopi: 40 });
  });

  it('takes the average of the last days, rounded up, and counts a quiet day as zero', () => {
    const samples = [
      sample(at(0, 11), 'susu', 300),
      sample(at(1, 11), 'susu', 500),
      sample(at(2, 11), 'susu', 301),
    ];
    // on day 3 the last three days are 0, 1 and 2: (300 + 500 + 301) / 3 = 367
    expect(forecastDemand(samples, at(3, 10), 3600 * 2)).toEqual({ susu: 367 });
    // on day 2 only two days exist: (300 + 500) / 2
    expect(forecastDemand(samples, at(2, 10), 3600 * 2)).toEqual({ susu: 400 });
  });

  it('looks back no further than the lookback days', () => {
    expect(FORECAST_LOOKBACK_DAYS).toBe(3);
    const samples = [sample(at(0, 11), 'susu', 9000), sample(at(3, 11), 'susu', 300)];
    // day 4 looks at days 1, 2 and 3: day 0 does not count
    expect(forecastDemand(samples, at(4, 10), 7200)).toEqual({ susu: 100 });
  });

  it('does not count the demand of today, and is the same for the same input', () => {
    const samples = [sample(at(1, 10, 30), 'susu', 700), sample(at(0, 10, 30), 'susu', 200)];
    expect(forecastDemand(samples, at(1, 10), 7200)).toEqual({ susu: 200 });
    expect(forecastDemand(samples, at(1, 10), 7200)).toEqual(
      forecastDemand(samples, at(1, 10), 7200),
    );
  });
});
