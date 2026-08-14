import mongoose, { Document, Schema } from "mongoose";
import { PAYMENT_METHODS, PaymentMethod, REFUND_REASONS, RefundReason } from "../types/finance.types";

/**
 * Devolución de dinero ya cobrado.
 *
 * Vive aparte del pago a propósito: el pago ocurrió y no se borra ni se edita.
 * Si se tocara el `Payment`, la caja del mes en que entró la plata cambiaría hacia
 * atrás y el histórico dejaría de cuadrar con el banco. El reembolso es un asiento
 * nuevo con su propia fecha, y lo neto se calcula restando.
 */
export interface IRefund extends Document {
  _id: mongoose.Types.ObjectId;
  /** Pago devuelto. Opcional: a veces se devuelve contra la factura sin identificar el pago. */
  paymentId?: mongoose.Types.ObjectId | null;
  invoiceId?: mongoose.Types.ObjectId | null;
  clientId: mongoose.Types.ObjectId;
  clientName: string;
  period: string;

  amount: number;
  currency: string;
  refundedAt: Date;
  method: PaymentMethod;
  reference?: string;
  reason: RefundReason;
  notes?: string;

  receiptUrl?: string;
  receiptPublicId?: string;

  /** Garantía que terminó en devolución, si la hubo. */
  guaranteeId?: mongoose.Types.ObjectId | null;
  /** Si el reembolso vino acompañado de la baja del cliente. */
  archivedClient: boolean;

  registeredBy?: mongoose.Types.ObjectId;
  registeredByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const refundSchema = new Schema<IRefund>(
  {
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment", default: null, index: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", default: null, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    period: { type: String, required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    refundedAt: { type: Date, required: true, index: true },
    method: { type: String, enum: PAYMENT_METHODS, default: "transferencia" },
    reference: { type: String, trim: true },
    reason: { type: String, enum: REFUND_REASONS, required: true, index: true },
    notes: { type: String, trim: true },

    receiptUrl: { type: String },
    receiptPublicId: { type: String },

    guaranteeId: { type: Schema.Types.ObjectId, ref: "Guarantee", default: null, index: true },
    archivedClient: { type: Boolean, default: false },

    registeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    registeredByName: { type: String },
  },
  { timestamps: true, versionKey: false }
);

refundSchema.index({ clientId: 1, refundedAt: -1 });

export const Refund = mongoose.model<IRefund>("Refund", refundSchema);
