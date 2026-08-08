import { Client } from "../models";
import { ARCHIVE_REASON_LABELS, ArchiveReason } from "../types/finance.types";
import {
  MONTHLY_AMOUNT_EXPR,
  clientLifecycleService,
} from "./client.lifecycle.service";

export interface ChurnReasonRow {
  reason: ArchiveReason | "sin_motivo";
  label: string;
  count: number;
  lostMonthlyAmount: number;
  avgLifetimeDays: number;
  totalLifetimeRevenue: number;
}

export interface ChurnTotals {
  archivedClients: number;
  lostMonthlyAmount: number;
  avgLifetimeDays: number;
  totalLifetimeRevenue: number;
}

const round2 = (value: number) => Math.round((value || 0) * 100) / 100;

async function byReason(): Promise<ChurnReasonRow[]> {
  const rows = await Client.aggregate<{
    _id: ArchiveReason | null;
    count: number;
    lostMonthlyAmount: number;
    avgLifetimeDays: number | null;
    totalLifetimeRevenue: number;
  }>([
    { $match: { isArchived: true } },
    { $addFields: { monthlyAmount: MONTHLY_AMOUNT_EXPR } },
    {
      $group: {
        _id: "$archiveReason",
        count: { $sum: 1 },
        lostMonthlyAmount: { $sum: "$monthlyAmount" },
        avgLifetimeDays: { $avg: { $ifNull: ["$lifetimeDays", 0] } },
        totalLifetimeRevenue: { $sum: { $ifNull: ["$lifetimeRevenue", 0] } },
      },
    },
    { $sort: { count: -1, lostMonthlyAmount: -1 } },
  ]);

  return rows.map((row) => ({
    reason: row._id || "sin_motivo",
    label: row._id ? ARCHIVE_REASON_LABELS[row._id] : "Sin motivo",
    count: row.count,
    lostMonthlyAmount: round2(row.lostMonthlyAmount),
    avgLifetimeDays: Math.round(row.avgLifetimeDays || 0),
    totalLifetimeRevenue: round2(row.totalLifetimeRevenue),
  }));
}

async function totals(): Promise<ChurnTotals> {
  const [row] = await Client.aggregate<{
    archivedClients: number;
    lostMonthlyAmount: number;
    avgLifetimeDays: number | null;
    totalLifetimeRevenue: number;
  }>([
    { $match: { isArchived: true } },
    { $addFields: { monthlyAmount: MONTHLY_AMOUNT_EXPR } },
    {
      $group: {
        _id: null,
        archivedClients: { $sum: 1 },
        lostMonthlyAmount: { $sum: "$monthlyAmount" },
        avgLifetimeDays: { $avg: { $ifNull: ["$lifetimeDays", 0] } },
        totalLifetimeRevenue: { $sum: { $ifNull: ["$lifetimeRevenue", 0] } },
      },
    },
    { $project: { _id: 0 } },
  ]);

  return {
    archivedClients: row?.archivedClients || 0,
    lostMonthlyAmount: round2(row?.lostMonthlyAmount || 0),
    avgLifetimeDays: Math.round(row?.avgLifetimeDays || 0),
    totalLifetimeRevenue: round2(row?.totalLifetimeRevenue || 0),
  };
}

/** Reporte de bajas: por qué se van los clientes y cuánto ingreso mensual se perdió. */
export async function churnReport() {
  const [reasons, resume, recent] = await Promise.all([
    byReason(),
    totals(),
    clientLifecycleService.listArchived(20),
  ]);

  return {
    byReason: reasons,
    totals: resume,
    recent: recent.map((item) => ({
      clientId: item._id,
      name: item.name,
      archivedAt: item.archivedAt,
      reason: item.reason,
      label: item.label,
      lifetimeDays: item.lifetimeDays,
      lifetimeRevenue: item.lifetimeRevenue,
      amount: item.amount,
      attachmentsCount: item.attachmentsCount,
    })),
  };
}
