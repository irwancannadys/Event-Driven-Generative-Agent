import type { Event } from './schemas';

/** An event as read back from the log: the event itself plus its position in the log. */
export type StoredEvent = Event & { id: number };
