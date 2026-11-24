import { describe, expect, it } from 'vitest';
import type { AgentState } from '../state/world';
import { agentPose, potTilt } from './pose';
import { findPath, pathLength, pointAlong } from './navigation';
import { STATION_SPOTS, standingPoint } from './registry';

const agent = (overrides: Partial<AgentState>): AgentState => ({
  id: 'stock_admin',
  state: 'idle',
  station: 'stock_shelf',
  from: null,
  label: null,
  taskId: null,
  startedAt: null,
  endsAt: null,
  ...overrides,
});

const walking = (
  from: AgentState['station'],
  to: AgentState['station'],
  startedAt = 1000,
  endsAt = 1200,
) => agent({ state: 'walking', station: to, from, taskId: 1, startedAt, endsAt });

describe('agentPose', () => {
  it('stands at the station when idle, facing its work', () => {
    const spot = standingPoint('stock_shelf', 'stock_admin');
    expect(agentPose(agent({}), 5000)).toEqual({
      x: spot.x,
      z: spot.z,
      facing: spot.facing,
      status: 'idle',
      walked: 0,
    });
  });

  it('works at the station it is at, in the working pose', () => {
    const pose = agentPose(
      agent({
        id: 'cook',
        state: 'working',
        station: 'kitchen',
        label: 'cooking',
        startedAt: 1000,
        endsAt: 1500,
      }),
      1200,
    );
    expect(pose).toMatchObject({
      x: STATION_SPOTS.kitchen.x,
      z: STATION_SPOTS.kitchen.z,
      status: 'working',
    });
  });

  it('walks along the way from where it set off to where it is going, over the time of the task', () => {
    const from = standingPoint('stock_shelf', 'stock_admin');
    const to = standingPoint('boss_desk', 'stock_admin');
    const way = findPath(from, to);
    const start = agentPose(walking('stock_shelf', 'boss_desk'), 1000);
    expect(start).toMatchObject({ x: from.x, z: from.z, status: 'walking' });
    for (const fraction of [0.25, 0.5, 0.75]) {
      const now = 1000 + 200 * fraction;
      const pose = agentPose(walking('stock_shelf', 'boss_desk'), now);
      const there = pointAlong(way, fraction);
      expect(pose.x).toBeCloseTo(there.x);
      expect(pose.z).toBeCloseTo(there.z);
      expect(pose.status).toBe('walking');
    }
    expect(pathLength(way)).toBeGreaterThan(Math.hypot(from.x - to.x, from.z - to.z) - 1e-9);
  });

  it('goes round the furniture: the way from the shelf to the office is not a straight line', () => {
    const from = standingPoint('stock_shelf', 'stock_admin');
    const to = standingPoint('boss_desk', 'stock_admin');
    expect(findPath(from, to).length).toBeGreaterThan(2); // round the end of the counter and through the door
  });

  it('faces the way it goes while walking', () => {
    const way = findPath(
      standingPoint('stock_shelf', 'stock_admin'),
      standingPoint('boss_desk', 'stock_admin'),
    );
    for (const fraction of [0.1, 0.5, 0.9]) {
      const pose = agentPose(walking('stock_shelf', 'boss_desk'), 1000 + 200 * fraction);
      expect(pose.facing).toBeCloseTo(pointAlong(way, fraction).heading);
    }
  });

  it('has arrived at the ETA: it stands at the station, facing its work, and stays there when time runs on', () => {
    const to = standingPoint('boss_desk', 'stock_admin');
    for (const now of [1200, 1201, 99_999]) {
      expect(agentPose(walking('stock_shelf', 'boss_desk'), now)).toEqual({
        x: to.x,
        z: to.z,
        facing: to.facing,
        status: 'idle',
        walked: 0,
      });
    }
  });

  it('is at the start before the walk begins, as when the clock of the page runs a little behind', () => {
    const from = standingPoint('stock_shelf', 'stock_admin');
    expect(agentPose(walking('stock_shelf', 'boss_desk'), 900)).toMatchObject({
      x: from.x,
      z: from.z,
    });
  });

  it('puts each character at its own place along the boss desk', () => {
    const at = (id: AgentState['id']) => agentPose(agent({ id, station: 'boss_desk' }), 0).z;
    expect(new Set([at('cashier'), at('cook'), at('stock_admin'), at('waiter')]).size).toBe(4);
  });

  it('gives the same pose for the same time, so a paused clock freezes everybody', () => {
    const state = walking('stock_shelf', 'boss_desk');
    expect(agentPose(state, 1100.5)).toEqual(agentPose(state, 1100.5));
  });

  it('is at the end of a walk after a jump in time, with nothing replayed', () => {
    // The boss jumped an hour ahead: the state says the walk should have ended long ago.
    const to = standingPoint('boss_desk', 'stock_admin');
    expect(agentPose(walking('stock_shelf', 'boss_desk'), 1000 + 3600)).toMatchObject({
      x: to.x,
      z: to.z,
      status: 'idle',
    });
  });

  it('copes with a walk that has no length, or no origin', () => {
    const spot = standingPoint('boss_desk', 'stock_admin');
    expect(agentPose(walking('stock_shelf', 'boss_desk', 1000, 1000), 1000)).toMatchObject({
      x: spot.x,
      status: 'idle',
    });
    expect(
      agentPose(
        agent({ state: 'walking', station: 'boss_desk', startedAt: 1000, endsAt: 1200 }),
        1100,
      ),
    ).toMatchObject({ x: spot.x, status: 'idle' });
    expect(agentPose(walking('boss_desk', 'boss_desk'), 1100).status).toBe('walking');
  });
});

describe('potTilt', () => {
  it('wobbles while the cook is cooking, within a small angle, and stands still otherwise', () => {
    const tilts = Array.from({ length: 60 }, (_, index) => potTilt(true, index / 10));
    expect(Math.max(...tilts)).toBeLessThanOrEqual(0.15);
    expect(Math.min(...tilts)).toBeGreaterThanOrEqual(-0.15);
    expect(new Set(tilts).size).toBeGreaterThan(10);
    expect(potTilt(false, 3.3)).toBe(0);
  });
});
