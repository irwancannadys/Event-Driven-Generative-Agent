import { describe, expect, it } from 'vitest';
import { thresholdSignals } from './stock-thresholds';

const base = { minQty: 1000, lowFlagged: false, outFlagged: false };

describe('thresholdSignals', () => {
  it('stays quiet while stock is above the minimum', () => {
    expect(thresholdSignals({ ...base, qtyAfter: 1001 })).toEqual({ low: false, out: false });
  });

  it('signals low at the minimum and below it', () => {
    expect(thresholdSignals({ ...base, qtyAfter: 1000 })).toEqual({ low: true, out: false });
    expect(thresholdSignals({ ...base, qtyAfter: 400 })).toEqual({ low: true, out: false });
  });

  it('does not repeat a signal that was already emitted', () => {
    expect(thresholdSignals({ ...base, qtyAfter: 400, lowFlagged: true })).toEqual({
      low: false,
      out: false,
    });
  });

  it('signals low and out together when stock drops from above the minimum to zero', () => {
    expect(thresholdSignals({ ...base, qtyAfter: 0 })).toEqual({ low: true, out: true });
  });

  it('signals only out when low was already emitted', () => {
    expect(thresholdSignals({ ...base, qtyAfter: 0, lowFlagged: true })).toEqual({
      low: false,
      out: true,
    });
  });

  it('is silent when both were already emitted', () => {
    expect(thresholdSignals({ ...base, qtyAfter: 0, lowFlagged: true, outFlagged: true })).toEqual({
      low: false,
      out: false,
    });
  });

  it('fires stock_low exactly once while stock keeps falling (milk, 150 ml per cup)', () => {
    let qty = 2500;
    let lowFlagged = false;
    const firedAtCup: number[] = [];
    for (let cup = 1; cup <= 16; cup += 1) {
      qty -= 150;
      const signals = thresholdSignals({
        qtyAfter: qty,
        minQty: 1000,
        lowFlagged,
        outFlagged: false,
      });
      if (signals.low) {
        firedAtCup.push(cup);
        lowFlagged = true;
      }
    }
    expect(firedAtCup).toEqual([10]);
  });
});
