import { z } from "zod";
import { PAYMENT_METHODS } from "../types/finance.types";
import { dateSchema, objectIdSchema, paginationSchema, periodSchema } from "./common.schema";

/** Un pago que se reparte entre los cobros abiertos de un cliente. */
export const settlePaymentSchema = z.object({
  clientId: objectIdSchema,
  amount: z.coerce.number().positive("El monto del pago debe ser mayor a cero"),
  paidAt: dateSchema.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  /** Si se omite, se reparte entre todos los cobros abiertos del cliente. */
  invoiceIds: z.array(objectIdSchema).optional(),
});

export const paymentListSchema = z.object({
  clientId: objectIdSchema.optional(),
  period: periodSchema.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  ...paginationSchema,
});

export const registerPaymentSchema = z.object({
  invoiceId: objectIdSchema,
  amount: z.coerce.number().positive("El monto debe ser mayor a cero"),
  paidAt: dateSchema.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});
