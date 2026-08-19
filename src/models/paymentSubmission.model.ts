import mongoose, { Document, Schema } from "mongoose";

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending: "En verificación",
  approved: "Aprobado",
  rejected: "Rechazado",
};

/**
 * Comprobante de transferencia subido por el CLIENTE desde el portal de metrics.
 * Es un flujo de aprobación, no un pago: el Payment real recién existe cuando un
 * admin aprueba. El fee bancario lo asume el cliente, así que el pago se aplica
 * por `netAmount` y la factura puede quedar parcial.
 */
export interface IPaymentSubmission extends Document {
  _id: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  clientName: string;
  workspaceId: string;
  invoiceId?: mongoose.Types.ObjectId | null;

  grossAmount: number;
  feeAmount: number;
  netAmount: number;
  currency: string;

  receiptUrl: string;
  receiptPublicId: string;

  status: SubmissionStatus;
  /** SLA visible para el cliente: 48 horas laborables desde que subió. */
  reviewDueAt: Date;

  submittedByName?: string;
  submittedByEmail?: string;

  reviewedBy?: mongoose.Types.ObjectId;
  reviewedByName?: string;
  reviewedAt?: Date;
  reviewNote?: string;
  paymentId?: mongoose.Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const paymentSubmissionSchema = new Schema<IPaymentSubmission>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    workspaceId: { type: String, required: true, index: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", default: null },

    grossAmount: { type: Number, required: true, min: 0.01 },
    feeAmount: { type: Number, required: true, min: 0, default: 0 },
    netAmount: { type: Number, required: true, min: 0.01 },
    currency: { type: String, default: "USD" },

    receiptUrl: { type: String, required: true },
    receiptPublicId: { type: String, required: true },

    status: { type: String, enum: SUBMISSION_STATUSES, default: "pending", index: true },
    reviewDueAt: { type: Date, required: true },

    submittedByName: { type: String, trim: true },
    submittedByEmail: { type: String, trim: true },

    reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reviewedByName: { type: String },
    reviewedAt: { type: Date },
    reviewNote: { type: String, trim: true },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
  },
  { timestamps: true, versionKey: false }
);

paymentSubmissionSchema.index({ clientId: 1, status: 1 });

export const PaymentSubmission = mongoose.model<IPaymentSubmission>(
  "PaymentSubmission",
  paymentSubmissionSchema
);
