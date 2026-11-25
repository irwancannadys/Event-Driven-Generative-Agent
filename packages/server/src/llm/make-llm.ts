import { DEFAULT_FAKE_SCRIPT, FakeLLM, type LLMClient } from '@cafe/core';
import type { Config } from '../config';
import { OllamaLLM } from './ollama-llm';

/** The model the configuration asks for, or none when the rules decide alone. */
export function makeLlm(config: Config): LLMClient | undefined {
  switch (config.llmProvider) {
    case 'fake':
      return new FakeLLM(DEFAULT_FAKE_SCRIPT);
    case 'ollama':
      return new OllamaLLM({
        baseUrl: config.ollama.url,
        model: config.ollama.model,
        timeoutMs: config.ollama.timeoutSec * 1000,
      });
    case 'off':
      return undefined;
  }
}
