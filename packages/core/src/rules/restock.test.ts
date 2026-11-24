import { describe, expect, it } from 'vitest';
import { INGREDIENTS } from '../seed-data';
import { StockProposalSchema } from '../llm/contracts';
import { proposeRestock, type RestockCandidate } from './restock';

function candidate(
  overrides: Partial<RestockCandidate> & { ingredient_id: string },
): RestockCandidate {
  return {
    name: overrides.ingredient_id,
    unit: 'g',
    qty: 1000,
    min_qty: 1000,
    capacity_qty: 6000,
    low: false,
    out: false,
    ...overrides,
  };
}

const susuLow = candidate({ ingredient_id: 'susu', name: 'Susu', unit: 'ml', qty: 950, low: true });
const nasiOut = candidate({
  ingredient_id: 'nasi',
  name: 'Nasi',
  qty: 0,
  capacity_qty: 8000,
  low: true,
  out: true,
});

describe('proposeRestock ("fill up to full")', () => {
  it('orders capacity minus stock for a low ingredient', () => {
    const proposal = proposeRestock([susuLow], new Set());
    expect(proposal?.items).toEqual([{ ingredient_id: 'susu', qty: 5050 }]);
    expect(proposal?.urgency).toBe('normal');
    expect(proposal?.rationale).toBe('Susu tinggal 950 ml (batas 1000). Usul: isi sampai penuh.');
    expect(proposal?.report.title).toBe('Usul belanja: Susu');
    expect(proposal?.report.body).toBe(
      'Urgensi: normal.\nSusu: pesan 5050 ml (stok 950 dari 6000).',
    );
  });

  it('is urgent when something ran out', () => {
    const proposal = proposeRestock([nasiOut], new Set());
    expect(proposal?.urgency).toBe('high');
    expect(proposal?.items).toEqual([{ ingredient_id: 'nasi', qty: 8000 }]);
    expect(proposal?.rationale).toContain('Nasi habis');
    expect(proposal?.report.body).toContain('Urgensi: tinggi.');
  });

  it('puts every low ingredient in one proposal, sorted by id', () => {
    const proposal = proposeRestock([susuLow, nasiOut], new Set());
    expect(proposal?.items.map((item) => item.ingredient_id)).toEqual(['nasi', 'susu']);
    expect(proposal?.urgency).toBe('high');
    expect(proposal?.report.title).toBe('Usul belanja: Nasi, Susu');
  });

  it('leaves out ingredients that are already covered', () => {
    const proposal = proposeRestock([susuLow, nasiOut], new Set(['nasi']));
    expect(proposal?.items).toEqual([{ ingredient_id: 'susu', qty: 5050 }]);
    expect(proposal?.urgency).toBe('normal');
  });

  it('proposes nothing when nothing is low, all is covered, or the shelf is already full', () => {
    expect(proposeRestock([candidate({ ingredient_id: 'gula' })], new Set())).toBeNull();
    expect(proposeRestock([susuLow], new Set(['susu']))).toBeNull();
    expect(
      proposeRestock([candidate({ ingredient_id: 'x', qty: 6000, low: true })], new Set()),
    ).toBeNull();
    expect(proposeRestock([], new Set())).toBeNull();
  });

  it('keeps the rationale within 200 characters, even for every ingredient at once', () => {
    const all = INGREDIENTS.map((ingredient) =>
      candidate({
        ingredient_id: ingredient.id,
        name: ingredient.name,
        unit: ingredient.unit,
        qty: ingredient.min_qty - 1,
        min_qty: ingredient.min_qty,
        capacity_qty: ingredient.capacity_qty,
        low: true,
      }),
    );
    const proposal = proposeRestock(all, new Set());
    expect(proposal?.items).toHaveLength(INGREDIENTS.length);
    expect(proposal?.rationale.length).toBeLessThanOrEqual(200);
    expect(proposal?.rationale.endsWith('…')).toBe(true);
  });

  it('produces something the LLM contract accepts, so a model can be swapped in later', () => {
    const proposal = proposeRestock([susuLow, nasiOut], new Set());
    expect(proposal).not.toBeNull();
    const { items, urgency, rationale } = proposal as NonNullable<typeof proposal>;
    expect(StockProposalSchema.safeParse({ items, urgency, rationale }).success).toBe(true);
  });
});
