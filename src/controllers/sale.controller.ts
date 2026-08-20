import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { saleService, CreateSaleInput, SaleListQuery } from "../services/sale.service";
import { saleGoalService, SaveSaleGoalInput } from "../services/saleGoal.service";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";
import { SaleLostReason } from "../types/finance.types";
import { ISaleBilling, ISaleItem } from "../models";

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await saleService.list(req.query as SaleListQuery));
});

export const summary = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { from, to } = req.query as { from?: string; to?: string };
  res
    .status(200)
    .json(await saleService.summary(from ? new Date(from) : undefined, to ? new Date(to) : undefined));
});

export const getById = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await saleService.getById(param(req, "id")));
});

export const create = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(201).json(await saleService.create(req.body as CreateSaleInput, req.user));
});

export const payInstallment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { amount, paidAt, notes } = req.body as {
    amount?: number;
    paidAt?: string;
    notes?: string;
  };
  res
    .status(200)
    .json(
      await saleService.payInstallment(
        param(req, "id"),
        Number(param(req, "index")),
        { amount, paidAt, notes },
        req.user
      )
    );
});

export const rescheduleInstallment = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { newDueDate, reason } = req.body as { newDueDate: string; reason?: string };
  res
    .status(200)
    .json(
      await saleService.rescheduleInstallment(
        param(req, "id"),
        Number(param(req, "index")),
        newDueDate,
        reason,
        req.user
      )
    );
});

export const updateItems = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { items } = req.body as { items: ISaleItem[] };
  res.status(200).json(await saleService.updateItems(param(req, "id"), items, req.user));
});

export const updateBilling = asyncHandler(async (req: AuthRequest, res: Response) => {
  res
    .status(200)
    .json(await saleService.updateBilling(param(req, "id"), req.body as Partial<ISaleBilling>, req.user));
});

export const changeOwner = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { ownerId } = req.body as { ownerId: string };
  res.status(200).json(await saleService.changeOwner(param(req, "id"), ownerId, req.user));
});

export const changeCategory = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { categoryId } = req.body as { categoryId: string | null };
  res.status(200).json(await saleService.changeCategory(param(req, "id"), categoryId ?? null, req.user));
});

// ── Objetivo de venta mensual ─────────────────────────────────────

export const getGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
  const goal = await saleGoalService.get(param(req, "period"));
  res.status(200).json(goal ?? { period: param(req, "period"), lines: [] });
});

export const saveGoal = asyncHandler(async (req: AuthRequest, res: Response) => {
  res
    .status(200)
    .json(await saleGoalService.save(param(req, "period"), req.body as SaveSaleGoalInput, req.user));
});

export const goalProgress = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await saleGoalService.progress(param(req, "period")));
});

export const lose = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { reason, notes, lostAt } = req.body as {
    reason: SaleLostReason;
    notes?: string;
    lostAt?: string;
  };
  res.status(200).json(await saleService.markLost(param(req, "id"), { reason, notes, lostAt }, req.user));
});

export const reopen = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await saleService.reopen(param(req, "id"), req.user));
});
