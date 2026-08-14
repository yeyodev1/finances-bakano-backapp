import { FilterQuery, Types } from "mongoose";
import { AuditLog, Client, Guarantee, IClient, IGuarantee, Invoice } from "../models";
import { CustomError } from "../errors/customError.error";
import {
  GUARANTEE_MAX_CYCLES,
  GUARANTEE_OPEN_STATUSES,
  GUARANTEE_STATUS_LABELS,
  GuaranteeOutcome,
  GuaranteeStatus,
  PaginatedResult,
  RefundReason,
} from "../types/finance.types";
import { JwtPayload } from "../types/AuthRequest";
import { addMonthsToPeriod, isValidPeriod, toPeriod } from "../utils/date.util";
import { clientLifecycleService, monthlyAmountOf } from "./client.lifecycle.service";
import { refundService } from "./refund.service";

const OPEN_INVOICE_STATUSES = ["pending", "partial", "overdue"];
const WAIVE_NOTE = "Mes de garantía: sin cobro";

export interface OpenGuaranteeInput {
  clientId: string;
  /** Mes que se regala. Por defecto, el siguiente al actual. */
  period?: string;
  /** Mes que salió sin resultados y motivó la garantía. Por defecto, el actual. */
  triggerPeriod?: string;
  reason?: string;
}

export interface ExtendGuaranteeInput {
  /** Segundo mes regalado. Por defecto, el siguiente al último ciclo. */
  period?: string;
  /** Qué se vio en el primer mes. */
  resultNotes?: string;
}

export interface CloseGuaranteeInput {
  outcome: GuaranteeOutcome;
  notes?: string;
  /** Solo aplica a `fallida`. Por defecto sí se archiva al cliente. */
  archiveClient?: boolean;
  /** Devolución opcional al cerrar por fracaso. */
  refund?: {
    paymentId?: string;
    invoiceId?: string;
    amount: number;
    reason?: RefundReason;
    refundedAt?: string;
    notes?: string;
  };
}

export interface GuaranteeListQuery {
  clientId?: string;
  status?: GuaranteeStatus;
  open?: boolean;
  page?: number;
  limit?: number;
}

const round2 = (value: number) => Math.round((value || 0) * 100) / 100;

function assertPeriod(period: string, field: string): string {
  if (!isValidPeriod(period)) {
    throw new CustomError(`${field} inválido: ${period}. Formato esperado YYYY-MM.`, 400);
  }
  return period;
}

async function findGuarantee(id: string): Promise<IGuarantee> {
  const guarantee = await Guarantee.findById(id);
  if (!guarantee) throw new CustomError("Garantía no encontrada", 404);
  return guarantee;
}

/** Copia el estado vigente al cliente para poder listarlo sin una consulta por fila. */
async function syncClientCache(client: IClient, guarantee: IGuarantee | null) {
  const open = guarantee && GUARANTEE_OPEN_STATUSES.includes(guarantee.status);
  const last = guarantee?.cycles[guarantee.cycles.length - 1];

  client.guarantee = open
    ? {
        status: guarantee!.status,
        guaranteeId: guarantee!._id,
        cycle: last?.cycle ?? guarantee!.cycles.length,
        period: last?.period ?? null,
        since: guarantee!.openedAt,
      }
    : { status: null, guaranteeId: null, cycle: 0, period: null, since: null };

  await client.save();
}

/**
 * Deja el período sin cobro: las facturas abiertas de ese mes pasan a `waived` y
 * quedan marcadas como garantía. No se borran para que el monto regalado siga a la
 * vista — es el costo real de la política.
 */
async function waivePeriod(guarantee: IGuarantee, period: string) {
  const invoices = await Invoice.find({
    clientId: guarantee.clientId,
    period,
    status: { $in: OPEN_INVOICE_STATUSES },
  });

  let waivedAmount = 0;
  const invoiceIds: Types.ObjectId[] = [];

  for (const invoice of invoices) {
    invoice.status = "waived";
    invoice.isGuarantee = true;
    invoice.guaranteeId = guarantee._id;
    invoice.notes = invoice.notes ? `${invoice.notes} | ${WAIVE_NOTE}` : WAIVE_NOTE;
    await invoice.save();
    waivedAmount += Math.max(invoice.amount - (invoice.paidAmount || 0), 0);
    invoiceIds.push(invoice._id);
  }

  // Sin facturas emitidas todavía se estima con el cobro mensual: la generación
  // mensual las creará ya condonadas (ver invoice.generation.service).
  return {
    invoiceIds,
    waivedAmount: round2(waivedAmount || (invoices.length ? 0 : guarantee.monthlyAmount)),
  };
}

/** Devuelve a `pending` lo condonado por una garantía que se cancela. */
async function unwaivePeriods(guarantee: IGuarantee) {
  const result = await Invoice.updateMany(
    { guaranteeId: guarantee._id, status: "waived" },
    { $set: { status: "pending", isGuarantee: false, guaranteeId: null } }
  );
  return result.modifiedCount || 0;
}

async function open(input: OpenGuaranteeInput, user?: JwtPayload) {
  const client = await Client.findById(input.clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);
  if (client.isArchived) {
    throw new CustomError(
      "Este cliente está dado de baja. Reactívalo antes de darle garantía.",
      400
    );
  }

  const existing = await Guarantee.findOne({
    clientId: client._id,
    status: { $in: GUARANTEE_OPEN_STATUSES },
  });
  if (existing) {
    throw new CustomError("Este cliente ya tiene una garantía en curso.", 409);
  }

  const now = toPeriod();
  const triggerPeriod = assertPeriod(input.triggerPeriod || now, "Período");
  const period = assertPeriod(input.period || addMonthsToPeriod(now, 1), "Mes de garantía");

  if (period < triggerPeriod) {
    throw new CustomError(
      "El mes de garantía no puede ser anterior al mes que quedó sin resultados.",
      400
    );
  }

  const monthlyAmount = monthlyAmountOf(client);

  const guarantee = await Guarantee.create({
    clientId: client._id,
    clientName: client.name,
    status: "abierta",
    triggerPeriod,
    reason: input.reason?.trim(),
    maxCycles: GUARANTEE_MAX_CYCLES,
    monthlyAmount,
    openedAt: new Date(),
    openedBy: user?._id,
    openedByName: user?.name,
    cycles: [],
  });

  const { invoiceIds, waivedAmount } = await waivePeriod(guarantee, period);

  guarantee.cycles.push({
    cycle: 1,
    period,
    invoiceIds,
    waivedAmount,
    openedAt: new Date(),
    by: user?._id ? new Types.ObjectId(user._id) : undefined,
    byName: user?.name,
  });
  await guarantee.save();

  await syncClientCache(client, guarantee);

  await AuditLog.create({
    action: "guarantee.open",
    entity: "Guarantee",
    entityId: guarantee._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      clientId: client._id.toString(),
      triggerPeriod,
      period,
      waivedAmount,
      waivedInvoices: invoiceIds.length,
    },
  });

  return {
    guarantee,
    client,
    waivedAmount,
    waivedInvoices: invoiceIds.length,
    message: `Garantía abierta: ${client.name} no paga ${period}`,
  };
}

/** Segundo mes sin cobro. Es el último que permite la política. */
async function extend(id: string, input: ExtendGuaranteeInput = {}, user?: JwtPayload) {
  const guarantee = await findGuarantee(id);
  if (!GUARANTEE_OPEN_STATUSES.includes(guarantee.status)) {
    throw new CustomError(
      `Esta garantía ya está cerrada (${GUARANTEE_STATUS_LABELS[guarantee.status]}).`,
      400
    );
  }
  if (guarantee.cycles.length >= guarantee.maxCycles) {
    throw new CustomError(
      `La política permite ${guarantee.maxCycles} meses de garantía y ya se usaron. ` +
        "Ciérrala como cumplida o como fracaso.",
      400
    );
  }

  const last = guarantee.cycles[guarantee.cycles.length - 1];
  const period = assertPeriod(
    input.period || addMonthsToPeriod(last?.period || toPeriod(), 1),
    "Mes de garantía"
  );

  if (last?.period && period <= last.period) {
    throw new CustomError("El segundo mes de garantía debe ser posterior al primero.", 400);
  }

  if (last && input.resultNotes?.trim()) {
    last.resultNotes = input.resultNotes.trim();
    guarantee.markModified("cycles");
  }

  const { invoiceIds, waivedAmount } = await waivePeriod(guarantee, period);

  guarantee.status = "extendida";
  guarantee.cycles.push({
    cycle: guarantee.cycles.length + 1,
    period,
    invoiceIds,
    waivedAmount,
    openedAt: new Date(),
    by: user?._id ? new Types.ObjectId(user._id) : undefined,
    byName: user?.name,
  });
  await guarantee.save();

  const client = await Client.findById(guarantee.clientId);
  if (client) await syncClientCache(client, guarantee);

  await AuditLog.create({
    action: "guarantee.extend",
    entity: "Guarantee",
    entityId: guarantee._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { period, waivedAmount, cycle: guarantee.cycles.length },
  });

  return {
    guarantee,
    waivedAmount,
    message: `Garantía extendida: ${guarantee.clientName} tampoco paga ${period}`,
  };
}

/**
 * Cierra la garantía.
 *
 * - `cumplida`: aparecieron resultados y el cliente vuelve a la facturación normal.
 * - `fallida`: se agotaron los meses sin cambio. Por defecto da de baja al cliente
 *   con motivo `garantia_fallida`, y admite devolver el dinero en el mismo paso.
 * - `cancelada`: se abrió por error. Los meses condonados vuelven a `pending`.
 */
async function close(id: string, input: CloseGuaranteeInput, user?: JwtPayload) {
  const guarantee = await findGuarantee(id);
  if (!GUARANTEE_OPEN_STATUSES.includes(guarantee.status)) {
    throw new CustomError(
      `Esta garantía ya está cerrada (${GUARANTEE_STATUS_LABELS[guarantee.status]}).`,
      400
    );
  }

  const outcome = input.outcome;
  if (!outcome || !["cumplida", "fallida", "cancelada"].includes(outcome)) {
    throw new CustomError("Indica cómo termina la garantía.", 400);
  }

  const client = await Client.findById(guarantee.clientId);
  if (!client) throw new CustomError("Cliente no encontrado", 404);

  const closedAt = new Date();
  const notes = input.notes?.trim();

  let restoredInvoices = 0;
  if (outcome === "cancelada") {
    restoredInvoices = await unwaivePeriods(guarantee);
  }

  let archived = false;
  let refundId: Types.ObjectId | null = null;

  if (outcome === "fallida") {
    if (input.refund) {
      const result = await refundService.register(
        {
          paymentId: input.refund.paymentId,
          invoiceId: input.refund.invoiceId,
          amount: input.refund.amount,
          reason: input.refund.reason || "garantia",
          refundedAt: input.refund.refundedAt,
          notes: input.refund.notes || notes,
          guaranteeId: guarantee._id.toString(),
        },
        user
      );
      refundId = result.refund._id;
    }

    const shouldArchive = input.archiveClient !== false;
    if (shouldArchive && !client.isArchived) {
      await clientLifecycleService.archive(
        client._id.toString(),
        {
          reason: "garantia_fallida",
          notes:
            notes ||
            `Se regalaron ${guarantee.cycles.length} mes(es) de garantía sin resultados.`,
          archivedAt: closedAt,
        },
        user
      );
      archived = true;
    }
  }

  guarantee.status = outcome;
  guarantee.closedAt = closedAt;
  guarantee.outcomeNotes = notes;
  guarantee.archivedClient = archived;
  guarantee.refundId = refundId;
  guarantee.closedBy = user?._id ? new Types.ObjectId(user._id) : undefined;
  guarantee.closedByName = user?.name;

  const last = guarantee.cycles[guarantee.cycles.length - 1];
  if (last && notes && !last.resultNotes) {
    last.resultNotes = notes;
    guarantee.markModified("cycles");
  }

  await guarantee.save();

  // Se relee el cliente: si se archivó, el documento en memoria quedó viejo.
  const fresh = (await Client.findById(guarantee.clientId)) || client;
  await syncClientCache(fresh, null);

  await AuditLog.create({
    action: `guarantee.${outcome}`,
    entity: "Guarantee",
    entityId: guarantee._id.toString(),
    userId: user?._id,
    userName: user?.name,
    level: outcome === "fallida" ? "warn" : "info",
    meta: {
      clientId: client._id.toString(),
      cycles: guarantee.cycles.length,
      waivedTotal: waivedTotalOf(guarantee),
      archived,
      refundId: refundId?.toString(),
      restoredInvoices,
    },
  });

  const messages: Record<GuaranteeOutcome, string> = {
    cumplida: `${client.name} vuelve a facturarse: la garantía funcionó`,
    fallida: archived
      ? `${client.name} se marcó como fracaso y quedó dado de baja`
      : `${client.name} se marcó como fracaso`,
    cancelada: "Garantía cancelada y cobros restaurados",
  };

  return {
    guarantee,
    client: fresh,
    archived,
    refundId: refundId?.toString() ?? null,
    restoredInvoices,
    message: messages[outcome],
  };
}

export function waivedTotalOf(guarantee: Pick<IGuarantee, "cycles">): number {
  return round2(guarantee.cycles.reduce((total, cycle) => total + (cycle.waivedAmount || 0), 0));
}

async function list(query: GuaranteeListQuery = {}): Promise<PaginatedResult<IGuarantee>> {
  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const filter: FilterQuery<IGuarantee> = {};
  if (query.clientId) filter.clientId = query.clientId;
  if (query.status) filter.status = query.status;
  else if (query.open) filter.status = { $in: GUARANTEE_OPEN_STATUSES };

  const [items, total] = await Promise.all([
    Guarantee.find(filter)
      .sort({ openedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Guarantee.countDocuments(filter),
  ]);

  return { items, total, page, limit, pages: Math.ceil(total / limit) || 1 };
}

async function getById(id: string) {
  return findGuarantee(id);
}

/** Garantía vigente de un cliente, o la última cerrada si no hay ninguna abierta. */
async function currentOf(clientId: string) {
  const open = await Guarantee.findOne({
    clientId,
    status: { $in: GUARANTEE_OPEN_STATUSES },
  });
  if (open) return open;
  return Guarantee.findOne({ clientId }).sort({ openedAt: -1 });
}

async function listByClient(clientId: string): Promise<IGuarantee[]> {
  return Guarantee.find({ clientId }).sort({ openedAt: -1 });
}

export interface GuaranteeSummary {
  open: number;
  firstMonth: number;
  secondMonth: number;
  recovered: number;
  failed: number;
  cancelled: number;
  /** Cobro mensual que hoy no entra por estar en garantía. */
  waivedMonthly: number;
  /** Todo lo regalado históricamente. */
  waivedTotal: number;
  /** Cumplidas sobre cerradas (cumplidas + fallidas), en porcentaje. */
  recoveryRate: number;
}

async function summary(): Promise<GuaranteeSummary> {
  const rows = await Guarantee.aggregate<{ _id: GuaranteeStatus; count: number; waived: number }>([
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        waived: { $sum: { $sum: "$cycles.waivedAmount" } },
      },
    },
  ]);

  const by = (status: GuaranteeStatus) => rows.find((row) => row._id === status);
  const firstMonth = by("abierta")?.count || 0;
  const secondMonth = by("extendida")?.count || 0;
  const recovered = by("cumplida")?.count || 0;
  const failed = by("fallida")?.count || 0;
  const cancelled = by("cancelada")?.count || 0;
  const closed = recovered + failed;

  const [openAmount] = await Guarantee.aggregate<{ total: number }>([
    { $match: { status: { $in: GUARANTEE_OPEN_STATUSES } } },
    { $group: { _id: null, total: { $sum: "$monthlyAmount" } } },
  ]);

  return {
    open: firstMonth + secondMonth,
    firstMonth,
    secondMonth,
    recovered,
    failed,
    cancelled,
    waivedMonthly: round2(openAmount?.total || 0),
    waivedTotal: round2(rows.reduce((total, row) => total + (row.waived || 0), 0)),
    recoveryRate: closed ? Math.round((recovered / closed) * 100) : 0,
  };
}

export const guaranteeService = {
  open,
  extend,
  close,
  list,
  listByClient,
  getById,
  currentOf,
  summary,
  waivedTotalOf,
};
