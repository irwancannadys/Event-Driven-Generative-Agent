import {
  AGENT_NAME_ID,
  AGENT_STATE_NAME_ID,
  ORDER_STATUS_NAME_ID,
  REPORT_TYPE_NAME_ID,
  STATION_NAME_ID,
  formatClock,
  taskName,
  type StockLevel,
  type TimeView,
} from '@cafe/core';
import type { AgentOverviewRow, OrderListRow, ReportRow } from '../db/queries';

/** Everything the board shows, as the API hands it out. */
export interface DashboardView {
  apiUrl: string;
  time: TimeView;
  agents: AgentOverviewRow[];
  stock: StockLevel[];
  /** The orders that are still open, plus the last few that are done. */
  orders: Record<OrderListRow['status'], OrderListRow[]>;
  /** The reports on the boss desk, waiting for his decision. */
  reports: ReportRow[];
}

const RULE = '─'.repeat(72);
const MAX_ORDERS_SHOWN = 6;
const MAX_BODY_LINES = 4;

function agentLine(agent: AgentOverviewRow): string {
  const who = AGENT_NAME_ID[agent.id].padEnd(15);
  const where = STATION_NAME_ID[agent.station].padEnd(10);
  const until = agent.task?.ends_at_sim ? ` (sampai ${formatClock(agent.task.ends_at_sim)})` : '';
  const queue = agent.queued > 0 ? `, antre ${agent.queued}` : '';
  let doing: string = AGENT_STATE_NAME_ID[agent.state];
  if (agent.task?.kind === 'goto' && agent.task.station) {
    doing = `${doing} ke ${STATION_NAME_ID[agent.task.station]}`;
  } else if (agent.task?.kind === 'work') {
    doing = `${doing}: ${taskName(agent.task.label)}`;
  }
  return `  ${who} ${where} ${doing}${until}${queue}`;
}

function orderLine(order: OrderListRow): string {
  const items = order.items.map((item) => `${item.menu_item_id}×${item.qty}`).join(', ');
  const done = order.done_at_sim === null ? '' : ` (selesai ${formatClock(order.done_at_sim)})`;
  return `    #${order.id} ${formatClock(order.created_at_sim)} ${items}${done}`;
}

function orderSection(view: DashboardView): string[] {
  const { placed, held, cooking, done } = view.orders;
  const lines = [
    'PESANAN',
    `  ${ORDER_STATUS_NAME_ID.placed} ${placed.length} · ${ORDER_STATUS_NAME_ID.cooking} ${cooking.length} · ${ORDER_STATUS_NAME_ID.held} ${held.length}`,
  ];
  const open = [...cooking, ...held, ...placed];
  for (const order of open.slice(0, MAX_ORDERS_SHOWN)) {
    lines.push(`${orderLine(order)}  [${ORDER_STATUS_NAME_ID[order.status]}]`);
  }
  if (open.length > MAX_ORDERS_SHOWN)
    lines.push(`    ... dan ${open.length - MAX_ORDERS_SHOWN} lagi`);
  if (done.length > 0) {
    lines.push(`  ${ORDER_STATUS_NAME_ID.done} terakhir:`);
    for (const order of done) lines.push(orderLine(order));
  }
  return lines;
}

function stockLine(row: StockLevel): string {
  const flag = row.out ? '  [HABIS]' : row.low ? '  [RENDAH]' : '';
  const amount = `${row.qty} / ${row.capacity_qty} ${row.unit}`;
  return `  ${row.name.padEnd(10)} ${amount.padEnd(18)}${flag}`.trimEnd();
}

function decisionCommand(apiUrl: string, id: number, decision: 'approved' | 'rejected'): string {
  return `curl -s -X POST ${apiUrl}/reports/${id}/decision -H 'content-type: application/json' -d '{"decision":"${decision}"}'`;
}

function bossDeskSection(view: DashboardView): string[] {
  if (view.reports.length === 0) return ['MEJA BOS', '  (tidak ada laporan yang menunggu)'];
  const lines = [`MEJA BOS  (${view.reports.length} laporan menunggu keputusan lu)`];
  for (const report of view.reports) {
    lines.push(`  #${report.id} [${REPORT_TYPE_NAME_ID[report.type]}] ${report.title}`);
    for (const text of report.body.split('\n').slice(0, MAX_BODY_LINES)) lines.push(`     ${text}`);
    lines.push(`     setujui: ${decisionCommand(view.apiUrl, report.id, 'approved')}`);
    lines.push(`     tolak  : ${decisionCommand(view.apiUrl, report.id, 'rejected')}`);
  }
  return lines;
}

/** The board as lines of text. Pure: the same view always gives the same board. */
export function formatDashboard(view: DashboardView): string {
  const { time } = view;
  const pace = time.paused ? 'JEDA' : `kecepatan ${time.speed}x`;
  return [
    `=== Cand's Coffee ===  hari ${time.day}, ${time.clock}  ·  ${pace}`,
    RULE,
    'KARAKTER',
    ...view.agents.map(agentLine),
    '',
    ...orderSection(view),
    '',
    'STOK',
    ...view.stock.map(stockLine),
    '',
    ...bossDeskSection(view),
    RULE,
  ].join('\n');
}
