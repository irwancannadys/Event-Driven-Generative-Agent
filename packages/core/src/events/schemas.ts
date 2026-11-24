import { z } from 'zod';
import {
  AGENT_IDS,
  ActorSchema,
  AgentIdSchema,
  OriginSchema,
  StationIdSchema,
  TableIdSchema,
  type Actor,
  type Origin,
} from '../ids';
import {
  ComplaintTriageSchema,
  FallbackReasonSchema,
  PurposeSchema,
  StockProposalSchema,
  TextDecisionSchema,
  WaiterInitiativeSchema,
} from '../llm/contracts';
import {
  ComplaintCauseSchema,
  CompensationSchema,
  EntityIdSchema,
  OrderItemSchema,
  PositiveQtySchema,
  QtySchema,
  ReportDraftSchema,
  SimTimeSchema,
  StockLineSchema,
  UrgencySchema,
} from '../schema-parts';

// The 33 events of docs/events.md. Each event is { type, sim_time, actor, origin, payload }.
// docs/events.md is the contract: tools/events-doc.test.ts fails if this file and the doc drift apart.

const id = EntityIdSchema;
const nonEmpty = z.string().min(1);

function defineEvent<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.object({
    type: z.literal(type),
    sim_time: SimTimeSchema,
    actor: ActorSchema,
    origin: OriginSchema,
    payload,
  });
}

const agentDecidedBase = {
  agent_id: AgentIdSchema,
  think_event_id: id,
  llm_call_id: id.optional(),
  fallback_reason: FallbackReasonSchema.optional(),
  attempts: z.number().int().positive().optional(),
};

const AgentDecidedPayloadSchema = z.discriminatedUnion('purpose', [
  z.object({
    purpose: z.literal('waiter_initiative'),
    decision: WaiterInitiativeSchema,
    ...agentDecidedBase,
  }),
  z.object({
    purpose: z.literal('stock_proposal'),
    decision: StockProposalSchema,
    ...agentDecidedBase,
  }),
  z.object({
    purpose: z.literal('complaint_triage'),
    decision: ComplaintTriageSchema,
    ...agentDecidedBase,
  }),
  z.object({ purpose: z.literal('greeting'), decision: TextDecisionSchema, ...agentDecidedBase }),
  z.object({ purpose: z.literal('reflection'), decision: TextDecisionSchema, ...agentDecidedBase }),
]);

const baseEventSchema = z.discriminatedUnion('type', [
  // --- World and time ---
  defineEvent(
    'world_initialized',
    z.object({
      seed: z.number().int().nonnegative(),
      initial_stock: z.record(z.string(), QtySchema),
      initial_visits: z.record(z.string(), z.number().int().nonnegative()),
    }),
  ),
  defineEvent('day_opened', z.object({ day: z.number().int().nonnegative() })),
  defineEvent('day_closed', z.object({ day: z.number().int().nonnegative() })),
  defineEvent('sim_time_advanced', z.object({ from: SimTimeSchema, to: SimTimeSchema })),

  // --- Orders and kitchen ---
  defineEvent('customer_arrived', z.object({ customer_id: id })),
  defineEvent(
    'order_created',
    z.object({
      order_id: id,
      source: z.enum(['walk_in', 'regular']),
      customer_id: id.optional(),
      regular_id: nonEmpty.optional(),
      table_id: TableIdSchema.optional(),
      items: z.array(OrderItemSchema).min(1),
    }),
  ),
  defineEvent(
    'order_held',
    z.object({
      order_id: id,
      missing: z
        .array(
          z.object({ ingredient_id: nonEmpty, needed: PositiveQtySchema, available: QtySchema }),
        )
        .min(1),
    }),
  ),
  defineEvent('order_resumed', z.object({ order_id: id })),
  defineEvent(
    'cooking_started',
    z.object({ order_id: id, duration_sim_sec: z.number().int().positive() }),
  ),
  defineEvent(
    'stock_decreased',
    z.object({ ingredient_id: nonEmpty, qty: PositiveQtySchema, new_qty: QtySchema, order_id: id }),
  ),
  defineEvent('cooking_done', z.object({ order_id: id })),
  defineEvent(
    'stock_low',
    z.object({ ingredient_id: nonEmpty, qty: QtySchema, min_qty: QtySchema }),
  ),
  defineEvent('stock_out', z.object({ ingredient_id: nonEmpty })),

  // --- Restocking and suppliers ---
  defineEvent(
    'restock_proposed',
    z.object({
      report: ReportDraftSchema,
      items: z.array(StockLineSchema).min(1),
      urgency: UrgencySchema,
      rationale: z.string().min(1).max(200),
    }),
  ),
  defineEvent('report_submitted', z.object({ report_id: id })),
  defineEvent(
    'report_decided',
    z.object({ report_id: id, decision: z.enum(['approved', 'rejected']) }),
  ),
  defineEvent(
    'restock_ordered',
    z.object({
      restock_id: id,
      report_id: id,
      items: z.array(StockLineSchema).min(1),
      supplier: z.enum(['on_time', 'late', 'out']),
      eta_sim_time: SimTimeSchema.nullable(),
    }),
  ),
  defineEvent(
    'restock_arrived',
    z.object({ restock_id: id, items: z.array(StockLineSchema).min(1) }),
  ),
  defineEvent('restock_failed', z.object({ restock_id: id, reason: z.literal('supplier_out') })),

  // --- Complaints ---
  defineEvent(
    'complaint_received',
    z.object({ complaint_id: id, order_id: id, cause: ComplaintCauseSchema }),
  ),
  defineEvent(
    'complaint_triaged',
    z.object({
      complaint_id: id,
      ...ComplaintTriageSchema.shape,
      report: ReportDraftSchema.optional(),
    }),
  ),
  defineEvent(
    'complaint_replied',
    z.object({ complaint_id: id, compensation: CompensationSchema, reply_text: nonEmpty }),
  ),

  // --- Regulars and Rina ---
  defineEvent(
    'regular_expected',
    z.object({ regular_id: nonEmpty, table_id: TableIdSchema, expected_at: SimTimeSchema }),
  ),
  defineEvent('regular_arrived', z.object({ regular_id: nonEmpty, table_id: TableIdSchema })),
  defineEvent('regular_greeted', z.object({ regular_id: nonEmpty, ...TextDecisionSchema.shape })),
  defineEvent('regular_left', z.object({ regular_id: nonEmpty, table_id: TableIdSchema })),
  defineEvent(
    'table_prepared',
    z.object({ table_id: TableIdSchema, regular_id: nonEmpty.optional() }),
  ),
  defineEvent('table_tidied', z.object({ table_id: TableIdSchema })),
  defineEvent(
    'reflection_created',
    z.object({ regular_id: nonEmpty, ...TextDecisionSchema.shape }),
  ),

  // --- Agents ---
  defineEvent(
    'agent_think_requested',
    z.object({
      agent_id: AgentIdSchema,
      purpose: PurposeSchema,
      subject: z
        .object({
          regular_id: nonEmpty.optional(),
          ingredient_ids: z.array(nonEmpty).optional(),
          complaint_id: id.optional(),
        })
        .optional(),
    }),
  ),
  defineEvent('agent_decided', AgentDecidedPayloadSchema),
  defineEvent(
    'agent_task_assigned',
    z.object({
      agent_id: AgentIdSchema,
      task_id: id,
      kind: z.enum(['goto', 'work']),
      station: StationIdSchema.optional(),
      label: nonEmpty.optional(),
      duration_sim_sec: z.number().int().nonnegative(),
      ref: z
        .object({
          type: z.enum(['order', 'report', 'complaint', 'restock', 'table', 'regular']),
          id: z.union([z.number().int(), nonEmpty]),
        })
        .optional(),
    }),
  ),
  defineEvent('agent_task_finished', z.object({ agent_id: AgentIdSchema, task_id: id })),
  defineEvent(
    'agent_state_changed',
    z.object({
      agent_id: AgentIdSchema,
      state: z.enum(['idle', 'walking', 'working', 'thinking']),
      station: StationIdSchema,
      task_id: id.optional(),
      label: nonEmpty.optional(),
      eta_sim_time: SimTimeSchema.optional(),
    }),
  ),
]);

export type EventType = z.infer<typeof baseEventSchema>['type'];

interface EventMeta {
  readonly origins: readonly Origin[];
  readonly actors: readonly Actor[];
}

const DECISION_ORIGINS = ['rule', 'llm', 'fallback'] as const;

/** Which origins and actors are allowed per event type. Mirrors the catalog table in docs/events.md. */
export const EVENT_META = {
  world_initialized: { origins: ['system'], actors: ['system'] },
  day_opened: { origins: ['scheduler'], actors: ['system'] },
  day_closed: { origins: ['scheduler'], actors: ['system'] },
  sim_time_advanced: { origins: ['boss'], actors: ['boss'] },
  customer_arrived: { origins: ['generator'], actors: ['world'] },
  order_created: { origins: ['generator', 'rule'], actors: ['world', 'waiter'] },
  order_held: { origins: ['rule'], actors: ['cook'] },
  order_resumed: { origins: ['rule'], actors: ['system'] },
  cooking_started: { origins: ['rule'], actors: ['cook'] },
  stock_decreased: { origins: ['rule'], actors: ['cook'] },
  cooking_done: { origins: ['rule'], actors: ['cook'] },
  stock_low: { origins: ['rule'], actors: ['system'] },
  stock_out: { origins: ['rule'], actors: ['system'] },
  restock_proposed: { origins: DECISION_ORIGINS, actors: ['stock_admin'] },
  report_submitted: { origins: ['rule'], actors: ['cashier', 'stock_admin'] },
  report_decided: { origins: ['boss'], actors: ['boss'] },
  restock_ordered: { origins: ['generator'], actors: ['stock_admin'] },
  restock_arrived: { origins: ['generator'], actors: ['world'] },
  restock_failed: { origins: ['generator'], actors: ['world'] },
  complaint_received: { origins: ['generator'], actors: ['world'] },
  complaint_triaged: { origins: DECISION_ORIGINS, actors: ['cashier'] },
  complaint_replied: { origins: ['rule'], actors: ['cashier'] },
  regular_expected: { origins: ['scheduler'], actors: ['system'] },
  regular_arrived: { origins: ['scheduler'], actors: ['world'] },
  regular_greeted: { origins: DECISION_ORIGINS, actors: ['waiter'] },
  regular_left: { origins: ['rule'], actors: ['world'] },
  table_prepared: { origins: DECISION_ORIGINS, actors: ['waiter'] },
  table_tidied: { origins: DECISION_ORIGINS, actors: ['waiter'] },
  reflection_created: { origins: DECISION_ORIGINS, actors: ['waiter'] },
  agent_think_requested: { origins: ['scheduler', 'rule'], actors: AGENT_IDS },
  agent_decided: { origins: DECISION_ORIGINS, actors: AGENT_IDS },
  agent_task_assigned: { origins: ['rule'], actors: AGENT_IDS },
  agent_task_finished: { origins: ['rule'], actors: AGENT_IDS },
  agent_state_changed: { origins: ['rule'], actors: AGENT_IDS },
} as const satisfies Record<EventType, EventMeta>;

export const EVENT_TYPES = Object.keys(EVENT_META) as EventType[];

export const eventSchema = baseEventSchema.superRefine((event, ctx) => {
  const fail = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: 'custom', path, message });

  const meta: EventMeta = EVENT_META[event.type];
  if (!meta.origins.includes(event.origin)) {
    fail(['origin'], `origin "${event.origin}" is not allowed for ${event.type}`);
  }
  if (!meta.actors.includes(event.actor)) {
    fail(['actor'], `actor "${event.actor}" is not allowed for ${event.type}`);
  }

  // Agent events are performed by the agent they are about.
  if (
    (event.type === 'agent_think_requested' ||
      event.type === 'agent_decided' ||
      event.type === 'agent_task_assigned' ||
      event.type === 'agent_task_finished' ||
      event.type === 'agent_state_changed') &&
    event.actor !== event.payload.agent_id
  ) {
    fail(['actor'], `actor must equal payload.agent_id (${event.payload.agent_id})`);
  }

  switch (event.type) {
    case 'sim_time_advanced':
      if (event.payload.to <= event.payload.from) {
        fail(['payload', 'to'], '"to" must be later than "from"');
      }
      break;
    case 'order_created':
      if (event.payload.source === 'regular') {
        if (event.payload.regular_id === undefined) {
          fail(['payload', 'regular_id'], 'regular_id is required when source is "regular"');
        }
        if (event.payload.table_id === undefined) {
          fail(['payload', 'table_id'], 'table_id is required when source is "regular"');
        }
      }
      break;
    case 'stock_low':
      if (event.payload.qty > event.payload.min_qty) {
        fail(['payload', 'qty'], 'qty must be at or below min_qty');
      }
      break;
    case 'restock_ordered':
      if ((event.payload.supplier === 'out') !== (event.payload.eta_sim_time === null)) {
        fail(
          ['payload', 'eta_sim_time'],
          'eta_sim_time must be null if and only if supplier is "out"',
        );
      }
      break;
    case 'complaint_triaged':
      if (event.payload.needs_boss_decision !== (event.payload.report !== undefined)) {
        fail(
          ['payload', 'report'],
          'report must be present if and only if needs_boss_decision is true',
        );
      }
      break;
    case 'agent_task_assigned':
      if (event.payload.kind === 'goto' && event.payload.station === undefined) {
        fail(['payload', 'station'], 'station is required for goto tasks');
      }
      break;
    case 'agent_decided':
      if ((event.origin === 'fallback') !== (event.payload.fallback_reason !== undefined)) {
        fail(
          ['payload', 'fallback_reason'],
          'fallback_reason must be present if and only if origin is "fallback"',
        );
      }
      break;
    default:
      break;
  }
});

export type Event = z.infer<typeof eventSchema>;
export type EventOf<T extends EventType> = Extract<Event, { type: T }>;
