import mongoose, { Document, Schema } from "mongoose";

/**
 * Una línea del objetivo: qué tipo de cliente hay que buscar este mes,
 * cuántos y por cuánto. Se guarda el nombre además del id para que el
 * histórico no se rompa si la categoría se renombra o se desactiva.
 */
export interface ISaleGoalLine {
  categoryId: mongoose.Types.ObjectId;
  categoryName: string;
  /** Cuántos clientes de este tipo hay que cerrar. */
  targetCount: number;
  /** Cuánto dinero (en ventas acordadas) debería salir de ellos. */
  targetAmount: number;
  notes?: string;
}

/**
 * Objetivo de venta de un mes. Uno por período: lo fija quien dirige ventas y
 * el avance se calcula a partir de las ventas registradas con `agreedAt`
 * dentro del mes y su `categoryId`.
 */
export interface ISaleGoal extends Document {
  _id: mongoose.Types.ObjectId;
  /** "YYYY-MM" */
  period: string;
  lines: ISaleGoalLine[];
  notes?: string;
  updatedBy?: mongoose.Types.ObjectId;
  updatedByName?: string;
  createdAt: Date;
  updatedAt: Date;
}

const lineSchema = new Schema<ISaleGoalLine>(
  {
    categoryId: { type: Schema.Types.ObjectId, ref: "ClientCategory", required: true },
    categoryName: { type: String, required: true, trim: true },
    targetCount: { type: Number, required: true, min: 0, default: 0 },
    targetAmount: { type: Number, required: true, min: 0, default: 0 },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const saleGoalSchema = new Schema<ISaleGoal>(
  {
    period: { type: String, required: true, unique: true, index: true },
    lines: { type: [lineSchema], default: [] },
    notes: { type: String, trim: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedByName: { type: String },
  },
  { timestamps: true, versionKey: false }
);

export const SaleGoal = mongoose.model<ISaleGoal>("SaleGoal", saleGoalSchema);
