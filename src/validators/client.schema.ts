import { z } from "zod";
import { ARCHIVE_REASONS, BILLING_TYPES, PAYMENT_METHODS } from "../types/finance.types";
import { booleanish, dateSchema, objectIdSchema, paginationSchema } from "./common.schema";

const dayOfMonth = z.number().int().min(1).max(31).nullable();

const splitSchema = z.object({
  label: z.string().trim().optional(),
  amount: z.number().min(0, "El monto del split no puede ser negativo"),
  day: dayOfMonth.optional(),
});

export const clientListSchema = z.object({
  q: z.string().trim().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  billingType: z.enum(BILLING_TYPES).optional(),
  isActive: booleanish.optional(),
  hasWorkspace: booleanish.optional(),
  archived: z.enum(["true", "false", "all"]).optional(),
  tag: z.string().trim().optional(),
  ownerId: objectIdSchema.optional(),
  categoryId: objectIdSchema.optional(),
  sort: z.string().trim().optional(),
  ...paginationSchema,
});

export const createClientSchema = z.object({
  name: z.string().trim().min(2, "El nombre del cliente es obligatorio"),
  legalName: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  contactEmail: z.string().trim().email("Correo de contacto inválido").optional().or(z.literal("")),
  contactPhone: z.string().trim().optional(),
  amount: z.number().min(0, "El monto no puede ser negativo").default(0),
  currency: z.string().trim().optional(),
  issueDay: dayOfMonth.optional(),
  collectionDay: dayOfMonth.optional(),
  collectionDayLabel: z.string().trim().optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  billingType: z.enum(BILLING_TYPES).optional(),
  splits: z.array(splitSchema).optional(),
  notes: z.string().trim().optional(),
  tags: z.array(z.string().trim()).optional(),
  autoDeactivate: z.boolean().optional(),
  graceDays: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
  /** Usuario que persigue el cobro de este cliente. */
  ownerId: objectIdSchema.nullable().optional(),
  /** Rubro del cliente. Las categorías se crean desde la app, no están fijas. */
  categoryId: objectIdSchema.nullable().optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.nullable().optional(),
  stripeCustomerId: z.string().trim().optional(),
  stripeSubscriptionId: z.string().trim().optional(),
});

export const updateClientSchema = createClientSchema.partial();

export const toggleClientActiveSchema = z.object({
  isActive: z.boolean(),
  reason: z.string().trim().optional(),
});

export const linkWorkspaceSchema = z.object({
  workspaceId: z.string().trim().min(1, "El workspaceId es obligatorio"),
  workspaceName: z.string().trim().optional(),
});

export const backfillSchema = z.object({
  fromDate: dateSchema,
  markPaidUntil: dateSchema.nullable().optional(),
});

export const clientCategorySchema = z.object({
  name: z.string().trim().min(2, "El nombre de la categoría es muy corto."),
  color: z.string().trim().max(30).optional(),
  icon: z.string().trim().max(60).optional(),
  description: z.string().trim().max(300).optional(),
  isActive: z.boolean().optional(),
});

export const clientIdParamSchema = z.object({ id: objectIdSchema });

/** Con multipart los campos llegan como strings, por eso no se coercen números aquí. */
export const archiveClientSchema = z.object({
  reason: z.enum(ARCHIVE_REASONS, { message: "Debes indicar el motivo de la baja." }),
  notes: z.string().trim().optional(),
  /** Fecha real de la baja. Si se omite se usa hoy. */
  archivedAt: dateSchema.optional(),
});

/**
 * Corrección de las fechas del ciclo de vida por parte de la project manager.
 * Se aceptan por separado porque casi siempre se corrige una sola.
 */
export const lifecycleDatesSchema = z
  .object({
    startDate: dateSchema.optional(),
    archivedAt: dateSchema.optional(),
  })
  .refine((data) => data.startDate || data.archivedAt, {
    message: "Indica al menos una fecha para corregir.",
  });

export const reactivateClientSchema = z.object({
  notes: z.string().trim().optional(),
});

/** Abrir el acceso a un moroso: el motivo es obligatorio y queda en el audit log. */
export const grantAccessSchema = z.object({
  reason: z
    .string({ message: "Debes indicar por qué se abre el acceso." })
    .trim()
    .min(3, "Debes indicar por qué se abre el acceso."),
  until: dateSchema.nullable().optional(),
});

export const revokeAccessSchema = z.object({
  closeWorkspace: booleanish.optional(),
});
