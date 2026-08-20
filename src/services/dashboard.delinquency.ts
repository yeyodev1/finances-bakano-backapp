import { Types } from "mongoose";
import { Invoice } from "../models";
import { startOfDay } from "../utils/date.util";
import { EXCLUDED_STATUSES } from "./dashboard.aggregations";

/**
 * Mora promedio: cuántos días tarda la gente en pagar.
 *
 * Dos lecturas distintas que no hay que mezclar:
 *  - **Actual**: los cobros vencidos hoy y cuántos días llevan así. Es la foto.
 *  - **Histórica**: los cobros ya pagados en los últimos N meses, cuántos días
 *    después del vencimiento entró el dinero (0 si pagó a tiempo). Es la costumbre.
 *
 * Se usa la fecha de vencimiento vigente (`dueDate`): si se prorrogó, la mora se
 * cuenta desde la nueva fecha, porque esa fue la que se acordó.
 */

const DAY = 86400000;

export interface DelinquencyClientRow {
  clientId: string;
  clientName: string;
  /** Cobros que cuentan (pagados tarde/a tiempo en el rango + vencidos hoy). */
  invoices: number;
  /** Promedio de días de atraso entre todos sus cobros. */
  avgDays: number;
  maxDays: number;
  /** Cuántos de sus cobros se pagaron (o están) fuera de fecha. */
  lateCount: number;
  latePct: number;
  /** Cobros vencidos hoy sin pagar. */
  openOverdue: number;
  openOverdueAmount: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function delinquencyReport(months = 12) {
  const range = Math.min(Math.max(Number(months) || 12, 1), 36);
  const today = startOfDay(new Date());
  const since = new Date(today);
  since.setMonth(since.getMonth() - range);

  const [paid, overdue] = await Promise.all([
    Invoice.find({
      status: "paid",
      paidAt: { $gte: since },
      isGuarantee: { $ne: true },
      isAdvance: { $ne: true },
    })
      .select("clientId clientName dueDate paidAt amount")
      .lean(),
    Invoice.find({
      status: "overdue",
      isGuarantee: { $ne: true },
    })
      .select("clientId clientName dueDate amount paidAmount")
      .lean(),
  ]);

  // ── Histórico: días entre vencimiento y pago ──
  const paidDelays: number[] = [];
  let paidLate = 0;
  for (const inv of paid) {
    if (!inv.paidAt || !inv.dueDate) continue;
    const days = Math.max(
      Math.round((startOfDay(new Date(inv.paidAt)).getTime() - startOfDay(new Date(inv.dueDate)).getTime()) / DAY),
      0
    );
    paidDelays.push(days);
    if (days > 0) paidLate += 1;
  }
  const paidAvg = paidDelays.length ? paidDelays.reduce((a, b) => a + b, 0) / paidDelays.length : 0;
  const lateOnly = paidDelays.filter((d) => d > 0);
  const lateAvg = lateOnly.length ? lateOnly.reduce((a, b) => a + b, 0) / lateOnly.length : 0;

  // ── Actual: vencidos hoy ──
  const openDays: number[] = [];
  let openAmount = 0;
  for (const inv of overdue) {
    const days = Math.max(Math.round((today.getTime() - startOfDay(new Date(inv.dueDate)).getTime()) / DAY), 0);
    openDays.push(days);
    openAmount += Math.max(Number(inv.amount || 0) - Number(inv.paidAmount || 0), 0);
  }
  const openAvg = openDays.length ? openDays.reduce((a, b) => a + b, 0) / openDays.length : 0;

  // ── Por cliente: junta lo pagado tarde y lo vencido hoy ──
  const byClient = new Map<
    string,
    { clientName: string; days: number[]; late: number; openOverdue: number; openOverdueAmount: number }
  >();
  const bucket = (id: Types.ObjectId | string, name: string) => {
    const key = String(id);
    let row = byClient.get(key);
    if (!row) {
      row = { clientName: name, days: [], late: 0, openOverdue: 0, openOverdueAmount: 0 };
      byClient.set(key, row);
    }
    return row;
  };
  for (const inv of paid) {
    if (!inv.paidAt || !inv.dueDate) continue;
    const days = Math.max(
      Math.round((startOfDay(new Date(inv.paidAt)).getTime() - startOfDay(new Date(inv.dueDate)).getTime()) / DAY),
      0
    );
    const row = bucket(inv.clientId, inv.clientName);
    row.days.push(days);
    if (days > 0) row.late += 1;
  }
  for (const inv of overdue) {
    const days = Math.max(Math.round((today.getTime() - startOfDay(new Date(inv.dueDate)).getTime()) / DAY), 0);
    const row = bucket(inv.clientId, inv.clientName);
    row.days.push(days);
    row.late += 1;
    row.openOverdue += 1;
    row.openOverdueAmount += Math.max(Number(inv.amount || 0) - Number(inv.paidAmount || 0), 0);
  }

  const clients: DelinquencyClientRow[] = [...byClient.entries()]
    .map(([clientId, row]) => {
      const avg = row.days.length ? row.days.reduce((a, b) => a + b, 0) / row.days.length : 0;
      return {
        clientId,
        clientName: row.clientName,
        invoices: row.days.length,
        avgDays: round1(avg),
        maxDays: Math.max(0, ...row.days),
        lateCount: row.late,
        latePct: row.days.length ? Math.round((row.late / row.days.length) * 100) : 0,
        openOverdue: row.openOverdue,
        openOverdueAmount: Math.round(row.openOverdueAmount * 100) / 100,
      };
    })
    .sort((a, b) => b.avgDays - a.avgDays || b.openOverdue - a.openOverdue);

  const clientsWithDelay = clients.filter((c) => c.avgDays > 0);
  const clientAvg = clientsWithDelay.length
    ? clientsWithDelay.reduce((a, c) => a + c.avgDays, 0) / clientsWithDelay.length
    : 0;

  return {
    months: range,
    since,
    /** Vencidos hoy: la foto. */
    current: {
      invoices: overdue.length,
      clients: new Set(overdue.map((i) => String(i.clientId))).size,
      amount: Math.round(openAmount * 100) / 100,
      avgDays: round1(openAvg),
      medianDays: round1(median(openDays)),
      maxDays: openDays.length ? Math.max(...openDays) : 0,
    },
    /** Pagados en el rango: la costumbre. */
    historical: {
      invoices: paidDelays.length,
      paidLate,
      paidOnTime: paidDelays.length - paidLate,
      latePct: paidDelays.length ? Math.round((paidLate / paidDelays.length) * 100) : 0,
      /** Días de atraso promedio contando también los que pagaron a tiempo (0). */
      avgDays: round1(paidAvg),
      /** Solo entre los que pagaron tarde: cuánto tardan cuando tardan. */
      avgDaysWhenLate: round1(lateAvg),
      medianDays: round1(median(paidDelays)),
    },
    /** Promedio de los promedios por cliente (solo clientes con algún atraso). */
    perClientAvgDays: round1(clientAvg),
    clientsWithDelay: clientsWithDelay.length,
    clientsTotal: clients.length,
    /** Peores primero. */
    clients: clients.slice(0, 20),
    excludedStatuses: EXCLUDED_STATUSES,
  };
}
