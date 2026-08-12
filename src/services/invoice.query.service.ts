import { FilterQuery } from "mongoose";
import { Client, IInvoice, Invoice } from "../models";
import { CustomError } from "../errors/customError.error";
import { InvoiceStatus, PaginatedResult } from "../types/finance.types";
import { isValidPeriod, startOfDay } from "../utils/date.util";

export interface InvoiceListQuery {
  period?: string;
  status?: InvoiceStatus;
  clientId?: string;
  /** Responsable de cobro: se resuelve a los clientes que tiene asignados. */
  ownerId?: string;
  q?: string;
  overdueOnly?: boolean;
  /** Solo facturas con al menos una prórroga registrada. */
  deferredOnly?: boolean;
  /** Solo cobros anticipados. */
  advanceOnly?: boolean;
  page?: number;
  limit?: number;
}

const OPEN_STATUSES: InvoiceStatus[] = ["pending", "partial", "overdue"];

async function list(query: InvoiceListQuery = {}): Promise<PaginatedResult<IInvoice>> {
  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const filter: FilterQuery<IInvoice> = {};
  if (query.period) filter.period = query.period;
  if (query.status) filter.status = query.status;
  if (query.clientId) filter.clientId = query.clientId;
  if (query.ownerId) {
    // La factura no guarda responsable: vive en el cliente. Se resuelven sus ids
    // primero para no arrastrar un $lookup en cada consulta del listado.
    const owned = await Client.find({ ownerId: query.ownerId }).select("_id").lean();
    filter.clientId = query.clientId
      ? query.clientId
      : { $in: owned.map((c) => c._id) };
  }
  if (query.q) filter.clientName = { $regex: query.q, $options: "i" };
  if (query.overdueOnly) {
    filter.status = { $in: ["pending", "partial", "overdue"] };
    filter.dueDate = { $lt: startOfDay(new Date()) };
  }
  if (query.deferredOnly) filter["deferrals.0"] = { $exists: true };
  if (query.advanceOnly) filter.isAdvance = true;

  const [items, total] = await Promise.all([
    Invoice.find(filter)
      .populate("clientId", "name contactEmail workspaceId workspaceName workspaceImageUrl isActive paymentMethod")
      .sort({ dueDate: -1, clientName: 1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Invoice.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

async function getById(id: string): Promise<IInvoice> {
  const invoice = await Invoice.findById(id).populate(
    "clientId",
    "name contactEmail workspaceId workspaceName isActive"
  );
  if (!invoice) throw new CustomError("Factura no encontrada", 404);
  return invoice;
}

async function update(id: string, input: Partial<IInvoice>) {
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new CustomError("Factura no encontrada", 404);

  if (invoice.status === "paid" && typeof input.amount === "number") {
    throw new CustomError("No puedes cambiar el monto de una factura pagada", 409);
  }

  const allowed = ["amount", "dueDate", "issueDate", "notes", "splitLabel", "status"] as const;
  allowed.forEach((key) => {
    if (input[key] !== undefined) {
      (invoice as unknown as Record<string, unknown>)[key] = input[key];
    }
  });

  if (typeof input.amount === "number") {
    invoice.status =
      invoice.paidAmount >= input.amount && input.amount > 0
        ? "paid"
        : invoice.paidAmount > 0
          ? "partial"
          : invoice.status;
  }

  await invoice.save();
  return invoice;
}

async function markWaived(id: string, reason: string) {
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new CustomError("Factura no encontrada", 404);

  if (invoice.status === "paid") {
    throw new CustomError("No puedes condonar una factura ya pagada", 409);
  }

  invoice.status = "waived";
  invoice.notes = [invoice.notes, `Condonada: ${reason}`].filter(Boolean).join(" | ");
  await invoice.save();
  return invoice;
}

async function cancel(id: string, reason: string) {
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new CustomError("Factura no encontrada", 404);

  if (invoice.paidAmount > 0) {
    throw new CustomError("No puedes anular una factura con pagos registrados", 409);
  }

  invoice.status = "cancelled";
  invoice.notes = [invoice.notes, `Anulada: ${reason}`].filter(Boolean).join(" | ");
  await invoice.save();
  return invoice;
}

/** La mora siempre se mide contra el `dueDate` vigente, es decir el ya prorrogado. */
async function recalcStatuses() {
  const today = startOfDay(new Date());

  const result = await Invoice.updateMany(
    { status: { $in: ["pending", "partial"] }, dueDate: { $lt: today } },
    { $set: { status: "overdue" } }
  );

  return { updated: result.modifiedCount || 0, evaluatedAt: today };
}

async function summaryByPeriod(period: string) {
  if (!isValidPeriod(period)) {
    throw new CustomError(`Período inválido: ${period}. Formato esperado YYYY-MM.`, 400);
  }

  const rows = await Invoice.aggregate<{
    _id: InvoiceStatus;
    count: number;
    amount: number;
    paidAmount: number;
  }>([
    { $match: { period } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        amount: { $sum: "$amount" },
        paidAmount: { $sum: "$paidAmount" },
      },
    },
  ]);

  const byStatus = Object.fromEntries(rows.map((row) => [row._id, row]));
  const sum = (key: "count" | "amount" | "paidAmount", statuses: InvoiceStatus[]) =>
    statuses.reduce((acc, status) => acc + (byStatus[status]?.[key] || 0), 0);

  const billable: InvoiceStatus[] = ["pending", "partial", "paid", "overdue"];
  const expectedAmount = sum("amount", billable);
  const collectedAmount = sum("paidAmount", billable);

  return {
    period,
    total: sum("count", ["pending", "partial", "paid", "overdue", "waived", "cancelled"]),
    paid: sum("count", ["paid"]),
    pending: sum("count", ["pending", "partial"]),
    overdue: sum("count", ["overdue"]),
    waived: sum("count", ["waived"]),
    cancelled: sum("count", ["cancelled"]),
    collectedAmount,
    expectedAmount,
    pendingAmount: Math.max(expectedAmount - collectedAmount, 0),
    collectionRate: expectedAmount > 0 ? Number((collectedAmount / expectedAmount).toFixed(4)) : 0,
  };
}

/** Devuelve true si el cliente ya no tiene facturas vencidas impagas. */
async function hasNoOverdueInvoices(clientId: string): Promise<boolean> {
  const today = startOfDay(new Date());
  const pending = await Invoice.countDocuments({
    clientId,
    status: { $in: OPEN_STATUSES },
    dueDate: { $lt: today },
  });
  return pending === 0;
}

async function assertClientExists(clientId: string) {
  const exists = await Client.exists({ _id: clientId });
  if (!exists) throw new CustomError("Cliente no encontrado", 404);
}

export const invoiceQueryService = {
  list,
  getById,
  update,
  markWaived,
  cancel,
  recalcStatuses,
  summaryByPeriod,
  hasNoOverdueInvoices,
  assertClientExists,
};
