import {
  AGENT_NAME_ID,
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
}

export function agentRows(state: WorldState): AgentRow[] {
  return Object.values(state.agents).map((agent) => ({
    id: agent.id,
    name: AGENT_NAME_ID[agent.id],
    where: STATION_NAME_ID[agent.station],
    doing: agentActivity(agent),
    until: agent.endsAt === null ? null : formatClock(agent.endsAt),
  }));
}

export function orderCounts(state: WorldState): Record<OrderStatus, number> {
  return state.orders;
}

export interface LogRow {
  id: number;
  clock: string;
  label: LogLabel;
  sentence: string;
}

/** Ingredient names for the sentences, from the stock the page already knows. */
export function namesOf(state: WorldState): Names {
  return {
    ingredient: (id) => state.stock[id]?.name ?? id.replaceAll('_', ' '),
  };
}

/** The newest events first, without the plumbing that is hidden from the log. */
export function logRows(state: WorldState, limit = 60): LogRow[] {
  const names = namesOf(state);
  const rows: LogRow[] = [];
  for (let index = state.log.length - 1; index >= 0 && rows.length < limit; index -= 1) {
    const event = state.log[index];
    if (!event || isHiddenFromLog(event)) continue;
    rows.push({
      id: event.id,
      clock: formatClock(event.sim_time),
      label: logLabel(event),
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

export interface ReportRowView {
  id: number;
  typeLabel: string;
  title: string;
  /** The lines of the report. */
  body: string[];
}

export interface BossDeskView {
  /** On the desk: the boss can decide. */
  waiting: ReportRowView[];
  /** Still being carried to the desk: shown, but nothing to decide yet. */
  onTheWay: ReportRowView[];
}

const toRow = (card: ReportCard): ReportRowView => ({
  id: card.id,
  typeLabel: REPORT_TYPE_NAME_ID[card.type],
  title: card.title,
  body: card.body.split('\n').filter((line) => line.length > 0),
});

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
