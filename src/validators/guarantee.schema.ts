import { z } from "zod";
import {
  GUARANTEE_OUTCOMES,
  GUARANTEE_STATUSES,
  REFUND_REASONS,
} from "../types/finance.types";
import {
  booleanish,
  objectIdSchema,
  paginationSchema,
  periodSchema,
} from "./common.schema";

export const openGuaranteeSchema = z.object({
  clientId: objectIdSchema,
  /** Mes que se regala. Si no viene, el siguiente al actual. */
  period: periodSchema.optional(),
  /** Mes que quedó sin resultados. Si no viene, el actual. */
  triggerPeriod: periodSchema.optional(),
  reason: z.string().trim().max(500).optional(),
});

export const extendGuaranteeSchema = z.object({
  period: periodSchema.optional(),
  resultNotes: z.string().trim().max(1000).optional(),
});

export const closeGuaranteeSchema = z.object({
  outcome: z.enum(GUARANTEE_OUTCOMES, { message: "Indica cómo termina la garantía" }),
  notes: z.string().trim().max(1000).optional(),
  archiveClient: booleanish.optional(),
  refund: z
    .object({
      paymentId: objectIdSchema.optional(),
      invoiceId: objectIdSchema.optional(),
      amount: z.coerce.number().positive("El monto del reembolso debe ser mayor a cero"),
      reason: z.enum(REFUND_REASONS).optional(),
      refundedAt: z.string().optional(),
      notes: z.string().trim().optional(),
    })
    .refine((data) => data.paymentId || data.invoiceId, {
      message: "Indica el pago o la factura que se está devolviendo",
      path: ["paymentId"],
    })
    .optional(),
});

export const guaranteeListSchema = z.object({
  clientId: objectIdSchema.optional(),
  status: z.enum(GUARANTEE_STATUSES).optional(),
  open: booleanish.optional(),
  ...paginationSchema,
});
