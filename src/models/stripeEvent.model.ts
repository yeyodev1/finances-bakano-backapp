import mongoose, { Document, Schema } from "mongoose";

export const STRIPE_EVENT_OUTCOMES = ["processed", "skipped", "unmatched", "failed"] as const;
export type StripeEventOutcome = (typeof STRIPE_EVENT_OUTCOMES)[number];

/**
 * Registro de cada evento recibido del webhook de Stripe. El índice único en
 * `eventId` es la barrera de idempotencia: Stripe reintenta entregas y un mismo
 * evento no puede aplicar dos veces.
 */
export interface IStripeEvent extends Document {
  _id: mongoose.Types.ObjectId;
  eventId: string;
  type: string;
  outcome: StripeEventOutcome;
  /** Por qué se saltó o falló (cliente sin vincular, sin facturas abiertas…). */
  detail?: string;
  stripeChargeId?: string;
  paymentId?: mongoose.Types.ObjectId;
  processedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stripeEventSchema = new Schema<IStripeEvent>(
  {
    eventId: { type: String, required: true, unique: true },
    type: { type: String, required: true, index: true },
    outcome: { type: String, enum: STRIPE_EVENT_OUTCOMES, required: true },
    detail: { type: String },
    stripeChargeId: { type: String, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    processedAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false }
);

export const StripeEvent = mongoose.model<IStripeEvent>("StripeEvent", stripeEventSchema);
