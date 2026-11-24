import { describe, expect, it } from 'vitest';
import { runStage2Demo } from './stage2';

function run(seed?: number) {
  const lines: string[] = [];
  const result = runStage2Demo({ log: (line) => lines.push(line), seed });
  return { lines, ...result };
}

describe('stage 2 demo', () => {
  it('plays one whole day and passes both checks', () => {
    const { lines, replayOk, restartOk, counts } = run();
    expect(replayOk).toBe(true);
    expect(restartOk).toBe(true);
    expect(lines.at(-2)).toMatch(/^Replay check: OK/);
    expect(lines.at(-1)).toMatch(/^Restart check: OK \(restart pukul 12:07/);
    expect(counts.day_opened).toBe(1);
    expect(counts.day_closed).toBe(1);
    expect(counts.regular_expected).toBe(3);
    expect(counts.order_created).toBeGreaterThan(50);
  });

  it('prints the day as readable log lines, with a summary', () => {
    const { lines } = run();
    expect(lines[0]).toMatch(/^=== Demo Tahap 2/);
    expect(lines.some((line) => /^08:00 {2}\[Aturan\]\s+day_opened/.test(line))).toBe(false); // opening is a Trigger
    expect(lines.some((line) => /^08:00 {2}\[Trigger\]\s+day_opened/.test(line))).toBe(true);
    expect(lines.some((line) => /^20:00 {2}\[Trigger\]\s+day_closed/.test(line))).toBe(true);
    expect(lines).toContain('--- Ringkasan satu hari ---');
    expect(lines.some((line) => line.startsWith('Pesanan per jam:'))).toBe(true);
  });

  it('is repeatable, and a different seed gives a different day', () => {
    expect(run().lines).toEqual(run().lines);
    expect(run(7).lines).not.toEqual(run().lines);
  });
});
