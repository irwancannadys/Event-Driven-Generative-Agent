import type { AgentId } from '@cafe/core';
import { transact, type Context, type Emit } from '../usecases/context';
import { freeAgent, writeDecided } from './decide';
import { kick } from './engine';
import { forecastProposal } from './forecast-flow';
import { emitProposal, lowStockProposal } from './restock-flow';
import { finishReviewByRules, pendingReviewDay } from './review-flow';

// A thought that was cut short (decision 037). A model that takes its time is asked after the question was
// written, and the answer is applied in a step of its own. If the server stops in between, the log has the
// question and the agent is still thinking. The next boot finishes the thought with the rules: it does not
// ask the model again (a boot, like a replay, never depends on one). Running it twice changes nothing: the
// agent is free after the first time.

interface OpenThink {
  id: number;
  purpose: string;
}

/** The last question of the agent that no decision points to. */
function openThink(ctx: Context, agent: AgentId): OpenThink | undefined {
  return ctx.db
    .prepare(
      `SELECT t.id, json_extract(t.payload_json, '$.purpose') AS purpose
       FROM events t
       WHERE t.type = 'agent_think_requested' AND t.actor = ?
         AND NOT EXISTS (
           SELECT 1 FROM events d
           WHERE d.type = 'agent_decided' AND json_extract(d.payload_json, '$.think_event_id') = t.id
         )
       ORDER BY t.id DESC LIMIT 1`,
    )
    .get(agent) as OpenThink | undefined;
}

function finishThought(ctx: Context, emit: Emit, agent: AgentId): void {
  const think = openThink(ctx, agent);
  if (think?.purpose === 'stock_proposal') {
    // What the rules would have her order now. When nothing is needed any more the thought is dropped.
    const proposal = lowStockProposal(ctx) ?? forecastProposal(ctx);
    if (proposal) {
      const decided = writeDecided(
        emit,
        { agent, purpose: 'stock_proposal' },
        think.id,
        'fallback',
        proposal,
        { fallback_reason: 'timeout' },
      );
      emitProposal(ctx, emit, decided);
    }
  } else if (think?.purpose === 'policy_review') {
    const day = pendingReviewDay(ctx);
    if (day !== undefined) finishReviewByRules(ctx, emit, day, think.id);
  }
  freeAgent(ctx, emit, agent);
  kick(ctx, emit, agent);
}

/** Finishes the thought of every agent that was thinking when the server stopped. Returns how many there were. */
export function recoverPendingThinks(ctx: Context): number {
  const thinking = ctx.db
    .prepare("SELECT id FROM agents WHERE state = 'thinking' ORDER BY id")
    .pluck()
    .all() as AgentId[];
  for (const agent of thinking) transact(ctx, (emit) => finishThought(ctx, emit, agent));
  return thinking.length;
}
