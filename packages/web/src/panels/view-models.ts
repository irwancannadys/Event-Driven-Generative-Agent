import {
  AGENT_NAME_ID,
  TASK_NAME_ID,
  REPORT_TYPE_NAME_ID,
  STATION_NAME_ID,
  dayOf,
  formatClock,
  isHiddenFromLog,
  logLabel,
  type ComplaintStatus,
  type LogLabel,
  type OrderStatus,
} from '@cafe/core';
import { describeEvent, formatSpan, t, type Names, type TextKey } from '../i18n';
import { agentActivity } from '../state/agent-text';
import { virtualNow, type ReportCard, type WorldState } from '../state/world';

// What each panel shows, worked out from the state as plain data. The DOM code only draws it, so this is
// where the behaviour is tested (decision 028).

export interface StatusView {
  day: number;
  clock: string;
  speed: number;
  paused: boolean;
}

/** The virtual day and time right now (it keeps running between the messages of the server). */
export function statusView(state: WorldState, nowMs: number): StatusView {
  const now = Math.floor(virtualNow(state.clock, nowMs));
  const { speed, paused } = state.clock.time;
  return { day: dayOf(now), clock: formatClock(now), speed, paused };
}

export interface AgentRow {
  id: string;
  name: string;
  where: string;
  doing: string;
  /** When the task is due to end, as a clock. */
  until: string | null;
  /** The letters in the round picture of the character. */
  initials: string;
  /** Doing something (walking, working, thinking), not idle. */
  busy: boolean;
  /** One or two words for the pill: Idle, Berjalan, Memasak. */
  statusLabel: string;
  /** Where, and until when: `Dapur · sampai 15:27`. */
  detail: string;
}

const INITIALS: Record<string, string> = {
  cashier: 'K',
  cook: 'Ko',
  stock_admin: 'AS',
  waiter: 'R',
};
const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export function agentRows(state: WorldState): AgentRow[] {
  return Object.values(state.agents).map((agent) => {
    const where = STATION_NAME_ID[agent.station];
    const until = agent.endsAt === null ? null : formatClock(agent.endsAt);
    const statusLabel =
      agent.state === 'working' && agent.label
        ? capitalize(
            TASK_NAME_ID[agent.label as keyof typeof TASK_NAME_ID] ?? t('agent.status.working'),
          )
        : t(`agent.status.${agent.state}` as TextKey);
    return {
      id: agent.id,
      name: AGENT_NAME_ID[agent.id],
      where,
      doing: agentActivity(agent),
      until,
      initials: INITIALS[agent.id] ?? AGENT_NAME_ID[agent.id].charAt(0),
      busy: agent.state !== 'idle',
      statusLabel,
      detail: `${agent.state === 'walking' ? `ke ${where}` : where}${until ? ` \u00b7 ${t('agent.until')} ${until}` : ''}`,
    };
  });
}

/** How many of the characters are doing something, for the corner of their card. */
export function agentsSummary(state: WorldState): { busy: number; total: number } {
  const agents = Object.values(state.agents);
  return { busy: agents.filter((agent) => agent.state !== 'idle').length, total: agents.length };
}

export function orderCounts(state: WorldState): Record<OrderStatus, number> {
  return state.orders;
}

export interface OrdersView {
  placed: number;
  cooking: number;
  held: number;
  done: number;
  /** The width of each part of the bar, percent of the orders that are not done yet (they add up to 100, or are 0). */
  bar: { placed: number; cooking: number; held: number };
}

export function ordersView(state: WorldState): OrdersView {
  const { placed, cooking, held, done } = state.orders;
  const open = placed + cooking + held;
  const part = (count: number): number => (open === 0 ? 0 : Math.round((count / open) * 1000) / 10);
  return {
    placed,
    cooking,
    held,
    done,
    bar: { placed: part(placed), cooking: part(cooking), held: part(held) },
  };
}

export interface LogRow {
  id: number;
  clock: string;
  /** The time is only shown on the first row of a minute, the ones under it share it. */
  showTime: boolean;
  label: LogLabel;
  sentence: string;
}

/** The labels the log can be narrowed to. */
export const LOG_FILTERS: readonly LogLabel[] = ['rule', 'trigger', 'llm', 'boss'];

/** Ingredient names for the sentences, from the stock the page already knows. */
export function namesOf(state: WorldState): Names {
  return {
    ingredient: (id) => state.stock[id]?.name ?? id.replaceAll('_', ' '),
  };
}

/** The newest events first, without the plumbing that is hidden from the log. */
export function logRows(state: WorldState, limit = 60, only?: LogLabel): LogRow[] {
  const names = namesOf(state);
  const rows: LogRow[] = [];
  for (let index = state.log.length - 1; index >= 0 && rows.length < limit; index -= 1) {
    const event = state.log[index];
    if (!event || isHiddenFromLog(event)) continue;
    const label = logLabel(event);
    if (only !== undefined && label !== only) continue;
    const clock = formatClock(event.sim_time);
    rows.push({
      id: event.id,
      clock,
      showTime: rows.length === 0 || rows[rows.length - 1]?.clock !== clock,
      label,
      sentence: describeEvent(event, names),
    });
  }
  return rows;
}

export interface StockRow {
  id: string;
  name: string;
  qty: number;
  capacity: number;
  unit: string;
  /** How full the shelf is, 0 to 100. */
  percent: number;
  level: 'ok' | 'low' | 'out';
}

export function stockRows(state: WorldState): StockRow[] {
  return Object.values(state.stock)
    .map((row) => ({
      id: row.ingredient_id,
      name: row.name,
      qty: row.qty,
      capacity: row.capacity_qty,
      unit: row.unit,
      percent: Math.max(0, Math.min(100, Math.round((row.qty / row.capacity_qty) * 100))),
      level: row.out ? ('out' as const) : row.low ? ('low' as const) : ('ok' as const),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** One ingredient of a restock report: `Susu`, `Stok 1000 / 6000 ml`, `+5000 ml`. */
export interface ReportItemView {
  name: string;
  stock: string;
  order: string;
}

export interface ReportRowView {
  id: number;
  typeLabel: string;
  title: string;
  /** The lines of the report. */
  body: string[];
  /** `Urgensi: normal`, when the report says how urgent it is. */
  urgency: string | null;
  /** The ingredients of a restock report, as rows. */
  items: ReportItemView[];
  /** The lines that are not an ingredient or the urgency (the words of a policy report, for example). */
  lines: string[];
}

/** Thousands with a dot, as people write them here: 8000 is `8.000`. */
export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

const ITEM_LINE = /^(.+): pesan (\d+) (\S+) \(stok (\d+) dari (\d+)\)\.?$/;
const URGENCY_LINE = /^Urgensi: (.+?)\.?$/;

export interface BossDeskView {
  /** On the desk: the boss can decide. */
  waiting: ReportRowView[];
  /** Still being carried to the desk: shown, but nothing to decide yet. */
  onTheWay: ReportRowView[];
}

const toRow = (card: ReportCard): ReportRowView => {
  const body = card.body.split('\n').filter((line) => line.length > 0);
  const items: ReportItemView[] = [];
  const lines: string[] = [];
  let urgency: string | null = null;
  for (const line of body) {
    const item = ITEM_LINE.exec(line);
    const urgent = URGENCY_LINE.exec(line);
    if (item) {
      const [, name = '', order = '', unit = '', stock = '', capacity = ''] = item;
      items.push({
        name,
        stock: `${t('boss.stock')} ${formatNumber(Number(stock))} / ${formatNumber(Number(capacity))} ${unit}`,
        order: `+${formatNumber(Number(order))} ${unit}`,
      });
    } else if (urgent) {
      urgency = `${t('boss.urgency')}: ${urgent[1]}`;
    } else {
      lines.push(line);
    }
  }
  return {
    id: card.id,
    typeLabel: REPORT_TYPE_NAME_ID[card.type],
    title: card.title,
    body,
    urgency,
    items,
    lines,
  };
};

export function bossDeskView(state: WorldState): BossDeskView {
  return {
    waiting: state.reports.filter((card) => card.status === 'submitted').map(toRow),
    onTheWay: state.reports.filter((card) => card.status === 'drafted').map(toRow),
  };
}

export interface ComplaintRowView {
  id: number;
  /** Which order it is about and why the customer complains. */
  title: string;
  /** `Pesanan #212`, and the cause in a few words: `Layanan lambat`. */
  order: string;
  cause: string;
  status: ComplaintStatus;
  statusLabel: string;
  /** How long it has been open, or how long it took to answer. */
  span: string;
  /** What is offered (a proposal while the boss has not decided) or was given. Empty before the cashier judged it. */
  offer: string;
}

export interface ComplaintsView {
  open: number;
  answered: number;
  rows: ComplaintRowView[];
}

/** The most complaints the panel lists. */
export const COMPLAINT_ROWS = 8;

/**
 * The complaints that wait for an answer first, oldest first (they are the ones that need something), then
 * the answered ones, newest first, up to `limit` rows.
 */
export function complaintsView(
  state: WorldState,
  nowMs: number,
  limit = COMPLAINT_ROWS,
): ComplaintsView {
  const now = Math.floor(virtualNow(state.clock, nowMs));
  const all = Object.values(state.complaints);
  const open = all
    .filter((complaint) => complaint.status !== 'replied')
    .sort((a, b) => a.id - b.id);
  const answered = all
    .filter((complaint) => complaint.status === 'replied')
    .sort((a, b) => b.id - a.id);
  const rows = [...open, ...answered].slice(0, limit).map((complaint): ComplaintRowView => {
    const replied = complaint.status === 'replied';
    const offer =
      complaint.compensation === null
        ? ''
        : `${replied ? '' : `${t('complaint.offered')}: `}${t(`complaint.offer.${complaint.compensation}` as TextKey)}`;
    return {
      id: complaint.id,
      title: `${t('complaint.order')} #${complaint.orderId} \u00b7 ${t(`complaint.cause.${complaint.cause}` as TextKey)}`,
      order: `${t('complaint.order')} #${complaint.orderId}`,
      cause: capitalize(t(`complaint.cause.${complaint.cause}` as TextKey)),
      status: complaint.status,
      statusLabel: t(`complaint.${complaint.status}` as TextKey),
      span: replied
        ? `${t('complaint.answeredIn')} ${formatSpan((complaint.repliedAt ?? now) - complaint.receivedAt)}`
        : `${t('complaint.waiting')} ${formatSpan(Math.max(0, now - complaint.receivedAt))}`,
      offer,
    };
  });
  return { open: open.length, answered: answered.length, rows };
}

/** The speeds of the time controls, in virtual seconds per real second (the server allows 1 to 3600). */
export const SPEEDS = [1, 10, 60, 600, 3600] as const;

/** The jumps of the time controls, in virtual seconds. */
export const JUMPS = [600, 1800, 3600] as const;

export interface StockSummary {
  out: number;
  low: number;
}

/** How many ingredients are out and how many are low, for the corner of the stock card. */
export function stockSummary(state: WorldState): StockSummary {
  const rows = Object.values(state.stock);
  return {
    out: rows.filter((row) => row.out).length,
    low: rows.filter((row) => row.low && !row.out).length,
  };
}

export interface AdminView {
  /** The last review: which day, what she wrote and who decided it. `null` before the first night. */
  review: {
    day: number;
    summary: string;
    origin: string;
    originKey: 'llm' | 'rule' | 'fallback';
  } | null;
  /** The minimums that differ from the ones the cafe started with. */
  changes: { name: string; from: number; to: number; unit: string }[];
  /** The newest notes first. */
  notes: { kind: 'observation' | 'reflection'; kindLabel: string; text: string; clock: string }[];
}

/** The newest notes the card shows. */
export const ADMIN_NOTES_SHOWN = 4;

/** What the stock admin has written and changed (decision 034), for her card. */
export function adminView(state: WorldState): AdminView {
  const review = state.review;
  return {
    review: review
      ? {
          day: review.day,
          summary: review.summary,
          origin: t(`admin.origin.${review.origin}` as TextKey),
          originKey: review.origin,
        }
      : null,
    changes: Object.values(state.stock)
      .filter((row) => row.min_qty !== row.base_min_qty)
      .map((row) => ({ name: row.name, from: row.base_min_qty, to: row.min_qty, unit: row.unit }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    notes: [...state.memories]
      .reverse()
      .slice(0, ADMIN_NOTES_SHOWN)
      .map((note) => ({
        kind: note.kind,
        kindLabel: t(`note.${note.kind}` as TextKey),
        text: note.text,
        clock: formatClock(note.created_at_sim),
      })),
  };
}
