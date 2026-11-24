// Which sections of the sidebar the boss folded away, remembered between visits. Browser storage can
// be missing, full or switched off (a private window), so every use of it is allowed to fail: the page
// then simply starts with everything open.

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = 'cafe.folded-panels';

/** The browser's local storage, or nothing when it cannot even be asked for. */
export function browserStore(): KeyValueStore | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** The ids of the sections that were folded the last time. Anything unreadable counts as none. */
export function loadFolded(store: KeyValueStore | undefined): Set<string> {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(STORAGE_KEY) ?? '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export function saveFolded(store: KeyValueStore | undefined, folded: ReadonlySet<string>): void {
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify([...folded]));
  } catch {
    // not remembered: the next visit starts with everything open
  }
}
