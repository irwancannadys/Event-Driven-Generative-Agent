import { DEFAULT_TEXT, TASK_DURATION_SEC, triageComplaint, type Compensation } from '@cafe/core';
import { readComplaint, readReport, type ReportRow } from '../db/queries';
import { nextId, type Context, type Emit } from '../usecases/context';
import { enqueueWork } from './engine';

// The complaint flow (decisions 022 and 024): the cashier notes a complaint, decides by the rule what
// to offer, and either answers at once or carries a report to the boss and answers once he decided.

/** A customer complains. The cashier notes it down. */
export function onComplaintReceived(ctx: Context, emit: Emit, complaintId: number): void {
  enqueueWork(ctx, emit, 'cashier', 'cashier', {
    label: 'noting_complaint',
    duration_sim_sec: TASK_DURATION_SEC.noting_complaint,
    ref: { type: 'complaint', id: complaintId },
  });
}

/**
 * The cashier has noted the complaint and decides what to offer. When compensation is involved the
 * boss has to agree, so a report goes to his desk. Otherwise she apologises right away.
 */
export function triageAndAnswer(ctx: Context, emit: Emit, complaintId: number): void {
  const complaint = readComplaint(ctx.db, complaintId);
  if (!complaint || complaint.status !== 'received') return;
  const waited = ctx.clock.now() - complaint.order_created_at_sim;
  const triage = triageComplaint(complaint.cause, waited, complaint.order_id);

  const think = emit({
    type: 'agent_think_requested',
    actor: 'cashier',
    origin: 'rule',
    payload: {
      agent_id: 'cashier',
      purpose: 'complaint_triage',
      subject: { complaint_id: complaintId },
    },
  });
  const { report: draftReport, ...decision } = triage;
  emit({
    type: 'agent_decided',
    actor: 'cashier',
    origin: 'rule',
    payload: {
      agent_id: 'cashier',
      purpose: 'complaint_triage',
      think_event_id: think.id,
      decision,
    },
  });

  if (draftReport) {
    const report_id = nextId(ctx.db, 'reports');
    emit({
      type: 'complaint_triaged',
      actor: 'cashier',
      origin: 'rule',
      payload: { complaint_id: complaintId, ...decision, report: { report_id, ...draftReport } },
    });
    enqueueWork(ctx, emit, 'cashier', 'boss_desk', {
      label: 'submitting_report',
      duration_sim_sec: TASK_DURATION_SEC.submitting_report,
      ref: { type: 'report', id: report_id },
    });
    return;
  }

  emit({
    type: 'complaint_triaged',
    actor: 'cashier',
    origin: 'rule',
    payload: { complaint_id: complaintId, ...decision },
  });
  reply(ctx, emit, complaintId, 'none');
}

/** The boss decided on a complaint report: the cashier goes back to her desk to answer the customer. */
export function onComplaintReportDecided(ctx: Context, emit: Emit, report: ReportRow): void {
  const complaintId = Number(report.subject.complaint_id);
  if (!Number.isInteger(complaintId)) return;
  enqueueWork(ctx, emit, 'cashier', 'cashier', {
    label: 'replying_customer',
    duration_sim_sec: TASK_DURATION_SEC.replying_customer,
    ref: { type: 'complaint', id: complaintId },
  });
}

/**
 * The cashier answers the customer. The compensation is what the boss approved, or nothing when he
 * said no.
 */
export function answerAfterDecision(ctx: Context, emit: Emit, complaintId: number): void {
  const complaint = readComplaint(ctx.db, complaintId);
  if (!complaint || complaint.status !== 'triaged') return;
  const report = complaint.report_id === null ? undefined : readReport(ctx.db, complaint.report_id);
  const approved = report?.status === 'approved';
  reply(ctx, emit, complaintId, approved ? (complaint.suggested_compensation ?? 'none') : 'none');
}

function reply(ctx: Context, emit: Emit, complaintId: number, compensation: Compensation): void {
  const complaint = readComplaint(ctx.db, complaintId);
  if (!complaint) return;
  emit({
    type: 'complaint_replied',
    actor: 'cashier',
    origin: 'rule',
    payload: {
      complaint_id: complaintId,
      compensation,
      reply_text: DEFAULT_TEXT.complaintReply(compensation, complaint.order_id),
    },
  });
}
