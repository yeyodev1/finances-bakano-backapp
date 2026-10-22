import jwt from "jsonwebtoken";
import { AuditLog, Payment } from "../models";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";
import { cloudinaryService } from "./cloudinary.service";

/**
 * Comprobantes por enlace: el MCP (o quien registre un pago desde el chat)
 * recibe un enlace firmado y de vida corta; la persona lo abre, arrastra la
 * imagen o el PDF, y el archivo queda pegado a los pagos del enlace. Así se
 * puede "subir una imagen desde el chat" sin que el chat toque archivos.
 *
 * El token es la autorización: lleva los ids de los pagos y vence solo. Si se
 * sube dos veces, la segunda reemplaza a la primera (y se borra la vieja de
 * Cloudinary): corregir un comprobante es parte del caso de uso.
 */

const RECEIPT_FOLDER = "bakano-finanzas/comprobantes";
const VIGENCIA = "48h";
const VIGENCIA_TEXTO = "48 horas";

interface TokenComprobante {
  t: "comprobante";
  /** Ids de los pagos (un pago repartido entre varios cobros son varios Payment). */
  p: string[];
  /** Quién pidió el enlace, para la bitácora. */
  by?: string;
}

function crearToken(paymentIds: string[], por?: string): string {
  const payload: TokenComprobante = { t: "comprobante", p: paymentIds, by: por };
  return jwt.sign(payload, env.jwtSecret, { expiresIn: VIGENCIA });
}

function leerToken(token: string): TokenComprobante {
  try {
    const datos = jwt.verify(token, env.jwtSecret) as TokenComprobante;
    if (datos?.t !== "comprobante" || !Array.isArray(datos.p) || !datos.p.length) throw new Error("tipo");
    return datos;
  } catch {
    throw new CustomError(
      "Este enlace para subir el comprobante no es válido o ya venció. Pide uno nuevo desde el chat.",
      401
    );
  }
}

function linkPara(baseUrl: string, paymentIds: string[], por?: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/api/comprobantes/${crearToken(paymentIds, por)}`;
}

async function pagosDe(datos: TokenComprobante) {
  const pagos = await Payment.find({ _id: { $in: datos.p } }).sort({ paidAt: -1 });
  if (!pagos.length) {
    throw new CustomError("Los pagos de este enlace ya no existen en Finanzas.", 404);
  }
  return pagos;
}

/** Lo que la página de subida muestra antes de subir. */
async function datos(token: string) {
  const payload = leerToken(token);
  const pagos = await pagosDe(payload);
  return {
    pagos: pagos.map((p) => ({
      id: String(p._id),
      cliente: p.clientName,
      monto: p.amount,
      moneda: p.currency,
      periodo: p.period,
      fecha: p.paidAt,
      tieneComprobante: Boolean(p.receiptUrl),
    })),
    vigencia: VIGENCIA_TEXTO,
  };
}

/** Sube el archivo a Cloudinary y lo pega a todos los pagos del enlace. */
async function subir(token: string, archivo: { buffer: Buffer; mimetype: string }) {
  const payload = leerToken(token);
  const pagos = await pagosDe(payload);

  const subido = await cloudinaryService.uploadBuffer(archivo.buffer, RECEIPT_FOLDER);

  const viejos = new Set<string>();
  for (const pago of pagos) {
    if (pago.receiptPublicId && pago.receiptPublicId !== subido.publicId) viejos.add(pago.receiptPublicId);
    pago.receiptUrl = subido.url;
    pago.receiptPublicId = subido.publicId;
    await pago.save();

    await AuditLog.create({
      action: "payment.receipt_uploaded",
      entity: "Payment",
      entityId: String(pago._id),
      userName: payload.by || "Enlace de comprobante",
      meta: {
        clientId: String(pago.clientId),
        clientName: pago.clientName,
        amount: pago.amount,
        period: pago.period,
        receiptUrl: subido.url,
      },
    });
  }

  // El comprobante viejo ya no lo referencia nadie: se limpia sin romper la subida.
  for (const publicId of viejos) {
    await cloudinaryService.destroy(publicId).catch(() => {});
  }

  return {
    listo: true,
    comprobante: subido.url,
    pagos: pagos.map((p) => ({ cliente: p.clientName, monto: p.amount, periodo: p.period })),
  };
}

export const receiptUploadService = { linkPara, datos, subir, VIGENCIA_TEXTO };
