import mongoose, { Document, Schema } from "mongoose";
import {
  SALE_FREQUENCIES,
  SALE_INSTALLMENT_STATUSES,
  SALE_ITEM_KINDS,
  SALE_LOST_REASONS,
  SALE_STATUSES,
  SaleFrequency,
  SaleInstallmentStatus,
  SaleItemKind,
  SaleLostReason,
  SaleStatus,
} from "../types/finance.types";

/** Un concepto de lo vendido: qué es, qué incluye y a qué precio se cerró. */
export interface ISaleItem {
  concept: string;
  description?: string;
  amount: number;
  kind: SaleItemKind;
}

/**
 * Datos de facturación del acuerdo. Van en la venta y no en el cliente porque
 * quien cobra suele no ser quien vendió, y necesita el RUC y la razón social a
 * mano sin ir a buscarlos.
 */
export interface ISaleBilling {
  needsInvoice: boolean;
  legalName?: string;
  taxId?: string;
  email?: string;
  address?: string;
  phone?: string;
  invoiceNumber?: string;
  issuedAt?: Date | null;
  notes?: string;
}

/**
 * Una cuota del acuerdo. Se guarda embebida y no como factura porque la venta
 * se cierra antes de que exista el cliente: la factura solo aparece cuando el
 * cobro se hace efectivo.
 */
export interface ISaleInstallment {
  index: number;
  dueDate: Date;
  amount: number;
  status: SaleInstallmentStatus;
  paidAt?: Date | null;
  paidAmount: number;
  /** Fecha original antes de moverla. Deja rastro de la reprogramación. */
  originalDueDate?: Date | null;
  notes?: string;
}

export interface ISaleHistoryEntry {
  action: string;
  detail?: string;
  at: Date;
  by?: mongoose.Types.ObjectId;
  byName?: string;
  meta?: Record<string, unknown>;
}

export interface ISale extends Document {
  _id: mongoose.Types.ObjectId;
  /** Nombre del negocio. Obligatorio: al cerrar puede no existir el cliente aún. */
  businessName: string;
  /** Se enlaza cuando el prospecto ya es (o pasa a ser) cliente. */
  clientId?: mongoose.Types.ObjectId | null;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;

  /** Total acordado. Si hay conceptos, es su suma. */
  amount: number;
  items: ISaleItem[];
  billing: ISaleBilling;
  currency: string;
  frequency: SaleFrequency;
  installmentsCount: number;
  firstChargeDate: Date;
  installments: ISaleInstallment[];

  /** Quién cerró la venta y quién tiene que cobrarla. Pueden ser distintos. */
  soldBy: mongoose.Types.ObjectId;
  soldByName?: string;
  ownerId: mongoose.Types.ObjectId;
  ownerName?: string;

  agreedAt: Date;
  status: SaleStatus;
  lostReason?: SaleLostReason | null;
  lostNotes?: string;
  lostAt?: Date | null;

  notes?: string;
  history: ISaleHistoryEntry[];
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const installmentSchema = new Schema<ISaleInstallment>(
  {
    index: { type: Number, required: true },
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: SALE_INSTALLMENT_STATUSES, default: "pendiente" },
    paidAt: { type: Date, default: null },
    paidAmount: { type: Number, default: 0, min: 0 },
    originalDueDate: { type: Date, default: null },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const itemSchema = new Schema<ISaleItem>(
  {
    concept: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    amount: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: SALE_ITEM_KINDS, default: "unico" },
  },
  { _id: false }
);

const billingSchema = new Schema<ISaleBilling>(
  {
    needsInvoice: { type: Boolean, default: false },
    legalName: { type: String, trim: true },
    taxId: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },
    phone: { type: String, trim: true },
    invoiceNumber: { type: String, trim: true },
    issuedAt: { type: Date, default: null },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const historySchema = new Schema<ISaleHistoryEntry>(
  {
    action: { type: String, required: true },
    detail: { type: String, trim: true },
    at: { type: Date, default: () => new Date() },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String },
    meta: { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const saleSchema = new Schema<ISale>(
  {
    businessName: { type: String, required: true, trim: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", default: null, index: true },
    contactName: { type: String, trim: true },
    contactEmail: { type: String, trim: true, lowercase: true },
    contactPhone: { type: String, trim: true },

    amount: { type: Number, required: true, min: 0 },
    items: { type: [itemSchema], default: [] },
    billing: { type: billingSchema, default: () => ({ needsInvoice: false }) },
    currency: { type: String, default: "USD" },
    frequency: { type: String, enum: SALE_FREQUENCIES, default: "unico" },
    installmentsCount: { type: Number, default: 1, min: 1 },
    firstChargeDate: { type: Date, required: true },
    installments: { type: [installmentSchema], default: [] },

    soldBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    soldByName: { type: String },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ownerName: { type: String },

    agreedAt: { type: Date, default: () => new Date(), index: true },
    status: { type: String, enum: SALE_STATUSES, default: "acordada", index: true },
    lostReason: { type: String, enum: SALE_LOST_REASONS, default: null },
    lostNotes: { type: String, trim: true },
    lostAt: { type: Date, default: null },

    notes: { type: String, trim: true },
    history: { type: [historySchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, versionKey: false }
);

// El listado por defecto ordena por próxima fecha de cobro dentro de cada estado.
saleSchema.index({ status: 1, firstChargeDate: 1 });

export const Sale = mongoose.model<ISale>("Sale", saleSchema);
