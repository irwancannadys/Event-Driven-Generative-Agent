import {
  finalStation,
  planGoto,
  planTasks,
  type AgentId,
  type StationId,
  type TaskLabel,
  type TaskRef,
  type TaskSpec,
  type WorkSpec,
} from '@cafe/core';
import type { Db } from '../db/database';
import { startCooking } from '../usecases/cooking';
import { DomainError, nextId, type Context, type Emit } from '../usecases/context';

// The agent engine (decision 022): every agent has a queue of tasks. A task goes from queued to
// active (when the agent is free), and ends when its time is up (a dynamic due item, decision 023).
// Everything here only writes events through `emit`; the projections keep the queue.

export interface AgentRow {
  id: AgentId;
  station: StationId;
  state: 'idle' | 'walking' | 'working' | 'thinking';
}

export interface TaskRow {
  id: number;
  agent_id: AgentId;
  kind: 'goto' | 'work';
  status: 'queued' | 'active';
  duration_sim_sec: number;
  station?: StationId;
  label?: TaskLabel;
  ref?: TaskRef;
}

interface RawTask {
  id: number;
  agent_id: AgentId;
  kind: 'goto' | 'work';
  status: 'queued' | 'active';
  duration_sim_sec: number;
  params_json: string;
}

export function readAgent(db: Db, agentId: AgentId): AgentRow {
  const row = db.prepare('SELECT id, station, state FROM agents WHERE id = ?').get(agentId) as
    AgentRow | undefined;
  if (!row) throw new Error(`unknown agent "${agentId}"`);
  return row;
}

/** The task that is running (first) and the tasks that wait, in the order they will run. */
export function readOpenTasks(db: Db, agentId: AgentId): TaskRow[] {
  const rows = db
    .prepare(
      `SELECT id, agent_id, kind, status, duration_sim_sec, params_json
       FROM agent_tasks
       WHERE agent_id = ? AND status IN ('active', 'queued')
       ORDER BY (status = 'active') DESC, id`,
    )
    .all(agentId) as RawTask[];
  return rows.map(({ params_json, ...row }) => ({
    ...row,
    ...(JSON.parse(params_json) as Pick<TaskRow, 'station' | 'label' | 'ref'>),
  }));
}

/** One task, wherever it is in its life. Used by reactions to find out what has just finished. */
export function readTask(db: Db, taskId: number): TaskRow | undefined {
  const row = db
    .prepare(
      `SELECT id, agent_id, kind, status, duration_sim_sec, params_json
       FROM agent_tasks WHERE id = ?`,
    )
    .get(taskId) as (Omit<RawTask, 'status'> & { status: string }) | undefined;
  if (!row) return undefined;
  const { params_json, ...rest } = row;
  return {
    ...(rest as Omit<TaskRow, 'station' | 'label' | 'ref'>),
    ...(JSON.parse(params_json) as Pick<TaskRow, 'station' | 'label' | 'ref'>),
  };
}

/** Puts tasks at the end of an agent's queue. Starting them is `kick`'s job. */
export function enqueueTasks(
  ctx: Context,
  emit: Emit,
  agentId: AgentId,
  specs: readonly TaskSpec[],
): void {
  for (const spec of specs) {
    emit({
      type: 'agent_task_assigned',
      actor: agentId,
      origin: 'rule',
      payload: {
        agent_id: agentId,
        task_id: nextId(ctx.db, 'agent_tasks'),
        kind: spec.kind,
        duration_sim_sec: spec.duration_sim_sec,
        ...(spec.station !== undefined && { station: spec.station }),
        ...(spec.label !== undefined && { label: spec.label }),
        ...(spec.ref !== undefined && { ref: spec.ref }),
      },
    });
  }
}

/** Where the agent will be once everything in its queue is done. */
function plannedStation(db: Db, agentId: AgentId): StationId {
  return finalStation(readAgent(db, agentId).station, readOpenTasks(db, agentId));
}

/** Queues some work at `station`, walking there first if the agent will not be there by then. */
export function enqueueWork(
  ctx: Context,
  emit: Emit,
  agentId: AgentId,
  station: StationId,
  work: WorkSpec,
): void {
  enqueueTasks(ctx, emit, agentId, planTasks(plannedStation(ctx.db, agentId), station, work));
}

/** Queues a walk to `station` unless the agent will already be there. */
export function enqueueGoto(ctx: Context, emit: Emit, agentId: AgentId, station: StationId): void {
  enqueueTasks(ctx, emit, agentId, planGoto(plannedStation(ctx.db, agentId), station));
}

/** Ends a task that is not going to run (or has run). Reactions to the event decide what follows. */
export function finishTask(emit: Emit, agentId: AgentId, taskId: number): void {
  emit({
    type: 'agent_task_finished',
    actor: agentId,
    origin: 'rule',
    payload: { agent_id: agentId, task_id: taskId },
  });
}

/**
 * Cooking is the one task with a check before it starts (decision 022): the stock is looked at, and
 * used, at the moment the cook really begins. If the ingredients are short the order is held and the
 * task is skipped.
 */
function mayStart(ctx: Context, task: TaskRow): boolean {
  if (task.kind !== 'work' || task.label !== 'cooking' || task.ref?.type !== 'order') return true;
  try {
    return !startCooking(ctx, Number(task.ref.id)).held;
  } catch (error) {
    if (error instanceof DomainError) return false; // the order is not waiting any more
    throw error;
  }
}

/**
 * Gets a free agent going: starts the next task in its queue, or sets it to idle when the queue is
 * empty. Does nothing while a task is running, or while the agent is thinking. Tasks that may not start are skipped on the spot.
 */
export function kick(ctx: Context, emit: Emit, agentId: AgentId): void {
  for (;;) {
    const tasks = readOpenTasks(ctx.db, agentId);
    if (tasks.some((task) => task.status === 'active')) return;
    const agent = readAgent(ctx.db, agentId);
    // Thinking is not interrupted: what waits in the queue starts when the answer has been applied (decision 037).
    if (agent.state === 'thinking') return;

    const next = tasks[0];
    if (!next) {
      if (agent.state !== 'idle') {
        emit({
          type: 'agent_state_changed',
          actor: agentId,
          origin: 'rule',
          payload: { agent_id: agentId, state: 'idle', station: agent.station },
        });
      }
      return;
    }

    if (!mayStart(ctx, next)) {
      finishTask(emit, agentId, next.id);
      continue;
    }

    emit({
      type: 'agent_state_changed',
      actor: agentId,
      origin: 'rule',
      payload: {
        agent_id: agentId,
        state: next.kind === 'goto' ? 'walking' : 'working',
        station: next.kind === 'goto' ? (next.station as StationId) : agent.station,
        task_id: next.id,
        eta_sim_time: ctx.clock.now() + next.duration_sim_sec,
        ...(next.label !== undefined && { label: next.label }),
      },
    });
    return;
  }
}
