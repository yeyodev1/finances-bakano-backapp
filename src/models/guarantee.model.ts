import mongoose, { Document, Schema } from "mongoose";
import {
  GUARANTEE_MAX_CYCLES,
  GUARANTEE_STATUSES,
  GuaranteeStatus,
} from "../types/finance.types";

/**
 * Un mes regalado dentro de la garantía. Se guarda el monto que se dejó de cobrar
 * porque es el costo real de la política: sin esto no hay forma de decir cuánto
 * invierte Bakano en recuperar clientes.
 */
export interface IGuaranteeCycle {
  /** 1 = primer mes, 2 = extensión. */
  cycle: number;
  /** Período "YYYY-MM" que queda sin cobro. */
  period: string;
  invoiceIds: mongoose.Types.ObjectId[];
  waivedAmount: number;
  openedAt: Date;
  /** Qué se vio al cerrar el mes: hubo o no hubo resultados. */
  resultNotes?: string;
  by?: mongoose.Types.ObjectId;
  byName?: string;
}

/**
 * Garantía comercial: el cliente que no vio resultados arranca el mes siguiente sin
 * pagar. Si aparecen resultados se vuelve a cobrar (`cumplida`). Si no, se estira un
 * segundo mes (`extendida`) y, agotado el tope, se cierra como `fallida` — que es la
 * baja por fracaso, con o sin devolución de dinero.
 */
export interface IGuarantee extends Document {
  _id: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  clientName: string;

  status: GuaranteeStatus;
  /** Período que salió mal y disparó la garantía. */
  triggerPeriod: string;
  /** Por qué se concedió, en palabras del acuerdo. */
  reason?: string;

  cycles: IGuaranteeCycle[];
  maxCycles: number;
  /** Cobro mensual del cliente al abrir la garantía: lo que se regala por ciclo. */
  monthlyAmount: number;

  openedAt: Date;
  closedAt?: Date | null;
  outcomeNotes?: string;

  /** Al fracasar: si además se dio de baja al cliente y si hubo devolución. */
  archivedClient: boolean;
  refundId?: mongoose.Types.ObjectId | null;

  openedBy?: mongoose.Types.ObjectId;
  openedByName?: string;
  closedBy?: mongoose.Types.ObjectId;
  closedByName?: string;

  createdAt: Date;
  updatedAt: Date;
}

const cycleSchema = new Schema<IGuaranteeCycle>(
  {
    cycle: { type: Number, required: true, min: 1 },
    period: { type: String, required: true },
    invoiceIds: { type: [Schema.Types.ObjectId], ref: "Invoice", default: [] },
    waivedAmount: { type: Number, default: 0, min: 0 },
    openedAt: { type: Date, default: () => new Date() },
    resultNotes: { type: String, trim: true },
    by: { type: Schema.Types.ObjectId, ref: "User" },
    byName: { type: String },
  },
  { _id: false }
);

const guaranteeSchema = new Schema<IGuarantee>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true, index: true },
    clientName: { type: String, required: true },

    status: { type: String, enum: GUARANTEE_STATUSES, default: "abierta", index: true },
    triggerPeriod: { type: String, required: true, index: true },
    reason: { type: String, trim: true },

    cycles: { type: [cycleSchema], default: [] },
    maxCycles: { type: Number, default: GUARANTEE_MAX_CYCLES, min: 1 },
    monthlyAmount: { type: Number, default: 0, min: 0 },

    openedAt: { type: Date, default: () => new Date(), index: true },
    closedAt: { type: Date, default: null },
    outcomeNotes: { type: String, trim: true },

    archivedClient: { type: Boolean, default: false },
    refundId: { type: Schema.Types.ObjectId, ref: "Refund", default: null },

    openedBy: { type: Schema.Types.ObjectId, ref: "User" },
    openedByName: { type: String },
    closedBy: { type: Schema.Types.ObjectId, ref: "User" },
    closedByName: { type: String },
  },
  { timestamps: true, versionKey: false }
);

guaranteeSchema.index({ clientId: 1, status: 1 });
guaranteeSchema.index({ status: 1, openedAt: -1 });
/** La generación mensual pregunta por período cubierto, no por cliente. */
guaranteeSchema.index({ "cycles.period": 1, status: 1 });

export const Guarantee = mongoose.model<IGuarantee>("Guarantee", guaranteeSchema);
