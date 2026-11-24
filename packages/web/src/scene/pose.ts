import type { AgentState } from '../state/world';
import { findPath, pathLength, pointAlong } from './navigation';
import { standingPoint } from './registry';

// Where a character is and what pose it has, worked out from its state and the virtual time (decision
// 027). Nothing is remembered between calls, so a jump in time, a pause or a page refresh needs no special
// care: the state changes and this gives the matching pose.

export type PoseStatus = 'idle' | 'walking' | 'working';

export interface Pose {
  x: number;
  z: number;
  /** `rotation.y` of the character. */
  facing: number;
  status: PoseStatus;
  /** How far it has walked along its way, in layout units (the legs swing by it). */
  walked: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export function agentPose(agent: AgentState, now: number): Pose {
  const to = standingPoint(agent.station, agent.id);
  const standing = (status: PoseStatus): Pose => ({
    x: to.x,
    z: to.z,
    facing: to.facing,
    status,
    walked: 0,
  });

  if (agent.state === 'working') return standing('working');
  if (
    agent.state !== 'walking' ||
    !agent.from ||
    agent.startedAt === null ||
    agent.endsAt === null
  ) {
    return standing('idle');
  }

  const from = standingPoint(agent.from, agent.id);
  const span = agent.endsAt - agent.startedAt;
  const progress = span <= 0 ? 1 : clamp01((now - agent.startedAt) / span);
  // Arrived (the server notes the next state a moment later): stand at the station, facing its work.
  if (progress >= 1) return standing('idle');

  // The way goes round the tables and through the doors, and takes as long as the domain says.
  const path = findPath(from, to);
  const length = pathLength(path);
  if (length === 0) return { x: to.x, z: to.z, facing: to.facing, status: 'walking', walked: 0 };
  const here = pointAlong(path, progress);
  return {
    x: here.x,
    z: here.z,
    facing: here.heading,
    status: 'walking',
    walked: progress * length,
  };
}

/** How far the pot on the stove tilts: it wobbles while the cook is cooking and stands still otherwise. */
export function potTilt(cooking: boolean, seconds: number): number {
  return cooking ? 0.15 * Math.sin(seconds * 11) : 0;
}
