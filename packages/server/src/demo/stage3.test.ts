import { describe, expect, it } from 'vitest';
import { runStage3Demo } from './stage3';

function run(seed?: number) {
  const lines: string[] = [];
  const result = runStage3Demo({ log: (line) => lines.push(line), seed });
  return { lines, ...result };
}

describe('stage 3 demo', () => {
  it('plays one whole day with the characters and passes both checks', () => {
    const { lines, replayOk, restartOk, counts } = run();
    expect(replayOk).toBe(true);
    expect(restartOk).toBe(true);
    expect(lines.at(-2)).toMatch(/^Replay check: OK/);
    expect(lines.at(-1)).toMatch(/^Restart check: OK \(restart pukul 12:07/);
    expect(counts.order_created).toBeGreaterThan(50);
    expect(counts.cooking_done).toBeGreaterThan(50);
    expect(counts.report_submitted).toBeGreaterThan(0);
    expect(counts.report_decided).toBe(counts.report_submitted);
    expect(counts.restock_arrived).toBeGreaterThan(0);
  });

  it('prints the story as readable log lines, without the plumbing of the characters', () => {
    const { lines } = run();
    expect(lines[0]).toMatch(/^=== Demo Tahap 3/);
    expect(lines.some((line) => /\[Aturan\]\s+restock_proposed/.test(line))).toBe(true);
    expect(lines.some((line) => /\[Bos\]\s+report_decided/.test(line))).toBe(true);
    expect(lines.some((line) => /\[Trigger\]\s+restock_arrived/.test(line))).toBe(true);
    expect(lines.some((line) => /agent_state_changed|agent_task_/.test(line))).toBe(false);
    expect(lines).toContain('--- Ringkasan satu hari ---');
    expect(lines.some((line) => line.startsWith('Belanja:'))).toBe(true);
  });

  it('is repeatable, and a different seed gives a different day', () => {
    expect(run().lines).toEqual(run().lines);
    expect(run(7).lines).not.toEqual(run().lines);
  });
});
