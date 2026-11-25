import { z } from 'zod';
import { DECISION_SCHEMAS, type Purpose } from './contracts';

type Json = Record<string, unknown>;

/**
 * The shape of an answer as a JSON schema, made from the same zod schema that checks it afterwards
 * (`DECISION_SCHEMAS`), so that the schema sent to a model and the check can never disagree on a field.
 * A model server that constrains its output to a schema (Ollama's `format`) can then only produce the
 * right shape; whether the values make sense is still `validateDecision`'s job.
 *
 * With the `facts` of the request the ingredient ids become a list of the ids that are allowed: a small model
 * that writes "Susu" or "id=susu" for the ingredient "susu" cannot, because the server only lets it write one of
 * the ids on the list. For a review the ingredients that are blocked are left off the list.
 */
export function decisionJsonSchema(purpose: Purpose, facts?: Json): Json {
  const schema = withoutNoise(z.toJSONSchema(DECISION_SCHEMAS[purpose])) as Json;
  const ids = allowedIds(purpose, facts);
  if (ids.length === 0) return schema;
  const idField =
    purpose === 'stock_proposal'
      ? pick(schema, 'properties', 'items', 'items', 'properties', 'ingredient_id')
      : purpose === 'policy_review'
        ? pick(schema, 'properties', 'change', 'properties', 'ingredient_id')
        : undefined;
  if (idField) idField.enum = ids;
  return schema;
}

function pick(node: Json, ...path: string[]): Json | undefined {
  let current: unknown = node;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Json)[key];
  }
  return typeof current === 'object' && current !== null ? (current as Json) : undefined;
}

const recordsOf = (value: unknown): Json[] =>
  Array.isArray(value)
    ? value.filter((item): item is Json => typeof item === 'object' && item !== null)
    : [];

/** The ids a model may name for this request: the ingredients it was told about, less the ones that are blocked. */
function allowedIds(purpose: Purpose, facts: Json | undefined): string[] {
  if (!facts) return [];
  const blocked = new Set(Array.isArray(facts.blocked) ? facts.blocked.map(String) : []);
  const listed =
    purpose === 'stock_proposal'
      ? recordsOf(facts.lines)
      : purpose === 'policy_review'
        ? recordsOf(facts.ingredients)
        : [];
  return listed
    .map((entry) => entry.ingredient_id)
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => purpose !== 'policy_review' || !blocked.has(id));
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
