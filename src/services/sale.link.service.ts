import { Types } from "mongoose";
import { Client, IClient, ISale, Invoice, Sale } from "../models";
import { normalizeText } from "../utils/similarity.util";
import { toPeriod } from "../utils/date.util";

/**
 * Enlace entre ventas y clientes.
 *
 * Una venta se registra en Ventas y el cliente se agrega en Clientes: son dos
 * pasos distintos que suelen hablar del mismo negocio. Si no se enlazan, el
 * mismo dinero aparece dos veces (la cuota de la venta y el cobro del cliente).
 * Este servicio junta las dos puntas y decide qué cuota ya está cubierta por un
 * cobro del cliente.
 */

const OPEN_SALE_STATUSES: ISale["status"][] = ["acordada", "cobrando"];

/** Cobros que cuentan como "ese mes ya está en la ficha del cliente". */
const COVERING_INVOICE_STATUSES = ["pending", "partial", "paid", "overdue", "waived"];

export function sameBusinessName(a: string, b: string): boolean {
  const left = normalizeText(a);
  return left.length > 0 && left === normalizeText(b);
}

/** Cliente activo cuyo nombre coincide (sin tildes, mayúsculas ni signos). */
async function findClientByBusinessName(businessName: string): Promise<IClient | null> {
  const wanted = normalizeText(businessName);
  if (!wanted) return null;
  const candidates = await Client.find({ isArchived: { $ne: true } }).select("name legalName");
  return (
    candidates.find(
      (c) => normalizeText(c.name) === wanted || (c.legalName && normalizeText(c.legalName) === wanted)
    ) ?? null
  );
}

/**
 * Enlaza al cliente las ventas abiertas sin cliente que llevan su nombre.
 * Devuelve cuántas enlazó. Deja rastro en el historial de cada venta.
 */
async function linkOpenSalesToClient(client: IClient, userId?: string): Promise<number> {
  const candidates = await Sale.find({ clientId: null, status: { $in: OPEN_SALE_STATUSES } });
  let linked = 0;

  for (const sale of candidates) {
    if (!sameBusinessName(sale.businessName, client.name)) continue;
    sale.clientId = client._id;
    sale.history.push({
      action: "client.linked",
      detail: `Enlazada al cliente ${client.name} al darlo de alta`,
      at: new Date(),
      by: userId ? new Types.ObjectId(userId) : undefined,
      meta: { clientId: client._id.toString(), clientName: client.name, auto: true },
    });
    await sale.save();
    linked += 1;
  }

  return linked;
}

/**
 * Períodos "YYYY-MM" con cobro emitido por cliente. Solo para los clientes que
 * se pasan: es lo único que hace falta para saber si una cuota está cubierta.
 */
async function invoicedPeriodsByClient(clientIds: string[]): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!clientIds.length) return map;

  const invoices = await Invoice.find({
    clientId: { $in: clientIds.map((id) => new Types.ObjectId(id)) },
    status: { $in: COVERING_INVOICE_STATUSES },
  })
    .select("clientId period")
    .lean();

  for (const invoice of invoices) {
    const key = String(invoice.clientId);
    const periods = map.get(key) ?? new Set<string>();
    periods.add(invoice.period);
    map.set(key, periods);
  }
  return map;
}

/**
 * Una cuota está cubierta cuando la venta está enlazada a un cliente y ese
 * cliente ya tiene el cobro del mes en que vence la cuota. En ese caso el
 * dinero se persigue desde Cobros del mes, no desde la venta.
 */
function isInstallmentCovered(
  sale: Pick<ISale, "clientId">,
  installment: { dueDate: Date },
  invoiced: Map<string, Set<string>>
): boolean {
  if (!sale.clientId) return false;
  const periods = invoiced.get(String(sale.clientId));
  if (!periods) return false;
  return periods.has(toPeriod(new Date(installment.dueDate)));
}

/**
 * El cobro del cliente de un mes se pagó: las cuotas de sus ventas enlazadas que
 * vencen ese mismo mes quedan cobradas también. Así la venta no sigue "vencida"
 * cuando el dinero ya entró por Cobros del mes.
 */
async function settleCoveredInstallments(
  clientId: Types.ObjectId | string,
  period: string,
  paidAt: Date,
  byName?: string
): Promise<number> {
  const sales = await Sale.find({ clientId, status: { $in: OPEN_SALE_STATUSES } });
  let settled = 0;

  for (const sale of sales) {
    let touched = false;
    for (const item of sale.installments) {
      if (item.status === "cobrada") continue;
      if (toPeriod(new Date(item.dueDate)) !== period) continue;
      item.status = "cobrada";
      item.paidAt = paidAt;
      item.paidAmount = item.amount;
      item.notes = `Cobrada con el cobro ${period} del cliente`;
      touched = true;
      settled += 1;
    }
    if (!touched) continue;

    const paid = sale.installments.filter((i) => i.status === "cobrada").length;
    sale.status = paid === sale.installments.length ? "cobrada" : "cobrando";
    sale.history.push({
      action: "installment.paid",
      detail: `Cuota(s) de ${period} cobradas con el pago del cliente`,
      at: new Date(),
      byName,
      meta: { period, auto: true },
    });
    await sale.save();
  }

  return settled;
}

export const saleLinkService = {
  settleCoveredInstallments,
  findClientByBusinessName,
  linkOpenSalesToClient,
  invoicedPeriodsByClient,
  isInstallmentCovered,
};
