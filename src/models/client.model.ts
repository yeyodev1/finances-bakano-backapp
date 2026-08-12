import mongoose, { Document, Schema } from "mongoose";
import {
  ARCHIVE_REASONS,
  ArchiveReason,
  BILLING_TYPES,
  BillingType,
  PAYMENT_METHODS,
  PaymentMethod,
} from "../types/finance.types";

export interface IClientSplit {
  label?: string;
  amount: number;
  day?: number | null;
}

/** Adjunto de respaldo de una baja (captura de WhatsApp, correo, contrato…). */
export interface IClientAttachment {
  name: string;
  url: string;
  publicId?: string;
  mimeType?: string;
  size?: number;
  uploadedAt: Date;
}

/**
 * Acceso abierto por excepción: el cliente está en mora y su espacio debería estar
 * cerrado, pero se le deja entrar a propósito. Queda marcado en rojo en el dashboard
 * y el cron no lo vuelve a cerrar mientras la excepción siga vigente.
 */
export interface IAccessOverride {
  enabled: boolean;
  reason?: string;
  grantedAt?: Date | null;
  grantedBy?: mongoose.Types.ObjectId;
  grantedByName?: string;
  /** Vence la excepción. null = indefinida (hay que revocarla a mano). */
  until?: Date | null;
  revokedAt?: Date | null;
  revokedByName?: string;
}

/** Cada entrada del ciclo de vida: baja o reactivación. */
export interface IClientLifecycleEntry {
  action: "archived" | "reactivated";
  reason?: ArchiveReason;
  notes?: string;
  attachments: IClientAttachment[];
  /** Días que el cliente estuvo activo hasta este evento. */
  durationDays?: number;
  /** Total cobrado al cliente hasta este evento. */
  revenueToDate?: number;
  at: Date;
  by?: mongoose.Types.ObjectId;
  byName?: string;
}

export interface IClient extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  legalName?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;

  /** Monto mensual a cobrar (USD). 0 para clientes que no pagan. */
  amount: number;
  currency: string;

  /** Día del mes en que se emite la factura (1-31). null = no se emite. */
  issueDay?: number | null;
  /** Día del mes en que se cobra (1-31). null = sin fecha fija. */
  collectionDay?: number | null;
  /** Texto libre cuando el cobro no es un día fijo. Ej: "Último viernes laborable". */
  collectionDayLabel?: string;

  paymentMethod: PaymentMethod;
  billingType: BillingType;

  /** Cobros divididos dentro del mismo mes. Ej: dos pagos de $210. */
  splits: IClientSplit[];

  notes?: string;
  tags: string[];

  /** Vínculo con el espacio de trabajo en el backend de métricas. */
  workspaceId?: string;
  workspaceName?: string;
  /** Quién persigue el cobro de este cliente. Sin esto no se puede repartir la cobranza. */
  ownerId?: mongoose.Types.ObjectId | null;
  ownerName?: string;
  workspaceLinkedAt?: Date;
  /** Imagen del espacio traída de métricas (logo del cliente o foto de su página). */
  workspaceImageUrl?: string | null;
  /** Acceso abierto a propósito pese a la mora. */
  accessOverride: IAccessOverride;

  /** Si true, el cron puede desactivar el workspace por mora. */
  autoDeactivate: boolean;
  /** Override de días de gracia. null = usa el global de NotificationSetting. */
  graceDays?: number | null;

  /** Estado operativo del cliente en finanzas. */
  isActive: boolean;
  /** Estado del workspace remoto la última vez que se consultó/actualizó. */
  workspaceIsActive?: boolean | null;
  deactivatedAt?: Date | null;
  deactivationReason?: string;

  startDate: Date;
  endDate?: Date | null;

  /**
   * Primer período "YYYY-MM" que se factura. Sirve para el caso de "paga hoy pero
   * el servicio arranca el 1 del mes siguiente": la generación mensual ignora los
   * períodos anteriores a este.
   */
  billingStartPeriod?: string | null;

  // ── Baja (archivado): nunca se borra, se archiva ──────────────
  isArchived: boolean;
  archivedAt?: Date | null;
  archiveReason?: ArchiveReason | null;
  archiveNotes?: string;
  archiveAttachments: IClientAttachment[];
  archivedBy?: mongoose.Types.ObjectId;
  /** Días que duró el cliente (startDate → archivedAt). Se calcula al archivar. */
  lifetimeDays?: number | null;
  /** Total cobrado al cliente durante toda su vida. Snapshot al archivar. */
  lifetimeRevenue?: number | null;
  /** Historial completo de bajas y reactivaciones. */
  lifecycleHistory: IClientLifecycleEntry[];

  stripeCustomerId?: string;
  stripeSubscriptionId?: string;

  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const splitSchema = new Schema<IClientSplit>(
  {
    label: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    day: { type: Number, min: 1, max: 31, default: null },
  },
  { _id: false }
);

const attachmentSchema = new Schema<IClientAttachment>(
  {
    name: { type: String, required: true },
    url: { type: String, required: true },
    publicId: { type: String },
    mimeType: { type: String },
    size: { type: Number },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

const accessOverrideSchema = new Schema<IAccessOverride>(
  {
    enabled: { type: Boolean, default: false },
    reason: { type: String, trim: true },
    grantedAt: { type: Date, default: null },
    grantedBy: { type: Schema.Types.ObjectId, ref: "User" },
    grantedByName: { type: String },
    until: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedByName: { type: String },
  },
  { _id: false }
);

const lifecycleSchema = new Schema<IClientLifecycleEntry>(
  {
    action: { type: String, enum: ["archived", "reactivated"], required: true },
    reason: { type: String, enum: ARCHIVE_REASONS },
    notes: { type: String, trim: true },
    attachments: { type: [attachmentSchema], default: [] },
    durationDays: { type: Number },
    revenueToDate: { type: Number },
    at: { type: Date, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String },
  },
  { _id: false }
);

const clientSchema = new Schema<IClient>(
  {
    name: { type: String, required: true, trim: true, index: true },
    legalName: { type: String, trim: true },
    contactName: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },

    amount: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, default: "USD" },

    issueDay: { type: Number, min: 1, max: 31, default: null },
    collectionDay: { type: Number, min: 1, max: 31, default: null },
    collectionDayLabel: { type: String, trim: true },

    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: "transferencia",
    },
    billingType: {
      type: String,
      enum: BILLING_TYPES,
      default: "monthly",
    },

    splits: { type: [splitSchema], default: [] },

    notes: { type: String, trim: true },
    tags: { type: [String], default: [] },

    workspaceId: { type: String, default: null, index: true },
    workspaceName: { type: String, default: null },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    ownerName: { type: String, default: null },
    workspaceLinkedAt: { type: Date, default: null },
    workspaceImageUrl: { type: String, default: null },
    accessOverride: { type: accessOverrideSchema, default: () => ({ enabled: false }) },

    autoDeactivate: { type: Boolean, default: true },
    graceDays: { type: Number, default: null, min: 0 },

    isActive: { type: Boolean, default: true, index: true },
    workspaceIsActive: { type: Boolean, default: null },
    deactivatedAt: { type: Date, default: null },
    deactivationReason: { type: String },

    startDate: { type: Date, default: () => new Date() },
    endDate: { type: Date, default: null },
    billingStartPeriod: { type: String, default: null },

    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archiveReason: { type: String, enum: ARCHIVE_REASONS, default: null },
    archiveNotes: { type: String, trim: true },
    archiveAttachments: { type: [attachmentSchema], default: [] },
    archivedBy: { type: Schema.Types.ObjectId, ref: "User" },
    lifetimeDays: { type: Number, default: null },
    lifetimeRevenue: { type: Number, default: null },
    lifecycleHistory: { type: [lifecycleSchema], default: [] },

    stripeCustomerId: { type: String, default: null },
    stripeSubscriptionId: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false }
);

clientSchema.index({ name: "text", legalName: "text", notes: "text" });

export const Client = mongoose.model<IClient>("Client", clientSchema);
