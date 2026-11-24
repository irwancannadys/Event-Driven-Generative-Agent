import { describe, expect, it } from 'vitest';
import { runStage1Demo } from './stage1';

async function run() {
  const lines: string[] = [];
  const result = await runStage1Demo({ log: (line) => lines.push(line) });
  return { lines, ...result };
}

describe('stage 1 demo', () => {
  it('plays out the scenario: orders, cooking, falling stock, thresholds and a held order', async () => {
    const { events, counts } = await run();
    expect(events[0]?.type).toBe('world_initialized');
    expect(counts).toEqual({
      world_initialized: 1,
      order_created: 13,
      cooking_started: 12,
      stock_decreased: 35,
      cooking_done: 12,
      stock_low: 3,
      stock_out: 1,
      order_held: 1,
    });
    expect(events).toHaveLength(78);
  });

  it('emits each threshold once: milk low at cup 10, rice low and out together, eggs low', async () => {
    const { events } = await run();
    const signals = events
      .filter((event) => event.type === 'stock_low' || event.type === 'stock_out')
      .map(
        (event) => `${event.type}:${(event.payload as { ingredient_id: string }).ingredient_id}`,
      );
    expect(signals).toEqual([
      'stock_low:susu',
      'stock_low:nasi',
      'stock_out:nasi',
      'stock_low:telur',
    ]);
  });

  it('holds the last order because the rice is gone', async () => {
    const { events } = await run();
    const held = events.find((event) => event.type === 'order_held');
    expect(held?.payload).toEqual({
      order_id: 13,
      missing: [{ ingredient_id: 'nasi', needed: 200, available: 0 }],
    });
  });

  it('proves that replaying the log gives the same state as the live run', async () => {
    const { replayOk, lines } = await run();
    expect(replayOk).toBe(true);
    expect(lines.at(-1)).toMatch(/^Replay check: OK/);
  });

  it('prints readable log lines, with the milk warning at 08:37', async () => {
    const { lines } = await run();
    // Only real event lines start with a clock; the summary also mentions "order_created".
    const eventLines = lines.filter((line) => /^\d{2}:\d{2} {2}\[/.test(line));
    expect(eventLines.filter((line) => line.includes(' order_created '))).toHaveLength(13);
    expect(eventLines).toHaveLength(78);
    expect(lines.some((line) => line.includes('agent_state_changed'))).toBe(false);
    const milkWarning = lines.find(
      (line) => line.includes('stock_low') && line.includes('ingredient_id=susu'),
    );
    expect(milkWarning).toBe(
      '08:37  [Aturan]     stock_low              ingredient_id=susu qty=1000 min_qty=1000',
    );
  });

  it('can be run twice: every run starts from a fresh database', async () => {
    const first = await run();
    const second = await run();
    expect(second.lines).toEqual(first.lines);
  });
});
