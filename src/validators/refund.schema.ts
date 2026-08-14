import { z } from "zod";
import { PAYMENT_METHODS, REFUND_REASONS } from "../types/finance.types";
import {
  booleanish,
  dateSchema,
  objectIdSchema,
  paginationSchema,
  periodSchema,
} from "./common.schema";

/**
 * Se acepta el pago o la factura, pero uno de los dos tiene que venir: sin origen
 * no hay contra qué validar el monto y se podría devolver más de lo cobrado.
 */
export const registerRefundSchema = z
  .object({
    paymentId: objectIdSchema.optional(),
    invoiceId: objectIdSchema.optional(),
    amount: z.coerce.number().positive("El monto del reembolso debe ser mayor a cero"),
    reason: z.enum(REFUND_REASONS, { message: "Debes indicar el motivo del reembolso" }),
    refundedAt: dateSchema.optional(),
    method: z.enum(PAYMENT_METHODS).optional(),
    reference: z.string().trim().optional(),
    notes: z.string().trim().optional(),
    archiveClient: booleanish.optional(),
    archiveNotes: z.string().trim().optional(),
  })
  .refine((data) => data.paymentId || data.invoiceId, {
    message: "Indica el pago o la factura que se está devolviendo",
    path: ["paymentId"],
  });

export const refundListSchema = z.object({
  clientId: objectIdSchema.optional(),
  period: periodSchema.optional(),
  reason: z.enum(REFUND_REASONS).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  ...paginationSchema,
});

export const clientIdParamSchema = z.object({ clientId: objectIdSchema });
