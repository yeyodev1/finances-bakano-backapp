import { FilterQuery, Types } from "mongoose";
import { AuditLog, Client, IRefund, Invoice, Payment, Refund } from "../models";
import { CustomError } from "../errors/customError.error";
import {
  PaginatedResult,
  PaymentMethod,
  REFUND_REASON_LABELS,
  RefundReason,
} from "../types/finance.types";
import { JwtPayload } from "../types/AuthRequest";
import { toPeriod } from "../utils/date.util";
import { cloudinaryService } from "./cloudinary.service";
import { clientLifecycleService } from "./client.lifecycle.service";

const RECEIPT_FOLDER = "bakano-finanzas/reembolsos";

export interface RegisterRefundInput {
  /** Pago devuelto. Si se manda, de acá salen factura, cliente y período. */
  paymentId?: string;
  /** Alternativa cuando la devolución no se puede atar a un pago puntual. */
  invoiceId?: string;
  amount: number;
  reason: RefundReason;
  refundedAt?: Date | string;
  method?: PaymentMethod;
  reference?: string;
  notes?: string;
  receipt?: Buffer;
  /** Devolver y despedir en un solo paso: deja al cliente de baja por "reembolso". */
  archiveClient?: boolean;
  archiveNotes?: string;
  /** Uso interno: garantía que terminó en devolución. */
  guaranteeId?: string;
}

export interface RefundListQuery {
  clientId?: string;
  period?: string;
  reason?: RefundReason;
  from?: Date | string;
  to?: Date | string;
  page?: number;
  limit?: number;
}

const round2 = (value: number) => Math.round((value || 0) * 100) / 100;

function toObjectId(value?: string): Types.ObjectId | undefined {
  return value && Types.ObjectId.isValid(value) ? new Types.ObjectId(value) : undefined;
}

/** Cuánto queda por devolver de una factura: lo cobrado menos lo ya reembolsado. */
export async function refundableOf(invoiceId: Types.ObjectId): Promise<number> {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) return 0;
  return round2(Math.max((invoice.paidAmount || 0) - (invoice.refundedAmount || 0), 0));
}

/**
 * Registra la devolución.
 *
 * Ni el pago ni el estado de la factura se tocan: el cobro ocurrió y la caja del mes
 * en que entró no se reescribe. Solo se acumula `refundedAmount` en la factura para
 * poder mostrar el neto.
 */
async function register(input: RegisterRefundInput, user?: JwtPayload) {
  const reason = input.reason;
  if (!reason || !REFUND_REASON_LABELS[reason]) {
    throw new CustomError("Debes indicar el motivo del reembolso.", 400);
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CustomError("El monto del reembolso debe ser mayor a cero", 400);
  }

  const payment = input.paymentId ? await Payment.findById(input.paymentId) : null;
  if (input.paymentId && !payment) throw new CustomError("Pago no encontrado", 404);

  const invoiceId = payment?.invoiceId?.toString() || input.invoiceId;
  const invoice = invoiceId ? await Invoice.findById(invoiceId) : null;
  if (!invoice) {
    throw new CustomError("Indica el pago o la factura que se está devolviendo.", 400);
  }

  const client = await Client.findById(invoice.clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  const alreadyRefunded = round2(invoice.refundedAmount || 0);
  const collected = round2(invoice.paidAmount || 0);
  if (collected <= 0) {
    throw new CustomError(
      "Esta factura no tiene pagos registrados: no hay nada que devolver.",
      400
    );
  }

  const refundable = round2(collected - alreadyRefunded);
  if (amount > refundable + 0.009) {
    throw new CustomError(
      `El reembolso supera lo cobrado en este período (disponible ${refundable.toFixed(2)}).`,
      400
    );
  }

  const refundedAt = input.refundedAt ? new Date(input.refundedAt) : new Date();
  if (Number.isNaN(refundedAt.getTime())) {
    throw new CustomError("La fecha del reembolso es inválida", 400);
  }

  let receiptUrl: string | undefined;
  let receiptPublicId: string | undefined;
  if (input.receipt) {
    const uploaded = await cloudinaryService.uploadBuffer(input.receipt, RECEIPT_FOLDER);
    receiptUrl = uploaded.url;
    receiptPublicId = uploaded.publicId;
  }

  const refund = await Refund.create({
    paymentId: payment?._id ?? null,
    invoiceId: invoice._id,
    clientId: client._id,
    clientName: client.name,
    period: invoice.period,
    amount: round2(amount),
    currency: invoice.currency || "USD",
    refundedAt,
    method: input.method || payment?.method || client.paymentMethod,
    reference: input.reference,
    reason,
    notes: input.notes,
    receiptUrl,
    receiptPublicId,
    guaranteeId: toObjectId(input.guaranteeId) ?? null,
    archivedClient: false,
    registeredBy: user?._id,
    registeredByName: user?.name,
  });

  invoice.refundedAmount = round2(alreadyRefunded + amount);
  invoice.refundedAt = refundedAt;
  await invoice.save();

  // La baja va después de guardar el reembolso: si archivar falla, la devolución
  // ya quedó asentada y el error se ve, en vez de perderse el asiento.
  let archived = false;
  if (input.archiveClient && !client.isArchived) {
    await clientLifecycleService.archive(
      client._id.toString(),
      {
        reason: "reembolso",
        notes:
          input.archiveNotes?.trim() ||
          `Reembolso de ${round2(amount).toFixed(2)} ${invoice.currency || "USD"} — ${
            REFUND_REASON_LABELS[reason]
          }`,
        archivedAt: refundedAt,
      },
      user
    );
    archived = true;
    refund.archivedClient = true;
    await refund.save();
  }

  await AuditLog.create({
    action: "refund.register",
    entity: "Refund",
    entityId: refund._id.toString(),
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: {
      clientId: client._id.toString(),
      invoiceId: invoice._id.toString(),
      paymentId: payment?._id?.toString(),
      amount: round2(amount),
      period: invoice.period,
      reason,
      label: REFUND_REASON_LABELS[reason],
      archivedClient: archived,
    },
  });

  return {
    refund,
    invoice,
    archived,
    netCollected: round2((invoice.paidAmount || 0) - (invoice.refundedAmount || 0)),
    message: archived
      ? "Reembolso registrado y cliente dado de baja"
      : "Reembolso registrado correctamente",
  };
}

async function list(query: RefundListQuery = {}): Promise<PaginatedResult<IRefund>> {
  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const filter: FilterQuery<IRefund> = {};
  if (query.clientId) filter.clientId = query.clientId;
  if (query.period) filter.period = query.period;
  if (query.reason) filter.reason = query.reason;

  if (query.from || query.to) {
    const range: Record<string, Date> = {};
    if (query.from) range.$gte = new Date(query.from);
    if (query.to) range.$lte = new Date(query.to);
    filter.refundedAt = range;
  }

  const [items, total] = await Promise.all([
    Refund.find(filter)
      .populate("invoiceId", "period amount status dueDate splitIndex paidAmount")
      .sort({ refundedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Refund.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

export interface RefundReasonRow {
  reason: RefundReason;
  label: string;
  count: number;
  amount: number;
}

export interface RefundSummary {
  count: number;
  amount: number;
  monthCount: number;
  monthAmount: number;
  archivedClients: number;
  byReason: RefundReasonRow[];
}

/** Cuánto se devolvió en total, este mes, y por qué. */
async function summary(): Promise<RefundSummary> {
  const period = toPeriod();

  const [totals, month, byReason, archivedClients] = await Promise.all([
    Refund.aggregate<{ count: number; amount: number }>([
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
    Refund.aggregate<{ count: number; amount: number }>([
      { $match: { period } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    ]),
    Refund.aggregate<{ _id: RefundReason; count: number; amount: number }>([
      { $group: { _id: "$reason", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
      { $sort: { amount: -1, count: -1 } },
    ]),
    Refund.countDocuments({ archivedClient: true }),
  ]);

  return {
    count: totals[0]?.count || 0,
    amount: round2(totals[0]?.amount || 0),
    monthCount: month[0]?.count || 0,
    monthAmount: round2(month[0]?.amount || 0),
    archivedClients,
    byReason: byReason.map((row) => ({
      reason: row._id,
      label: REFUND_REASON_LABELS[row._id] || String(row._id),
      count: row.count,
      amount: round2(row.amount),
    })),
  };
}

async function getById(id: string) {
  const refund = await Refund.findById(id).populate(
    "invoiceId",
    "period amount status dueDate splitIndex paidAmount"
  );
  if (!refund) throw new CustomError("Reembolso no encontrado", 404);
  return refund;
}

async function listByClient(clientId: string, limit = 100): Promise<IRefund[]> {
  const max = Math.min(Math.max(Number(limit) || 100, 1), 200);
  return Refund.find({ clientId }).sort({ refundedAt: -1 }).limit(max);
}

/** Deshace un reembolso mal cargado. La baja que haya disparado se revierte a mano. */
async function remove(id: string, user?: JwtPayload) {
  const refund = await Refund.findById(id);
  if (!refund) throw new CustomError("Reembolso no encontrado", 404);

  const invoice = refund.invoiceId ? await Invoice.findById(refund.invoiceId) : null;
  if (invoice) {
    invoice.refundedAmount = round2(Math.max((invoice.refundedAmount || 0) - refund.amount, 0));
    if (invoice.refundedAmount <= 0) invoice.refundedAt = null;
    await invoice.save();
  }

  if (refund.receiptPublicId) {
    try {
      await cloudinaryService.destroy(refund.receiptPublicId);
    } catch (error) {
      console.error("[refund] No se pudo borrar el comprobante en Cloudinary:", error);
    }
  }

  await refund.deleteOne();

  await AuditLog.create({
    action: "refund.remove",
    entity: "Refund",
    entityId: id,
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: {
      clientId: refund.clientId?.toString(),
      amount: refund.amount,
      period: refund.period,
      archivedClient: refund.archivedClient,
    },
  });

  return {
    message: refund.archivedClient
      ? "Reembolso eliminado. El cliente sigue dado de baja: reactívalo desde su ficha si corresponde."
      : "Reembolso eliminado y factura recalculada",
  };
}

export const refundService = {
  register,
  list,
  listByClient,
  summary,
  getById,
  remove,
  refundableOf,
};
