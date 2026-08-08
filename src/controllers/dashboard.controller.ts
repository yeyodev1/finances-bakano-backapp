import { Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { asyncHandler } from "../utils/asyncHandler.util";
import { dashboardService } from "../services/dashboard.service";

function periodOf(req: AuthRequest): string | undefined {
  const value = req.query.period;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberOf(req: AuthRequest, key: string, fallback: number): number {
  const raw = req.query[key];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const getSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json(await dashboardService.summary(periodOf(req)));
});

export const getRevenueSeries = asyncHandler(async (req: AuthRequest, res: Response) => {
  const months = numberOf(req, "months", 12);
  res.json({ months, items: await dashboardService.revenueSeries(months) });
});

export const getStatusBreakdown = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json(await dashboardService.statusBreakdown(periodOf(req)));
});

export const getMethodBreakdown = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json(await dashboardService.methodBreakdown(periodOf(req)));
});

export const getTopClients = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json(await dashboardService.topClients(periodOf(req), numberOf(req, "limit", 10)));
});

export const getAging = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json({ items: await dashboardService.agingBuckets() });
});

export const getUpcoming = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json(await dashboardService.upcomingCollections(numberOf(req, "days", 15)));
});

export const getOverdue = asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await dashboardService.overdueList(numberOf(req, "limit", 50));
  res.json({ total: items.length, items });
});

export const getChurn = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.json(await dashboardService.churnReport());
});
