import { describe, expect, it } from 'vitest';
import { walkDurationSec } from '../stations';
import { finalStation, planGoto, planTasks } from './tasks';

describe('planGoto', () => {
  it('walks when the target is somewhere else, with the time from the distance table', () => {
    expect(planGoto('cashier', 'boss_desk')).toEqual([
      {
        kind: 'goto',
        station: 'boss_desk',
        duration_sim_sec: walkDurationSec('cashier', 'boss_desk'),
      },
    ]);
    expect(planGoto('cashier', 'boss_desk')[0]?.duration_sim_sec).toBe(132);
  });

  it('does nothing when the agent is already there', () => {
    expect(planGoto('kitchen', 'kitchen')).toEqual([]);
  });
});

describe('planTasks', () => {
  const work = { label: 'cooking', duration_sim_sec: 180, ref: { type: 'order', id: 7 } } as const;

  it('is just the work when the agent is already at the station', () => {
    expect(planTasks('kitchen', 'kitchen', work)).toEqual([
      { kind: 'work', label: 'cooking', duration_sim_sec: 180, ref: { type: 'order', id: 7 } },
    ]);
  });

  it('walks first when the agent is elsewhere', () => {
    expect(planTasks('cashier', 'kitchen', work)).toEqual([
      { kind: 'goto', station: 'kitchen', duration_sim_sec: 200 },
      { kind: 'work', label: 'cooking', duration_sim_sec: 180, ref: { type: 'order', id: 7 } },
    ]);
  });

  it('leaves out the reference when there is none', () => {
    const [task] = planTasks('stock_shelf', 'stock_shelf', {
      label: 'checking_stock',
      duration_sim_sec: 90,
    });
    expect(task).toEqual({ kind: 'work', label: 'checking_stock', duration_sim_sec: 90 });
    expect('ref' in (task ?? {})).toBe(false);
  });
});

describe('finalStation', () => {
  it('is where the agent stands when nothing is queued', () => {
    expect(finalStation('kitchen', [])).toBe('kitchen');
  });

  it('is the destination of the last goto in the queue, and work does not move anyone', () => {
    expect(
      finalStation('stock_shelf', [
        { kind: 'work' },
        { kind: 'goto', station: 'boss_desk' },
        { kind: 'work' },
        { kind: 'goto', station: 'stock_shelf' },
        { kind: 'work' },
      ]),
    ).toBe('stock_shelf');
    expect(
      finalStation('stock_shelf', [{ kind: 'goto', station: 'boss_desk' }, { kind: 'work' }]),
    ).toBe('boss_desk');
  });

  it('lets later tasks start from the right place instead of the current one', () => {
    const queue = [{ kind: 'goto', station: 'boss_desk' } as const];
    const from = finalStation('stock_shelf', queue);
    expect(planGoto(from, 'boss_desk')).toEqual([]); // already heading there
    expect(planGoto(from, 'stock_shelf')[0]?.duration_sim_sec).toBe(
      walkDurationSec('boss_desk', 'stock_shelf'),
    );
  });
});
