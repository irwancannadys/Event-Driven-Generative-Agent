import { describe, expect, it } from 'vitest';
import { ComplaintTriageSchema } from '../llm/contracts';
import { triageComplaint } from './complaint-triage';

const minutes = (m: number) => m * 60;

describe('triageComplaint for slow service', () => {
  it('only apologises when the wait was under 40 minutes, and needs no boss', () => {
    const triage = triageComplaint('slow_service', minutes(25), 8);
    expect(triage).toMatchObject({
      category: 'slow_service',
      severity: 1,
      suggested_compensation: 'none',
      needs_boss_decision: false,
    });
    expect(triage.report).toBeUndefined();
    expect(triage.draft_reply).toBe(
      'Mohon maaf atas keterlambatan pesanan #8. Terima kasih atas kesabaran Anda.',
    );
  });

  it('offers 10% off between 40 and 60 minutes and asks the boss', () => {
    const triage = triageComplaint('slow_service', minutes(45), 12);
    expect(triage).toMatchObject({
      severity: 2,
      suggested_compensation: 'discount_10',
      needs_boss_decision: true,
    });
    expect(triage.report).toEqual({
      title: 'Komplain: layanan lambat (pesanan #12)',
      body:
        'Pesanan #12 menunggu 45 menit. Usul balasan: Mohon maaf atas keterlambatan pesanan #12. ' +
        'Kami beri diskon 10% untuk pesanan berikutnya. Kompensasi usulan: diskon 10% untuk pesanan berikutnya.',
    });
  });

  it('offers a free item after an hour and asks the boss', () => {
    const triage = triageComplaint('slow_service', minutes(75), 3);
    expect(triage).toMatchObject({
      severity: 3,
      suggested_compensation: 'free_item',
      needs_boss_decision: true,
    });
    expect(triage.draft_reply).toContain('Satu item gratis');
  });

  it('switches exactly at 40 and 60 minutes', () => {
    expect(triageComplaint('slow_service', minutes(40) - 1, 1).severity).toBe(1);
    expect(triageComplaint('slow_service', minutes(40), 1).severity).toBe(2);
    expect(triageComplaint('slow_service', minutes(60) - 1, 1).severity).toBe(2);
    expect(triageComplaint('slow_service', minutes(60), 1).severity).toBe(3);
  });

  it('has a report if and only if the boss has to decide', () => {
    for (const wait of [minutes(21), minutes(41), minutes(61), minutes(300)]) {
      const triage = triageComplaint('slow_service', wait, 1);
      expect(triage.report !== undefined, `${wait}s`).toBe(triage.needs_boss_decision);
    }
  });

  it('produces something the LLM contract accepts, so a model can be swapped in later', () => {
    for (const wait of [minutes(21), minutes(45), minutes(90)]) {
      const triage = triageComplaint('slow_service', wait, 5);
      // The LLM contract has no `report` field: the report is built from the decision afterwards.
      const decision = {
        category: triage.category,
        severity: triage.severity,
        draft_reply: triage.draft_reply,
        suggested_compensation: triage.suggested_compensation,
        needs_boss_decision: triage.needs_boss_decision,
      };
      expect(ComplaintTriageSchema.safeParse(decision).success).toBe(true);
    }
  });
});

describe('triageComplaint for the other causes (not generated yet)', () => {
  it('has a cautious fixed rule so the function is total', () => {
    expect(triageComplaint('wrong_order', 0, 1)).toMatchObject({
      category: 'wrong_order',
      suggested_compensation: 'free_item',
      needs_boss_decision: true,
    });
    expect(triageComplaint('quality', 0, 1)).toMatchObject({
      category: 'quality',
      suggested_compensation: 'discount_10',
      needs_boss_decision: true,
    });
  });
});
