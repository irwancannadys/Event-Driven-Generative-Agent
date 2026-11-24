import {
  formatClock,
  isHiddenFromLog,
  logLabel,
  type LogLabel,
  type StoredEvent,
} from '@cafe/core';

// One readable line per event for the terminal:
//   08:37  [Aturan]     stock_low          ingredient_id=susu qty=1000 min_qty=1000
// The label text comes from this small dictionary (decision 015): core only returns a neutral key.

const LABEL_TEXT: Record<LogLabel, string> = {
  trigger: 'Trigger',
  rule: 'Aturan',
  llm: 'LLM',
  initiative: 'Inisiatif',
  boss: 'Bos',
};

const LABEL_WIDTH = 11; // fits "[Inisiatif]"
const TYPE_WIDTH = 17; // fits the longest event types of stage 1
const MAX_INLINE_OBJECT = 60;

/** The log line for an event, or `null` for plumbing events that are hidden from the log. */
export function formatEvent(event: StoredEvent): string | null {
  if (isHiddenFromLog(event)) return null;
  const label = `[${LABEL_TEXT[logLabel(event)]}]`.padEnd(LABEL_WIDTH);
  const type = event.type.padEnd(TYPE_WIDTH);
  return `${formatClock(event.sim_time)}  ${label}  ${type}  ${summarizePayload(event.payload)}`.trimEnd();
}

export function consoleSink(events: StoredEvent[]): void {
  for (const event of events) {
    const line = formatEvent(event);
    if (line !== null) console.log(line);
  }
}

function summarizePayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([key, value]) => `${key}=${summarizeValue(value)}`)
    .join(' ');
}

function summarizeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.map(summarizeItem).join(',');
  if (typeof value === 'object') {
    const json = JSON.stringify(value);
    return json.length <= MAX_INLINE_OBJECT ? json : `{${Object.keys(value).length} entries}`;
  }
  return String(value);
}

function summarizeItem(item: unknown): string {
  if (typeof item === 'object' && item !== null) {
    const line = item as Record<string, unknown>;
    const id = line.menu_item_id ?? line.ingredient_id;
    if (typeof id === 'string' && typeof line.qty === 'number') return `${id}×${line.qty}`;
    if (typeof id === 'string' && 'needed' in line && 'available' in line) {
      return `${id}(need ${line.needed}, have ${line.available})`;
    }
  }
  return JSON.stringify(item);
}
