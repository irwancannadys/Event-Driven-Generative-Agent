// Stateless seeded randomness (decision 006). There is no generator that remembers a position:
// every draw is a pure function of (seed, key). The same pair always gives the same number, so a
// replay, a restart or a test that asks again gets the same answer. Each draw needs its own stable
// key, for example `order_arrival@28800`.

/** 53-bit string hash (cyrb53). Good enough spread for simulation draws, not for security. */
function hash53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** A number in [0, 1) that depends only on `seed` and `key`. */
export function rand(seed: number, key: string): number {
  if (!Number.isInteger(seed)) throw new Error(`seed must be an integer, got ${seed}`);
  return hash53(`${seed}|${key}`) / 2 ** 53;
}

/** A whole number in [0, n). */
export function randInt(seed: number, key: string, n: number): number {
  if (!Number.isInteger(n) || n <= 0) throw new Error(`n must be a positive integer, got ${n}`);
  return Math.floor(rand(seed, key) * n);
}

export interface Weighted<T> {
  value: T;
  weight: number;
}

/** Picks one option with a chance proportional to its weight. Zero-weight options are never picked. */
export function pickWeighted<T>(seed: number, key: string, options: readonly Weighted<T>[]): T {
  let total = 0;
  for (const option of options) {
    if (!Number.isFinite(option.weight) || option.weight < 0) {
      throw new Error(`weights must be non-negative numbers, got ${option.weight}`);
    }
    total += option.weight;
  }
  if (total <= 0) throw new Error('pickWeighted needs at least one option with a positive weight');
  const target = rand(seed, key) * total;
  let cumulative = 0;
  let lastPositive: T | undefined;
  for (const option of options) {
    if (option.weight === 0) continue;
    cumulative += option.weight;
    lastPositive = option.value;
    if (target < cumulative) return option.value;
  }
  return lastPositive as T; // only reachable through floating point rounding at the very end
}
