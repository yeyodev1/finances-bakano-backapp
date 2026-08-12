import axios, { AxiosInstance } from "axios";
import { randomUUID } from "crypto";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

/**
 * Facturación electrónica con Dátil (que a su vez emite ante el SRI).
 *
 * Reglas de la integración:
 *
 * - Emitir es IRREVERSIBLE en producción: un comprobante autorizado solo se
 *   deshace con nota de crédito. Por eso `ambiente` arranca en pruebas (1) y
 *   nada emite sin que alguien lo pida explícitamente.
 * - La factura y el cobro son cosas distintas. A veces se factura antes de que
 *   entre la transferencia, así que este servicio no sabe nada de pagos: solo
 *   emite y consulta. Quien las asocia es `invoice.billing.service`.
 * - Todas las emisiones llevan `Idempotency-Key`. Un reintento por timeout
 *   devolvería la misma factura en vez de duplicarla ante el SRI.
 */

/** IVA. `codigo: "2"` es IVA; el porcentaje va aparte. */
const TAX_CODE_IVA = "2";

/** Código de porcentaje del IVA vigente en Ecuador (15%). */
export const IVA_CODES: Record<string, { codigo_porcentaje: string; tarifa: number }> = {
  "0": { codigo_porcentaje: "0", tarifa: 0 },
  "15": { codigo_porcentaje: "4", tarifa: 15 },
};

export type DatilIdType = "04" | "05" | "06" | "07" | "08";

export interface DatilPerson {
  razon_social: string;
  identificacion: string;
  tipo_identificacion: DatilIdType;
  email?: string;
  telefono?: string;
  direccion?: string;
}

export interface DatilInvoicePayload {
  ambiente: number;
  tipo_emision: number;
  secuencial: number;
  fecha_emision: string;
  moneda: string;
  emisor: Record<string, unknown>;
  comprador: DatilPerson;
  items: Array<Record<string, unknown>>;
  totales: Record<string, unknown>;
  pagos: Array<Record<string, unknown>>;
  informacion_adicional?: Record<string, string>;
}

export interface DatilIssueResult {
  id: string;
  estado: string;
  claveAcceso?: string;
  numero?: string;
  secuencial?: string;
  urlPdf?: string;
  urlXml?: string;
  autorizacion?: Record<string, unknown>;
  raw: Record<string, unknown>;
}

let client: AxiosInstance | null = null;

function getClient(): AxiosInstance {
  if (!client) {
    client = axios.create({
      baseURL: env.datil.apiUrl,
      timeout: env.datil.timeout,
      headers: { "Content-Type": "application/json" },
    });
  }
  return client;
}

/** Sin clave del API no hay integración; la app sigue funcionando sin facturar. */
function isConfigured(): boolean {
  return Boolean(env.datil.apiKey);
}

/** Emitir exige además la clave del certificado de firma. */
function canIssue(): boolean {
  return isConfigured() && Boolean(env.datil.certPassword) && Boolean(env.datil.emisor.ruc);
}

/** Qué falta por configurar, para poder decirlo en la interfaz sin adivinar. */
function missingConfig(): string[] {
  const missing: string[] = [];
  if (!env.datil.apiKey) missing.push("DATIL_API_KEY");
  if (!env.datil.certPassword) missing.push("DATIL_CERT_PASSWORD");
  if (!env.datil.emisor.ruc) missing.push("DATIL_RUC");
  if (!env.datil.emisor.razonSocial) missing.push("DATIL_RAZON_SOCIAL");
  if (!env.datil.emisor.direccion) missing.push("DATIL_DIRECCION");
  return missing;
}

interface DatilErrorItem {
  message?: string;
  details?: string;
  code?: string;
  parameter?: string;
}

/**
 * Dátil devuelve los rechazos de negocio en `errors[]` y los de formato en la
 * raíz. Leer solo la raíz dejaba "Request failed with status code 400", que no
 * dice nada: el motivo real ("Punto de emisión no existe") venía en el array.
 */
function describeError(error: unknown): string {
  const err = error as {
    response?: { status?: number; data?: DatilErrorItem & { errors?: DatilErrorItem[] } };
    message?: string;
  };
  const data = err?.response?.data;

  const list = Array.isArray(data?.errors) ? data!.errors! : data?.message ? [data] : [];
  if (list.length) {
    return list
      .map((item) => {
        const parts = [
          item.message || item.details,
          item.details && item.details !== item.message ? item.details : "",
          item.parameter ? `campo: ${item.parameter}` : "",
        ];
        return parts.filter(Boolean).join(" · ");
      })
      .join(" | ");
  }

  return err?.message || "Error desconocido de Dátil";
}

function emisorPayload(): Record<string, unknown> {
  const e = env.datil.emisor;
  return {
    ruc: e.ruc,
    razon_social: e.razonSocial,
    nombre_comercial: e.nombreComercial,
    direccion: e.direccion,
    obligado_contabilidad: e.obligadoContabilidad,
    contribuyente_especial: e.contribuyenteEspecial || "",
    establecimiento: {
      codigo: e.establecimiento.codigo,
      punto_emision: e.establecimiento.puntoEmision,
      direccion: e.establecimiento.direccion,
    },
  };
}

/**
 * Arma el cuerpo de una factura de un solo concepto.
 *
 * El monto que se guarda en el cobro es lo que el cliente paga, o sea IVA
 * incluido; el SRI quiere la base y el impuesto por separado, así que aquí se
 * desglosa hacia atrás en vez de sumarle el IVA por encima.
 */
function buildInvoice(input: {
  secuencial: number;
  comprador: DatilPerson;
  descripcion: string;
  /** Total que paga el cliente, IVA incluido. */
  totalConIva: number;
  /** "0" o "15". */
  iva: keyof typeof IVA_CODES;
  fechaEmision?: Date;
  notasPago?: string;
  infoAdicional?: Record<string, string>;
}): DatilInvoicePayload {
  const tax = IVA_CODES[input.iva] ?? IVA_CODES["15"];
  const total = Number(input.totalConIva);
  if (!Number.isFinite(total) || total <= 0) {
    throw new CustomError("El monto de la factura debe ser mayor a cero.", 400);
  }

  const round = (n: number) => Number(n.toFixed(2));
  const base = round(total / (1 + tax.tarifa / 100));
  // El IVA sale por diferencia para que base + iva cuadre EXACTO con el total.
  // Calcularlo aparte deja descuadres de un centavo que el SRI rechaza.
  const ivaValue = round(total - base);

  const impuestoItem = {
    base_imponible: base,
    valor: ivaValue,
    tarifa: tax.tarifa,
    codigo: TAX_CODE_IVA,
    codigo_porcentaje: tax.codigo_porcentaje,
  };

  return {
    ambiente: env.datil.ambiente,
    tipo_emision: 1,
    secuencial: input.secuencial,
    fecha_emision: (input.fechaEmision ?? new Date()).toISOString(),
    moneda: "USD",
    emisor: emisorPayload(),
    comprador: input.comprador,
    items: [
      {
        cantidad: 1,
        codigo_principal: "SERV",
        descripcion: input.descripcion.slice(0, 300),
        precio_unitario: base,
        descuento: 0,
        precio_total_sin_impuestos: base,
        impuestos: [impuestoItem],
      },
    ],
    totales: {
      total_sin_impuestos: base,
      descuento: 0,
      propina: 0,
      importe_total: total,
      impuestos: [
        {
          base_imponible: base,
          valor: ivaValue,
          codigo: TAX_CODE_IVA,
          codigo_porcentaje: tax.codigo_porcentaje,
        },
      ],
    },
    // Siempre transferencia: es como cobra Bakano. Dátil lo traduce al código
    // SRI 20 ("otros con utilización del sistema financiero").
    pagos: [
      {
        medio: "transferencia",
        total,
        ...(input.notasPago ? { notas: input.notasPago.slice(0, 300) } : {}),
      },
    ],
    ...(input.infoAdicional ? { informacion_adicional: input.infoAdicional } : {}),
  };
}

function normalize(data: Record<string, unknown>): DatilIssueResult {
  return {
    id: String(data.id ?? ""),
    estado: String(data.estado ?? "DESCONOCIDO"),
    claveAcceso: data.clave_acceso ? String(data.clave_acceso) : undefined,
    numero: data.numero ? String(data.numero) : undefined,
    secuencial: data.secuencial ? String(data.secuencial) : undefined,
    urlPdf: data.url_formato_impresion ? String(data.url_formato_impresion) : undefined,
    urlXml: data.url_documento_electronico ? String(data.url_documento_electronico) : undefined,
    autorizacion: (data.autorizacion as Record<string, unknown>) || undefined,
    raw: data,
  };
}

/**
 * Emite la factura ante el SRI.
 *
 * @param idempotencyKey clave estable del cobro: si se reintenta por un timeout,
 * Dátil devuelve la misma factura en vez de emitir otra.
 */
async function issueInvoice(
  payload: DatilInvoicePayload,
  idempotencyKey?: string
): Promise<DatilIssueResult> {
  if (!canIssue()) {
    throw new CustomError(
      `Falta configurar la facturación electrónica: ${missingConfig().join(", ")}`,
      503
    );
  }

  try {
    const res = await getClient().post("/invoices/issue", payload, {
      headers: {
        "X-Key": env.datil.apiKey,
        "X-Password": env.datil.certPassword,
        "Idempotency-Key": idempotencyKey || randomUUID(),
      },
    });
    return normalize(res.data as Record<string, unknown>);
  } catch (error) {
    throw new CustomError(`Dátil rechazó la factura: ${describeError(error)}`, 502);
  }
}

/** Consulta el estado; el SRI puede tardar en pasar de RECIBIDO a AUTORIZADO. */
async function getInvoice(id: string): Promise<DatilIssueResult> {
  if (!isConfigured()) {
    throw new CustomError("La facturación electrónica no está configurada.", 503);
  }

  try {
    const res = await getClient().get(`/invoices/${id}`, {
      headers: { "X-Key": env.datil.apiKey },
    });
    return normalize(res.data as Record<string, unknown>);
  } catch (error) {
    throw new CustomError(`No se pudo consultar la factura: ${describeError(error)}`, 502);
  }
}

export const datilService = {
  isConfigured,
  canIssue,
  missingConfig,
  buildInvoice,
  issueInvoice,
  getInvoice,
  ambiente: () => env.datil.ambiente,
};
