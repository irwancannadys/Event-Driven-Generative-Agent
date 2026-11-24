import type { StationId } from '../ids';
import { walkDurationSec } from '../stations';
import type { TaskLabel } from './home';

export interface TaskRef {
  type: 'order' | 'report' | 'complaint' | 'restock' | 'table' | 'regular' | 'day';
  id: number | string;
}

/** A task to put in an agent's queue. `goto` needs a station, `work` needs a label. */
export interface TaskSpec {
  kind: 'goto' | 'work';
  station?: StationId;
  label?: TaskLabel;
  duration_sim_sec: number;
  ref?: TaskRef;
}

export interface WorkSpec {
  label: TaskLabel;
  duration_sim_sec: number;
  ref?: TaskRef;
}

/** A task already in a queue, as far as position is concerned. */
export interface QueuedTask {
  kind: 'goto' | 'work';
  station?: StationId;
}

/**
 * Where an agent will be once its whole queue is done. `current` is where it stands (or its
 * destination while walking), `queue` lists the active task and the queued tasks in order.
 * New tasks must start from here, not from where the agent is right now.
 */
export function finalStation(current: StationId, queue: readonly QueuedTask[]): StationId {
  let station = current;
  for (const task of queue) {
    if (task.kind === 'goto' && task.station !== undefined) station = task.station;
  }
  return station;
}

/** Walk to `target` if the agent is not there yet. Nothing to do when it already is. */
export function planGoto(from: StationId, target: StationId): TaskSpec[] {
  if (from === target) return [];
  return [{ kind: 'goto', station: target, duration_sim_sec: walkDurationSec(from, target) }];
}

/** Walk to `target` when needed, then do the work there. */
export function planTasks(from: StationId, target: StationId, work: WorkSpec): TaskSpec[] {
  return [
    ...planGoto(from, target),
    {
      kind: 'work',
      label: work.label,
      duration_sim_sec: work.duration_sim_sec,
      ...(work.ref !== undefined && { ref: work.ref }),
    },
  ];
}
