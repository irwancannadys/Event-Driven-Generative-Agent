import { readReport } from '../db/queries';
import { DomainError, transact, type Context } from './context';

/**
 * The boss decides on a report on his desk (the only input a human gives, brief section 4). The
 * characters react to `report_decided` in the same step: the stock admin places the order, the cashier
 * answers the customer.
 */
export function decideReport(
  ctx: Context,
  input: { report_id: number; decision: 'approved' | 'rejected' },
): void {
  const report = readReport(ctx.db, input.report_id);
  if (!report) {
    throw new DomainError('report_not_found', `report ${input.report_id} does not exist`);
  }
  if (report.status !== 'submitted') {
    throw new DomainError(
      'report_not_submitted',
      `report ${input.report_id} is ${report.status}: only a submitted report can be decided`,
    );
  }
  transact(ctx, (emit) => {
    emit({
      type: 'report_decided',
      actor: 'boss',
      origin: 'boss',
      payload: { report_id: input.report_id, decision: input.decision },
    });
  });
}
