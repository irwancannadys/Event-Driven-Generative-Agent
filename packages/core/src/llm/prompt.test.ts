import { describe, expect, it } from 'vitest';
import type { DayMetrics } from '../rules/day-metrics';
import type { PolicyIngredient } from '../rules/policy-review';
import { simTime } from '../time';
import { reviewContext, stockContext } from './context';
import { buildPrompt } from './prompt';

const stock = stockContext({
  kind: 'forecast',
  now: simTime(1, 10),
  lines: [
    {
      ingredient_id: 'susu',
      name: 'Susu',
      unit: 'ml',
      qty: 900,
      min_qty: 1000,
      capacity_qty: 6000,
      expected: 3200,
      shortfall: 3300,
    },
    {
      ingredient_id: 'gula',
      name: 'Gula',
      unit: 'g',
      qty: 100,
      min_qty: 300,
      capacity_qty: 2000,
      expected: null,
      shortfall: 1900,
    },
  ],
});

const ingredients: PolicyIngredient[] = [
  {
    ingredient_id: 'susu',
    name: 'Susu',
    unit: 'ml',
    base_min_qty: 1000,
    min_qty: 1500,
    capacity_qty: 6000,
  },
  {
    ingredient_id: 'teh',
    name: 'Teh',
    unit: 'g',
    base_min_qty: 200,
    min_qty: 200,
    capacity_qty: 500,
  },
];
const metrics: DayMetrics = {
  day: 2,
  orders: 80,
  done: 75,
  held: 5,
  held_by_ingredient: { susu: 5 },
  stockout_sec: { susu: 1200 },
  complaints: 2,
};
const review = reviewContext({ metrics, ingredients, lessons: [], blocked: ['teh'] });

describe('buildPrompt for a stock proposal', () => {
  const prompt = buildPrompt({ purpose: 'stock_proposal', ...stock });

  it('asks for JSON only, in the shape of the contract, and says what the checks will accept', () => {
    expect(prompt.system).toContain('HANYA dengan satu objek JSON');
    expect(prompt.system).toContain('"items"');
    expect(prompt.system).toContain('"urgency"');
    expect(prompt.system).toContain('ruang di rak');
  });

  it('carries the situation, and the ids and the room on the shelf of every ingredient', () => {
    expect(prompt.user).toContain(stock.context);
    expect(prompt.user).toContain(
      '- id=susu (Susu): stok 900 ml, kapasitas 6000, ruang di rak 5100',
    );
    expect(prompt.user).toContain(
      '- id=gula (Gula): stok 100 g, kapasitas 2000, ruang di rak 1900',
    );
  });

  it('does not mention a refusal on the first attempt', () => {
    expect(prompt.user).not.toContain('ditolak');
  });

  it('tells the model why its last answer was refused when it is asked again', () => {
    const again = buildPrompt({
      purpose: 'stock_proposal',
      ...stock,
      feedback: 'unknown ingredient "kopi susu"',
    });
    expect(again.user).toContain(
      'Jawabanmu sebelumnya ditolak: unknown ingredient "kopi susu". Perbaiki',
    );
    expect(again.user.startsWith(stock.context)).toBe(true);
  });

  it('never lets the room on the shelf go below zero', () => {
    const over = buildPrompt({
      purpose: 'stock_proposal',
      context: 'x',
      facts: {
        lines: [{ ingredient_id: 'roti', name: 'Roti', unit: 'pcs', qty: 70, capacity_qty: 60 }],
      },
    });
    expect(over.user).toContain('ruang di rak 0');
  });
});

describe('buildPrompt for the nightly review', () => {
  const prompt = buildPrompt({ purpose: 'policy_review', ...review });

  it('asks for at most one change and says the change may be left out', () => {
    expect(prompt.system).toContain('PALING BANYAK SATU');
    expect(prompt.system).toContain('"change" boleh dihilangkan');
    expect(prompt.system).toContain('TERBLOKIR');
  });

  it('gives every ingredient with its id, its minimum, the range it may be changed to, and what is blocked', () => {
    expect(prompt.user).toContain(review.context);
    expect(prompt.user).toContain(
      '- id=susu (Susu): batas sekarang 1500 ml (awal 1000), boleh diubah ke 500 sampai 3000',
    );
    expect(prompt.user).toContain(
      '- id=teh (Teh): batas sekarang 200 g (awal 200), boleh diubah ke 100 sampai 500, TERBLOKIR: jangan diusulkan',
    );
    expect(prompt.user.split('TERBLOKIR').length - 1).toBe(1);
  });

  it('adds the refusal of the last answer on a retry', () => {
    const again = buildPrompt({
      purpose: 'policy_review',
      ...review,
      feedback: 'a minimum of 9000 for "susu" is outside 500 to 3000',
    });
    expect(again.user).toContain('outside 500 to 3000. Perbaiki');
  });
});

describe('buildPrompt in general', () => {
  it('still has the context when a request carries no facts', () => {
    const prompt = buildPrompt({ purpose: 'stock_proposal', context: 'Pukul 10:00.' });
    expect(prompt.user).toBe('Pukul 10:00.');
  });

  it('is the same prompt for the same request', () => {
    const request = { purpose: 'policy_review' as const, ...review };
    expect(buildPrompt(request)).toEqual(
      buildPrompt(JSON.parse(JSON.stringify(request)) as typeof request),
    );
  });

  it('refuses a purpose that is not put in front of a model yet', () => {
    expect(() => buildPrompt({ purpose: 'complaint_triage', context: 'x' })).toThrow(
      /no prompt for the purpose "complaint_triage"/,
    );
  });
});
