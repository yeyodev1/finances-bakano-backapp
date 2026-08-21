import { z } from "zod";
import {
  SALE_FREQUENCIES,
  SALE_ITEM_KINDS,
  SALE_LOST_REASONS,
  SALE_STATUSES,
} from "../types/finance.types";
import { booleanish, dateSchema, objectIdSchema, paginationSchema, periodSchema } from "./common.schema";

/** Un concepto vendido: qué es, qué incluye y a qué precio se cerró. */
export const saleItemSchema = z.object({
  concept: z.string().trim().min(2, "El concepto necesita un nombre."),
  description: z.string().trim().max(500).optional(),
  amount: z.coerce.number().positive("El monto del concepto debe ser mayor a cero."),
  kind: z.enum(SALE_ITEM_KINDS),
});

/** Datos de facturación. Todo opcional: se completan cuando se tienen a mano. */
export const saleBillingSchema = z.object({
  needsInvoice: z.boolean().optional(),
  legalName: z.string().trim().max(200).optional(),
  taxId: z.string().trim().max(30).optional(),
  email: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
  address: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
  invoiceNumber: z.string().trim().max(60).optional(),
  issuedAt: dateSchema.nullable().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const updateSaleItemsSchema = z.object({
  items: z.array(saleItemSchema).min(1, "Indica al menos un concepto."),
});

export const saleListSchema = z.object({
  status: z.enum(SALE_STATUSES).optional(),
  ownerId: objectIdSchema.optional(),
  soldBy: objectIdSchema.optional(),
  clientId: objectIdSchema.optional(),
  categoryId: objectIdSchema.optional(),
  uncategorized: booleanish.optional(),
  q: z.string().trim().optional(),
  overdueOnly: booleanish.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  ...paginationSchema,
});

export const createSaleSchema = z
  .object({
    businessName: z.string().trim().min(2, "Indica el nombre del negocio."),
    clientId: objectIdSchema.nullable().optional(),
    categoryId: objectIdSchema.nullable().optional(),
    contactName: z.string().trim().optional(),
    contactEmail: z.string().trim().email("Correo inválido").optional().or(z.literal("")),
    contactPhone: z.string().trim().optional(),
    /** Con conceptos el total sale de su suma; sin ellos manda `amount`. */
    items: z.array(saleItemSchema).optional(),
    billing: saleBillingSchema.optional(),
    amount: z.coerce.number().positive("El monto acordado debe ser mayor a cero.").optional(),
    currency: z.string().trim().optional(),
    frequency: z.enum(SALE_FREQUENCIES),
    installmentsCount: z.coerce.number().int().min(1).max(60).optional(),
    firstChargeDate: dateSchema,
    soldBy: objectIdSchema,
    ownerId: objectIdSchema,
    agreedAt: dateSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((data) => data.frequency === "unico" || (data.installmentsCount ?? 1) >= 1, {
    message: "Indica en cuántos cobros se divide.",
    path: ["installmentsCount"],
  })
  .refine((data) => data.items?.length || (data.amount ?? 0) > 0, {
    message: "Indica el monto acordado o al menos un concepto vendido.",
    path: ["amount"],
  });

export const payInstallmentSchema = z.object({
  amount: z.coerce.number().positive("El monto cobrado debe ser mayor a cero.").optional(),
  paidAt: dateSchema.optional(),
  notes: z.string().trim().max(500).optional(),
});

export const rescheduleInstallmentSchema = z.object({
  newDueDate: dateSchema,
  reason: z.string().trim().max(200).optional(),
});

export const changeSaleOwnerSchema = z.object({
  ownerId: objectIdSchema,
});

/** `null` deja la venta sin tipo de cliente. */
export const changeSaleCategorySchema = z.object({
  categoryId: objectIdSchema.nullable(),
});

export const goalPeriodParamSchema = z.object({ period: periodSchema });

export const saveSaleGoalSchema = z.object({
  lines: z
    .array(
      z.object({
        categoryId: objectIdSchema,
        targetCount: z.coerce.number().int().min(0).max(10000).optional(),
        perClientAmount: z.coerce.number().min(0).optional(),
        targetAmount: z.coerce.number().min(0).optional(),
        notes: z.string().trim().max(300).optional(),
      })
    )
    .max(50),
  notes: z.string().trim().max(1000).optional(),
});

export const loseSaleSchema = z.object({
  reason: z.enum(SALE_LOST_REASONS, { message: "Debes indicar por qué se perdió la venta." }),
  notes: z.string().trim().max(1000).optional(),
  lostAt: dateSchema.optional(),
});

export const saleSummarySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
});

export const installmentParamSchema = z.object({
  id: objectIdSchema,
  index: z.coerce.number().int().min(0),
});
