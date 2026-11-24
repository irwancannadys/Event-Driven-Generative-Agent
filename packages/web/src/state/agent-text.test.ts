import { describe, expect, it } from 'vitest';
import { agentActivity } from './agent-text';
import type { AgentState } from './world';

const agent = (overrides: Partial<AgentState>): AgentState => ({
  id: 'cook',
  state: 'idle',
  station: 'kitchen',
  from: null,
  label: null,
  taskId: null,
  startedAt: null,
  endsAt: null,
  ...overrides,
});

describe('agentActivity', () => {
  it('says what the agent is doing', () => {
    expect(agentActivity(agent({}))).toBe('menganggur');
    expect(agentActivity(agent({ state: 'walking', station: 'boss_desk', from: 'kitchen' }))).toBe(
      'berjalan ke Meja Bos',
    );
    expect(agentActivity(agent({ state: 'working', label: 'cooking' }))).toBe('bekerja: memasak');
    expect(agentActivity(agent({ state: 'working', label: null }))).toBe('bekerja: bekerja');
  });
});
