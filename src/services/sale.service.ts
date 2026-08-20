import { FilterQuery, Types } from "mongoose";
import {
  AuditLog,
  Client,
  ClientCategory,
  ISale,
  ISaleBilling,
  ISaleInstallment,
  ISaleItem,
  Sale,
  User,
} from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";
import {
  PaginatedResult,
  SALE_FREQUENCY_DAYS,
  SALE_LOST_REASON_LABELS,
  SaleFrequency,
  SaleLostReason,
  SaleStatus,
} from "../types/finance.types";
import { startOfDay } from "../utils/date.util";
import { idealMonthlyAmount } from "./client.lifecycle.service";

export interface SaleListQuery {
  status?: SaleStatus;
  ownerId?: string;
  soldBy?: string;
  clientId?: string;
  categoryId?: string;
  /** Solo las que no tienen tipo de cliente asignado. */
  uncategorized?: boolean;
  q?: string;
  /** Solo las que tienen alguna cuota vencida sin cobrar. */
  overdueOnly?: boolean;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export interface CreateSaleInput {
  businessName: string;
  clientId?: string | null;
  /** Tipo de cliente. Si no viene y el cliente existe, se hereda del cliente. */
  categoryId?: string | null;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Si vienen conceptos, el total sale de su suma y `amount` se ignora. */
  items?: ISaleItem[];
  billing?: Partial<ISaleBilling>;
  amount: number;
  currency?: string;
  frequency: SaleFrequency;
  installmentsCount?: number;
  firstChargeDate: Date | string;
  soldBy: string;
  ownerId: string;
  agreedAt?: Date | string;
  notes?: string;
}

const OPEN_STATUSES: SaleStatus[] = ["acordada", "cobrando"];

/** Suma meses conservando el día; si el mes destino es más corto, cae al último día. */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Reparte el total en N cuotas a partir de la primera fecha.
 * El redondeo sobrante se acumula en la última cuota para que la suma cuadre
 * exactamente con el monto acordado.
 */
export function buildSchedule(
  amount: number,
  frequency: SaleFrequency,
  installmentsCount: number,
  firstChargeDate: Date
): ISaleInstallment[] {
  const count = frequency === "unico" ? 1 : Math.max(installmentsCount, 1);
  const base = Math.floor((amount / count) * 100) / 100;

  const installments: ISaleInstallment[] = [];
  let assigned = 0;

  for (let i = 0; i < count; i += 1) {
    const isLast = i === count - 1;
    const value = isLast ? Number((amount - assigned).toFixed(2)) : base;
    assigned = Number((assigned + value).toFixed(2));

    let dueDate = new Date(firstChargeDate);
    if (i > 0) {
      if (frequency === "mensual") dueDate = addMonths(firstChargeDate, i);
      else if (frequency === "trimestral") dueDate = addMonths(firstChargeDate, i * 3);
      else dueDate = addDays(firstChargeDate, SALE_FREQUENCY_DAYS[frequency] * i);
    }

    installments.push({
      index: i,
      dueDate,
      amount: value,
      status: "pendiente",
      paidAt: null,
      paidAmount: 0,
      originalDueDate: null,
    });
  }

  return installments;
}

/** Normaliza los conceptos y devuelve su suma. Lanza si alguno es inválido. */
export function normalizeItems(items?: ISaleItem[]): { items: ISaleItem[]; total: number } {
  if (!items?.length) return { items: [], total: 0 };

  const clean = items.map((item, i) => {
    const concept = String(item.concept || "").trim();
    if (!concept) throw new CustomError(`El concepto ${i + 1} necesita un nombre.`, 400);

    const amount = Number(item.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new CustomError(`El monto de "${concept}" debe ser mayor a cero.`, 400);
    }

    return {
      concept,
      description: item.description?.trim() || undefined,
      amount: Number(amount.toFixed(2)),
      kind: item.kind === "recurrente" ? ("recurrente" as const) : ("unico" as const),
    };
  });

  const total = Number(clean.reduce((acc, i) => acc + i.amount, 0).toFixed(2));
  return { items: clean, total };
}

/** Marca como vencidas las cuotas pendientes cuyo día ya pasó. No persiste. */
function applyOverdue(sale: ISale): ISale {
  const today = startOfDay(new Date());
  sale.installments.forEach((item) => {
    if (item.status === "pendiente" && startOfDay(item.dueDate) < today) {
      item.status = "vencida";
    }
  });
  return sale;
}

/** El estado de la venta se deriva de sus cuotas; nunca se fija a mano. */
function resolveStatus(sale: ISale): SaleStatus {
  if (sale.status === "perdida") return "perdida";
  const paid = sale.installments.filter((i) => i.status === "cobrada").length;
  if (paid === 0) return "acordada";
  if (paid === sale.installments.length) return "cobrada";
  return "cobrando";
}

function pushHistory(
  sale: ISale,
  action: string,
  detail: string,
  user?: JwtPayload,
  meta?: Record<string, unknown>
) {
  sale.history.push({
    action,
    detail,
    at: new Date(),
    by: user?._id ? new Types.ObjectId(user._id) : undefined,
    byName: user?.name,
    meta,
  });
}

async function findSale(id: string): Promise<ISale> {
  if (!Types.ObjectId.isValid(id)) throw new CustomError("Identificador inválido", 400);
  const sale = await Sale.findById(id);
  if (!sale) throw new CustomError("Venta no encontrada", 404);
  return sale;
}

/** Devuelve id + nombre de la categoría, o null si no se indicó. */
async function resolveCategory(
  id?: string | null
): Promise<{ categoryId: Types.ObjectId; categoryName: string } | null> {
  if (!id) return null;
  if (!Types.ObjectId.isValid(id)) throw new CustomError("Tipo de cliente inválido", 400);
  const category = await ClientCategory.findById(id).select("name isActive");
  if (!category) throw new CustomError("Tipo de cliente no encontrado", 404);
  return { categoryId: category._id, categoryName: category.name };
}

async function resolveUserName(id: string, label: string): Promise<string> {
  const user = await User.findById(id).select("name isActive");
  if (!user) throw new CustomError(`${label} no encontrado`, 404);
  return user.name;
}

async function create(input: CreateSaleInput, user?: JwtPayload): Promise<ISale> {
  // Con conceptos el total es su suma: así el desglose y el total no se separan.
  const { items, total } = normalizeItems(input.items);
  const amount = items.length ? total : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CustomError("El monto acordado debe ser mayor a cero.", 400);
  }

  const firstChargeDate = new Date(input.firstChargeDate);
  if (Number.isNaN(firstChargeDate.getTime())) {
    throw new CustomError("La fecha del primer cobro es inválida.", 400);
  }

  // Sin tipo explícito, el de la ficha del cliente (si ya existe) sirve.
  let categoryId: string | null | undefined = input.categoryId;
  if (input.clientId) {
    const client = await Client.findById(input.clientId).select("categoryId");
    if (!client) throw new CustomError("Cliente no encontrado", 404);
    if (!categoryId && client.categoryId) categoryId = client.categoryId.toString();
  }
  const category = await resolveCategory(categoryId);

  const [soldByName, ownerName] = await Promise.all([
    resolveUserName(input.soldBy, "El vendedor"),
    resolveUserName(input.ownerId, "El responsable de cobro"),
  ]);

  const count = input.frequency === "unico" ? 1 : Math.max(Number(input.installmentsCount) || 1, 1);
  const installments = buildSchedule(amount, input.frequency, count, firstChargeDate);

  const sale = await Sale.create({
    businessName: input.businessName.trim(),
    clientId: input.clientId || null,
    categoryId: category?.categoryId ?? null,
    categoryName: category?.categoryName ?? null,
    contactName: input.contactName?.trim(),
    contactEmail: input.contactEmail?.trim(),
    contactPhone: input.contactPhone?.trim(),
    amount,
    items,
    billing: {
      needsInvoice: Boolean(input.billing?.needsInvoice),
      legalName: input.billing?.legalName?.trim(),
      taxId: input.billing?.taxId?.trim(),
      email: input.billing?.email?.trim(),
      address: input.billing?.address?.trim(),
      phone: input.billing?.phone?.trim(),
      invoiceNumber: input.billing?.invoiceNumber?.trim(),
      issuedAt: input.billing?.issuedAt ? new Date(input.billing.issuedAt) : null,
      notes: input.billing?.notes?.trim(),
    },
    currency: input.currency || "USD",
    frequency: input.frequency,
    installmentsCount: count,
    firstChargeDate,
    installments,
    soldBy: input.soldBy,
    soldByName,
    ownerId: input.ownerId,
    ownerName,
    agreedAt: input.agreedAt ? new Date(input.agreedAt) : new Date(),
    status: "acordada",
    notes: input.notes?.trim(),
    createdBy: user?._id ? new Types.ObjectId(user._id) : undefined,
    history: [
      {
        action: "created",
        detail: `Venta acordada por ${amount} ${input.currency || "USD"} en ${count} cobro(s)`,
        at: new Date(),
        by: user?._id ? new Types.ObjectId(user._id) : undefined,
        byName: user?.name,
      },
    ],
  });

  await AuditLog.create({
    action: "sale.create",
    entity: "Sale",
    entityId: sale._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      businessName: sale.businessName,
      amount,
      installments: count,
      ownerName,
      categoryName: category?.categoryName ?? null,
    },
  });

  return sale;
}

/**
 * Ubica (o reubica) la venta en un tipo de cliente. Es lo que mueve una venta
 * "sin clasificar" a su línea del objetivo del mes. Con `null` la deja sin tipo.
 */
async function changeCategory(id: string, categoryId: string | null, user?: JwtPayload) {
  const sale = await findSale(id);
  const category = await resolveCategory(categoryId);
  const previous = sale.categoryName ?? null;

  sale.categoryId = category?.categoryId ?? null;
  sale.categoryName = category?.categoryName ?? null;
  pushHistory(
    sale,
    "category.changed",
    `Tipo de cliente: ${previous ?? "sin clasificar"} → ${category?.categoryName ?? "sin clasificar"}`,
    user,
    { previous, categoryName: category?.categoryName ?? null }
  );
  await sale.save();

  await AuditLog.create({
    action: "sale.category.change",
    entity: "Sale",
    entityId: sale._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { previous, categoryName: category?.categoryName ?? null, businessName: sale.businessName },
  });

  return applyOverdue(sale);
}

async function list(query: SaleListQuery = {}): Promise<PaginatedResult<ISale>> {
  const page = Math.max(query.page || 1, 1);
  const limit = Math.min(Math.max(query.limit || 50, 1), 200);

  const filter: FilterQuery<ISale> = {};
  if (query.status) filter.status = query.status;
  if (query.ownerId) filter.ownerId = query.ownerId;
  if (query.soldBy) filter.soldBy = query.soldBy;
  if (query.clientId) filter.clientId = query.clientId;
  if (query.categoryId) filter.categoryId = query.categoryId;
  if (query.uncategorized) filter.categoryId = null;
  if (query.q) filter.businessName = { $regex: query.q, $options: "i" };
  if (query.from || query.to) {
    filter.agreedAt = {};
    if (query.from) filter.agreedAt.$gte = query.from;
    if (query.to) filter.agreedAt.$lte = query.to;
  }
  if (query.overdueOnly) {
    filter.status = { $in: OPEN_STATUSES };
    filter.installments = {
      $elemMatch: { status: { $ne: "cobrada" }, dueDate: { $lt: startOfDay(new Date()) } },
    };
  }

  const [items, total] = await Promise.all([
    Sale.find(filter)
      .sort({ firstChargeDate: 1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Sale.countDocuments(filter),
  ]);

  return {
    items: items.map(applyOverdue),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit) || 1,
  };
}

async function getById(id: string): Promise<ISale> {
  return applyOverdue(await findSale(id));
}

/** Registra el cobro de una cuota. Sin monto se asume que se cobró completa. */
async function payInstallment(
  id: string,
  index: number,
  input: { amount?: number; paidAt?: Date | string; notes?: string },
  user?: JwtPayload
) {
  const sale = await findSale(id);
  if (sale.status === "perdida") {
    throw new CustomError("Esta venta está marcada como perdida.", 400);
  }

  const installment = sale.installments.find((i) => i.index === index);
  if (!installment) throw new CustomError("Cuota no encontrada", 404);
  if (installment.status === "cobrada") {
    throw new CustomError("Esta cuota ya está cobrada.", 400);
  }

  const amount = input.amount === undefined ? installment.amount : Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CustomError("El monto cobrado debe ser mayor a cero.", 400);
  }
  if (amount > installment.amount + 0.009) {
    throw new CustomError("El monto supera lo pactado para esta cuota.", 400);
  }

  const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) {
    throw new CustomError("La fecha del cobro es inválida.", 400);
  }

  installment.paidAmount = amount;
  installment.paidAt = paidAt;
  installment.status = "cobrada";
  if (input.notes) installment.notes = input.notes.trim();

  sale.status = resolveStatus(sale);
  pushHistory(
    sale,
    "installment.paid",
    `Cuota ${index + 1} cobrada por ${amount} ${sale.currency}`,
    user,
    { index, amount, paidAt }
  );
  await sale.save();

  await AuditLog.create({
    action: "sale.installment.paid",
    entity: "Sale",
    entityId: sale._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { index, amount, paidAt, businessName: sale.businessName },
  });

  return applyOverdue(sale);
}

/** Mueve la fecha de una cuota conservando la original en el histórico. */
async function rescheduleInstallment(
  id: string,
  index: number,
  newDueDate: Date | string,
  reason: string | undefined,
  user?: JwtPayload
) {
  const sale = await findSale(id);
  const installment = sale.installments.find((i) => i.index === index);
  if (!installment) throw new CustomError("Cuota no encontrada", 404);
  if (installment.status === "cobrada") {
    throw new CustomError("No puedes mover una cuota ya cobrada.", 400);
  }

  const target = new Date(newDueDate);
  if (Number.isNaN(target.getTime())) {
    throw new CustomError("La nueva fecha es inválida.", 400);
  }

  const previous = installment.dueDate;
  if (!installment.originalDueDate) installment.originalDueDate = previous;
  installment.dueDate = target;
  installment.status = "pendiente";

  pushHistory(
    sale,
    "installment.rescheduled",
    `Cuota ${index + 1} movida al ${target.toISOString().slice(0, 10)}${reason ? ` · ${reason}` : ""}`,
    user,
    { index, previous, newDueDate: target, reason }
  );
  await sale.save();

  await AuditLog.create({
    action: "sale.installment.reschedule",
    entity: "Sale",
    entityId: sale._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { index, previous, newDueDate: target, reason },
  });

  return applyOverdue(sale);
}

/**
 * Reescribe los conceptos vendidos. Como el total sale de ellos, también se
 * rehace el calendario de cobros — por eso solo se permite mientras no haya
 * ninguna cuota cobrada: si no, se estaría moviendo dinero ya recibido.
 */
async function updateItems(id: string, items: ISaleItem[], user?: JwtPayload) {
  const sale = await findSale(id);
  if (sale.installments.some((i) => i.status === "cobrada")) {
    throw new CustomError(
      "Esta venta ya tiene cobros registrados: no puedes cambiar los conceptos.",
      400
    );
  }

  const { items: clean, total } = normalizeItems(items);
  if (!clean.length) throw new CustomError("Indica al menos un concepto.", 400);

  const previousAmount = sale.amount;
  sale.items = clean;
  sale.amount = total;
  sale.installments = buildSchedule(total, sale.frequency, sale.installmentsCount, sale.firstChargeDate);

  pushHistory(
    sale,
    "items.updated",
    `Conceptos actualizados · total ${previousAmount} → ${total} ${sale.currency}`,
    user,
    { previousAmount, total, items: clean }
  );
  await sale.save();

  await AuditLog.create({
    action: "sale.items.update",
    entity: "Sale",
    entityId: sale._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { previousAmount, total, items: clean },
  });

  return applyOverdue(sale);
}

/**
 * Datos de facturación. Siempre editable, incluso con la venta ya cobrada:
 * quien cobra suele no tener la factura a mano y la completa después.
 */
async function updateBilling(id: string, input: Partial<ISaleBilling>, user?: JwtPayload) {
  const sale = await findSale(id);

  const billing: ISaleBilling = {
    needsInvoice:
      input.needsInvoice === undefined ? sale.billing?.needsInvoice ?? false : Boolean(input.needsInvoice),
    legalName: input.legalName?.trim() ?? sale.billing?.legalName,
    taxId: input.taxId?.trim() ?? sale.billing?.taxId,
    email: input.email?.trim() ?? sale.billing?.email,
    address: input.address?.trim() ?? sale.billing?.address,
    phone: input.phone?.trim() ?? sale.billing?.phone,
    invoiceNumber: input.invoiceNumber?.trim() ?? sale.billing?.invoiceNumber,
    issuedAt:
      input.issuedAt === undefined
        ? sale.billing?.issuedAt ?? null
        : input.issuedAt
          ? new Date(input.issuedAt)
          : null,
    notes: input.notes?.trim() ?? sale.billing?.notes,
  };

  if (billing.issuedAt && Number.isNaN(billing.issuedAt.getTime())) {
    throw new CustomError("La fecha de emisión de la factura es inválida.", 400);
  }

  sale.billing = billing;
  pushHistory(
    sale,
    "billing.updated",
    billing.invoiceNumber
      ? `Datos de factura actualizados · Nº ${billing.invoiceNumber}`
      : "Datos de factura actualizados",
    user,
    { billing }
  );
  await sale.save();

  await AuditLog.create({
    action: "sale.billing.update",
    entity: "Sale",
    entityId: sale._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { billing },
  });

  return applyOverdue(sale);
}

/** Reasigna quién debe cobrar. Queda en el histórico para que no se diluya. */
async function changeOwner(id: string, ownerId: string, user?: JwtPayload) {
  const sale = await findSale(id);
  const ownerName = await resolveUserName(ownerId, "El responsable de cobro");
  const previous = sale.ownerName;

  sale.ownerId = new Types.ObjectId(ownerId);
  sale.ownerName = ownerName;
  pushHistory(sale, "owner.changed", `Cobro reasignado de ${previous ?? "—"} a ${ownerName}`, user, {
    previous,
    ownerName,
  });
  await sale.save();

  await AuditLog.create({
    action: "sale.owner.change",
    entity: "Sale",
    entityId: sale._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { previous, ownerName },
  });

  return applyOverdue(sale);
}

/** Da la venta por perdida. Exige motivo: sin él no sirve para analizar nada. */
async function markLost(
  id: string,
  input: { reason: SaleLostReason; notes?: string; lostAt?: Date | string },
  user?: JwtPayload
) {
  const sale = await findSale(id);
  if (sale.status === "perdida") throw new CustomError("Esta venta ya está perdida.", 400);
  if (sale.installments.some((i) => i.status === "cobrada")) {
    throw new CustomError(
      "Esta venta ya tiene cobros registrados; no puede darse por perdida completa.",
      400
    );
  }

  const lostAt = input.lostAt ? new Date(input.lostAt) : new Date();
  if (Number.isNaN(lostAt.getTime())) throw new CustomError("La fecha es inválida.", 400);

  sale.status = "perdida";
  sale.lostReason = input.reason;
  sale.lostNotes = input.notes?.trim();
  sale.lostAt = lostAt;

  pushHistory(sale, "lost", `Dada por perdida: ${SALE_LOST_REASON_LABELS[input.reason]}`, user, {
    reason: input.reason,
    notes: input.notes,
    lostAt,
  });
  await sale.save();

  await AuditLog.create({
    action: "sale.lost",
    entity: "Sale",
    entityId: sale._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: { reason: input.reason, label: SALE_LOST_REASON_LABELS[input.reason], notes: input.notes },
  });

  return sale;
}

/** Deshace la baja y devuelve la venta al circuito de cobro. */
async function reopen(id: string, user?: JwtPayload) {
  const sale = await findSale(id);
  if (sale.status !== "perdida") throw new CustomError("Esta venta no está perdida.", 400);

  sale.lostReason = null;
  sale.lostNotes = undefined;
  sale.lostAt = null;
  sale.status = resolveStatus(sale);

  pushHistory(sale, "reopened", "Reabierta: vuelve al circuito de cobro", user);
  await sale.save();

  return applyOverdue(sale);
}

/**
 * Cuánto dinero debe entrar: lo recurrente de los clientes que ya están y lo
 * pactado en ventas nuevas que sigue sin cobrarse.
 */
async function summary(from?: Date, to?: Date) {
  const range: FilterQuery<ISale> = {};
  if (from || to) {
    range.agreedAt = {};
    if (from) range.agreedAt.$gte = from;
    if (to) range.agreedAt.$lte = to;
  }

  const [sales, recurring] = await Promise.all([
    Sale.find(range),
    idealMonthlyAmount(),
  ]);

  const today = startOfDay(new Date());
  let agreed = 0;
  let collected = 0;
  let pending = 0;
  let overdue = 0;
  let lost = 0;
  // Lo vendido separado por naturaleza: la mensualidad se repite, el extra no.
  let recurringSold = 0;
  let oneOffSold = 0;
  /** Ventas que piden factura y todavía no tienen número cargado. */
  let missingInvoice = 0;

  const byOwnerMap = new Map<string, { ownerName: string; pending: number; overdue: number; count: number }>();

  for (const sale of sales) {
    if (sale.status === "perdida") {
      lost += sale.amount;
      continue;
    }
    agreed += sale.amount;

    for (const item of sale.items ?? []) {
      if (item.kind === "recurrente") recurringSold += item.amount;
      else oneOffSold += item.amount;
    }
    if (sale.billing?.needsInvoice && !sale.billing?.invoiceNumber) missingInvoice += 1;

    const owner = byOwnerMap.get(sale.ownerId.toString()) ?? {
      ownerName: sale.ownerName || "Sin asignar",
      pending: 0,
      overdue: 0,
      count: 0,
    };
    owner.count += 1;

    for (const item of sale.installments) {
      if (item.status === "cobrada") {
        collected += item.paidAmount || item.amount;
        continue;
      }
      pending += item.amount;
      owner.pending += item.amount;
      if (startOfDay(item.dueDate) < today) {
        overdue += item.amount;
        owner.overdue += item.amount;
      }
    }

    byOwnerMap.set(sale.ownerId.toString(), owner);
  }

  const round = (value: number) => Number(value.toFixed(2));

  return {
    recurringMonthly: round(recurring),
    newSales: {
      agreed: round(agreed),
      collected: round(collected),
      pending: round(pending),
      overdue: round(overdue),
      lost: round(lost),
      /** De lo vendido, cuánto se repite cada mes y cuánto es puntual. */
      recurringSold: round(recurringSold),
      oneOffSold: round(oneOffSold),
      missingInvoice,
    },
    /** Lo que debería entrar este mes: recurrente + lo pendiente de ventas nuevas. */
    expectedTotal: round(recurring + pending),
    byOwner: [...byOwnerMap.values()]
      .map((o) => ({ ...o, pending: round(o.pending), overdue: round(o.overdue) }))
      .sort((a, b) => b.pending - a.pending),
  };
}

export const saleService = {
  create,
  list,
  getById,
  payInstallment,
  rescheduleInstallment,
  changeOwner,
  changeCategory,
  updateItems,
  updateBilling,
  markLost,
  reopen,
  summary,
  buildSchedule,
};
