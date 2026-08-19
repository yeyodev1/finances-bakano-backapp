import mongoose, { Document, Schema } from "mongoose";
import { PAYMENT_METHODS, PAYMENT_SOURCES, PaymentMethod, PaymentSource } from "../types/finance.types";

export interface IPayment extends Document {
  _id: mongoose.Types.ObjectId;
  invoiceId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  clientName: string;
  period: string;

  amount: number;
  currency: string;
  paidAt: Date;
  method: PaymentMethod;
  reference?: string;
  notes?: string;

  receiptUrl?: string;
  receiptPublicId?: string;

  source: PaymentSource;
  /** ch_... de Stripe. Barrera de idempotencia: un cargo nunca genera dos pagos. */
  stripeChargeId?: string;
  /** Transferencias internacionales: lo que envió el cliente y lo que se comió el banco. */
  grossAmount?: number;
  feeAmount?: number;

  registeredBy?: mongoose.Types.ObjectId;
  registeredByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    period: { type: String, required: true, index: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    paidAt: { type: Date, required: true, index: true },
    method: { type: String, enum: PAYMENT_METHODS, default: "transferencia" },
    reference: { type: String, trim: true },
    notes: { type: String, trim: true },

    receiptUrl: { type: String },
    receiptPublicId: { type: String },

    source: { type: String, enum: PAYMENT_SOURCES, default: "manual" },
    stripeChargeId: { type: String, unique: true, sparse: true },
    grossAmount: { type: Number, min: 0 },
    feeAmount: { type: Number, min: 0 },

    registeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    registeredByName: { type: String },
  },
  { timestamps: true, versionKey: false }
);

export const Payment = mongoose.model<IPayment>("Payment", paymentSchema);
