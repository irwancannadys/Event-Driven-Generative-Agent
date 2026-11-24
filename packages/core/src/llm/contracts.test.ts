import { describe, expect, it } from 'vitest';
import {
  ComplaintTriageSchema,
  DECISION_SCHEMAS,
  PURPOSES,
  PolicyReviewSchema,
  StockProposalSchema,
  TextDecisionSchema,
  WaiterInitiativeSchema,
} from './contracts';

// Contract tests for the LLM output schemas. Checks against the live world (unknown ids, stale
// answers) need context and belong where a decision is applied (stages 5 and 6).

describe('waiter_initiative', () => {
  const valid = { action: 'prepare_table', table_id: 1, reason: 'Pak Budi sebentar lagi datang.' };

  it('accepts a valid decision, and idle without a table', () => {
    expect(WaiterInitiativeSchema.safeParse(valid).success).toBe(true);
    expect(
      WaiterInitiativeSchema.safeParse({ action: 'idle', reason: 'Semua beres.' }).success,
    ).toBe(true);
  });

  it('requires a table for prepare_table and tidy_table', () => {
    expect(WaiterInitiativeSchema.safeParse({ ...valid, table_id: undefined }).success).toBe(false);
    expect(
      WaiterInitiativeSchema.safeParse({ action: 'tidy_table', reason: 'Sepi.' }).success,
    ).toBe(false);
  });

  it('rejects an unknown action, an unknown table and a long reason', () => {
    expect(WaiterInitiativeSchema.safeParse({ ...valid, action: 'dance' }).success).toBe(false);
    expect(WaiterInitiativeSchema.safeParse({ ...valid, table_id: 4 }).success).toBe(false);
    expect(WaiterInitiativeSchema.safeParse({ ...valid, reason: 'a'.repeat(141) }).success).toBe(
      false,
    );
    expect(WaiterInitiativeSchema.safeParse({ ...valid, reason: 'a'.repeat(140) }).success).toBe(
      true,
    );
  });
});

describe('stock_proposal', () => {
  const valid = {
    items: [
      { ingredient_id: 'susu', qty: 2000 },
      { ingredient_id: 'kopi', qty: 500 },
    ],
    urgency: 'high',
    rationale: 'Susu dan kopi hampir habis.',
  };

  it('accepts a valid proposal', () => {
    expect(StockProposalSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects empty, negative, fractional and duplicate lines', () => {
    expect(StockProposalSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(
      StockProposalSchema.safeParse({ ...valid, items: [{ ingredient_id: 'susu', qty: -1 }] })
        .success,
    ).toBe(false);
    expect(
      StockProposalSchema.safeParse({ ...valid, items: [{ ingredient_id: 'susu', qty: 1.5 }] })
        .success,
    ).toBe(false);
    expect(
      StockProposalSchema.safeParse({
        ...valid,
        items: [
          { ingredient_id: 'susu', qty: 100 },
          { ingredient_id: 'susu', qty: 200 },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a wrong urgency and a long rationale', () => {
    expect(StockProposalSchema.safeParse({ ...valid, urgency: 'urgent' }).success).toBe(false);
    expect(StockProposalSchema.safeParse({ ...valid, rationale: 'a'.repeat(201) }).success).toBe(
      false,
    );
  });
});

describe('complaint_triage', () => {
  const valid = {
    category: 'slow_service',
    severity: 2,
    draft_reply: 'Maaf atas keterlambatannya.',
    suggested_compensation: 'discount_10',
    needs_boss_decision: true,
  };

  it('accepts a valid triage', () => {
    expect(ComplaintTriageSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects wrong enums, severity out of range and missing fields', () => {
    expect(ComplaintTriageSchema.safeParse({ ...valid, category: 'rude_staff' }).success).toBe(
      false,
    );
    expect(ComplaintTriageSchema.safeParse({ ...valid, severity: 4 }).success).toBe(false);
    expect(
      ComplaintTriageSchema.safeParse({ ...valid, suggested_compensation: 'free_coffee' }).success,
    ).toBe(false);
    expect(
      ComplaintTriageSchema.safeParse({ ...valid, needs_boss_decision: undefined }).success,
    ).toBe(false);
  });
});

describe('greeting and reflection text', () => {
  it('accepts up to 200 characters and rejects empty or longer text', () => {
    expect(TextDecisionSchema.safeParse({ text: 'a'.repeat(200) }).success).toBe(true);
    expect(TextDecisionSchema.safeParse({ text: '' }).success).toBe(false);
    expect(TextDecisionSchema.safeParse({ text: 'a'.repeat(201) }).success).toBe(false);
  });
});

describe('DECISION_SCHEMAS', () => {
  it('has a schema for every purpose', () => {
    expect(Object.keys(DECISION_SCHEMAS).sort()).toEqual([...PURPOSES].sort());
  });
});

describe('policy_review', () => {
  const valid = {
    summary: 'Susu habis 40 menit dan 9 pesanan tertahan.',
    change: { ingredient_id: 'susu', min_qty: 2000 },
    rationale: 'Naikkan batas supaya belanja lebih awal.',
  };

  it('accepts a review with one change, and a review without a change', () => {
    expect(PolicyReviewSchema.safeParse(valid).success).toBe(true);
    const noChange = { summary: valid.summary, rationale: valid.rationale };
    expect(PolicyReviewSchema.safeParse(noChange).success).toBe(true);
  });

  it('rejects a summary or a rationale that is empty or too long, and a minimum that is not a whole number', () => {
    expect(PolicyReviewSchema.safeParse({ ...valid, summary: '' }).success).toBe(false);
    expect(PolicyReviewSchema.safeParse({ ...valid, summary: 'a'.repeat(301) }).success).toBe(
      false,
    );
    expect(PolicyReviewSchema.safeParse({ ...valid, summary: 'a'.repeat(300) }).success).toBe(true);
    expect(PolicyReviewSchema.safeParse({ ...valid, rationale: 'a'.repeat(201) }).success).toBe(
      false,
    );
    expect(
      PolicyReviewSchema.safeParse({ ...valid, change: { ingredient_id: 'susu', min_qty: 1.5 } })
        .success,
    ).toBe(false);
    expect(
      PolicyReviewSchema.safeParse({ ...valid, change: { ingredient_id: 'susu', min_qty: -1 } })
        .success,
    ).toBe(false);
  });

  it('has a schema of its own among the purposes', () => {
    expect(PURPOSES).toContain('policy_review');
    expect(DECISION_SCHEMAS.policy_review).toBe(PolicyReviewSchema);
  });
});
