import { describe, expect, it } from 'vitest';
import { validateDecision, type ValidationWorld } from './validate';

const world = (covered: string[] = []): ValidationWorld => ({
  ingredients: new Map([
    ['susu', { qty: 800, capacity_qty: 6000, base_min_qty: 1000 }],
    ['kopi', { qty: 100, capacity_qty: 2000, base_min_qty: 300 }],
  ]),
  covered: new Set(covered),
});

const proposal = (items: { ingredient_id: string; qty: number }[]) => ({
  items,
  urgency: 'normal',
  rationale: 'Susu akan habis sebelum makan siang.',
});

describe('validateDecision: the shape of the answer', () => {
  it('accepts a good answer, as an object or as text', () => {
    const good = proposal([{ ingredient_id: 'susu', qty: 2000 }]);
    const fromObject = validateDecision('stock_proposal', good, world());
    expect(fromObject).toEqual({ ok: true, decision: good });
    expect(validateDecision('stock_proposal', JSON.stringify(good), world())).toEqual(fromObject);
  });

  it('says invalid_json for text that is not JSON, for something that is not an object, and for a missing field', () => {
    for (const raw of ['{"items": [', 'halo', 42, null, [], {}]) {
      const result = validateDecision('stock_proposal', raw, world());
      expect(result, JSON.stringify(raw)).toMatchObject({ ok: false, reason: 'invalid_json' });
    }
  });

  it('says invalid_enum for a value that is not one of the choices', () => {
    const result = validateDecision(
      'stock_proposal',
      { ...proposal([{ ingredient_id: 'susu', qty: 100 }]), urgency: 'sangat' },
      world(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'invalid_enum' });
  });

  it('says too_long for a text over its limit, and out_of_range for a number that cannot be', () => {
    expect(
      validateDecision(
        'stock_proposal',
        { ...proposal([{ ingredient_id: 'susu', qty: 100 }]), rationale: 'a'.repeat(201) },
        world(),
      ),
    ).toMatchObject({ ok: false, reason: 'too_long' });
    expect(
      validateDecision('stock_proposal', proposal([{ ingredient_id: 'susu', qty: -5 }]), world()),
    ).toMatchObject({ ok: false, reason: 'out_of_range' });
  });

  it('puts the place of the problem in the message, so that a retry can say what was wrong', () => {
    const result = validateDecision(
      'stock_proposal',
      { ...proposal([{ ingredient_id: 'susu', qty: 100 }]), urgency: 'sangat' },
      world(),
    );
    expect(result.ok === false && result.message).toContain('urgency');
  });
});

describe('validateDecision: stock_proposal against the world', () => {
  it('says unknown_id for an ingredient that does not exist', () => {
    const result = validateDecision(
      'stock_proposal',
      proposal([{ ingredient_id: 'durian', qty: 10 }]),
      world(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'unknown_id' });
  });

  it('names the ids that exist when it refuses an unknown one, so that a retry can be helped', () => {
    const result = validateDecision(
      'stock_proposal',
      proposal([{ ingredient_id: 'Susu', qty: 10 }]),
      world(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'unknown_id' });
    expect(result.ok ? '' : result.message).toMatch(
      /^unknown ingredient "Susu": use exactly one of susu/,
    );
  });

  it('says out_of_range for more than fits on the shelf', () => {
    const fits = validateDecision(
      'stock_proposal',
      proposal([{ ingredient_id: 'susu', qty: 5200 }]),
      world(),
    );
    expect(fits.ok).toBe(true); // 6000 capacity - 800 in stock
    const tooMuch = validateDecision(
      'stock_proposal',
      proposal([{ ingredient_id: 'susu', qty: 5201 }]),
      world(),
    );
    expect(tooMuch).toMatchObject({ ok: false, reason: 'out_of_range' });
  });

  it('says stale for an ingredient that is covered by another proposal or order while the model thought', () => {
    const result = validateDecision(
      'stock_proposal',
      proposal([{ ingredient_id: 'susu', qty: 1000 }]),
      world(['susu']),
    );
    expect(result).toMatchObject({ ok: false, reason: 'stale' });
  });
});

describe('validateDecision: policy_review against the world', () => {
  const review = (change?: { ingredient_id: string; min_qty: number }) => ({
    summary: 'Susu habis 40 menit dan 9 pesanan tertahan.',
    ...(change && { change }),
    rationale: 'Naikkan batas supaya belanja lebih awal.',
  });

  it('accepts a review without a change, and a change within 0.5x to 3x the starting value', () => {
    expect(validateDecision('policy_review', review(), world()).ok).toBe(true);
    expect(
      validateDecision('policy_review', review({ ingredient_id: 'susu', min_qty: 2000 }), world())
        .ok,
    ).toBe(true);
    expect(
      validateDecision('policy_review', review({ ingredient_id: 'susu', min_qty: 500 }), world())
        .ok,
    ).toBe(true);
    expect(
      validateDecision('policy_review', review({ ingredient_id: 'susu', min_qty: 3000 }), world())
        .ok,
    ).toBe(true);
  });

  it('says out_of_range for a minimum outside that range, and unknown_id for an ingredient that is not there', () => {
    for (const min_qty of [499, 3001, 100_000]) {
      expect(
        validateDecision('policy_review', review({ ingredient_id: 'susu', min_qty }), world()),
        `${min_qty}`,
      ).toMatchObject({ ok: false, reason: 'out_of_range' });
    }
    expect(
      validateDecision('policy_review', review({ ingredient_id: 'durian', min_qty: 100 }), world()),
    ).toMatchObject({ ok: false, reason: 'unknown_id' });
  });

  it('says too_long for a summary over 300 characters', () => {
    const result = validateDecision(
      'policy_review',
      { ...review(), summary: 'a'.repeat(301) },
      world(),
    );
    expect(result).toMatchObject({ ok: false, reason: 'too_long' });
  });
});

describe('validateDecision: purposes that have nothing to check against the world', () => {
  it('only checks the shape', () => {
    expect(validateDecision('greeting', { text: 'Selamat pagi, Pak Budi!' }, world()).ok).toBe(
      true,
    );
    expect(validateDecision('greeting', { text: '' }, world())).toMatchObject({ ok: false });
  });
});
