import { z } from 'zod';

export const AGENT_IDS = ['cashier', 'cook', 'stock_admin', 'waiter'] as const;
export const AgentIdSchema = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentIdSchema>;

export const STATION_IDS = [
  'cashier',
  'kitchen',
  'stock_shelf',
  'boss_desk',
  'table_1',
  'table_2',
  'table_3',
] as const;
export const StationIdSchema = z.enum(STATION_IDS);
export type StationId = z.infer<typeof StationIdSchema>;

export const TableIdSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type TableId = z.infer<typeof TableIdSchema>;

/** What caused an event. See docs/events.md. */
export const ORIGINS = [
  'generator',
  'scheduler',
  'rule',
  'llm',
  'fallback',
  'boss',
  'system',
] as const;
export const OriginSchema = z.enum(ORIGINS);
export type Origin = z.infer<typeof OriginSchema>;

/** Who performed an event: an agent, the boss, the outside world (customers, suppliers) or the system. */
export const ACTORS = [...AGENT_IDS, 'boss', 'world', 'system'] as const;
export const ActorSchema = z.enum(ACTORS);
export type Actor = z.infer<typeof ActorSchema>;
