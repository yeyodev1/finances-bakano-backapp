import { Invoice } from "../models";
import {
  addDays,
  addMonthsToPeriod,
  endOfDay,
  periodLabelEs,
  startOfDay,
  toPeriod,
} from "../utils/date.util";
import { CustomError } from "../errors/customError.error";
import { isValidPeriod } from "../utils/date.util";
import {
  EXCLUDED_STATUSES,
  clientCounters,
  methodBreakdownRows,
  periodTotals,
  revenueSeriesRows,
  statusBreakdownRows,
  topClientRows,
} from "./dashboard.aggregations";
import { idealMonthlyAmount } from "./client.lifecycle.service";
import { churnReport } from "./dashboard.churn";
import { delinquencyReport } from "./dashboard.delinquency";
import { saleGoalService } from "./saleGoal.service";
import { accessStatusCounts } from "./access.status.service";

function ensurePeriod(period?: string): string {
  const value = period || toPeriod();
  if (!isValidPeriod(value)) {
    throw new CustomError(`Período inválido: ${value}. Formato esperado YYYY-MM.`, 400);
  }
  return value;
}

function daysOverdueFrom(dueDate: Date): number {
  const ms = startOfDay(new Date()).getTime() - startOfDay(new Date(dueDate)).getTime();
  return Math.max(Math.round(ms / 86400000), 0);
}

async function summary(period?: string) {
  const target = ensurePeriod(period);
  const [totals, counters, ideal, accessCounts, goal] = await Promise.all([
    periodTotals(target),
    clientCounters(target),
    idealMonthlyAmount(),
    accessStatusCounts(),
    saleGoalService.progress(target).catch(() => null),
  ]);

  const collectionRate =
    totals.expectedAmount > 0
      ? Math.round((totals.collectedAmount / totals.expectedAmount) * 1000) / 10
      : 0;

  return {
    period: target,
    label: periodLabelEs(target),
    ...totals,
    idealMonthlyAmount: ideal,
    collectionRate,
    ...counters,
    ...accessCounts,
    /** Objetivo de ventas del mes, para leerlo junto al ideal mensual. */
    salesGoal: goal
      ? {
          hasGoal: goal.hasGoal,
          targetAmount: goal.totals.targetAmount,
          soldAmount: goal.totals.inGoalAmount,
          targetCount: goal.totals.targetCount,
          soldCount: goal.totals.inGoalCount,
          amountPct: goal.totals.amountPct,
          /** Ideal mensual si se cumple la meta: lo de hoy + lo que la meta suma en mensualidades. */
          idealIfMet: Math.round((ideal + goal.totals.targetAmount) * 100) / 100,
        }
      : null,
  };
}

async function revenueSeries(months = 12) {
  const total = Math.min(Math.max(Number(months) || 12, 1), 36);
  const current = toPeriod();
  const periods: string[] = [];

  for (let i = total - 1; i >= 0; i -= 1) {
    periods.push(addMonthsToPeriod(current, -i));
  }

  const rows = await revenueSeriesRows(periods);
  const map = new Map(rows.map((row) => [row.period, row]));

  return periods.map((period) => {
    const row = map.get(period);
    return {
      period,
      label: periodLabelEs(period),
      expected: row?.expected || 0,
      collected: row?.collected || 0,
    };
  });
}

async function statusBreakdown(period?: string) {
  const target = ensurePeriod(period);
  return { period: target, items: await statusBreakdownRows(target) };
}

async function methodBreakdown(period?: string) {
  const target = ensurePeriod(period);
  return { period: target, items: await methodBreakdownRows(target) };
}

async function topClients(period?: string, limit = 10) {
  const target = ensurePeriod(period);
  const max = Math.min(Math.max(Number(limit) || 10, 1), 100);
  return { period: target, items: await topClientRows(target, max) };
}

const AGING_BUCKETS = [
  { key: "0-7", label: "0 a 7 días", min: 0, max: 7 },
  { key: "8-15", label: "8 a 15 días", min: 8, max: 15 },
  { key: "16-30", label: "16 a 30 días", min: 16, max: 30 },
  { key: "30+", label: "Más de 30 días", min: 31, max: Number.MAX_SAFE_INTEGER },
];

async function agingBuckets() {
  const rows = await Invoice.aggregate<{ _id: string; count: number; amount: number }>([
    { $match: { status: "overdue" } },
    {
      $addFields: {
        daysOverdue: {
          $max: [
            0,
            { $floor: { $divide: [{ $subtract: [new Date(), "$dueDate"] }, 86400000] } },
          ],
        },
        balance: { $subtract: ["$amount", "$paidAmount"] },
      },
    },
    {
      $bucket: {
        groupBy: "$daysOverdue",
        boundaries: [0, 8, 16, 31],
        default: "30+",
        output: { count: { $sum: 1 }, amount: { $sum: "$balance" } },
      },
    },
  ]);

  const byBoundary: Record<string, { count: number; amount: number }> = {
    "0-7": { count: 0, amount: 0 },
    "8-15": { count: 0, amount: 0 },
    "16-30": { count: 0, amount: 0 },
    "30+": { count: 0, amount: 0 },
  };

  const boundaryKey: Record<string, string> = { "0": "0-7", "8": "8-15", "16": "16-30" };

  for (const row of rows) {
    const key = row._id === "30+" ? "30+" : boundaryKey[String(row._id)];
    if (key) {
      byBoundary[key] = { count: row.count, amount: row.amount };
    }
  }

  return AGING_BUCKETS.map((bucket) => ({
    bucket: bucket.key,
    label: bucket.label,
    count: byBoundary[bucket.key].count,
    amount: byBoundary[bucket.key].amount,
  }));
}

async function upcomingCollections(days = 15) {
  const total = Math.min(Math.max(Number(days) || 15, 1), 120);
  const from = startOfDay(new Date());
  const to = endOfDay(addDays(new Date(), total));

  const items = await Invoice.aggregate([
    {
      $match: {
        status: { $in: ["pending", "partial"] },
        dueDate: { $gte: from, $lte: to },
      },
    },
    { $sort: { dueDate: 1 } },
    {
      $lookup: {
        from: "clients",
        localField: "clientId",
        foreignField: "_id",
        as: "client",
        pipeline: [
          {
            $project: {
              name: 1,
              contactName: 1,
              contactEmail: 1,
              contactPhone: 1,
              paymentMethod: 1,
              collectionDayLabel: 1,
              workspaceId: 1,
            },
          },
        ],
      },
    },
    { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        balance: { $subtract: ["$amount", "$paidAmount"] },
        daysUntilDue: {
          $floor: { $divide: [{ $subtract: ["$dueDate", from] }, 86400000] },
        },
      },
    },
  ]);

  return { days: total, from, to, items };
}

async function overdueList(limit = 50) {
  const max = Math.min(Math.max(Number(limit) || 50, 1), 500);

  const items = await Invoice.aggregate([
    { $match: { status: "overdue" } },
    { $sort: { dueDate: 1 } },
    { $limit: max },
    {
      $lookup: {
        from: "clients",
        localField: "clientId",
        foreignField: "_id",
        as: "client",
        pipeline: [
          {
            $project: {
              name: 1,
              contactName: 1,
              contactEmail: 1,
              contactPhone: 1,
              paymentMethod: 1,
              workspaceId: 1,
              workspaceName: 1,
              workspaceIsActive: 1,
              autoDeactivate: 1,
              graceDays: 1,
            },
          },
        ],
      },
    },
    { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        balance: { $subtract: ["$amount", "$paidAmount"] },
        daysOverdue: {
          $floor: { $divide: [{ $subtract: [new Date(), "$dueDate"] }, 86400000] },
        },
      },
    },
  ]);

  return items;
}

/** Clientes en mora de un período, usado por el resumen mensual por correo. */
async function overdueClientsForPeriod(period: string, limit = 30) {
  const invoices = await Invoice.find({
    period,
    status: { $in: ["overdue", "pending", "partial"] },
  })
    .sort({ dueDate: 1 })
    .limit(limit)
    .lean();

  return invoices
    .filter((invoice) => invoice.amount - invoice.paidAmount > 0)
    .map((invoice) => ({
      clientName: invoice.clientName,
      amount: invoice.amount - invoice.paidAmount,
      dueDate: invoice.dueDate,
      daysOverdue: daysOverdueFrom(invoice.dueDate),
    }));
}

export const dashboardService = {
  summary,
  revenueSeries,
  statusBreakdown,
  methodBreakdown,
  topClients,
  agingBuckets,
  upcomingCollections,
  overdueList,
  overdueClientsForPeriod,
  churnReport,
  delinquencyReport,
  EXCLUDED_STATUSES,
};
