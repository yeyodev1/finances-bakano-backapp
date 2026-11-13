import mongoose, { Document, Schema } from "mongoose";

/**
 * Facturas y cobros leídos del sistema de facturación (crm.soporte.press), solo lectura.
 * Se refrescan con el cron `/api/cron/run/facturacion`; `raw` guarda lo que vino tal cual.
 */
export interface IDocumentoExterno extends Document {
  tipo: "factura" | "cobro";
  externalId: string;
  fecha?: Date;
  periodo: string; // AAAA-MM
  monto: number;
  estado?: string;
  secuencial?: string;
  clienteNombre?: string;
  clienteIdentificacion?: string;
  /** Cobro: id de la factura a la que se aplicó. */
  facturaExternalId?: string;
  /** Cobro: tiene factura (ligada o marcada a mano). Factura: se cobró al emitir o tiene cobros. */
  conPar: boolean;
  clientId?: mongoose.Types.ObjectId;
  raw: unknown;
  sincronizadoEn: Date;
}

const schema = new Schema<IDocumentoExterno>(
  {
    tipo: { type: String, enum: ["factura", "cobro"], required: true },
    externalId: { type: String, required: true },
    fecha: { type: Date },
    periodo: { type: String, required: true, index: true },
    monto: { type: Number, default: 0 },
    estado: { type: String },
    secuencial: { type: String },
    clienteNombre: { type: String },
    clienteIdentificacion: { type: String },
    facturaExternalId: { type: String },
    conPar: { type: Boolean, default: false },
    clientId: { type: Schema.Types.ObjectId, ref: "Client", index: true },
    raw: { type: Schema.Types.Mixed },
    sincronizadoEn: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false }
);
schema.index({ tipo: 1, externalId: 1 }, { unique: true });

export const DocumentoExterno = mongoose.model<IDocumentoExterno>("DocumentoExterno", schema, "facturacionexterna");
