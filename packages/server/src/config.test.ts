import { describe, expect, it } from 'vitest';
import { parseConfig } from './config';

const root = '/repo';

describe('parseConfig', () => {
  it('uses sensible defaults when nothing is set', () => {
    expect(parseConfig({}, root)).toEqual({
      repoRoot: '/repo',
      databasePath: '/repo/data/cafe.db',
      port: 3000,
      speed: 60,
      scenario: {
        seed: 42,
        crowdPct: 150,
        complaintChancePct: 15,
        complaintWaitSec: 1200,
        stockForecast: true,
      },
      llmProvider: 'fake',
    });
  });

  it('lets the rules decide alone when the model is off, and refuses a provider it does not know', () => {
    expect(parseConfig({ LLM_PROVIDER: 'off' }, root).llmProvider).toBe('off');
    expect(parseConfig({ LLM_PROVIDER: ' FAKE ' }, root).llmProvider).toBe('fake');
    expect(parseConfig({ LLM_PROVIDER: '' }, root).llmProvider).toBe('fake');
    expect(() => parseConfig({ LLM_PROVIDER: 'ollama' }, root)).toThrow(
      /LLM_PROVIDER must be fake or off/,
    );
  });

  it('lets the stock admin look ahead unless it is switched off, and refuses a value it does not know', () => {
    expect(parseConfig({ STOCK_FORECAST: 'off' }, root).scenario.stockForecast).toBe(false);
    expect(parseConfig({ STOCK_FORECAST: ' ON ' }, root).scenario.stockForecast).toBe(true);
    expect(() => parseConfig({ STOCK_FORECAST: 'maybe' }, root)).toThrow(
      /STOCK_FORECAST must be on or off/,
    );
  });

  it('takes every setting from the environment', () => {
    const config = parseConfig(
      {
        DATABASE_PATH: 'var/other.db',
        PORT: '3100',
        SPEED: '600',
        SEED: '7',
        CROWD_PCT: '250',
        COMPLAINT_CHANCE_PCT: '30',
        COMPLAINT_WAIT_MIN: '45',
      },
      root,
    );
    expect(config.databasePath).toBe('/repo/var/other.db');
    expect(config.port).toBe(3100);
    expect(config.speed).toBe(600);
    expect(config.scenario).toMatchObject({
      seed: 7,
      crowdPct: 250,
      complaintChancePct: 30,
      complaintWaitSec: 45 * 60,
    });
  });

  it('keeps an absolute database path as it is', () => {
    expect(parseConfig({ DATABASE_PATH: '/data/x.db' }, root).databasePath).toBe('/data/x.db');
  });

  it('treats an empty value as not set', () => {
    expect(parseConfig({ PORT: '', SPEED: '  ', SEED: '' }, root)).toMatchObject({
      port: 3000,
      speed: 60,
      scenario: { seed: 42 },
    });
  });

  it('accepts port 0 (a free port) and a negative seed', () => {
    const config = parseConfig({ PORT: '0', SEED: '-5' }, root);
    expect(config.port).toBe(0);
    expect(config.scenario.seed).toBe(-5);
  });

  it('rejects values that are not whole numbers, naming the variable', () => {
    for (const name of [
      'PORT',
      'SPEED',
      'SEED',
      'CROWD_PCT',
      'COMPLAINT_CHANCE_PCT',
      'COMPLAINT_WAIT_MIN',
    ]) {
      expect(() => parseConfig({ [name]: 'abc' }, root), name).toThrow(
        new RegExp(`${name} must be a whole number, got "abc"`),
      );
      expect(() => parseConfig({ [name]: '1.5' }, root), name).toThrow(/must be a whole number/);
    }
  });

  it('rejects values out of range, naming the variable', () => {
    expect(() => parseConfig({ PORT: '70000' }, root)).toThrow(/PORT must be between 0 and 65535/);
    expect(() => parseConfig({ SPEED: '0' }, root)).toThrow(/SPEED must be between 1 and 3600/);
    expect(() => parseConfig({ SPEED: '3601' }, root)).toThrow(/SPEED must be between 1 and 3600/);
    expect(() => parseConfig({ CROWD_PCT: '1001' }, root)).toThrow(
      /CROWD_PCT must be between 0 and 1000/,
    );
    expect(() => parseConfig({ COMPLAINT_CHANCE_PCT: '101' }, root)).toThrow(
      /COMPLAINT_CHANCE_PCT must be between 0 and 100/,
    );
    expect(() => parseConfig({ COMPLAINT_WAIT_MIN: '0' }, root)).toThrow(
      /COMPLAINT_WAIT_MIN must be between 1 and 1440/,
    );
    expect(() => parseConfig({ COMPLAINT_WAIT_MIN: '1441' }, root)).toThrow(
      /COMPLAINT_WAIT_MIN must be between 1 and 1440/,
    );
  });
});
