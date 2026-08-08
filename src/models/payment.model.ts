import mongoose, { Document, Schema } from "mongoose";
import { PAYMENT_METHODS, PaymentMethod } from "../types/finance.types";

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

    registeredBy: { type: Schema.Types.ObjectId, ref: "User" },
    registeredByName: { type: String },
  },
  { timestamps: true, versionKey: false }
);

export const Payment = mongoose.model<IPayment>("Payment", paymentSchema);
