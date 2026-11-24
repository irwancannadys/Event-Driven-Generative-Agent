import type { StoredEvent } from '@cafe/core';
import type { Context, Emit } from '../usecases/context';
import { kick } from './engine';

/**
 * What the characters do in response to an event (decision 022). It runs for every event written in
 * a step, inside the step's transaction. The engine's own part is here: a new task gets going when
 * the agent is free, and a finished task gives way to the next one.
 */
export function reactToEvent(ctx: Context, event: StoredEvent, emit: Emit): void {
  switch (event.type) {
    case 'agent_task_assigned':
      kick(ctx, emit, event.payload.agent_id);
      return;
    case 'agent_task_finished':
      kick(ctx, emit, event.payload.agent_id);
      return;
    default:
      return;
  }
}
