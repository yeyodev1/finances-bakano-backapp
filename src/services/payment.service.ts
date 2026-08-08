import { FilterQuery } from "mongoose";
import { AuditLog, Client, Invoice, IPayment, Payment } from "../models";
import { CustomError } from "../errors/customError.error";
import { PaginatedResult, PaymentMethod } from "../types/finance.types";
import { JwtPayload } from "../types/AuthRequest";
import { startOfDay } from "../utils/date.util";
import { cloudinaryService } from "./cloudinary.service";
import { emailService } from "./email.service";
import { metricsService } from "./metrics.service";

const RECEIPT_FOLDER = "bakano-finanzas/comprobantes";
const OPEN_STATUSES = ["pending", "partial", "overdue"];

export interface RegisterPaymentInput {
  invoiceId: string;
  amount: number;
  paidAt?: Date | string;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;
  receipt?: Buffer;
}

export interface PaymentListQuery {
  clientId?: string;
  period?: string;
  method?: PaymentMethod;
  from?: Date | string;
  to?: Date | string;
  page?: number;
  limit?: number;
}

async function hasOverdueInvoices(clientId: unknown): Promise<boolean> {
  const count = await Invoice.countDocuments({
    clientId,
    status: { $in: OPEN_STATUSES },
    dueDate: { $lt: startOfDay(new Date()) },
  });
  return count > 0;
}

async function maybeReactivateWorkspace(clientId: unknown, invoiceId: unknown) {
  const client = await Client.findById(clientId);
  if (!client || !client.workspaceId || !client.deactivatedAt) return;
  if (await hasOverdueInvoices(client._id)) return;

  try {
    await metricsService.setWorkspaceActive(client.workspaceId, true, "Pago registrado");
    client.workspaceIsActive = true;
  } catch (error) {
    console.error("[payment] No se pudo reactivar el workspace:", error);
    return;
  }

  client.deactivatedAt = null;
  client.deactivationReason = undefined;
  await client.save();

  const invoice = await Invoice.findById(invoiceId);
  if (invoice) {
    invoice.deactivation = { ...invoice.deactivation, reactivatedAt: new Date() };
    await invoice.save();
  }

  try {
    await emailService.sendWorkspaceReactivated({ client, invoice });
  } catch (error) {
    console.error("[payment] Falló el email de reactivación:", error);
  }
}

async function register(input: RegisterPaymentInput, user?: JwtPayload) {
  const invoice = await Invoice.findById(input.invoiceId);
  if (!invoice) throw new CustomError("Factura no encontrada", 404);

  if (invoice.status === "cancelled" || invoice.status === "waived") {
    throw new CustomError("No puedes registrar pagos en una factura anulada o condonada", 409);
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CustomError("El monto del pago debe ser mayor a cero", 400);
  }

  const client = await Client.findById(invoice.clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  let receiptUrl: string | undefined;
  let receiptPublicId: string | undefined;

  if (input.receipt) {
    const uploaded = await cloudinaryService.uploadBuffer(input.receipt, RECEIPT_FOLDER);
    receiptUrl = uploaded.url;
    receiptPublicId = uploaded.publicId;
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    throw new CustomError("La fecha de pago es inválida", 400);
  }

  const payment = await Payment.create({
    invoiceId: invoice._id,
    clientId: client._id,
    clientName: client.name,
    period: invoice.period,
    amount,
    currency: invoice.currency,
    paidAt,
    method: input.method || client.paymentMethod,
    reference: input.reference,
    notes: input.notes,
    receiptUrl,
    receiptPublicId,
    registeredBy: user?._id,
    registeredByName: user?.name,
  });

  // Cobro anticipado con vencimiento futuro: no hay mora que regularizar, así que
  // no se toca el workspace.
  const isEarlyAdvance =
    Boolean(invoice.isAdvance) && startOfDay(invoice.dueDate) > startOfDay(new Date());

  invoice.paidAmount = Number((invoice.paidAmount + amount).toFixed(2));
  invoice.status = invoice.paidAmount >= invoice.amount ? "paid" : "partial";
  invoice.paidAt = paidAt;
  await invoice.save();

  if (!isEarlyAdvance) {
    await maybeReactivateWorkspace(client._id, invoice._id);
  }

  try {
    await emailService.sendPaymentRegistered({ invoice, payment, client });
  } catch (error) {
    console.error("[payment] Falló el email de pago registrado:", error);
  }

  await AuditLog.create({
    action: "payment.register",
    entity: "Payment",
    entityId: payment._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      invoiceId: invoice._id.toString(),
      clientId: client._id.toString(),
      amount,
      period: invoice.period,
      invoiceStatus: invoice.status,
      isAdvance: Boolean(invoice.isAdvance),
    },
  });

  return { payment, invoice, isAdvance: Boolean(invoice.isAdvance) };
}

async function list(query: PaymentListQuery = {}): Promise<PaginatedResult<IPayment>> {
  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const filter: FilterQuery<IPayment> = {};
  if (query.clientId) filter.clientId = query.clientId;
  if (query.period) filter.period = query.period;
  if (query.method) filter.method = query.method;

  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(query.from);
    if (query.to) range.$lte = new Date(query.to);
    filter.paidAt = range;
  }

  const [items, total] = await Promise.all([
    Payment.find(filter)
      .populate("invoiceId", "period amount status dueDate splitIndex")
      .sort({ paidAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Payment.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

async function getById(id: string) {
  const payment = await Payment.findById(id).populate(
    "invoiceId",
    "period amount status dueDate splitIndex"
  );
  if (!payment) throw new CustomError("Pago no encontrado", 404);
  return payment;
}

async function remove(id: string, user?: JwtPayload) {
  const payment = await Payment.findById(id);
  if (!payment) throw new CustomError("Pago no encontrado", 404);

  const invoice = await Invoice.findById(payment.invoiceId);

  if (invoice) {
    invoice.paidAmount = Math.max(Number((invoice.paidAmount - payment.amount).toFixed(2)), 0);

    if (invoice.paidAmount <= 0) {
      invoice.paidAmount = 0;
      invoice.paidAt = null;
      invoice.status = invoice.dueDate < startOfDay(new Date()) ? "overdue" : "pending";
    } else if (invoice.paidAmount < invoice.amount) {
      invoice.status = "partial";
    } else {
      invoice.status = "paid";
    }

    await invoice.save();
  }

  if (payment.receiptPublicId) {
    try {
      await cloudinaryService.destroy(payment.receiptPublicId);
    } catch (error) {
      console.error("[payment] No se pudo borrar el comprobante en Cloudinary:", error);
    }
  }

  await payment.deleteOne();

  await AuditLog.create({
    action: "payment.remove",
    entity: "Payment",
    entityId: id,
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: {
      invoiceId: payment.invoiceId?.toString(),
      clientId: payment.clientId?.toString(),
      amount: payment.amount,
      period: payment.period,
    },
  });

  return { message: "Pago eliminado y factura recalculada" };
}

export const paymentService = { register, list, getById, remove };
