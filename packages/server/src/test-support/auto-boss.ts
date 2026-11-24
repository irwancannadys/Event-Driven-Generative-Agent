import type { SimTime } from '@cafe/core';
import { readReports, type ReportRow } from '../db/queries';
import type { Simulation } from '../sim/simulation';
import { decideReport } from '../usecases/reports';

// The boss, played by the computer. Only for tests and demos: in the real world the boss is a human
// who clicks (brief section 4: no manual triggers, the boss only approves or rejects).

export interface AutoBossOptions {
  /** How long a report lies on the desk before the boss decides, in virtual seconds. Default 10 minutes. */
  delaySec?: number;
  /** What the boss says. Default: approve everything. */
  decide?: (report: ReportRow) => 'approved' | 'rejected';
}

const DEFAULT_DELAY_SEC = 600;
/** The boss looks at his desk on every full virtual minute. */
const LOOK_EVERY_SEC = 60;

/**
 * It keeps no state of its own: it reads the reports on the desk from the database. So a restart in the
 * middle changes nothing. The boss only looks at his desk at fixed moments of the virtual day (every
 * full minute), wherever a call to `advanceTo` starts or stops, so he decides at the same moments
 * however the time is cut into steps.
 */
export class AutoBoss {
  private readonly delaySec: number;
  private readonly decide: NonNullable<AutoBossOptions['decide']>;

  constructor(
    private readonly sim: Simulation,
    options: AutoBossOptions = {},
  ) {
    this.delaySec = options.delaySec ?? DEFAULT_DELAY_SEC;
    this.decide = options.decide ?? (() => 'approved');
  }

  /** Moves the clock to `target`, deciding on the reports whose time on the desk is over on the way. */
  advanceTo(target: SimTime): void {
    const { clock } = this.sim;
    while (clock.now() < target) {
      const nextLook = (Math.floor(clock.now() / LOOK_EVERY_SEC) + 1) * LOOK_EVERY_SEC;
      clock.advance(Math.min(target, nextLook) - clock.now());
      if (clock.now() % LOOK_EVERY_SEC === 0) this.lookAtDesk();
    }
  }

  private lookAtDesk(): void {
    const { ctx, clock } = this.sim;
    for (const report of readReports(ctx.db, 'submitted')) {
      if ((report.submitted_at_sim ?? clock.now()) + this.delaySec <= clock.now()) {
        decideReport(ctx, { report_id: report.id, decision: this.decide(report) });
      }
    }
  }
}
