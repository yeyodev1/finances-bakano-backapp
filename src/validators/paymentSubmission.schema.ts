import { z } from "zod";
import { SUBMISSION_STATUSES } from "../models/paymentSubmission.model";
import { objectIdSchema, paginationSchema } from "./common.schema";

export const submissionListSchema = z.object({
  status: z.enum(SUBMISSION_STATUSES).optional(),
  clientId: objectIdSchema.optional(),
  ...paginationSchema,
});

export const approveSubmissionSchema = z.object({
  invoiceId: objectIdSchema.optional(),
  reviewNote: z.string().trim().optional(),
});

export const rejectSubmissionSchema = z.object({
  reviewNote: z.string().trim().min(3, "El rechazo necesita un motivo para el cliente"),
});

/** Lo que llega del portal vía proxy de metrics (multipart, campos como texto). */
export const portalSubmitSchema = z.object({
  invoiceId: objectIdSchema.optional(),
  grossAmount: z.coerce.number().positive("El monto enviado debe ser mayor a cero"),
  feeAmount: z.coerce.number().min(0).optional(),
  submittedByName: z.string().trim().max(120).optional(),
  submittedByEmail: z.string().trim().email().optional(),
});

export const portalCheckoutSchema = z.object({
  invoiceId: objectIdSchema,
  returnUrl: z.string().trim().url("returnUrl debe ser una URL válida"),
});

export const portalCardUpdateSchema = z.object({
  returnUrl: z.string().trim().url("returnUrl debe ser una URL válida"),
});
