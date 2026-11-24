import type { AgentId, StationId } from '../ids';

/** Where each agent stands when idle, and where the day starts (decision 024). */
export const AGENT_HOME_STATION: Record<AgentId, StationId> = {
  cashier: 'cashier',
  cook: 'kitchen',
  stock_admin: 'stock_shelf',
  waiter: 'table_2',
};

/** Labels of `work` tasks. They are i18n keys: the text people see comes from a dictionary. */
export const TASK_LABELS = [
  'recording_order',
  'cooking',
  'checking_stock',
  'submitting_report',
  'placing_order',
  'noting_complaint',
  'replying_customer',
  'waiting_retry',
] as const;
export type TaskLabel = (typeof TASK_LABELS)[number];

/** How long the fixed tasks take, in virtual seconds. Cooking takes as long as the recipe says. */
export const TASK_DURATION_SEC = {
  recording_order: 45,
  checking_stock: 90,
  submitting_report: 60,
  placing_order: 60,
  noting_complaint: 60,
  replying_customer: 60,
} as const;

/** After the boss rejects a restock report, the admin waits this long before checking again. */
export const RESTOCK_RETRY_SEC = 3600;
