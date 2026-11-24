import { describe, expect, it } from 'vitest';
import { ev } from '../test-support/events';
import { appendInTransaction, createInitializedDb } from '../test-support/world';
import { nextDynamicDue } from './dynamic-due';

const T = 30000;

function startTask(
  db: ReturnType<typeof createInitializedDb>,
  agent: 'cashier' | 'cook' | 'stock_admin',
  id: number,
  ends: number,
) {
  appendInTransaction(
    db,
    ev.agentTaskAssigned(
      agent,
      id,
      { kind: 'work', label: 'recording_order', duration_sim_sec: 10 },
      T,
    ),
    ev.agentStateChanged(
      agent,
      'working',
      agent === 'cook' ? 'kitchen' : agent === 'cashier' ? 'cashier' : 'stock_shelf',
      { task_id: id, eta_sim_time: ends },
      T,
    ),
  );
}

function orderedRestock(
  db: ReturnType<typeof createInitializedDb>,
  restockId: number,
  supplier: 'on_time' | 'late' | 'out',
  eta: number | null,
) {
  const reportId = restockId;
  appendInTransaction(
    db,
    ev.restockProposed(reportId, [{ ingredient_id: 'kopi', qty: 100 }]),
    ev.reportSubmitted(reportId),
    ev.reportDecided(reportId, 'approved'),
    ev.restockOrdered(restockId, reportId, [{ ingredient_id: 'kopi', qty: 100 }], supplier, eta),
  );
}

describe('nextDynamicDue', () => {
  it('has nothing when no task is running and no delivery is on its way', () => {
    expect(nextDynamicDue(createInitializedDb(), T, T + 1000)).toEqual([]);
  });

  it('finds the end of a running task inside the window', () => {
    const db = createInitializedDb();
    startTask(db, 'cook', 1, T + 200);
    expect(nextDynamicDue(db, T, T + 1000)).toEqual([
      { kind: 'task_end', time: T + 200, agent_id: 'cook', task_id: 1 },
    ]);
    expect(nextDynamicDue(db, T, T + 199)).toEqual([]); // not yet
    expect(nextDynamicDue(db, T + 200, T + 1000)).toEqual([
      { kind: 'task_end', time: T + 200, agent_id: 'cook', task_id: 1 },
    ]); // overdue counts as now
  });

  it('ignores tasks that are only queued or already done', () => {
    const db = createInitializedDb();
    appendInTransaction(
      db,
      ev.agentTaskAssigned('cook', 1, { kind: 'work', label: 'cooking', duration_sim_sec: 10 }, T),
    );
    expect(nextDynamicDue(db, T, T + 1000)).toEqual([]);
    appendInTransaction(
      db,
      ev.agentStateChanged('cook', 'working', 'kitchen', { task_id: 1, eta_sim_time: T + 10 }, T),
    );
    appendInTransaction(
      db,
      ev.agentTaskFinished('cook', 1, T + 10),
      ev.agentStateChanged('cook', 'idle', 'kitchen', {}, T + 10),
    );
    expect(nextDynamicDue(db, T, T + 1000)).toEqual([]);
  });

  it('returns only the group that is due first', () => {
    const db = createInitializedDb();
    startTask(db, 'cook', 1, T + 300);
    startTask(db, 'cashier', 2, T + 100);
    startTask(db, 'stock_admin', 3, T + 100);
    expect(
      nextDynamicDue(db, T, T + 1000).map((item) => [item.kind, 'task_id' in item && item.task_id]),
    ).toEqual([
      ['task_end', 2],
      ['task_end', 3],
    ]);
  });

  it('treats an overdue item as due now, not in the past', () => {
    const db = createInitializedDb();
    startTask(db, 'cook', 1, T + 10);
    const [item] = nextDynamicDue(db, T + 500, T + 600);
    expect(item).toMatchObject({ kind: 'task_end', time: T + 500 });
  });

  it('finds a delivery that is on its way, and lets it go before a task that ends at the same time', () => {
    const db = createInitializedDb();
    orderedRestock(db, 1, 'on_time', T + 400);
    startTask(db, 'cook', 1, T + 400);
    expect(nextDynamicDue(db, T, T + 1000).map((item) => item.kind)).toEqual([
      'restock_arrival',
      'task_end',
    ]);
  });

  it('ignores deliveries that arrived, failed, or have no arrival time', () => {
    const db = createInitializedDb();
    orderedRestock(db, 1, 'out', null);
    appendInTransaction(db, ev.restockFailed(1));
    expect(nextDynamicDue(db, T, T + 100000)).toEqual([]);
    orderedRestock(db, 2, 'on_time', T + 50);
    appendInTransaction(db, ev.restockArrived(2, [{ ingredient_id: 'kopi', qty: 100 }], T + 50));
    expect(nextDynamicDue(db, T, T + 100000)).toEqual([]);
  });

  it('is empty for an empty window', () => {
    const db = createInitializedDb();
    startTask(db, 'cook', 1, T + 10);
    expect(nextDynamicDue(db, T + 5, T + 5)).toEqual([]);
  });
});
