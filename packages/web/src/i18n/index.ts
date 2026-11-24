import { ID, type TextKey } from './id';
import { describeEventId, type Names } from './events-id';

export type { TextKey, Names };
export { PLAIN_NAMES, formatSpan, humanize } from './events-id';

/** The text for a key. Other languages are other copies of `id.ts` (decision 015), picked with `?lang=`. */
export function t(key: TextKey): string {
  return ID[key];
}

/** One readable sentence for an event, for the log. */
export const describeEvent = describeEventId;
