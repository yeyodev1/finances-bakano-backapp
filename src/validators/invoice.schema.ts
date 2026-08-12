import { z } from "zod";
import { INVOICE_STATUSES } from "../types/finance.types";
import {
  booleanish,
  dateSchema,
  objectIdSchema,
  paginationSchema,
  periodSchema,
} from "./common.schema";

export const invoiceListSchema = z.object({
  period: periodSchema.optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  clientId: objectIdSchema.optional(),
  ownerId: objectIdSchema.optional(),
  q: z.string().trim().optional(),
  overdueOnly: booleanish.optional(),
  deferredOnly: booleanish.optional(),
  advanceOnly: booleanish.optional(),
  ...paginationSchema,
});

export const invoiceSummarySchema = z.object({
  period: periodSchema,
});

export const generateInvoicesSchema = z.object({
  period: periodSchema,
  clientIds: z.array(objectIdSchema).optional(),
  force: z.boolean().optional(),
});

export const updateInvoiceSchema = z.object({
  amount: z.number().min(0).optional(),
  dueDate: dateSchema.optional(),
  issueDate: dateSchema.nullable().optional(),
  notes: z.string().trim().optional(),
  splitLabel: z.string().trim().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
});

export const invoiceReasonSchema = z.object({
  reason: z.string().trim().min(3, "Debes indicar un motivo"),
});

/** Prórroga: acuerdo de pago que mueve el vencimiento de una sola factura. */
export const deferInvoiceSchema = z.object({
  newDueDate: dateSchema,
  reason: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
});

/** Cobro anticipado de un período futuro (o del actual). */
export const advanceInvoiceSchema = z.object({
  clientId: objectIdSchema,
  period: periodSchema,
  amount: z.coerce.number().positive("El monto debe ser mayor a cero").optional(),
  dueDate: dateSchema.optional(),
  splitIndex: z.coerce.number().int().min(0).optional(),
  notes: z.string().trim().max(1000).optional(),
});
