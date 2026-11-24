import {
  OPEN_TIME_SEC,
  type AgentId,
  type Compensation,
  type Event,
  type OrderItem,
  type StationId,
  type StockLine,
} from '@cafe/core';

// Small builders for valid events, used by the tests. Everything happens at 08:00 unless stated.

export const AT = OPEN_TIME_SEC;

export const ev = {
  orderCreated(
    order_id: number,
    items: OrderItem[] = [{ menu_item_id: 'kopi_susu', qty: 1 }],
    sim_time = AT,
  ): Event {
    return {
      type: 'order_created',
      sim_time,
      actor: 'world',
      origin: 'generator',
      payload: { order_id, source: 'walk_in', items },
    };
  },

  orderHeld(
    order_id: number,
    missing = [{ ingredient_id: 'susu', needed: 150, available: 100 }],
    sim_time = AT,
  ): Event {
    return {
      type: 'order_held',
      sim_time,
      actor: 'cook',
      origin: 'rule',
      payload: { order_id, missing },
    };
  },

  cookingStarted(order_id: number, duration_sim_sec = 180, sim_time = AT): Event {
    return {
      type: 'cooking_started',
      sim_time,
      actor: 'cook',
      origin: 'rule',
      payload: { order_id, duration_sim_sec },
    };
  },

  stockDecreased(
    order_id: number,
    ingredient_id: string,
    qty: number,
    new_qty: number,
    sim_time = AT,
  ): Event {
    return {
      type: 'stock_decreased',
      sim_time,
      actor: 'cook',
      origin: 'rule',
      payload: { ingredient_id, qty, new_qty, order_id },
    };
  },

  cookingDone(order_id: number, sim_time = AT): Event {
    return { type: 'cooking_done', sim_time, actor: 'cook', origin: 'rule', payload: { order_id } };
  },

  stockLow(ingredient_id: string, qty: number, min_qty: number, sim_time = AT): Event {
    return {
      type: 'stock_low',
      sim_time,
      actor: 'system',
      origin: 'rule',
      payload: { ingredient_id, qty, min_qty },
    };
  },

  stockOut(ingredient_id: string, sim_time = AT): Event {
    return {
      type: 'stock_out',
      sim_time,
      actor: 'system',
      origin: 'rule',
      payload: { ingredient_id },
    };
  },

  complaintReceived(
    complaint_id: number,
    order_id: number,
    cause: 'slow_service' | 'wrong_order' | 'quality' = 'slow_service',
    sim_time = AT,
  ): Event {
    return {
      type: 'complaint_received',
      sim_time,
      actor: 'world',
      origin: 'generator',
      payload: { complaint_id, order_id, cause },
    };
  },

  orderResumed(order_id: number, sim_time = AT): Event {
    return {
      type: 'order_resumed',
      sim_time,
      actor: 'system',
      origin: 'rule',
      payload: { order_id },
    };
  },

  agentTaskAssigned(
    agent_id: AgentId,
    task_id: number,
    spec: {
      kind: 'goto' | 'work';
      station?: StationId;
      label?: string;
      duration_sim_sec: number;
      ref?: {
        type: 'order' | 'report' | 'complaint' | 'restock' | 'table' | 'regular';
        id: number | string;
      };
    },
    sim_time = AT,
  ): Event {
    return {
      type: 'agent_task_assigned',
      sim_time,
      actor: agent_id,
      origin: 'rule',
      payload: { agent_id, task_id, ...spec },
    };
  },

  agentStateChanged(
    agent_id: AgentId,
    state: 'idle' | 'walking' | 'working' | 'thinking',
    station: StationId,
    extra: { task_id?: number; label?: string; eta_sim_time?: number } = {},
    sim_time = AT,
  ): Event {
    return {
      type: 'agent_state_changed',
      sim_time,
      actor: agent_id,
      origin: 'rule',
      payload: { agent_id, state, station, ...extra },
    };
  },

  agentTaskFinished(agent_id: AgentId, task_id: number, sim_time = AT): Event {
    return {
      type: 'agent_task_finished',
      sim_time,
      actor: agent_id,
      origin: 'rule',
      payload: { agent_id, task_id },
    };
  },

  restockProposed(
    report_id: number,
    items: StockLine[] = [{ ingredient_id: 'susu', qty: 5050 }],
    sim_time = AT,
  ): Event {
    return {
      type: 'restock_proposed',
      sim_time,
      actor: 'stock_admin',
      origin: 'rule',
      payload: {
        report: { report_id, title: 'Usul belanja: Susu', body: 'Urgensi: normal.' },
        items,
        urgency: 'normal',
        rationale: 'Susu tinggal 950 ml (batas 1000). Usul: isi sampai penuh.',
      },
    };
  },

  policyProposed(
    report_id: number,
    change = { ingredient_id: 'susu', from: 1000, to: 1500 },
    sim_time = AT,
  ): Event {
    return {
      type: 'policy_proposed',
      sim_time,
      actor: 'stock_admin',
      origin: 'rule',
      payload: {
        report: {
          report_id,
          title: 'Usul kebijakan: batas minimum Susu 1000 jadi 1500 ml',
          body: 'Naikkan batas minimum.',
        },
        change,
        rationale: 'Susu sering menahan pesanan.',
      },
    };
  },

  policyChanged(
    report_id: number,
    change = { ingredient_id: 'susu', from: 1000, to: 1500 },
    sim_time = AT,
  ): Event {
    return {
      type: 'policy_changed',
      sim_time,
      actor: 'system',
      origin: 'rule',
      payload: { ...change, report_id },
    };
  },

  memoryCreated(
    text: string,
    kind: 'observation' | 'reflection' = 'observation',
    ingredient_id?: string,
    sim_time = AT,
  ): Event {
    return {
      type: 'memory_created',
      sim_time,
      actor: 'stock_admin',
      origin: 'rule',
      payload: {
        agent_id: 'stock_admin',
        kind,
        ...(ingredient_id !== undefined && { ingredient_id }),
        text,
      },
    };
  },

  reportSubmitted(
    report_id: number,
    actor: 'cashier' | 'stock_admin' = 'stock_admin',
    sim_time = AT,
  ): Event {
    return { type: 'report_submitted', sim_time, actor, origin: 'rule', payload: { report_id } };
  },

  reportDecided(report_id: number, decision: 'approved' | 'rejected', sim_time = AT): Event {
    return {
      type: 'report_decided',
      sim_time,
      actor: 'boss',
      origin: 'boss',
      payload: { report_id, decision },
    };
  },

  restockOrdered(
    restock_id: number,
    report_id: number,
    items: StockLine[] = [{ ingredient_id: 'susu', qty: 5050 }],
    supplier: 'on_time' | 'late' | 'out' = 'on_time',
    eta_sim_time: number | null = supplier === 'out' ? null : AT + 7200,
    sim_time = AT,
  ): Event {
    return {
      type: 'restock_ordered',
      sim_time,
      actor: 'stock_admin',
      origin: 'generator',
      payload: { restock_id, report_id, items, supplier, eta_sim_time },
    };
  },

  restockFailed(restock_id: number, sim_time = AT): Event {
    return {
      type: 'restock_failed',
      sim_time,
      actor: 'world',
      origin: 'generator',
      payload: { restock_id, reason: 'supplier_out' },
    };
  },

  restockArrived(
    restock_id: number,
    items: StockLine[] = [{ ingredient_id: 'susu', qty: 5050 }],
    sim_time = AT,
  ): Event {
    return {
      type: 'restock_arrived',
      sim_time,
      actor: 'world',
      origin: 'generator',
      payload: { restock_id, items },
    };
  },

  complaintTriaged(
    complaint_id: number,
    options: {
      report?: { report_id: number; title: string; body: string };
      compensation?: Compensation;
    } = {},
    sim_time = AT,
  ): Event {
    const compensation = options.compensation ?? (options.report ? 'discount_10' : 'none');
    return {
      type: 'complaint_triaged',
      sim_time,
      actor: 'cashier',
      origin: 'rule',
      payload: {
        complaint_id,
        category: 'slow_service',
        severity: options.report ? 2 : 1,
        draft_reply: 'Mohon maaf atas keterlambatannya.',
        suggested_compensation: compensation,
        needs_boss_decision: options.report !== undefined,
        ...(options.report && { report: options.report }),
      },
    };
  },

  complaintReplied(
    complaint_id: number,
    compensation: Compensation = 'none',
    sim_time = AT,
  ): Event {
    return {
      type: 'complaint_replied',
      sim_time,
      actor: 'cashier',
      origin: 'rule',
      payload: { complaint_id, compensation, reply_text: 'Mohon maaf atas keterlambatannya.' },
    };
  },
};
