import { z } from 'zod';
import { DECISION_SCHEMAS, type Purpose } from './contracts';

/**
 * The shape of an answer as a JSON schema, made from the same zod schema that checks it afterwards
 * (`DECISION_SCHEMAS`), so that the schema sent to a model and the check can never disagree on a field.
 * A model server that constrains its output to a schema (Ollama's `format`) can then only produce the
 * right shape; whether the values make sense is still `validateDecision`'s job.
 */
export function decisionJsonSchema(purpose: Purpose): Record<string, unknown> {
  const schema = z.toJSONSchema(DECISION_SCHEMAS[purpose]) as Record<string, unknown>;
  return withoutNoise(schema) as Record<string, unknown>;
}

// `$schema` and the largest safe integer that zod adds to every integer say nothing a model can use.
function withoutNoise(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutNoise);
  if (typeof node !== 'object' || node === null) return node;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === '$schema') continue;
    if (key === 'maximum' && value === Number.MAX_SAFE_INTEGER) continue;
    result[key] = withoutNoise(value);
  }
  return result;
}
