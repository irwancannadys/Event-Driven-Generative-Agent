import { ID, type TextKey } from './id';

export type { TextKey };

/** The text for a key. Other languages are other copies of `id.ts` (decision 015), picked with `?lang=`. */
export function t(key: TextKey): string {
  return ID[key];
}
