import { Client, Invoice, Payment } from "../models";
import { INVOICE_STATUS_LABELS, InvoiceStatus, PAYMENT_METHOD_LABELS, PaymentMethod } from "../types/finance.types";

/** Estados que no cuentan como facturación real. */
export const EXCLUDED_STATUSES: InvoiceStatus[] = ["cancelled", "waived"];

export interface PeriodTotals {
  expectedAmount: number;
  collectedAmount: number;
  pendingAmount: number;
  overdueAmount: number;
  invoicesTotal: number;
  invoicesPaid: number;
  invoicesPending: number;
  invoicesOverdue: number;
}

export async function periodTotals(period: string): Promise<PeriodTotals> {
  const [result] = await Invoice.aggregate<PeriodTotals>([
    { $match: { period, status: { $nin: EXCLUDED_STATUSES } } },
    {
      $group: {
        _id: null,
        expectedAmount: { $sum: "$amount" },
        collectedAmount: { $sum: "$paidAmount" },
        pendingAmount: {
          $sum: {
            $cond: [
              { $in: ["$status", ["pending", "partial"]] },
              { $subtract: ["$amount", "$paidAmount"] },
              0,
            ],
          },
        },
        overdueAmount: {
          $sum: {
            $cond: [{ $eq: ["$status", "overdue"] }, { $subtract: ["$amount", "$paidAmount"] }, 0],
          },
        },
        invoicesTotal: { $sum: 1 },
        invoicesPaid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
        invoicesPending: {
          $sum: { $cond: [{ $in: ["$status", ["pending", "partial"]] }, 1, 0] },
        },
        invoicesOverdue: { $sum: { $cond: [{ $eq: ["$status", "overdue"] }, 1, 0] } },
      },
    },
    { $project: { _id: 0 } },
  ]);

  return (
    result || {
      expectedAmount: 0,
      collectedAmount: 0,
      pendingAmount: 0,
      overdueAmount: 0,
      invoicesTotal: 0,
      invoicesPaid: 0,
      invoicesPending: 0,
      invoicesOverdue: 0,
    }
  );
}

export async function clientCounters(period: string) {
  const notArchived = { isArchived: { $ne: true } };

  const [clientsTotal, clientsActive, archivedClients, workspacesDeactivated, overdueClients] =
    await Promise.all([
      Client.countDocuments(notArchived),
      Client.countDocuments({ ...notArchived, isActive: true }),
      Client.countDocuments({ isArchived: true }),
      Client.countDocuments({ ...notArchived, workspaceIsActive: false }),
      Invoice.distinct("clientId", { period, status: "overdue" }),
    ]);

  return {
    clientsTotal,
    clientsActive,
    archivedClients,
    clientsOverdue: overdueClients.length,
    workspacesDeactivated,
  };
}

export interface StatusBreakdownRow {
  status: InvoiceStatus;
  label: string;
  count: number;
  amount: number;
  paidAmount: number;
}

export async function statusBreakdownRows(period: string): Promise<StatusBreakdownRow[]> {
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
    { $sort: { amount: -1 } },
  ]);

  return rows.map((row) => ({
    status: row._id,
    label: INVOICE_STATUS_LABELS[row._id] || row._id,
    count: row.count,
    amount: row.amount,
    paidAmount: row.paidAmount,
  }));
}

export interface MethodBreakdownRow {
  method: PaymentMethod;
  label: string;
  count: number;
  amount: number;
}

export async function methodBreakdownRows(period: string): Promise<MethodBreakdownRow[]> {
  const rows = await Payment.aggregate<{ _id: PaymentMethod; count: number; amount: number }>([
    { $match: { period } },
    { $group: { _id: "$method", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
    { $sort: { amount: -1 } },
  ]);

  return rows.map((row) => ({
    method: row._id,
    label: PAYMENT_METHOD_LABELS[row._id] || row._id,
    count: row.count,
    amount: row.amount,
  }));
}

export interface TopClientRow {
  clientId: string;
  clientName: string;
  invoiced: number;
  collected: number;
  pending: number;
  invoices: number;
}

export async function topClientRows(period: string, limit: number): Promise<TopClientRow[]> {
  const rows = await Invoice.aggregate<{
    _id: unknown;
    clientName: string;
    invoiced: number;
    collected: number;
    invoices: number;
  }>([
    { $match: { period, status: { $nin: EXCLUDED_STATUSES } } },
    {
      $group: {
        _id: "$clientId",
        clientName: { $first: "$clientName" },
        invoiced: { $sum: "$amount" },
        collected: { $sum: "$paidAmount" },
        invoices: { $sum: 1 },
      },
    },
    { $sort: { invoiced: -1 } },
    { $limit: limit },
  ]);

  return rows.map((row) => ({
    clientId: String(row._id),
    clientName: row.clientName,
    invoiced: row.invoiced,
    collected: row.collected,
    pending: Math.max(row.invoiced - row.collected, 0),
    invoices: row.invoices,
  }));
}

export interface SeriesRow {
  period: string;
  expected: number;
  collected: number;
}

export async function revenueSeriesRows(periods: string[]): Promise<SeriesRow[]> {
  return Invoice.aggregate<SeriesRow>([
    { $match: { period: { $in: periods }, status: { $nin: EXCLUDED_STATUSES } } },
    {
      $group: {
        _id: "$period",
        expected: { $sum: "$amount" },
        collected: { $sum: "$paidAmount" },
      },
    },
    { $project: { _id: 0, period: "$_id", expected: 1, collected: 1 } },
  ]);
}
