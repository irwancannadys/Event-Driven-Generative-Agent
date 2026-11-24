import { describe, expect, it } from 'vitest';
import type { Origin } from '../ids';
import { EVENT_META, EVENT_TYPES } from './schemas';
import {
  HIDDEN_FROM_LOG,
  INITIATIVE_EVENT_TYPES,
  LOG_LABELS,
  isHiddenFromLog,
  logLabel,
  type LabelSource,
} from './log-label';

function source(type: string, origin: Origin, payload: Record<string, unknown> = {}): LabelSource {
  return { type, origin, payload };
}

describe('logLabel', () => {
  it('labels what the world or the schedule causes as trigger', () => {
    expect(logLabel(source('order_created', 'generator'))).toBe('trigger');
    expect(logLabel(source('day_opened', 'scheduler'))).toBe('trigger');
    expect(logLabel(source('restock_arrived', 'generator'))).toBe('trigger');
  });

  it('labels plain rules, fallbacks and system events as rule', () => {
    expect(logLabel(source('stock_decreased', 'rule'))).toBe('rule');
    expect(logLabel(source('regular_greeted', 'fallback'))).toBe('rule');
    expect(logLabel(source('world_initialized', 'system'))).toBe('rule');
  });

  it('labels LLM output as llm', () => {
    expect(logLabel(source('restock_proposed', 'llm'))).toBe('llm');
    expect(logLabel(source('complaint_triaged', 'llm'))).toBe('llm');
  });

  it('labels the boss as boss', () => {
    expect(logLabel(source('report_decided', 'boss'))).toBe('boss');
    expect(logLabel(source('sim_time_advanced', 'boss'))).toBe('boss');
  });

  it("labels Rina's own actions as initiative, whatever the origin", () => {
    expect(logLabel(source('table_prepared', 'llm'))).toBe('initiative');
    expect(logLabel(source('table_tidied', 'fallback'))).toBe('initiative');
    expect(logLabel(source('reflection_created', 'rule'))).toBe('initiative');
  });

  it('labels a waiter_initiative decision as initiative, but other decisions by origin', () => {
    expect(logLabel(source('agent_decided', 'llm', { purpose: 'waiter_initiative' }))).toBe(
      'initiative',
    );
    expect(logLabel(source('agent_decided', 'llm', { purpose: 'stock_proposal' }))).toBe('llm');
    expect(logLabel(source('agent_decided', 'rule', { purpose: 'greeting' }))).toBe('rule');
  });

  it('gives every event type and allowed origin a known label', () => {
    for (const type of EVENT_TYPES) {
      for (const origin of EVENT_META[type].origins) {
        expect(LOG_LABELS, `${type}/${origin}`).toContain(logLabel(source(type, origin)));
      }
    }
  });
});

describe('hidden and initiative event lists', () => {
  it('only name event types that exist (guards against typos)', () => {
    for (const type of [...HIDDEN_FROM_LOG, ...INITIATIVE_EVENT_TYPES]) {
      expect(EVENT_TYPES as readonly string[], type).toContain(type);
    }
  });

  it('hides the plumbing events and nothing else', () => {
    expect(isHiddenFromLog({ type: 'agent_state_changed' })).toBe(true);
    expect(isHiddenFromLog({ type: 'agent_task_assigned' })).toBe(true);
    expect(isHiddenFromLog({ type: 'agent_task_finished' })).toBe(true);
    expect(isHiddenFromLog({ type: 'agent_decided' })).toBe(false);
    expect(isHiddenFromLog({ type: 'order_created' })).toBe(false);
  });
});
