import mongoose, { Document, Schema } from "mongoose";

/**
 * Consumo del CRM (GoHighLevel) que Bakano provee a cada cliente. Son cargos
 * de Stripe que NO corresponden a la mensualidad de agencia: rebilling de uso
 * del CRM ($25, $1…). Se guardan aparte para que ese dinero no se pierda ni
 * ensucie las facturas; si uno resulta ser una mensualidad, se puede aplicar
 * a una factura (se convierte en Payment y sale de acá).
 */
export interface ICrmConsumption extends Document {
  _id: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  clientName: string;
  stripeCustomerId?: string;
  stripeChargeId: string;
  amount: number;
  currency: string;
  paidAt: Date;
  description?: string;
  receiptUrl?: string;
  source: "stripe_webhook" | "stripe_import";
  createdAt: Date;
  updatedAt: Date;
}

const crmConsumptionSchema = new Schema<ICrmConsumption>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },
    stripeCustomerId: { type: String },
    stripeChargeId: { type: String, required: true, unique: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    paidAt: { type: Date, required: true, index: true },
    description: { type: String, trim: true },
    receiptUrl: { type: String },
    source: { type: String, enum: ["stripe_webhook", "stripe_import"], required: true },
  },
  { timestamps: true, versionKey: false }
);

crmConsumptionSchema.index({ clientId: 1, paidAt: -1 });

export const CrmConsumption = mongoose.model<ICrmConsumption>(
  "CrmConsumption",
  crmConsumptionSchema
);
