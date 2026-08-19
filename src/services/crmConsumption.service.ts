import { FilterQuery } from "mongoose";
import { AuditLog, CrmConsumption, ICrmConsumption, Payment } from "../models";
import { CustomError } from "../errors/customError.error";
import { PaginatedResult } from "../types/finance.types";
import { JwtPayload } from "../types/AuthRequest";
import { startOfPeriod, endOfPeriod, isValidPeriod } from "../utils/date.util";
import { paymentService } from "./payment.service";

export interface CrmChargeInput {
  clientId: unknown;
  clientName: string;
  stripeCustomerId?: string | null;
  stripeChargeId: string;
  amount: number;
  currency: string;
  paidAt: Date;
  description?: string;
  receiptUrl?: string;
  source: "stripe_webhook" | "stripe_import";
}

/** Guarda un cargo como consumo CRM. Idempotente: si ya existe (acá o como Payment), no duplica. */
async function record(input: CrmChargeInput): Promise<{ created: boolean; doc?: ICrmConsumption }> {
  const [asPayment, asConsumption] = await Promise.all([
    Payment.findOne({ stripeChargeId: input.stripeChargeId }),
    CrmConsumption.findOne({ stripeChargeId: input.stripeChargeId }),
  ]);
  if (asPayment || asConsumption) return { created: false, doc: asConsumption || undefined };

  const doc = await CrmConsumption.create({
    clientId: input.clientId,
    clientName: input.clientName,
    stripeCustomerId: input.stripeCustomerId || undefined,
    stripeChargeId: input.stripeChargeId,
    amount: input.amount,
    currency: input.currency,
    paidAt: input.paidAt,
    description: input.description,
    receiptUrl: input.receiptUrl,
    source: input.source,
  });

  return { created: true, doc };
}

export interface CrmListQuery {
  clientId?: string;
  period?: string;
  page?: number;
  limit?: number;
}

async function list(query: CrmListQuery = {}): Promise<
  PaginatedResult<ICrmConsumption> & {
    totals: { total: number; currentMonth: number; byClient: Array<{ clientId: string; clientName: string; total: number; count: number }> };
  }
> {
  const filter: FilterQuery<ICrmConsumption> = {};
  if (query.clientId) filter.clientId = query.clientId;
  if (query.period && isValidPeriod(query.period)) {
    filter.paidAt = { $gte: startOfPeriod(query.period), $lte: endOfPeriod(query.period) };
  }

  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [items, total, sums, monthSum, byClient] = await Promise.all([
    CrmConsumption.find(filter)
      .sort({ paidAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    CrmConsumption.countDocuments(filter),
    CrmConsumption.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    CrmConsumption.aggregate([
      { $match: { ...filter, paidAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    CrmConsumption.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$clientId",
          clientName: { $first: "$clientName" },
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { total: -1 } },
    ]),
  ]);

  return {
    items,
    total,
    page,
    limit,
    pages: Math.ceil(total / limit) || 1,
    totals: {
      total: Number((sums[0]?.total || 0).toFixed(2)),
      currentMonth: Number((monthSum[0]?.total || 0).toFixed(2)),
      byClient: byClient.map((c) => ({
        clientId: c._id.toString(),
        clientName: c.clientName,
        total: Number(c.total.toFixed(2)),
        count: c.count,
      })),
    },
  };
}

/**
 * Reclasifica: el cargo era una mensualidad. Se registra como Payment en la
 * factura indicada (con todos sus efectos) y sale de consumo CRM.
 */
async function applyToInvoice(id: string, invoiceId: string, user?: JwtPayload) {
  const doc = await CrmConsumption.findById(id);
  if (!doc) throw new CustomError("Consumo no encontrado", 404);

  const { payment, invoice } = await paymentService.register(
    {
      invoiceId,
      amount: doc.amount,
      paidAt: doc.paidAt,
      method: "stripe",
      reference: doc.stripeChargeId,
      notes: doc.description ? `Reclasificado desde consumo CRM: ${doc.description}` : "Reclasificado desde consumo CRM",
      stripeChargeId: doc.stripeChargeId,
      source: "stripe",
    },
    user
  );

  await doc.deleteOne();

  await AuditLog.create({
    action: "crm.applied_to_invoice",
    entity: "CrmConsumption",
    entityId: id,
    userId: user?._id,
    userName: user?.name,
    meta: { stripeChargeId: doc.stripeChargeId, invoiceId, amount: doc.amount },
  });

  return { payment, invoice, message: `Cargo aplicado a la factura como pago de ${doc.clientName}` };
}

async function remove(id: string, user?: JwtPayload) {
  const doc = await CrmConsumption.findById(id);
  if (!doc) throw new CustomError("Consumo no encontrado", 404);

  await doc.deleteOne();

  await AuditLog.create({
    action: "crm.removed",
    entity: "CrmConsumption",
    entityId: id,
    userId: user?._id,
    userName: user?.name,
    level: "warn",
    meta: { stripeChargeId: doc.stripeChargeId, amount: doc.amount, clientName: doc.clientName },
  });

  return { message: "Consumo eliminado del registro" };
}

export const crmConsumptionService = { record, list, applyToInvoice, remove };
