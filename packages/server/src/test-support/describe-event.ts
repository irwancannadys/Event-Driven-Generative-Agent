import { SECONDS_PER_MINUTE, formatClock, secondsIntoDay, type StoredEvent } from '@cafe/core';

type Payload = Record<string, unknown>;

const lines = (items: unknown): string =>
  (items as { ingredient_id: string; qty: number }[])
    .map((line) => `${line.ingredient_id}:${line.qty}`)
    .join(',');

/** `08:30:15`: the golden day of the agents needs the seconds, a walk of 20 s more or less matters. */
function clockWithSeconds(time: number): string {
  const rest = secondsIntoDay(time) % SECONDS_PER_MINUTE;
  return `${formatClock(time)}:${String(rest).padStart(2, '0')}`;
}

function detail(event: StoredEvent): string {
  const payload = event.payload as Payload;
  switch (event.type) {
    case 'world_initialized':
      return `seed=${payload.seed}`;
    case 'day_opened':
    case 'day_closed':
      return `day=${payload.day}`;
    case 'regular_expected':
      return `${payload.regular_id} table=${payload.table_id} expected_at=${formatClock(payload.expected_at as number)}`;
    case 'customer_arrived':
      return `customer=${payload.customer_id}`;
    case 'order_created': {
      const items = payload.items as { menu_item_id: string; qty: number }[];
      const customer = payload.customer_id === undefined ? '' : ` customer=${payload.customer_id}`;
      return `#${payload.order_id} ${items.map((item) => `${item.menu_item_id}x${item.qty}`).join(',')}${customer}`;
    }
    case 'complaint_received':
      return `#${payload.complaint_id} order=${payload.order_id} cause=${payload.cause}`;
    case 'order_held':
    case 'order_resumed':
    case 'cooking_started':
    case 'cooking_done':
      return `#${payload.order_id}`;
    case 'stock_decreased':
      return `#${payload.order_id} ${payload.ingredient_id} -${payload.qty} =${payload.new_qty}`;
    case 'stock_low':
      return `${payload.ingredient_id} qty=${payload.qty} min=${payload.min_qty}`;
    case 'stock_out':
      return `${payload.ingredient_id}`;
    case 'agent_task_assigned':
      return payload.kind === 'goto'
        ? `${payload.agent_id} #${payload.task_id} goto ${payload.station}`
        : `${payload.agent_id} #${payload.task_id} work ${payload.label}`;
    case 'agent_state_changed':
      return `${payload.agent_id} ${payload.state} at ${payload.station}${
        payload.label ? ` (${payload.label})` : ''
      }${payload.eta_sim_time ? ` until ${clockWithSeconds(payload.eta_sim_time as number)}` : ''}`;
    case 'agent_task_finished':
      return `${payload.agent_id} #${payload.task_id}`;
    case 'agent_think_requested':
    case 'agent_decided':
      return `${payload.agent_id} ${payload.purpose}`;
    case 'daily_review_created':
      return `day=${payload.day} ${payload.summary}`;
    case 'policy_proposed': {
      const change = payload.change as { ingredient_id: string; from: number; to: number };
      return `report=#${(payload.report as { report_id: number }).report_id} ${change.ingredient_id} min ${change.from} -> ${change.to}`;
    }
    case 'policy_changed':
      return `${payload.ingredient_id} min ${payload.from} -> ${payload.to}`;
    case 'memory_created':
      return `${payload.kind}${payload.ingredient_id ? ` ${payload.ingredient_id}` : ''}: ${payload.text}`;
    case 'restock_proposed': {
      const report = payload.report as { report_id: number };
      return `report=#${report.report_id} ${payload.urgency} ${lines(payload.items)}`;
    }
    case 'report_submitted':
      return `report=#${payload.report_id} by ${event.actor}`;
    case 'report_decided':
      return `report=#${payload.report_id} ${payload.decision}`;
    case 'restock_ordered':
      return `#${payload.restock_id} report=#${payload.report_id} ${payload.supplier} ${lines(payload.items)}${
        payload.eta_sim_time ? ` eta=${clockWithSeconds(payload.eta_sim_time as number)}` : ''
      }`;
    case 'restock_failed':
      return `#${payload.restock_id} ${payload.reason}`;
    case 'restock_arrived':
      return `#${payload.restock_id} ${lines(payload.items)}`;
    case 'complaint_triaged': {
      const report = payload.report as { report_id: number } | undefined;
      return `#${payload.complaint_id} severity=${payload.severity} ${payload.suggested_compensation} boss=${payload.needs_boss_decision}${
        report ? ` report=#${report.report_id}` : ''
      }`;
    }
    case 'complaint_replied':
      return `#${payload.complaint_id} ${payload.compensation}`;
    default:
      return JSON.stringify(payload);
  }
}

/** One readable line per event, for the golden files. Minutes by default, seconds on request. */
export function describeEvent(event: StoredEvent, options: { seconds?: boolean } = {}): string {
  const clock = options.seconds ? clockWithSeconds(event.sim_time) : formatClock(event.sim_time);
  return `${clock} ${event.type} ${detail(event)}`;
}
