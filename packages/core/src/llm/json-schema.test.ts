import { describe, expect, it } from 'vitest';
import { DECISION_SCHEMAS } from './contracts';
import { decisionJsonSchema } from './json-schema';

type Schema = {
  type?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
  enum?: string[];
  maxLength?: number;
};

describe('decisionJsonSchema', () => {
  it('describes a stock proposal: items with an id and a whole quantity, an urgency from the contract, a rationale of at most 200 characters', () => {
    const schema = decisionJsonSchema('stock_proposal') as Schema;
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['items', 'urgency', 'rationale']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties?.items?.items?.required).toEqual(['ingredient_id', 'qty']);
    expect(schema.properties?.items?.items?.properties?.qty?.type).toBe('integer');
    expect(schema.properties?.urgency?.enum).toEqual(['low', 'normal', 'high']);
    expect(schema.properties?.rationale?.maxLength).toBe(200);
  });

  it('describes the review: the change is optional and has an id and a whole minimum', () => {
    const schema = decisionJsonSchema('policy_review') as Schema;
    expect(schema.required).toEqual(['summary', 'rationale']);
    expect(schema.properties?.summary?.maxLength).toBe(300);
    expect(schema.properties?.change?.required).toEqual(['ingredient_id', 'min_qty']);
    expect(schema.properties?.change?.properties?.min_qty?.type).toBe('integer');
  });

  it('leaves out what a model has no use for', () => {
    for (const purpose of ['stock_proposal', 'policy_review'] as const) {
      const text = JSON.stringify(decisionJsonSchema(purpose));
      expect(text).not.toContain('$schema');
      expect(text).not.toContain(String(Number.MAX_SAFE_INTEGER));
    }
  });

  it('is made from the schema that checks the answer: what it describes is accepted by it', () => {
    expect(
      DECISION_SCHEMAS.stock_proposal.safeParse({
        items: [{ ingredient_id: 'susu', qty: 5000 }],
        urgency: 'normal',
        rationale: 'Susu hampir habis.',
      }).success,
    ).toBe(true);
    expect(
      DECISION_SCHEMAS.policy_review.safeParse({
        summary: 'Hari lancar.',
        rationale: 'Tidak ada yang perlu diubah.',
      }).success,
    ).toBe(true);
  });

  it('is a plain JSON value (it goes over the wire as it is)', () => {
    const schema = decisionJsonSchema('policy_review');
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});
