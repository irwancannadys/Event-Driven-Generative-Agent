import { AGENT_STATE_NAME_ID, STATION_NAME_ID, taskName } from '@cafe/core';
import type { AgentState } from './world';

/** What an agent is doing, in words: `menganggur`, `berjalan ke Meja Bos`, `bekerja: memasak`. */
export function agentActivity(agent: AgentState): string {
  const state: string = AGENT_STATE_NAME_ID[agent.state];
  if (agent.state === 'walking') return `${state} ke ${STATION_NAME_ID[agent.station]}`;
  if (agent.state === 'working') return `${state}: ${taskName(agent.label)}`;
  return state;
}
