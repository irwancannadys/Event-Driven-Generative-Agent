import {
  AGENT_HOME_STATION,
  RECENT_COMPLAINT_WINDOW_SEC,
  RECENT_DONE_WINDOW_SEC,
  WALK_IN_SEC,
  type AgentId,
  type AgentView,
  type Snapshot,
  type StationId,
  type TimeView,
} from '@cafe/core';
import type { Db } from '../db/database';
import {
  readAgentOverview,
  readArrivalsInFlight,
  readComplaintViews,
  readOrderCounts,
  readRecentOrders,
  readReports,
} from '../db/queries';
import { lastEventId, listRecentEvents } from '../events/store';
import { stockView } from '../http/api';
import type { Context } from '../usecases/context';

/** How many of the newest events a page gets with its snapshot, enough to fill the log. */
export const SNAPSHOT_EVENT_COUNT = 200;
export { RECENT_DONE_WINDOW_SEC };
/** The most orders a snapshot carries. */
export const SNAPSHOT_ORDER_COUNT = 200;

/**
 * Where an agent that is walking set off from (decision 026). A walking state records the station it is
 * heading to, so the start of the walk is the station of the state before it, or the agent's home when
 * it is the first thing the agent ever did in this world.
 */
function walkOrigin(db: Db, agentId: AgentId): StationId {
  const rows = db
    .prepare(
      `SELECT payload_json FROM events
       WHERE type = 'agent_state_changed' AND actor = ?
         AND id > COALESCE((SELECT MAX(id) FROM events WHERE type = 'world_initialized'), 0)
       ORDER BY id DESC LIMIT 2`,
    )
    .all(agentId) as { payload_json: string }[];
  const before = rows[1];
  if (!before) return AGENT_HOME_STATION[agentId];
  return (JSON.parse(before.payload_json) as { station: StationId }).station;
}

/** The world as it is right now, for a page that has just connected. Read-only. */
export function buildSnapshot(ctx: Context, time: TimeView): Snapshot {
  const { db } = ctx;
  const agents: AgentView[] = readAgentOverview(db).map((agent) => ({
    ...agent,
    from_station: agent.state === 'walking' ? walkOrigin(db, agent.id) : null,
  }));
  return {
    time,
    last_event_id: lastEventId(db),
    agents,
    stock: stockView(ctx),
    orders: readOrderCounts(db),
    recent_orders: readRecentOrders(
      db,
      time.sim_time - RECENT_DONE_WINDOW_SEC,
      SNAPSHOT_ORDER_COUNT,
    ),
    arrivals_in_flight: readArrivalsInFlight(db, time.sim_time - WALK_IN_SEC),
    complaints: readComplaintViews(db, time.sim_time - RECENT_COMPLAINT_WINDOW_SEC),
    reports: [...readReports(db, 'drafted'), ...readReports(db, 'submitted')].sort(
      (a, b) => a.id - b.id,
    ),
    events: listRecentEvents(db, SNAPSHOT_EVENT_COUNT),
  };
}
