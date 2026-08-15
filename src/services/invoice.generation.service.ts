import { FilterQuery } from "mongoose";
import { Client, Guarantee, IClient, Invoice, Payment } from "../models";
import { CustomError } from "../errors/customError.error";
import { GUARANTEE_OPEN_STATUSES } from "../types/finance.types";
import {
  dayToDate,
  daysInMonth,
  endOfPeriod,
  isValidPeriod,
  lastWeekdayOfPeriod,
  parsePeriod,
  periodRange,
  startOfDay,
  toPeriod,
} from "../utils/date.util";
import { normalizeText } from "../utils/similarity.util";

export interface GenerateOptions {
  clientIds?: string[];
  force?: boolean;
}

export interface BackfillOptions {
  fromDate: Date;
  markPaidUntil?: Date | null;
}

interface InvoiceEntry {
  splitIndex: number;
  splitLabel?: string;
  amount: number;
  day?: number | null;
}

const OPEN_STATUSES = ["pending", "partial", "overdue"];

export function resolveDueDate(period: string, day: number | null | undefined, client: IClient): Date {
  if (day) return dayToDate(period, day);
  if (client.collectionDay) return dayToDate(period, client.collectionDay);

  const label = normalizeText(client.collectionDayLabel || "");
  if (label.includes("ultimo viernes")) return lastWeekdayOfPeriod(period, 5);

  const { year, month } = parsePeriod(period);
  return dayToDate(period, daysInMonth(year, month));
}

function buildEntries(client: IClient): InvoiceEntry[] {
  if (client.splits && client.splits.length > 0) {
    return client.splits.map((split, index) => ({
      splitIndex: index,
      splitLabel: split.label,
      amount: split.amount,
      day: split.day ?? client.collectionDay,
    }));
  }

  return [{ splitIndex: 0, amount: client.amount, day: client.collectionDay }];
}

/**
 * Un cliente entra en la facturación de un período si su `billingStartPeriod` ya llegó
 * (caso "paga hoy pero arranca el mes siguiente") o, en su defecto, si su `startDate`
 * cae dentro o antes del período.
 */
function billsInPeriod(client: IClient, period: string): boolean {
  if (client.billingStartPeriod) return period >= client.billingStartPeriod;
  if (client.startDate && client.startDate > endOfPeriod(period)) return false;
  return true;
}

async function generateForPeriod(period: string, opts: GenerateOptions = {}) {
  if (!isValidPeriod(period)) {
    throw new CustomError(`Período inválido: ${period}. Formato esperado YYYY-MM.`, 400);
  }

  const filter: FilterQuery<IClient> = {
    isActive: true,
    isArchived: { $ne: true },
    billingType: { $ne: "no_charge" },
    $or: [{ amount: { $gt: 0 } }, { "splits.0": { $exists: true } }],
  };
  if (opts.clientIds?.length) filter._id = { $in: opts.clientIds };

  const clients = await Client.find(filter);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const client of clients) {
    if (!billsInPeriod(client, period)) {
      skipped += 1;
      continue;
    }

    const issueDate = client.issueDay ? dayToDate(period, client.issueDay) : null;

    // Mes cubierto por una garantía: el cobro igual se emite —así se ve cuánto se
    // está regalando— pero nace condonado para que no entre en mora ni en el ideal.
    const guarantee = await Guarantee.findOne({
      clientId: client._id,
      status: { $in: GUARANTEE_OPEN_STATUSES },
      "cycles.period": period,
    });

    for (const entry of buildEntries(client)) {
      if (!entry.amount || entry.amount <= 0) {
        skipped += 1;
        continue;
      }

      const dueDate = resolveDueDate(period, entry.day, client);
      const existing = await Invoice.findOne({
        clientId: client._id,
        period,
        splitIndex: entry.splitIndex,
      });

      if (existing) {
        // Un cobro anulado por monto equivocado bloqueaba el período: el slot
        // (período, splitIndex) ya existe y el generador lo saltaba, así que el
        // cobro corregido nunca aparecía y su pago no se podía registrar. Si la
        // configuración trae OTRO monto, la anulación era por el monto y revive;
        // si el monto es el mismo, la anulación fue deliberada y se respeta.
        const revivable =
          Boolean(opts.force) &&
          existing.status === "cancelled" &&
          !existing.isAdvance &&
          existing.paidAmount <= 0 &&
          existing.amount !== entry.amount;

        // Un cobro anticipado ya acordado manualmente nunca se pisa desde el generador.
        const isLocked =
          existing.isAdvance ||
          (!OPEN_STATUSES.includes(existing.status) && !revivable) ||
          existing.paidAmount > 0;
        if (isLocked || !opts.force) {
          skipped += 1;
          continue;
        }

        existing.amount = entry.amount;
        existing.splitLabel = entry.splitLabel;
        existing.issueDate = issueDate;
        existing.dueDate = dueDate;
        existing.clientName = client.name;
        existing.workspaceId = client.workspaceId || null;
        if (revivable) {
          existing.status = dueDate < startOfDay(new Date()) ? "overdue" : "pending";
          existing.notes = undefined;
        }
        await existing.save();
        updated += 1;
        continue;
      }

      await Invoice.create({
        clientId: client._id,
        clientName: client.name,
        period,
        splitIndex: entry.splitIndex,
        splitLabel: entry.splitLabel,
        amount: entry.amount,
        currency: client.currency || "USD",
        issueDate,
        dueDate,
        status: guarantee ? "waived" : "pending",
        isGuarantee: Boolean(guarantee),
        guaranteeId: guarantee?._id ?? null,
        notes: guarantee ? "Mes de garantía: sin cobro" : undefined,
        autoGenerated: true,
        workspaceId: client.workspaceId || null,
      });
      created += 1;
    }
  }

  return { created, updated, skipped, period };
}

async function backfillForClient(clientId: string, opts: BackfillOptions) {
  const client = await Client.findById(clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  const from = new Date(opts.fromDate);
  if (Number.isNaN(from.getTime())) {
    throw new CustomError("La fecha de inicio del backfill es inválida", 400);
  }

  const periods = periodRange(from, new Date());
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const period of periods) {
    const result = await generateForPeriod(period, { clientIds: [clientId] });
    created += result.created;
    updated += result.updated;
    skipped += result.skipped;
  }

  let markedPaid = 0;
  let paymentsCreated = 0;

  if (opts.markPaidUntil) {
    const until = new Date(opts.markPaidUntil);
    if (Number.isNaN(until.getTime())) {
      throw new CustomError("La fecha markPaidUntil es inválida", 400);
    }

    const pending = await Invoice.find({
      clientId: client._id,
      dueDate: { $lte: until },
      status: { $in: OPEN_STATUSES },
    });

    for (const invoice of pending) {
      invoice.paidAmount = invoice.amount;
      invoice.paidAt = invoice.dueDate;
      invoice.status = "paid";
      await invoice.save();
      markedPaid += 1;

      const hasPayment = await Payment.exists({ invoiceId: invoice._id });
      if (!hasPayment) {
        await Payment.create({
          invoiceId: invoice._id,
          clientId: client._id,
          clientName: client.name,
          period: invoice.period,
          amount: invoice.amount,
          currency: invoice.currency,
          paidAt: invoice.dueDate,
          method: client.paymentMethod,
          notes: "Registro histórico (backfill)",
        });
        paymentsCreated += 1;
      }
    }
  }

  return {
    clientId,
    clientName: client.name,
    fromPeriod: toPeriod(from),
    periods: periods.length,
    created,
    updated,
    skipped,
    markedPaid,
    paymentsCreated,
  };
}

export const invoiceGenerationService = { generateForPeriod, backfillForClient };
