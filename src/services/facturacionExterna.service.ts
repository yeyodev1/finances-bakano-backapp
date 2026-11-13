import axios from "axios";
import { AuditLog, Client } from "../models";
import { DocumentoExterno } from "../models/documentoExterno.model";
import { toPeriod } from "../utils/date.util";

/**
 * Lee (solo lectura) facturas y cobros del sistema de facturación por su GraphQL interno,
 * con el usuario de FACTURACION_EMAIL / FACTURACION_PASSWORD. Nunca emite, anula ni edita nada.
 */

const URL = () => `${(process.env.FACTURACION_URL || "https://crm.soporte.press").replace(/\/+$/, "")}/graphql`;

async function gql<T = any>(query: string, variables: Record<string, unknown>, token?: string): Promise<T> {
  const { data } = await axios.post(
    URL(),
    { query, variables },
    { timeout: 45000, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }
  );
  if (data?.errors?.length) throw new Error(`Facturación: ${data.errors.map((e: any) => e.message).join(" | ")}`);
  return data.data;
}

const LOGIN = `mutation Login($email: String!, $password: String!) {
  login(loginInput: { email: $email, password: $password }) { accessToken user { tenantId } } }`;
const FACTURAS = `query Invoices($issuerId: ID!, $limit: Float, $offset: Float, $month: Float, $year: Float) {
  invoices(issuerId: $issuerId, limit: $limit, offset: $offset, month: $month, year: $year) {
    _id secuencial status authorizationDate createdAt invoiceData clientId cobradaAlEmitir } }`;
const COBROS = `query latestPaymentsReport($period: String, $limit: Float) {
  latestPaymentsReport(period: $period, limit: $limit) {
    _id amount date method concept reference invoiceId isManualInvoiced customerSnapshot { name identification } } }`;

async function login() {
  const email = process.env.FACTURACION_EMAIL;
  const password = process.env.FACTURACION_PASSWORD;
  if (!email || !password) throw new Error("Falta FACTURACION_EMAIL / FACTURACION_PASSWORD en el entorno de Finanzas.");
  const d = await gql(LOGIN, { email, password });
  const token = d?.login?.accessToken;
  const tenantId = d?.login?.user?.tenantId;
  if (!token || !tenantId) throw new Error("Facturación: el login no devolvió token o empresa (¿pide captcha?).");
  return { token, tenantId: String(tenantId) };
}

/** Busca el primer valor presente entre varias rutas (el JSON de la factura varía). */
function leer(obj: any, rutas: string[]): any {
  for (const r of rutas) {
    const v = r.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

/** Datos útiles de una factura del sistema (invoiceData puede venir como texto JSON). */
export function extraerFactura(f: any) {
  let d = f?.invoiceData;
  if (typeof d === "string") {
    try { d = JSON.parse(d); } catch { d = {}; }
  }
  const total = Number(leer(d, ["infoFactura.importeTotal", "importeTotal", "total", "totales.total"]) ?? 0);
  const fecha = new Date(f?.authorizationDate || f?.createdAt || leer(d, ["infoFactura.fechaEmision", "fechaEmision"]) || Date.now());
  return {
    externalId: String(f._id),
    secuencial: f.secuencial != null ? String(f.secuencial) : undefined,
    estado: f.status,
    fecha,
    monto: Number.isFinite(total) ? total : 0,
    clienteNombre: leer(d, ["infoFactura.razonSocialComprador", "razonSocialComprador", "cliente.nombre", "customer.name"]),
    clienteIdentificacion: leer(d, ["infoFactura.identificacionComprador", "identificacionComprador", "cliente.identificacion"]),
    cobradaAlEmitir: Boolean(f.cobradaAlEmitir),
  };
}

/** Cruce: cobro con factura = ligado o marcado a mano; factura cobrada = al emitir o con algún cobro ligado. */
export function cruzar(facturas: Array<{ externalId: string; cobradaAlEmitir: boolean }>, cobros: Array<{ invoiceId?: string | null; isManualInvoiced?: boolean }>) {
  const cobradas = new Set(cobros.map((c) => c.invoiceId).filter(Boolean) as string[]);
  return {
    facturaCobrada: (f: { externalId: string; cobradaAlEmitir: boolean }) => f.cobradaAlEmitir || cobradas.has(f.externalId),
    cobroFacturado: (c: { invoiceId?: string | null; isManualInvoiced?: boolean }) => Boolean(c.invoiceId) || Boolean(c.isManualInvoiced),
  };
}

const norm = (s?: string) => String(s || "").trim().toLowerCase();

async function mapaClientes() {
  const clientes = await Client.find({}).select("_id name legalName").lean();
  const m = new Map<string, any>();
  for (const c of clientes) for (const n of [c.name, (c as any).legalName]) if (n) m.set(norm(n), c._id);
  return m;
}

async function traerFacturas(token: string, issuerId: string, periodo: string) {
  const [year, month] = periodo.split("-").map(Number);
  const todas: any[] = [];
  for (let offset = 0; offset < 5000; offset += 500) {
    const d = await gql(FACTURAS, { issuerId, limit: 500, offset, month, year }, token);
    const page = d?.invoices || [];
    todas.push(...page);
    if (page.length < 500) break;
  }
  return todas;
}

/** Trae el mes actual y el anterior y los guarda/actualiza. Idempotente. */
async function sincronizar(periodos?: string[]) {
  const ahora = new Date();
  const lista = periodos?.length ? periodos : [toPeriod(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 15)), toPeriod(ahora)];
  const { token, tenantId } = await login();
  const clientes = await mapaClientes();
  const resumen: Record<string, { facturas: number; cobros: number }> = {};

  for (const periodo of lista) {
    const [facturasRaw, cobrosD] = await Promise.all([
      traerFacturas(token, tenantId, periodo),
      gql(COBROS, { period: periodo, limit: 5000 }, token),
    ]);
    const cobrosRaw: any[] = cobrosD?.latestPaymentsReport || [];
    const facturas = facturasRaw.map(extraerFactura);
    const { facturaCobrada, cobroFacturado } = cruzar(facturas, cobrosRaw);
    const en = new Date();

    const ops: any[] = [
      ...facturas.map((f, i) => ({
        updateOne: {
          filter: { tipo: "factura", externalId: f.externalId },
          update: {
            $set: {
              periodo, fecha: f.fecha, monto: f.monto, estado: f.estado, secuencial: f.secuencial,
              clienteNombre: f.clienteNombre, clienteIdentificacion: f.clienteIdentificacion,
              conPar: facturaCobrada(f), clientId: clientes.get(norm(f.clienteNombre)), raw: facturasRaw[i], sincronizadoEn: en,
            },
          },
          upsert: true,
        },
      })),
      ...cobrosRaw.map((c) => ({
        updateOne: {
          filter: { tipo: "cobro", externalId: String(c._id) },
          update: {
            $set: {
              periodo, fecha: c.date ? new Date(c.date) : undefined, monto: Number(c.amount) || 0, estado: c.method,
              secuencial: c.reference, clienteNombre: c.customerSnapshot?.name, clienteIdentificacion: c.customerSnapshot?.identification,
              facturaExternalId: c.invoiceId || undefined, conPar: cobroFacturado(c),
              clientId: clientes.get(norm(c.customerSnapshot?.name)), raw: c, sincronizadoEn: en,
            },
          },
          upsert: true,
        },
      })),
    ];
    if (ops.length) await DocumentoExterno.bulkWrite(ops, { ordered: false });
    resumen[periodo] = { facturas: facturas.length, cobros: cobrosRaw.length };
  }

  await AuditLog.create({ action: "facturacion.sync", entity: "DocumentoExterno", entityId: "-", level: "info", meta: resumen });
  return { listo: true, periodos: resumen };
}

/** Cruces del período: facturado, cobrado y lo que no cuadra. */
async function resumen(periodo = toPeriod(new Date())) {
  const docs = await DocumentoExterno.find({ periodo }).select("-raw").lean();
  const facturas = docs.filter((d) => d.tipo === "factura" && !/anul/i.test(d.estado || ""));
  const cobros = docs.filter((d) => d.tipo === "cobro");
  const suma = (xs: typeof docs) => Math.round(xs.reduce((a, d) => a + (d.monto || 0), 0) * 100) / 100;
  const fila = (d: (typeof docs)[number]) => ({
    fecha: d.fecha, monto: d.monto, cliente: d.clienteNombre, identificacion: d.clienteIdentificacion,
    numero: d.secuencial, estado: d.estado, enFinanzas: Boolean(d.clientId),
  });
  const ultima = docs.reduce<Date | null>((a, d) => (!a || d.sincronizadoEn > a ? d.sincronizadoEn : a), null);
  return {
    periodo,
    actualizadoEn: ultima,
    facturado: { total: suma(facturas), cantidad: facturas.length },
    cobrado: { total: suma(cobros), cantidad: cobros.length },
    cobrosSinFactura: cobros.filter((c) => !c.conPar).map(fila),
    facturasSinCobro: facturas.filter((f) => !f.conPar).map(fila),
    sinClienteEnFinanzas: [...new Set(docs.filter((d) => !d.clientId && d.clienteNombre).map((d) => d.clienteNombre!))],
  };
}

export const facturacionExternaService = { sincronizar, resumen };
