import { describe, expect, it } from 'vitest';
import { makeScenario, walkDurationSec, type StoredEvent } from '@cafe/core';
import { listEvents } from '../events/store';
import { saveClockState } from '../sim/clock-state';
import { nextDynamicDue } from '../sim/dynamic-due';
import { FIRST_BOOT_START, bootSimulation, type Simulation } from '../sim/simulation';
import { createTestDb } from '../test-support/world';
import { transact } from '../usecases/context';
import { createOrder } from '../usecases/orders';
import { enqueueGoto, enqueueWork, readAgent, readOpenTasks } from './engine';

const START = FIRST_BOOT_START;

/** A world with no customers, so that only what the test queues happens. */
function quietWorld(agents = true) {
  const db = createTestDb();
  const sim = bootSimulation({ db, agents, scenario: makeScenario(42, { crowdPct: 0 }) });
  return { db, sim };
}

const TASK_EVENTS = ['agent_task_assigned', 'agent_state_changed', 'agent_task_finished'];

function agentLog(db: ReturnType<typeof createTestDb>, types: string[] = TASK_EVENTS) {
  return listEvents(db)
    .filter((event) => types.includes(event.type))
    .map((event: StoredEvent) => ({
      type: event.type,
      time: event.sim_time,
      ...('state' in event.payload && { state: event.payload.state }),
      ...('station' in event.payload && { station: event.payload.station }),
      ...('eta_sim_time' in event.payload && { eta: event.payload.eta_sim_time }),
    }));
}

function queueWork(
  sim: Simulation,
  agent: 'cashier' | 'cook' | 'stock_admin',
  station: 'cashier' | 'kitchen' | 'stock_shelf' | 'boss_desk',
  label: 'recording_order' | 'submitting_report' | 'checking_stock' | 'cooking',
  duration_sim_sec: number,
  ref?: { type: 'order'; id: number },
) {
  transact(sim.ctx, (emit) =>
    enqueueWork(sim.ctx, emit, agent, station, { label, duration_sim_sec, ...(ref && { ref }) }),
  );
}

describe('a free agent', () => {
  it('starts a new task at once, with an ETA', () => {
    const { db, sim } = quietWorld();
    queueWork(sim, 'cashier', 'cashier', 'recording_order', 45);
    expect(agentLog(db)).toEqual([
      { type: 'agent_task_assigned', time: START },
      {
        type: 'agent_state_changed',
        time: START,
        state: 'working',
        station: 'cashier',
        eta: START + 45,
      },
    ]);
    expect(readAgent(db, 'cashier').state).toBe('working');
    expect(nextDynamicDue(db, START, START + 100)).toEqual([
      { kind: 'task_end', time: START + 45, agent_id: 'cashier', task_id: 1 },
    ]);
  });

  it('finishes the task when its time is up and goes idle', () => {
    const { db, sim } = quietWorld();
    queueWork(sim, 'cashier', 'cashier', 'recording_order', 45);
    sim.clock.advance(44);
    expect(readAgent(db, 'cashier').state).toBe('working');
    sim.clock.advance(1);
    expect(agentLog(db).slice(2)).toEqual([
      { type: 'agent_task_finished', time: START + 45 },
      { type: 'agent_state_changed', time: START + 45, state: 'idle', station: 'cashier' },
    ]);
    expect(readAgent(db, 'cashier').state).toBe('idle');
    expect(readOpenTasks(db, 'cashier')).toEqual([]);
  });

  it('walks first when the work is somewhere else, then works there', () => {
    const { db, sim } = quietWorld();
    queueWork(sim, 'cashier', 'boss_desk', 'submitting_report', 60);
    const walk = walkDurationSec('cashier', 'boss_desk');
    expect(walk).toBe(132);
    sim.clock.advance(walk + 60);
    expect(agentLog(db)).toEqual([
      { type: 'agent_task_assigned', time: START, station: 'boss_desk' }, // the walk
      { type: 'agent_task_assigned', time: START }, // the work
      {
        type: 'agent_state_changed',
        time: START,
        state: 'walking',
        station: 'boss_desk',
        eta: START + walk,
      },
      { type: 'agent_task_finished', time: START + walk },
      {
        type: 'agent_state_changed',
        time: START + walk,
        state: 'working',
        station: 'boss_desk',
        eta: START + walk + 60,
      },
      { type: 'agent_task_finished', time: START + walk + 60 },
      { type: 'agent_state_changed', time: START + walk + 60, state: 'idle', station: 'boss_desk' },
    ]);
    expect(readAgent(db, 'cashier')).toMatchObject({ state: 'idle', station: 'boss_desk' });
  });

  it('runs its queue in order, each task starting the moment the previous one ends', () => {
    const { db, sim } = quietWorld();
    queueWork(sim, 'cook', 'kitchen', 'recording_order', 30);
    queueWork(sim, 'cook', 'kitchen', 'checking_stock', 50);
    queueWork(sim, 'cook', 'kitchen', 'submitting_report', 70);
    sim.clock.advance(1000);
    const starts = agentLog(db)
      .filter((entry) => entry.type === 'agent_state_changed' && entry.state === 'working')
      .map((entry) => [entry.time, entry.eta]);
    expect(starts).toEqual([
      [START, START + 30],
      [START + 30, START + 80],
      [START + 80, START + 150],
    ]);
    expect(readAgent(db, 'cook').state).toBe('idle');
  });

  it('works in parallel with the other agents', () => {
    const { db, sim } = quietWorld();
    queueWork(sim, 'cashier', 'cashier', 'recording_order', 45);
    queueWork(sim, 'cook', 'kitchen', 'recording_order', 100);
    sim.clock.advance(60);
    expect(readAgent(db, 'cashier').state).toBe('idle');
    expect(readAgent(db, 'cook').state).toBe('working');
    sim.clock.advance(40);
    expect(readAgent(db, 'cook').state).toBe('idle');
  });
});

describe('planning from where an agent will be', () => {
  it('walks back from the destination of its queue, not from where it stands now', () => {
    const { db, sim } = quietWorld();
    queueWork(sim, 'stock_admin', 'boss_desk', 'submitting_report', 60);
    transact(sim.ctx, (emit) => enqueueGoto(sim.ctx, emit, 'stock_admin', 'stock_shelf'));
    const gotos = readOpenTasks(db, 'stock_admin').filter((task) => task.kind === 'goto');
    expect(gotos.map((task) => [task.station, task.duration_sim_sec])).toEqual([
      ['boss_desk', walkDurationSec('stock_shelf', 'boss_desk')],
      ['stock_shelf', walkDurationSec('boss_desk', 'stock_shelf')],
    ]);
  });

  it('adds nothing when the agent will already be at the station', () => {
    const { db, sim } = quietWorld();
    const before = listEvents(db).length;
    transact(sim.ctx, (emit) => enqueueGoto(sim.ctx, emit, 'cook', 'kitchen'));
    expect(listEvents(db)).toHaveLength(before);
  });
});

describe('cooking tasks (the stock is used when the task starts)', () => {
  const order = (sim: Simulation, qty: number) =>
    createOrder(sim.ctx, { items: [{ menu_item_id: 'kopi_susu', qty }] }).order_id;

  it('takes the ingredients at the moment the cook starts, then shows the cook as working', () => {
    const { db, sim } = quietWorld();
    const id = order(sim, 1);
    queueWork(sim, 'cook', 'kitchen', 'cooking', 180, { type: 'order', id });
    expect(
      listEvents(db)
        .map((event) => event.type)
        .slice(-6),
    ).toEqual([
      'agent_task_assigned',
      'cooking_started',
      'stock_decreased',
      'stock_decreased',
      'stock_decreased',
      'agent_state_changed',
    ]);
    expect(db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(id)).toBe('cooking');
    expect(db.prepare("SELECT qty FROM stock WHERE ingredient_id = 'susu'").pluck().get()).toBe(
      2350,
    );
  });

  it('does not take anything while the cook is still busy with another order', () => {
    const { db, sim } = quietWorld();
    const first = order(sim, 1);
    const second = order(sim, 1);
    queueWork(sim, 'cook', 'kitchen', 'cooking', 180, { type: 'order', id: first });
    queueWork(sim, 'cook', 'kitchen', 'cooking', 180, { type: 'order', id: second });
    expect(db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(second)).toBe('placed');
    expect(db.prepare("SELECT qty FROM stock WHERE ingredient_id = 'susu'").pluck().get()).toBe(
      2350,
    );
    sim.clock.advance(180);
    expect(db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(second)).toBe(
      'cooking',
    );
    expect(db.prepare("SELECT qty FROM stock WHERE ingredient_id = 'susu'").pluck().get()).toBe(
      2200,
    );
  });

  it('holds the order and skips the task when the ingredients are short, leaving the cook free', () => {
    const { db, sim } = quietWorld();
    const id = order(sim, 17); // 2550 ml of milk, only 2500 in stock
    queueWork(sim, 'cook', 'kitchen', 'cooking', 3060, { type: 'order', id });
    const types = listEvents(db)
      .map((event) => event.type)
      .slice(-3);
    expect(types).toEqual(['agent_task_assigned', 'order_held', 'agent_task_finished']);
    expect(db.prepare('SELECT status FROM orders WHERE id = ?').pluck().get(id)).toBe('held');
    expect(db.prepare("SELECT qty FROM stock WHERE ingredient_id = 'susu'").pluck().get()).toBe(
      2500,
    );
    expect(readAgent(db, 'cook').state).toBe('idle');
  });

  it('goes on with the next task after a skipped one', () => {
    const { db, sim } = quietWorld();
    const held = order(sim, 17);
    queueWork(sim, 'cook', 'kitchen', 'cooking', 3060, { type: 'order', id: held });
    queueWork(sim, 'cook', 'kitchen', 'checking_stock', 90);
    expect(readAgent(db, 'cook').state).toBe('working');
    sim.clock.advance(90);
    expect(readAgent(db, 'cook').state).toBe('idle');
  });

  it('skips a cooking task whose order is not waiting any more, without failing', () => {
    const { db, sim } = quietWorld();
    queueWork(sim, 'cook', 'kitchen', 'cooking', 180, { type: 'order', id: 99 });
    expect(readAgent(db, 'cook').state).toBe('idle');
    expect(readOpenTasks(db, 'cook')).toEqual([]);
  });
});

describe('restarting while agents are busy', () => {
  function story(restartAt?: number) {
    const { db, sim: first } = quietWorld();
    queueWork(first, 'cashier', 'boss_desk', 'submitting_report', 60);
    queueWork(first, 'cook', 'kitchen', 'recording_order', 500);
    let sim = first;
    if (restartAt !== undefined) {
      first.clock.advance(restartAt - first.clock.now());
      sim = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }) });
      expect(sim.recovered).toBe(true);
    }
    sim.clock.advance(START + 1000 - sim.clock.now());
    return agentLog(db);
  }

  const straight = story();

  it.each([
    START + 1,
    START + 100,
    START + 132,
    START + 133,
    START + 192,
    START + 400,
    START + 500,
  ])('gives the identical log when the server restarts at %i s', (restartAt) => {
    expect(story(restartAt)).toEqual(straight);
  });
});

describe('a task that is overdue after a crash', () => {
  it('is finished right away, at the time the clock was restored to', () => {
    const { db, sim } = quietWorld();
    queueWork(sim, 'cashier', 'cashier', 'recording_order', 45);
    // The server died, and the saved clock is well after the task should have ended.
    saveClockState(db, { current_sim_sec: START + 500, speed: 60, paused: false });
    const restored = bootSimulation({ db, scenario: makeScenario(42, { crowdPct: 0 }) });
    expect(restored.clock.now()).toBe(START + 500);
    restored.clock.advance(1);
    const finished = listEvents(db).find((event) => event.type === 'agent_task_finished');
    expect(finished?.sim_time).toBe(START + 500);
    expect(readAgent(db, 'cashier').state).toBe('idle');
  });
});

describe('the agents switch', () => {
  it('leaves tasks waiting in the queue when agents are off', () => {
    const { db, sim } = quietWorld(false);
    expect(sim.ctx.react).toBeUndefined();
    queueWork(sim, 'cashier', 'cashier', 'recording_order', 45);
    expect(readAgent(db, 'cashier').state).toBe('idle');
    expect(readOpenTasks(db, 'cashier').map((task) => task.status)).toEqual(['queued']);
    sim.clock.advance(1000);
    expect(readOpenTasks(db, 'cashier').map((task) => task.status)).toEqual(['queued']);
  });
});
