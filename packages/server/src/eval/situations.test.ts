import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { DEFAULT_FAKE_SCRIPT, FakeLLM, buildPrompt, validateDecision } from '@cafe/core';
import { SITUATIONS_FILE, loadSituations, parseSituations, toWorld } from './situations';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const situations = loadSituations(repoRoot);

describe('the situations of the evaluation', () => {
  it('are about twenty: questions about orders (stock that is low and the look ahead) and about the review', () => {
    expect(SITUATIONS_FILE).toBe('eval/llm-situations.json');
    expect(situations).toHaveLength(20);
    const count = (purpose: string, kind?: string) =>
      situations.filter(
        (s) => s.purpose === purpose && (kind === undefined || s.request.facts.kind === kind),
      ).length;
    expect(count('stock_proposal', 'low_stock')).toBe(6);
    expect(count('stock_proposal', 'forecast')).toBe(6);
    expect(count('policy_review')).toBe(8);
    expect(new Set(situations.map((s) => s.id)).size).toBe(situations.length);
  });

  it('carry what a model needs: a prompt can be made of each, and the world has every ingredient', () => {
    for (const situation of situations) {
      expect(situation.request.purpose, situation.id).toBe(situation.purpose);
      const prompt = buildPrompt(situation.request);
      expect(prompt.user, situation.id).toContain(situation.request.context);
      expect(prompt.user, situation.id).toContain('id=');
      expect(toWorld(situation).ingredients.size, situation.id).toBe(8);
    }
  });

  it('are faithful: the scripted model that the cafe asked at the time gives an answer that passes in their world', () => {
    const fake = new FakeLLM(DEFAULT_FAKE_SCRIPT);
    for (const situation of situations) {
      const { output } = fake.completeNow(situation.request);
      const checked = validateDecision(situation.purpose, output, toWorld(situation));
      expect(checked.ok, `${situation.id}: ${checked.ok ? '' : checked.message}`).toBe(true);
    }
  });
});

describe('parseSituations', () => {
  const one = situations[0];
  const file = (extra: object = {}) =>
    JSON.stringify({ version: 1, generated_by: 'test', situations: [one], ...extra });

  it('reads a file of situations', () => {
    expect(parseSituations(file())).toHaveLength(1);
  });

  it('refuses a file of another version, with no situation, or with a purpose that is not evaluated', () => {
    expect(() => parseSituations(file({ version: 2 }))).toThrow();
    expect(() => parseSituations(file({ situations: [] }))).toThrow();
    const odd = {
      ...one,
      purpose: 'complaint_triage',
      request: { ...one?.request, purpose: 'complaint_triage' },
    };
    expect(() => parseSituations(file({ situations: [odd] }))).toThrow();
  });

  it('refuses two situations with the same id', () => {
    expect(() => parseSituations(file({ situations: [one, one] }))).toThrow(/same id/);
  });
});
