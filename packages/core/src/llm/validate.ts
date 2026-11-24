import type { ZodIssue } from 'zod';
import { policyBounds } from '../rules/policy';
import { DECISION_SCHEMAS, type DecisionOf, type FallbackReason, type Purpose } from './contracts';

// Checks what a model answered before anything is done with it (brief section 7: a valid output is not
// necessarily a sensible one). First the shape, with the reason mapped to the fallback reasons of the
// catalog, then the answer against the live world: unknown ids, numbers out of range, a proposal that has
// become pointless while the model was thinking.

/** What the checks against the world need to know about one ingredient. */
export interface IngredientFacts {
  /** What is in stock now. */
  qty: number;
  capacity_qty: number;
  /** The minimum stock the cafe started with: a policy change is measured against it. */
  base_min_qty: number;
}

export interface ValidationWorld {
  ingredients: ReadonlyMap<string, IngredientFacts>;
  /** Ingredients that already have a proposal waiting or an order on its way: a proposal for them is stale. */
  covered?: ReadonlySet<string>;
  /** Ingredients that must not be proposed for a change of policy: one is pending, or a note says it did not help. */
  blocked?: ReadonlySet<string>;
}

export type Validation<P extends Purpose> =
  { ok: true; decision: DecisionOf<P> } | { ok: false; reason: FallbackReason; message: string };

const fail = (
  reason: FallbackReason,
  message: string,
): { ok: false; reason: FallbackReason; message: string } => ({
  ok: false,
  reason,
  message,
});

function reasonOf(issue: ZodIssue): FallbackReason {
  switch (issue.code) {
    case 'invalid_value':
      return 'invalid_enum';
    case 'too_big':
    case 'too_small': {
      const origin = (issue as { origin?: string }).origin;
      if (origin === 'string') return issue.code === 'too_big' ? 'too_long' : 'invalid_json';
      if (origin === 'number' || origin === 'int') return 'out_of_range';
      return 'invalid_json';
    }
    default:
      return 'invalid_json';
  }
}

function parseRaw(raw: unknown): { value: unknown } | { error: string } {
  if (typeof raw !== 'string') return { value: raw };
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { error: 'the answer is not valid JSON' };
  }
}

export function validateDecision<P extends Purpose>(
  purpose: P,
  raw: unknown,
  world: ValidationWorld,
): Validation<P> {
  const parsed = parseRaw(raw);
  if ('error' in parsed) return fail('invalid_json', parsed.error);
  if (typeof parsed.value !== 'object' || parsed.value === null) {
    return fail('invalid_json', 'the answer is not a JSON object');
  }

  const result = DECISION_SCHEMAS[purpose].safeParse(parsed.value);
  if (!result.success) {
    const [issue] = result.error.issues as [ZodIssue, ...ZodIssue[]];
    const where = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    return fail(reasonOf(issue), `${where}${issue.message}`);
  }
  const decision = result.data as DecisionOf<P>;

  const problem = checkAgainstWorld(purpose, decision, world);
  return problem ?? { ok: true, decision };
}

function checkAgainstWorld(
  purpose: Purpose,
  decision: unknown,
  world: ValidationWorld,
): { ok: false; reason: FallbackReason; message: string } | undefined {
  if (purpose === 'stock_proposal') {
    const { items } = decision as DecisionOf<'stock_proposal'>;
    for (const item of items) {
      const facts = world.ingredients.get(item.ingredient_id);
      if (!facts) return fail('unknown_id', `unknown ingredient "${item.ingredient_id}"`);
      if (world.covered?.has(item.ingredient_id)) {
        return fail(
          'stale',
          `"${item.ingredient_id}" is already covered by another proposal or order`,
        );
      }
      const room = facts.capacity_qty - facts.qty;
      if (item.qty > room) {
        return fail(
          'out_of_range',
          `${item.qty} of "${item.ingredient_id}" does not fit: only ${Math.max(0, room)} is room left on the shelf`,
        );
      }
    }
  }
  if (purpose === 'policy_review') {
    const { change } = decision as DecisionOf<'policy_review'>;
    if (change) {
      const facts = world.ingredients.get(change.ingredient_id);
      if (!facts) return fail('unknown_id', `unknown ingredient "${change.ingredient_id}"`);
      if (world.blocked?.has(change.ingredient_id)) {
        return fail(
          'out_of_range',
          `"${change.ingredient_id}" has a proposal waiting, or was tried before and did not help`,
        );
      }
      const bounds = policyBounds(facts.base_min_qty, facts.capacity_qty);
      if (change.min_qty < bounds.min || change.min_qty > bounds.max) {
        return fail(
          'out_of_range',
          `a minimum of ${change.min_qty} for "${change.ingredient_id}" is outside ${bounds.min} to ${bounds.max}`,
        );
      }
    }
  }
  return undefined;
}
