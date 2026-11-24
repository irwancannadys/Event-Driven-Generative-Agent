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
const TYPE_WIDTH = 21; // fits the longest event type (agent_think_requested)
const MAX_INLINE_OBJECT = 60;
const MAX_TEXT = 50;
/** A piece of text that is already a summary: it is printed as it is and never cut. */
class Verbatim {
  constructor(readonly text: string) {}
}

/** Payload fields that hold a virtual time: the log shows them as a clock, not as raw seconds. */
const CLOCK_KEYS: ReadonlySet<string> = new Set(['eta_sim_time', 'expected_at']);

/** The log line for an event, or `null` for plumbing events that are hidden from the log. */
export function formatEvent(event: StoredEvent): string | null {
  if (isHiddenFromLog(event)) return null;
  const label = `[${LABEL_TEXT[logLabel(event)]}]`.padEnd(LABEL_WIDTH);
  const type = event.type.padEnd(TYPE_WIDTH);
  return `${formatClock(event.sim_time)}  ${label}  ${type}  ${summarizePayload(printable(event))}`.trimEnd();
}

export function consoleSink(events: StoredEvent[]): void {
  for (const event of events) {
    const line = formatEvent(event);
    if (line !== null) console.log(line);
  }
}

/**
 * What the line shows of an event. Most events print their payload as it is. A few carry a nested
 * object that would read as "{3 entries}", so their useful parts are lifted to the top.
 */
function printable(event: StoredEvent): Record<string, unknown> {
  const payload = event.payload as Record<string, unknown>;
  switch (event.type) {
    case 'restock_proposed': {
      const { report, ...rest } = payload;
      const { report_id, title } = report as { report_id: number; title: string };
      return { report_id, title, ...rest };
    }
    case 'complaint_triaged': {
      const { report, ...rest } = payload;
      return report === undefined
        ? rest
        : { ...rest, report_id: (report as { report_id: number }).report_id };
    }
    case 'agent_decided': {
      const { decision, ...rest } = payload;
      return {
        ...rest,
        decision: new Verbatim(`[${summarizePayload(decision as Record<string, unknown>)}]`),
      };
    }
    default:
      return payload;
  }
}

function summarizePayload(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(([key, value]) => `${key}=${summarizeValue(key, value)}`)
    .join(' ');
}

function summarizeValue(key: string, value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Verbatim) return value.text;
  if (typeof value === 'number' && CLOCK_KEYS.has(key)) return formatClock(value);
  if (typeof value === 'string') {
    return value.length <= MAX_TEXT ? value : `${value.slice(0, MAX_TEXT - 1)}…`;
  }
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
