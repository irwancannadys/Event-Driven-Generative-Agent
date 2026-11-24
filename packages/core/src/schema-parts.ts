import { z } from 'zod';

// Building blocks shared by event payloads and LLM decisions.

/** Integer virtual seconds since day 0 at 00:00. */
export const SimTimeSchema = z.number().int().nonnegative();

/** Entity ids created by events (orders, reports, tasks, ...). */
export const EntityIdSchema = z.number().int().positive();

/** Stock quantity (g, ml, pcs). Always an integer. */
export const QtySchema = z.number().int().nonnegative();
export const PositiveQtySchema = z.number().int().positive();

export const StockLineSchema = z.object({
  ingredient_id: z.string().min(1),
  qty: PositiveQtySchema,
});
export type StockLine = z.infer<typeof StockLineSchema>;

/** One line of an order: a menu item and how many portions. */
export const OrderItemSchema = z.object({
  menu_item_id: z.string().min(1),
  qty: z.number().int().positive(),
});
export type OrderItem = z.infer<typeof OrderItemSchema>;

export const UrgencySchema = z.enum(['low', 'normal', 'high']);
export const CompensationSchema = z.enum(['none', 'discount_10', 'free_item']);
export type Compensation = z.infer<typeof CompensationSchema>;

export const ComplaintCauseSchema = z.enum(['slow_service', 'wrong_order', 'quality']);
export const ComplaintCategorySchema = z.enum(['slow_service', 'wrong_order', 'quality', 'other']);
export const SeveritySchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

/** A report created by an event; the human-readable text is stored as a final string. */
export const ReportDraftSchema = z.object({
  report_id: EntityIdSchema,
  title: z.string().min(1),
  body: z.string().min(1),
});
export type ReportDraft = z.infer<typeof ReportDraftSchema>;
