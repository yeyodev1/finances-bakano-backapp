import { Types } from "mongoose";
import { AuditLog, Client, IInvoice, Invoice } from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";
import { InvoiceStatus } from "../types/finance.types";
import { isValidPeriod, startOfDay, toPeriod } from "../utils/date.util";
import { emailService } from "./email.service";
import { resolveDueDate } from "./invoice.generation.service";

const CLOSED_STATUSES: InvoiceStatus[] = ["paid", "cancelled", "waived"];

export interface DeferInvoiceInput {
  newDueDate: Date | string;
  reason?: string;
  notes?: string;
}

export interface CreateAdvanceInvoiceInput {
  clientId: string;
  period: string;
  amount?: number;
  dueDate?: Date | string;
  splitIndex?: number;
  notes?: string;
}

function parseDate(value: Date | string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new CustomError(`${label} es inválida.`, 400);
  return date;
}

/** Estado que corresponde a la factura según su `dueDate` vigente y lo ya pagado. */
function resolveStatus(invoice: IInvoice): InvoiceStatus {
  if (invoice.amount > 0 && invoice.paidAmount >= invoice.amount) return "paid";
  if (startOfDay(invoice.dueDate) < startOfDay(new Date())) return "overdue";
  return invoice.paidAmount > 0 ? "partial" : "pending";
}

/** Reabre los marcadores de aviso para que los correos vuelvan a dispararse con la fecha nueva. */
function resetNotificationMarkers(invoice: IInvoice) {
  invoice.reminderSentAt = null;
  invoice.overdueNotifiedAt = null;
  invoice.deactivation = { ...invoice.deactivation, warnedAt: null };
  invoice.markModified("deactivation");
}

/**
 * Acuerdo de pago: mueve el vencimiento de ESTA factura únicamente. El `collectionDay`
 * del cliente no se toca, así que el período siguiente vuelve a su fecha habitual.
 */
async function deferInvoice(invoiceId: string, input: DeferInvoiceInput, user?: JwtPayload) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new CustomError("Factura no encontrada", 404);

  if (CLOSED_STATUSES.includes(invoice.status)) {
    throw new CustomError(
      "No puedes prorrogar una factura pagada, anulada o condonada.",
      400
    );
  }

  const newDueDate = parseDate(input.newDueDate, "La nueva fecha de vencimiento");
  const previousDueDate = new Date(invoice.dueDate);

  if (startOfDay(newDueDate).getTime() <= startOfDay(previousDueDate).getTime()) {
    throw new CustomError("La nueva fecha debe ser posterior al vencimiento actual.", 400);
  }

  if (!invoice.originalDueDate) invoice.originalDueDate = previousDueDate;

  invoice.deferrals.push({
    previousDueDate,
    newDueDate,
    reason: input.reason,
    notes: input.notes,
    agreedAt: new Date(),
    agreedBy: user?._id as unknown as Types.ObjectId,
    agreedByName: user?.name,
  });
  invoice.markModified("deferrals");

  invoice.dueDate = newDueDate;

  if (invoice.status === "overdue" && startOfDay(newDueDate) >= startOfDay(new Date())) {
    invoice.status = invoice.paidAmount > 0 ? "partial" : "pending";
  }

  resetNotificationMarkers(invoice);
  await invoice.save();

  const client = await Client.findById(invoice.clientId);

  await AuditLog.create({
    action: "invoice.defer",
    entity: "Invoice",
    entityId: invoice._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      clientId: invoice.clientId?.toString(),
      period: invoice.period,
      previousDueDate,
      newDueDate,
      reason: input.reason,
      deferralCount: invoice.deferrals.length,
    },
  });

  try {
    await emailService.sendPaymentDeferred({
      invoice,
      client,
      previousDueDate,
      newDueDate,
      reason: input.reason,
    });
  } catch (error) {
    console.error("[invoice] Falló el email de acuerdo de pago:", error);
  }

  return invoice;
}

/** Deshace la última prórroga y devuelve el vencimiento al valor anterior. */
async function removeLastDeferral(invoiceId: string, user?: JwtPayload) {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw new CustomError("Factura no encontrada", 404);

  const last = invoice.deferrals[invoice.deferrals.length - 1];
  if (!last) throw new CustomError("La factura no tiene prórrogas registradas.", 400);

  invoice.dueDate = new Date(last.previousDueDate);
  invoice.deferrals.splice(invoice.deferrals.length - 1, 1);
  invoice.markModified("deferrals");

  if (invoice.deferrals.length === 0) invoice.originalDueDate = null;

  if (!CLOSED_STATUSES.includes(invoice.status)) {
    invoice.status = resolveStatus(invoice);
  }

  resetNotificationMarkers(invoice);
  await invoice.save();

  await AuditLog.create({
    action: "invoice.defer.remove",
    entity: "Invoice",
    entityId: invoice._id.toString(),
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: {
      clientId: invoice.clientId?.toString(),
      period: invoice.period,
      restoredDueDate: invoice.dueDate,
      removedNewDueDate: last.newDueDate,
    },
  });

  return invoice;
}

/**
 * Cobro anticipado: crea la factura de un período futuro (o del actual) antes de que
 * corra el generador mensual, para poder registrarle el pago hoy.
 */
async function createAdvanceInvoice(input: CreateAdvanceInvoiceInput, user?: JwtPayload) {
  if (!isValidPeriod(input.period)) {
    throw new CustomError(`Período inválido: ${input.period}. Formato esperado YYYY-MM.`, 400);
  }

  if (input.period < toPeriod()) {
    throw new CustomError(
      "Un cobro anticipado solo puede crearse para el período actual o uno futuro.",
      400
    );
  }

  const client = await Client.findById(input.clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);
  if (client.isArchived) {
    throw new CustomError("No puedes crear cobros para un cliente dado de baja.", 400);
  }

  const splitIndex = input.splitIndex ?? 0;
  const split = client.splits?.[splitIndex];

  if (splitIndex > 0 && !split) {
    throw new CustomError(`El cliente no tiene un cobro dividido en la posición ${splitIndex}.`, 400);
  }

  const existing = await Invoice.findOne({
    clientId: client._id,
    period: input.period,
    splitIndex,
  });
  if (existing) return { invoice: existing, created: false };

  const amount = input.amount ?? split?.amount ?? client.amount;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CustomError("El monto del cobro anticipado debe ser mayor a cero.", 400);
  }

  const dueDate = input.dueDate
    ? parseDate(input.dueDate, "La fecha de vencimiento")
    : resolveDueDate(input.period, split?.day ?? client.collectionDay, client);

  const invoice = await Invoice.create({
    clientId: client._id,
    clientName: client.name,
    period: input.period,
    splitIndex,
    splitLabel: split?.label,
    amount,
    currency: client.currency || "USD",
    issueDate: new Date(),
    dueDate,
    status: "pending",
    isAdvance: true,
    autoGenerated: false,
    notes: input.notes,
    workspaceId: client.workspaceId || null,
    createdBy: user?._id,
  });

  await AuditLog.create({
    action: "invoice.advance.create",
    entity: "Invoice",
    entityId: invoice._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      clientId: client._id.toString(),
      period: input.period,
      splitIndex,
      amount,
      dueDate,
    },
  });

  return { invoice, created: true };
}

export const invoiceDeferralService = {
  deferInvoice,
  removeLastDeferral,
  createAdvanceInvoice,
};
