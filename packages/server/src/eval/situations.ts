import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ValidationWorld } from '@cafe/core';

// The situations a model is evaluated on (stage 6): what the stock admin is asked, and the world the answer is
// checked against. They come from simulated days (`make-situations.ts`), so that the model is judged on what the
// cafe really asks of it, and they are kept in a file so that every model gets the same questions.

const PurposeOfSituation = z.enum(['stock_proposal', 'policy_review']);

export const SituationSchema = z.object({
  id: z.string().min(1),
  purpose: PurposeOfSituation,
  /** What the situation is, for the person who reads the report of an evaluation. */
  note: z.string(),
  request: z.object({
    purpose: PurposeOfSituation,
    context: z.string().min(1),
    facts: z.record(z.string(), z.unknown()),
  }),
  world: z.object({
    ingredients: z.record(
      z.string(),
      z.object({ qty: z.number(), capacity_qty: z.number(), base_min_qty: z.number() }),
    ),
    covered: z.array(z.string()),
    blocked: z.array(z.string()),
  }),
});
export type Situation = z.infer<typeof SituationSchema>;

export const SituationsFileSchema = z.object({
  version: z.literal(1),
  generated_by: z.string(),
  situations: z.array(SituationSchema).min(1),
});

/** The world of a situation in the shape the checks want. */
export function toWorld(situation: Situation): ValidationWorld {
  return {
    ingredients: new Map(Object.entries(situation.world.ingredients)),
    covered: new Set(situation.world.covered),
    blocked: new Set(situation.world.blocked),
  };
}

export const SITUATIONS_FILE = 'eval/llm-situations.json';

export function parseSituations(text: string): Situation[] {
  const parsed = SituationsFileSchema.parse(JSON.parse(text));
  const ids = parsed.situations.map((situation) => situation.id);
  if (new Set(ids).size !== ids.length) throw new Error('two situations have the same id');
  return parsed.situations;
}

export function loadSituations(repoRoot: string): Situation[] {
  return parseSituations(readFileSync(path.join(repoRoot, SITUATIONS_FILE), 'utf8'));
}
