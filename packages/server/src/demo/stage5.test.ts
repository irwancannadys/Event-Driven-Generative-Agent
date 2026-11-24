import { describe, expect, it } from 'vitest';
import { runStage5Demo, type Stage5Options } from './stage5';

function run(options: Stage5Options = {}) {
  const lines: string[] = [];
  const result = runStage5Demo({ log: (line) => lines.push(line), ...options });
  return { lines, ...result };
}

describe('stage 5 demo', () => {
  it('plays four days in which the stock admin learns, and passes both checks', () => {
    const { lines, days, replayOk, restartOk, counts } = run();
    expect(replayOk).toBe(true);
    expect(restartOk).toBe(true);
    expect(lines.at(-2)).toMatch(/^Replay check: OK/);
    expect(lines.at(-1)).toMatch(/^Restart check: OK \(restart hari 1 pukul 12:07/);
    expect(days).toHaveLength(4);
    expect(counts.daily_review_created).toBe(4);
    expect(counts.policy_proposed).toBeGreaterThan(0);
    expect(counts.policy_changed).toBe(counts.policy_proposed); // the boss of the demo approves them
    expect(counts.memory_created).toBeGreaterThan(4); // an observation a night, and what came of the changes
  });

  it('tells the story: the review, the proposal, the change, and what came of it', () => {
    const { lines } = run();
    expect(lines[0]).toMatch(/^=== Demo Tahap 5: 4 hari kafe, Admin Stok belajar/);
    expect(lines.some((line) => /\[LLM\]\s+daily_review_created/.test(line))).toBe(true);
    expect(lines.some((line) => /\[LLM\]\s+policy_proposed/.test(line))).toBe(true);
    expect(lines.some((line) => /\[Aturan\]\s+policy_changed/.test(line))).toBe(true);
    expect(lines.some((line) => /kind=reflection .*membantu/.test(line))).toBe(true);
    expect(lines).toContain('--- Per hari ---');
    expect(lines.filter((line) => /^Hari \d:/.test(line))).toHaveLength(4);
    expect(lines.some((line) => line.startsWith('Jumlah:'))).toBe(true);
    expect(
      lines.some((line) => /^Gula: batas minimum|^Susu: batas minimum|; Susu: batas/.test(line)),
    ).toBe(true);
  });

  it('is the cafe of stage 3 without learning: no change of policy, and it passes the checks too', () => {
    const { lines, counts, replayOk, restartOk } = run({ learning: false });
    expect(lines[0]).toContain('tanpa belajar');
    expect(counts.policy_changed ?? 0).toBe(0);
    expect(lines).toContain('Tidak ada yang berubah dari awal.');
    expect(replayOk && restartOk).toBe(true);
  });

  it('holds fewer orders and runs out of stock for a shorter time when it learns than when it does not (seed 42)', () => {
    const total = (learning: boolean) => {
      const { days } = run({ learning });
      return {
        held: days.reduce((sum, day) => sum + day.held, 0),
        out: days.reduce(
          (sum, day) => sum + Object.values(day.stockout_sec).reduce((a, b) => a + b, 0),
          0,
        ),
      };
    };
    const learned = total(true);
    const baseline = total(false);
    expect(learned.held).toBeLessThan(baseline.held);
    expect(learned.out).toBeLessThan(baseline.out);
  });

  it('is repeatable, and a different seed gives different days', () => {
    expect(run().lines).toEqual(run().lines);
    expect(run({ seed: 7 }).lines).not.toEqual(run().lines);
  });
});
