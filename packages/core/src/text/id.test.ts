import { describe, expect, it } from 'vitest';
import { TEXT_ID, type OutcomeText, type ReviewFacts } from './id';

const facts: ReviewFacts = {
  day: 1,
  orders: 75,
  done: 70,
  held: 9,
  complaints: 4,
  worst: [
    { name: 'Susu', unit: 'ml', held: 7, stockout_minutes: 40 },
    { name: 'Kopi', unit: 'g', held: 2, stockout_minutes: 15 },
    { name: 'Teh', unit: 'g', held: 1, stockout_minutes: 5 },
  ],
};
const change = { name: 'Susu', unit: 'ml', from: 1000, to: 1500 };
const outcome = (overrides: Partial<OutcomeText> = {}): OutcomeText => ({
  ...change,
  verdict: 'helped',
  held_before: 9,
  held_after: 2,
  stockout_minutes_before: 40,
  stockout_minutes_after: 5,
  ...overrides,
});

describe('the texts of the stock admin', () => {
  it('writes the summary of a day with the ingredients that gave trouble, and says so when none did', () => {
    expect(TEXT_ID.reviewSummary(facts)).toBe(
      'Hari 1: 75 pesanan, 70 selesai, 9 kali ditahan, 4 komplain. Paling bermasalah: Susu (7x menahan pesanan, habis 40 menit); Kopi (2x menahan pesanan, habis 15 menit); Teh (1x menahan pesanan, habis 5 menit).',
    );
    expect(TEXT_ID.reviewSummary({ ...facts, worst: [] })).toContain(
      'Tidak ada bahan yang bermasalah',
    );
  });

  it('keeps the summary within the 300 characters of the contract for three ingredients', () => {
    expect(TEXT_ID.reviewSummary(facts).length).toBeLessThanOrEqual(300);
  });

  it('writes the report for the boss: the title says what changes, the body how to decide', () => {
    expect(TEXT_ID.policyTitle(change)).toBe(
      'Usul kebijakan: batas minimum Susu 1000 jadi 1500 ml',
    );
    const body = TEXT_ID.policyBody(change, 'Susu sering menahan pesanan.');
    expect(body.split('\n')).toEqual([
      'Batas minimum Susu: 1000 ml jadi 1500 ml.',
      'Susu sering menahan pesanan.',
      'Setujui untuk mengubah batas, Tolak untuk membiarkannya.',
    ]);
  });

  it('writes the notes of the admin: what she saw, what she learned, and what the boss refused', () => {
    expect(TEXT_ID.observationText(facts)).toContain(
      'Hari 1: 75 pesanan, 9 kali ditahan, 4 komplain.',
    );
    expect(TEXT_ID.reflectionText(outcome())).toBe(
      'Batas Susu dinaikkan dari 1000 ke 1500 ml: membantu (pesanan tertahan 9 jadi 2, habis 40 jadi 5 menit).',
    );
    expect(TEXT_ID.reflectionText(outcome({ verdict: 'no_help' }))).toContain('tidak membantu');
    expect(TEXT_ID.reflectionText(outcome({ verdict: 'no_help' }))).toContain('Jangan diulang');
    expect(TEXT_ID.reflectionText(outcome({ verdict: 'unclear' }))).toContain('belum bisa dinilai');
    expect(TEXT_ID.rejectedText(change)).toContain('Bos menolak');
  });

  it('has a rationale for a review with a change and one without', () => {
    expect(TEXT_ID.reviewRationale(change, 7)).toContain('7 pesanan tertahan');
    expect(TEXT_ID.reviewRationale(null, 0)).toBe('Tidak ada yang perlu diubah.');
  });
});
