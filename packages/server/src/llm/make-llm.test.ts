import { describe, expect, it } from 'vitest';
import { FakeLLM, isInstant } from '@cafe/core';
import { parseConfig } from '../config';
import { makeLlm } from './make-llm';
import { OllamaLLM } from './ollama-llm';

const llmFor = (env: Record<string, string>) => makeLlm(parseConfig(env, '/repo'));

describe('makeLlm', () => {
  it('answers from a script by default, and at once', () => {
    const llm = llmFor({});
    expect(llm).toBeInstanceOf(FakeLLM);
    expect(llm && isInstant(llm)).toBe(true);
  });

  it('leaves the decisions to the rules when the model is off', () => {
    expect(llmFor({ LLM_PROVIDER: 'off' })).toBeUndefined();
  });

  it('asks the local model when told to: one that takes its time, so it is not instant', () => {
    const llm = llmFor({ LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'llama3.2:3b' });
    expect(llm).toBeInstanceOf(OllamaLLM);
    expect(llm && isInstant(llm)).toBe(false);
  });
});
