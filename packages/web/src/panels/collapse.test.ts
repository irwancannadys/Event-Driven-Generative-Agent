import { describe, expect, it } from 'vitest';
import { loadFolded, saveFolded, type KeyValueStore } from './collapse';

const memoryStore = (initial?: string): KeyValueStore & { value: string | null } => ({
  value: initial ?? null,
  getItem() {
    return this.value;
  },
  setItem(_key, value) {
    this.value = value;
  },
});

describe('the folded sections', () => {
  it('come back the way they were saved', () => {
    const store = memoryStore();
    saveFolded(store, new Set(['log', 'stock']));
    expect([...loadFolded(store)].sort()).toEqual(['log', 'stock']);
  });

  it('start with everything open when nothing was saved', () => {
    expect(loadFolded(memoryStore()).size).toBe(0);
  });

  it('start with everything open when what was saved cannot be read', () => {
    expect(loadFolded(memoryStore('{not json')).size).toBe(0);
    expect(loadFolded(memoryStore('{"log":true}')).size).toBe(0);
    expect([...loadFolded(memoryStore('["log", 3, null]'))]).toEqual(['log']);
  });

  it('do not break the page when storage is missing or refuses', () => {
    expect(loadFolded(undefined).size).toBe(0);
    expect(() => saveFolded(undefined, new Set(['log']))).not.toThrow();
    const refusing: KeyValueStore = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('full');
      },
    };
    expect(loadFolded(refusing).size).toBe(0);
    expect(() => saveFolded(refusing, new Set(['log']))).not.toThrow();
  });
});
