import { Client, Invoice, Payment, Sale } from "../models";
import { addDays, startOfDay } from "../utils/date.util";

/**
 * Pronóstico de cobranza semanal.
 *
 * El dinero que debe entrar viene de dos sitios que hasta ahora se miraban por
 * separado: las facturas de los clientes que ya están y las cuotas de las ventas
 * nuevas. Verlos juntos por semana es lo único que responde "cuánto entra y
 * cuándo"; por eso este servicio los mezcla en los mismos tramos.
 */

const OPEN_INVOICE_STATUSES = ["pending", "partial", "overdue"];
const WEEK_MS = 7 * 86_400_000;

export interface CashflowSource {
  count: number;
  amount: number;
}

export interface CashflowWeek {
  index: number;
  start: Date;
  end: Date;
  isCurrent: boolean;
  invoices: CashflowSource;
  sales: CashflowSource;
  total: number;
}

export interface CashflowBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
  count: number;
  amount: number;
}

const round = (value: number) => Number(value.toFixed(2));

/** Lunes de la semana que contiene `date`. La semana laboral empieza en lunes. */
function startOfWeek(date: Date): Date {
  const result = startOfDay(date);
  // getDay(): 0 = domingo. Se retrocede hasta el lunes anterior.
  const offset = (result.getDay() + 6) % 7;
  return addDays(result, -offset);
}

/** Saldo real pendiente de una factura: lo facturado menos lo ya pagado. */
function invoiceBalance(amount: number, paidAmount: number): number {
  return Math.max(Number(amount || 0) - Number(paidAmount || 0), 0);
}

/**
 * ¿El cobro es de un cliente ya asentado o de una venta nueva?
 *
 * La regla del negocio: un cliente con **más de un mes** desde que entró ya es
 * ingreso recurrente; por debajo de eso el dinero todavía es de la venta que lo
 * trajo. Se compara contra la fecha del cobro, no contra hoy, para que una
 * semana vieja no se reclasifique sola con el paso del tiempo.
 */
function isRecurringAt(startDate: Date | null | undefined, paidAt: Date): boolean {
  if (!startDate) return false;

  // Sumar un mes con `setMonth` desborda cuando el destino es más corto (31 ene
  // + 1 mes daría 3 mar), y eso retrasaba de más el paso a recurrente. Se fija
  // el día al último del mes destino.
  const from = new Date(startDate);
  const oneMonthIn = new Date(from);
  oneMonthIn.setDate(1);
  oneMonthIn.setMonth(oneMonthIn.getMonth() + 1);
  const lastDay = new Date(oneMonthIn.getFullYear(), oneMonthIn.getMonth() + 1, 0).getDate();
  oneMonthIn.setDate(Math.min(from.getDate(), lastDay));

  return paidAt >= oneMonthIn;
}

export interface RealizedWeek {
  index: number;
  start: Date;
  end: Date;
  isCurrent: boolean;
  /** Cobros de clientes nuevos (menos de un mes) y de cuotas de ventas. */
  newBusiness: CashflowSource;
  /** Cobros de clientes con más de un mes de antigüedad. */
  recurring: CashflowSource;
  total: number;
}

const AGING_BUCKETS: Array<{ label: string; minDays: number; maxDays: number | null }> = [
  { label: "1 a 7 días", minDays: 1, maxDays: 7 },
  { label: "8 a 15 días", minDays: 8, maxDays: 15 },
  { label: "16 a 30 días", minDays: 16, maxDays: 30 },
  { label: "31 a 60 días", minDays: 31, maxDays: 60 },
  { label: "Más de 60 días", minDays: 61, maxDays: null },
];

/**
 * Dinero que YA entró, semana a semana hacia atrás.
 *
 * Es la contraparte del pronóstico: una cosa es lo que debería entrar y otra
 * lo que entró de verdad. Se separa venta nueva de recurrente porque crecer a
 * base de clientes que se van al mes no es lo mismo que crecer sobre una base
 * que se queda.
 *
 * @param weeksBack cuántas semanas hacia atrás incluir, contando la actual (1–26).
 */
async function realized(weeksBack = 6) {
  const totalWeeks = Math.min(Math.max(Number(weeksBack) || 6, 1), 26);
  const currentMonday = startOfWeek(new Date());
  const firstMonday = addDays(currentMonday, -(totalWeeks - 1) * 7);
  const rangeEnd = addDays(currentMonday, 7);

  const [payments, sales, clients] = await Promise.all([
    Payment.find({ paidAt: { $gte: firstMonday, $lt: rangeEnd } })
      .select("amount paidAt clientId clientName")
      .lean(),
    Sale.find({ "installments.status": "cobrada" })
      .select("businessName installments")
      .lean(),
    Client.find({}).select("startDate createdAt").lean(),
  ]);

  const startById = new Map<string, Date | null>(
    clients.map((c) => [String(c._id), (c.startDate ?? c.createdAt ?? null) as Date | null])
  );

  const weeks: RealizedWeek[] = Array.from({ length: totalWeeks }, (_, index) => {
    const start = addDays(firstMonday, index * 7);
    return {
      index,
      start,
      end: addDays(start, 6),
      isCurrent: index === totalWeeks - 1,
      newBusiness: { count: 0, amount: 0 },
      recurring: { count: 0, amount: 0 },
      total: 0,
    };
  });

  function place(paidAt: Date, amount: number, kind: "newBusiness" | "recurring") {
    if (amount <= 0) return;
    const day = startOfDay(paidAt);
    if (day < firstMonday || day >= rangeEnd) return;
    const weekIndex = Math.floor((day.getTime() - firstMonday.getTime()) / WEEK_MS);
    const week = weeks[weekIndex];
    if (!week) return;
    week[kind].count += 1;
    week[kind].amount += amount;
    week.total += amount;
  }

  for (const payment of payments) {
    const paidAt = new Date(payment.paidAt);
    const start = startById.get(String(payment.clientId)) ?? null;
    place(paidAt, Number(payment.amount || 0), isRecurringAt(start, paidAt) ? "recurring" : "newBusiness");
  }

  // Las cuotas de una venta son, por definición, negocio nuevo.
  for (const sale of sales) {
    for (const item of sale.installments ?? []) {
      if (item.status !== "cobrada" || !item.paidAt) continue;
      place(new Date(item.paidAt), Number(item.paidAmount || item.amount || 0), "newBusiness");
    }
  }

  const out = weeks.map((w) => ({
    ...w,
    newBusiness: { count: w.newBusiness.count, amount: round(w.newBusiness.amount) },
    recurring: { count: w.recurring.count, amount: round(w.recurring.amount) },
    total: round(w.total),
  }));

  const thisWeek = out[out.length - 1] ?? null;
  const previous = out[out.length - 2] ?? null;

  const totalNew = round(out.reduce((a, w) => a + w.newBusiness.amount, 0));
  const totalRecurring = round(out.reduce((a, w) => a + w.recurring.amount, 0));

  return {
    weeks: out,
    thisWeek,
    /** Variación contra la semana anterior; null si no hay con qué comparar. */
    vsPreviousWeek:
      previous && previous.total > 0 && thisWeek
        ? Math.round(((thisWeek.total - previous.total) / previous.total) * 100)
        : null,
    totals: {
      collected: round(totalNew + totalRecurring),
      newBusiness: totalNew,
      recurring: totalRecurring,
    },
  };
}

/**
 * @param weeks cuántas semanas hacia adelante proyectar (1–26).
 */
async function forecast(weeks = 8) {
  const totalWeeks = Math.min(Math.max(Number(weeks) || 8, 1), 26);
  const today = startOfDay(new Date());
  const firstMonday = startOfWeek(today);
  const horizon = addDays(firstMonday, totalWeeks * 7);

  const [invoices, sales] = await Promise.all([
    Invoice.find({ status: { $in: OPEN_INVOICE_STATUSES } })
      .select("amount paidAmount dueDate clientName period status")
      .lean(),
    Sale.find({ status: { $in: ["acordada", "cobrando"] } })
      .select("businessName installments ownerName")
      .lean(),
  ]);

  const buckets: CashflowWeek[] = Array.from({ length: totalWeeks }, (_, index) => {
    const start = addDays(firstMonday, index * 7);
    return {
      index,
      start,
      end: addDays(start, 6),
      isCurrent: index === 0,
      invoices: { count: 0, amount: 0 },
      sales: { count: 0, amount: 0 },
      total: 0,
    };
  });

  const overdue = {
    total: 0,
    count: 0,
    invoices: { count: 0, amount: 0 } as CashflowSource,
    sales: { count: 0, amount: 0 } as CashflowSource,
    buckets: AGING_BUCKETS.map((b) => ({ ...b, count: 0, amount: 0 })) as CashflowBucket[],
  };

  /** Reparte un cobro pendiente entre "atrasado" y su semana correspondiente. */
  function place(dueDate: Date, amount: number, source: "invoices" | "sales") {
    if (amount <= 0) return;
    const due = startOfDay(dueDate);

    if (due < today) {
      const daysLate = Math.floor((today.getTime() - due.getTime()) / 86_400_000);
      overdue.total += amount;
      overdue.count += 1;
      overdue[source].count += 1;
      overdue[source].amount += amount;

      const bucket = overdue.buckets.find(
        (b) => daysLate >= b.minDays && (b.maxDays === null || daysLate <= b.maxDays)
      );
      if (bucket) {
        bucket.count += 1;
        bucket.amount += amount;
      }
      return;
    }

    // Fuera del horizonte proyectado: no se fuerza dentro para no inflar la última semana.
    if (due >= horizon) return;

    const weekIndex = Math.floor((due.getTime() - firstMonday.getTime()) / WEEK_MS);
    const week = buckets[weekIndex];
    if (!week) return;
    week[source].count += 1;
    week[source].amount += amount;
    week.total += amount;
  }

  for (const invoice of invoices) {
    place(new Date(invoice.dueDate), invoiceBalance(invoice.amount, invoice.paidAmount), "invoices");
  }

  for (const sale of sales) {
    for (const item of sale.installments ?? []) {
      if (item.status === "cobrada") continue;
      place(new Date(item.dueDate), Number(item.amount || 0), "sales");
    }
  }

  const weeksOut = buckets.map((w) => ({
    ...w,
    invoices: { count: w.invoices.count, amount: round(w.invoices.amount) },
    sales: { count: w.sales.count, amount: round(w.sales.amount) },
    total: round(w.total),
  }));

  const upcoming = round(weeksOut.reduce((acc, w) => acc + w.total, 0));
  const overdueTotal = round(overdue.total);

  // La semana más cargada sirve para anticipar el pico de trabajo de cobranza.
  const peak = weeksOut.reduce<(typeof weeksOut)[number] | null>(
    (best, week) => (!best || week.total > best.total ? week : best),
    null
  );

  return {
    generatedAt: new Date(),
    weeks: weeksOut,
    overdue: {
      total: overdueTotal,
      count: overdue.count,
      invoices: { count: overdue.invoices.count, amount: round(overdue.invoices.amount) },
      sales: { count: overdue.sales.count, amount: round(overdue.sales.amount) },
      buckets: overdue.buckets.map((b) => ({ ...b, amount: round(b.amount) })),
    },
    totals: {
      /** Lo que vence dentro del horizonte proyectado. */
      upcoming,
      overdue: overdueTotal,
      /** Todo lo cobrable: lo vencido sigue siendo dinero que debe entrar. */
      expected: round(upcoming + overdueTotal),
      thisWeek: weeksOut[0]?.total ?? 0,
      peakWeekStart: peak?.start ?? null,
      peakWeekAmount: peak?.total ?? 0,
    },
  };
}

export const cashflowService = { forecast, realized };
