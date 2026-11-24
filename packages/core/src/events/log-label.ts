import type { Origin } from '../ids';

// Which label the event log shows next to an event (docs/events.md section 6). The label is a neutral
// key: the text shown to people ("Trigger", "Aturan", ...) comes from the language dictionary.

export const LOG_LABELS = ['trigger', 'rule', 'llm', 'initiative', 'boss'] as const;
export type LogLabel = (typeof LOG_LABELS)[number];

/** The few fields the label depends on, so the web client can use this with plain objects too. */
export interface LabelSource {
  type: string;
  origin: Origin;
  payload: Readonly<Record<string, unknown>>;
}

/** Things Rina does on her own, whatever produced the decision. */
export const INITIATIVE_EVENT_TYPES: ReadonlySet<string> = new Set([
  'table_prepared',
  'table_tidied',
  'reflection_created',
]);

/** Plumbing events that are not shown in the log by default. */
export const HIDDEN_FROM_LOG: ReadonlySet<string> = new Set([
  'agent_task_assigned',
  'agent_task_finished',
  'agent_state_changed',
]);

/** Checked top to bottom, the first match wins. */
export function logLabel(event: LabelSource): LogLabel {
  if (
    INITIATIVE_EVENT_TYPES.has(event.type) ||
    (event.type === 'agent_decided' && event.payload.purpose === 'waiter_initiative')
  ) {
    return 'initiative';
  }
  switch (event.origin) {
    case 'boss':
      return 'boss';
    case 'llm':
      return 'llm';
    case 'generator':
    case 'scheduler':
      return 'trigger';
    default:
      return 'rule';
  }
}

export function isHiddenFromLog(event: { type: string }): boolean {
  return HIDDEN_FROM_LOG.has(event.type);
}
