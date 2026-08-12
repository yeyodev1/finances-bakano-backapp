import { Types } from "mongoose";
import { AuditLog, Client, IInvoice, Invoice } from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";
import { datilService, type DatilIdType, type DatilPerson } from "./datil.service";
import { env } from "../config/env";
import { periodLabelEs } from "../utils/date.util";

/**
 * Puente entre un cobro y su factura electrónica.
 *
 * La factura y el pago son independientes a propósito: se factura cuando el
 * cliente lo pide, que puede ser antes de que llegue la transferencia. Por eso
 * emitir NO marca el cobro como pagado, y registrar un pago no obliga a
 * facturar.
 */

/** Estados en los que ya hay comprobante y no se debe volver a emitir. */
const ISSUED_STATES = ["AUTORIZADO", "RECIBIDO", "ENVIADO", "EN PROCESO"];

function isIssued(invoice: IInvoice): boolean {
  const estado = invoice.einvoice?.estado;
  return Boolean(invoice.einvoice?.datilId) && Boolean(estado) && ISSUED_STATES.includes(estado!);
}

/**
 * Datos del comprador. Sin identificación válida no se puede facturar: mejor
 * fallar acá con un mensaje claro que mandar al SRI algo que va a rechazar.
 */
async function buyerOf(clientId: Types.ObjectId | string): Promise<DatilPerson> {
  const client = await Client.findById(clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  const billing = client.billing ?? {};
  const taxId = String(billing.taxId ?? "").trim();
  const idType = String(billing.idType ?? "04") as DatilIdType;

  if (!taxId) {
    throw new CustomError(
      `${client.name} no tiene RUC o cédula cargados. Complétalos en su ficha para poder facturar.`,
      400
    );
  }
  if (taxId.length < 5 || taxId.length > 20) {
    throw new CustomError(`La identificación de ${client.name} no es válida.`, 400);
  }
  if (idType === "04" && taxId.length !== 13) {
    throw new CustomError(`El RUC de ${client.name} debe tener 13 dígitos.`, 400);
  }
  if (idType === "05" && taxId.length !== 10) {
    throw new CustomError(`La cédula de ${client.name} debe tener 10 dígitos.`, 400);
  }

  const razonSocial = String(billing.razonSocial || client.legalName || client.name).trim();

  return {
    razon_social: razonSocial.slice(0, 300),
    identificacion: taxId,
    tipo_identificacion: idType,
    ...(billing.email || client.contactEmail
      ? { email: String(billing.email || client.contactEmail) }
      : {}),
    ...(billing.telefono || client.contactPhone
      ? { telefono: String(billing.telefono || client.contactPhone) }
      : {}),
    ...(billing.direccion ? { direccion: String(billing.direccion) } : {}),
  };
}

/**
 * Siguiente secuencial. Dátil exige un entero correlativo por punto de emisión;
 * se toma el mayor ya usado y se suma uno. No hay carrera realista aquí: las
 * emisiones son manuales y de una en una.
 */
async function nextSecuencial(): Promise<number> {
  const last = await Invoice.findOne({ "einvoice.secuencial": { $exists: true, $ne: null } })
    .sort({ "einvoice.emitidaAt": -1 })
    .select("einvoice.secuencial")
    .lean();

  const previous = Number(last?.einvoice?.secuencial ?? 0);
  return Number.isFinite(previous) && previous > 0 ? previous + 1 : 1;
}

/** Emite la factura electrónica de un cobro. No toca su estado de pago. */
async function issueForInvoice(invoiceId: string, user?: JwtPayload) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new CustomError("Cobro no encontrado", 404);

  if (isIssued(invoice)) {
    throw new CustomError(
      `Este cobro ya tiene factura (${invoice.einvoice?.numero ?? invoice.einvoice?.estado}).`,
      409
    );
  }
  if (invoice.status === "cancelled" || invoice.status === "waived") {
    throw new CustomError("No puedes facturar un cobro anulado o condonado.", 400);
  }

  const client = await Client.findById(invoice.clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  const comprador = await buyerOf(invoice.clientId as Types.ObjectId);
  const secuencial = await nextSecuencial();
  const iva = (client.billing?.iva ?? "15") as "0" | "15";

  const descripcion = [
    "Servicios de marketing digital",
    periodLabelEs(invoice.period),
    invoice.splitLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const payload = datilService.buildInvoice({
    secuencial,
    comprador,
    descripcion,
    totalConIva: Number(invoice.amount),
    iva,
    notasPago: `Cobro ${invoice.period}`,
    infoAdicional: { Periodo: invoice.period, Cliente: client.name },
  });

  try {
    // La clave de idempotencia es el id del cobro: si se reintenta tras un
    // timeout, Dátil devuelve la misma factura en vez de emitir otra al SRI.
    const result = await datilService.issueInvoice(payload, `inv-${invoice._id.toString()}`);

    invoice.einvoice = {
      datilId: result.id,
      estado: result.estado,
      secuencial: result.secuencial ?? String(secuencial),
      numero: result.numero,
      claveAcceso: result.claveAcceso,
      urlPdf: result.urlPdf,
      urlXml: result.urlXml,
      ambiente: env.datil.ambiente,
      emitidaAt: new Date(),
      error: undefined,
    };
    await invoice.save();

    await AuditLog.create({
      action: "invoice.einvoice.issue",
      entity: "Invoice",
      entityId: invoice._id.toString(),
      userId: user?._id,
      userName: user?.name,
      meta: {
        clientName: invoice.clientName,
        period: invoice.period,
        amount: invoice.amount,
        estado: result.estado,
        numero: result.numero,
        ambiente: env.datil.ambiente,
      },
    });

    return invoice;
  } catch (error) {
    // El error se guarda para poder reintentar sabiendo qué falló, sin que el
    // cobro quede en un limbo silencioso.
    invoice.einvoice = {
      ...(invoice.einvoice ?? {}),
      error: (error as Error).message,
      ambiente: env.datil.ambiente,
    };
    await invoice.save();
    throw error;
  }
}

/** Refresca el estado desde Dátil: el SRI tarda en pasar a AUTORIZADO. */
async function refreshStatus(invoiceId: string) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new CustomError("Cobro no encontrado", 404);
  if (!invoice.einvoice?.datilId) {
    throw new CustomError("Este cobro todavía no tiene factura emitida.", 400);
  }

  const result = await datilService.getInvoice(invoice.einvoice.datilId);
  invoice.einvoice = {
    ...invoice.einvoice,
    estado: result.estado,
    numero: result.numero ?? invoice.einvoice.numero,
    claveAcceso: result.claveAcceso ?? invoice.einvoice.claveAcceso,
    urlPdf: result.urlPdf ?? invoice.einvoice.urlPdf,
    urlXml: result.urlXml ?? invoice.einvoice.urlXml,
  };
  await invoice.save();
  return invoice;
}

/**
 * Resumen para el tablero: cuánto se facturó y, sobre todo, qué está
 * descuadrado —facturado sin cobrar y cobrado sin facturar—, que es lo que
 * hay que perseguir.
 */
async function summary(period?: string) {
  const match = period ? { period } : {};
  const invoices = await Invoice.find({
    ...match,
    status: { $nin: ["cancelled", "waived"] },
  })
    .select("amount paidAmount status einvoice")
    .lean();

  const round = (n: number) => Number(n.toFixed(2));
  let facturado = 0;
  let sinFacturar = 0;
  let facturadoSinCobrar = 0;
  let cobradoSinFacturar = 0;
  let conError = 0;
  let pendienteAutorizacion = 0;

  for (const inv of invoices) {
    const tieneFactura = Boolean(inv.einvoice?.datilId);
    const estado = inv.einvoice?.estado ?? "";
    const pagado = Number(inv.paidAmount ?? 0) >= Number(inv.amount) - 0.009;
    const amount = Number(inv.amount ?? 0);

    if (tieneFactura) {
      facturado += amount;
      if (estado && estado !== "AUTORIZADO") pendienteAutorizacion += 1;
      if (!pagado) facturadoSinCobrar += amount;
    } else {
      sinFacturar += amount;
      if (pagado) cobradoSinFacturar += amount;
    }

    if (inv.einvoice?.error) conError += 1;
  }

  return {
    period: period ?? null,
    configurada: datilService.canIssue(),
    ambiente: env.datil.ambiente,
    faltaConfigurar: datilService.missingConfig(),
    facturado: round(facturado),
    sinFacturar: round(sinFacturar),
    /** Se emitió la factura pero el dinero no ha entrado. */
    facturadoSinCobrar: round(facturadoSinCobrar),
    /** Entró el dinero pero nunca se facturó: es lo que deja expuesto al SRI. */
    cobradoSinFacturar: round(cobradoSinFacturar),
    pendienteAutorizacion,
    conError,
  };
}

export const invoiceBillingService = {
  issueForInvoice,
  refreshStatus,
  summary,
  isIssued,
};
