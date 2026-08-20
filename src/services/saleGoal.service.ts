import { Types } from "mongoose";
import { AuditLog, ClientCategory, ISale, ISaleGoal, Sale, SaleGoal } from "../models";
import { CustomError } from "../errors/customError.error";
import { JwtPayload } from "../types/AuthRequest";
import { endOfPeriod, isValidPeriod, startOfPeriod, toPeriod } from "../utils/date.util";

export interface SaleGoalLineInput {
  categoryId: string;
  targetCount?: number;
  targetAmount?: number;
  notes?: string;
}

export interface SaveSaleGoalInput {
  lines: SaleGoalLineInput[];
  notes?: string;
}

/** Resumen de una venta tal como lo necesita el panel del objetivo. */
export interface GoalSaleRow {
  _id: string;
  businessName: string;
  amount: number;
  status: ISale["status"];
  agreedAt: Date;
  soldByName?: string;
  categoryId: string | null;
  categoryName: string | null;
}

export interface GoalLineProgress {
  categoryId: string;
  categoryName: string;
  color?: string;
  icon?: string;
  targetCount: number;
  targetAmount: number;
  soldCount: number;
  soldAmount: number;
  /** Porcentaje de avance por cantidad y por monto, recortado a 0–999. */
  countPct: number;
  amountPct: number;
  remainingCount: number;
  remainingAmount: number;
  notes?: string;
  sales: GoalSaleRow[];
}

function ensurePeriod(period?: string): string {
  const value = period || toPeriod();
  if (!isValidPeriod(value)) {
    throw new CustomError("Período inválido. Formato esperado YYYY-MM", 400);
  }
  return value;
}

function pct(done: number, target: number): number {
  if (target <= 0) return done > 0 ? 100 : 0;
  return Math.min(Math.round((done / target) * 100), 999);
}

const round = (value: number) => Number(value.toFixed(2));

function toRow(sale: ISale): GoalSaleRow {
  return {
    _id: sale._id.toString(),
    businessName: sale.businessName,
    amount: sale.amount,
    status: sale.status,
    agreedAt: sale.agreedAt,
    soldByName: sale.soldByName,
    categoryId: sale.categoryId ? sale.categoryId.toString() : null,
    categoryName: sale.categoryName ?? null,
  };
}

async function get(period?: string): Promise<ISaleGoal | null> {
  return SaleGoal.findOne({ period: ensurePeriod(period) });
}

/**
 * Crea o reemplaza el objetivo del mes. Se manda la lista completa de líneas:
 * lo que no venga, desaparece. Una categoría no puede repetirse.
 */
async function save(period: string, input: SaveSaleGoalInput, user?: JwtPayload): Promise<ISaleGoal> {
  const target = ensurePeriod(period);
  const seen = new Set<string>();
  const lines = [];

  for (const [i, line] of (input.lines ?? []).entries()) {
    if (!Types.ObjectId.isValid(line.categoryId)) {
      throw new CustomError(`La línea ${i + 1} tiene un tipo de cliente inválido.`, 400);
    }
    if (seen.has(line.categoryId)) {
      throw new CustomError("Un tipo de cliente no puede repetirse en el objetivo.", 400);
    }
    seen.add(line.categoryId);

    const category = await ClientCategory.findById(line.categoryId).select("name");
    if (!category) throw new CustomError(`La línea ${i + 1} apunta a un tipo que no existe.`, 404);

    const targetCount = Math.max(Math.floor(Number(line.targetCount) || 0), 0);
    const targetAmount = round(Math.max(Number(line.targetAmount) || 0, 0));
    if (targetCount === 0 && targetAmount === 0) {
      throw new CustomError(`Indica cuántos o cuánto para "${category.name}".`, 400);
    }

    lines.push({
      categoryId: category._id,
      categoryName: category.name,
      targetCount,
      targetAmount,
      notes: line.notes?.trim() || undefined,
    });
  }

  const goal = await SaleGoal.findOneAndUpdate(
    { period: target },
    {
      $set: {
        lines,
        notes: input.notes?.trim() || undefined,
        updatedBy: user?._id ? new Types.ObjectId(user._id) : undefined,
        updatedByName: user?.name,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  await AuditLog.create({
    action: "sale.goal.save",
    entity: "SaleGoal",
    entityId: goal._id.toString(),
    userId: user?._id,
    userName: user?.name,
    meta: {
      period: target,
      lines: lines.map((l) => ({ categoryName: l.categoryName, targetCount: l.targetCount, targetAmount: l.targetAmount })),
    },
  });

  return goal;
}

/**
 * Cruza el objetivo del mes con las ventas acordadas en ese mes.
 *
 * - Cuentan las ventas no perdidas con `agreedAt` dentro del período.
 * - `lines` trae el avance por tipo de cliente que está en el objetivo.
 * - `outside` son ventas con un tipo que NO está en el objetivo: suman al total
 *   pero no a ninguna línea; se muestran aparte para decidir si se abre línea.
 * - `unclassified` son ventas sin tipo: hay que ubicarlas para que cuenten.
 */
async function progress(period?: string) {
  const target = ensurePeriod(period);
  const [goal, sales, categories] = await Promise.all([
    SaleGoal.findOne({ period: target }).lean(),
    Sale.find({
      status: { $ne: "perdida" },
      agreedAt: { $gte: startOfPeriod(target), $lte: endOfPeriod(target) },
    }).sort({ agreedAt: -1 }),
    ClientCategory.find().select("name color icon isActive").lean(),
  ]);

  const catById = new Map(categories.map((c) => [c._id.toString(), c]));
  const goalLines = goal?.lines ?? [];
  const lineByCategory = new Map<string, GoalLineProgress>();

  for (const line of goalLines) {
    const key = line.categoryId.toString();
    const cat = catById.get(key);
    lineByCategory.set(key, {
      categoryId: key,
      categoryName: cat?.name ?? line.categoryName,
      color: cat?.color,
      icon: cat?.icon,
      targetCount: line.targetCount,
      targetAmount: line.targetAmount,
      soldCount: 0,
      soldAmount: 0,
      countPct: 0,
      amountPct: 0,
      remainingCount: line.targetCount,
      remainingAmount: line.targetAmount,
      notes: line.notes,
      sales: [],
    });
  }

  const unclassified: GoalSaleRow[] = [];
  const outsideMap = new Map<string, { categoryId: string; categoryName: string; color?: string; icon?: string; soldCount: number; soldAmount: number; sales: GoalSaleRow[] }>();
  let soldCount = 0;
  let soldAmount = 0;

  for (const sale of sales) {
    const row = toRow(sale);
    soldCount += 1;
    soldAmount += sale.amount;

    if (!row.categoryId) {
      unclassified.push(row);
      continue;
    }

    const line = lineByCategory.get(row.categoryId);
    if (line) {
      line.soldCount += 1;
      line.soldAmount += sale.amount;
      line.sales.push(row);
      continue;
    }

    const cat = catById.get(row.categoryId);
    const bucket = outsideMap.get(row.categoryId) ?? {
      categoryId: row.categoryId,
      categoryName: cat?.name ?? row.categoryName ?? "Otro",
      color: cat?.color,
      icon: cat?.icon,
      soldCount: 0,
      soldAmount: 0,
      sales: [],
    };
    bucket.soldCount += 1;
    bucket.soldAmount += sale.amount;
    bucket.sales.push(row);
    outsideMap.set(row.categoryId, bucket);
  }

  const lines = [...lineByCategory.values()].map((line) => ({
    ...line,
    soldAmount: round(line.soldAmount),
    countPct: pct(line.soldCount, line.targetCount),
    amountPct: pct(line.soldAmount, line.targetAmount),
    remainingCount: Math.max(line.targetCount - line.soldCount, 0),
    remainingAmount: round(Math.max(line.targetAmount - line.soldAmount, 0)),
  }));

  const targetCount = lines.reduce((acc, l) => acc + l.targetCount, 0);
  const targetAmount = round(lines.reduce((acc, l) => acc + l.targetAmount, 0));
  const inGoalCount = lines.reduce((acc, l) => acc + l.soldCount, 0);
  const inGoalAmount = round(lines.reduce((acc, l) => acc + l.soldAmount, 0));

  return {
    period: target,
    hasGoal: !!goal,
    notes: goal?.notes,
    updatedByName: goal?.updatedByName,
    updatedAt: goal?.updatedAt,
    totals: {
      targetCount,
      targetAmount,
      /** Todo lo vendido en el mes, esté o no dentro del objetivo. */
      soldCount,
      soldAmount: round(soldAmount),
      /** Solo lo que cae en una línea del objetivo. */
      inGoalCount,
      inGoalAmount,
      countPct: pct(inGoalCount, targetCount),
      amountPct: pct(inGoalAmount, targetAmount),
      unclassifiedCount: unclassified.length,
      unclassifiedAmount: round(unclassified.reduce((acc, s) => acc + s.amount, 0)),
    },
    lines,
    outside: [...outsideMap.values()].map((b) => ({ ...b, soldAmount: round(b.soldAmount) })),
    unclassified,
    /** Tipos disponibles para ubicar una venta o abrir una línea nueva. */
    categories: categories
      .filter((c) => c.isActive)
      .map((c) => ({ _id: c._id.toString(), name: c.name, color: c.color, icon: c.icon })),
  };
}

export const saleGoalService = { get, save, progress };
