import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";
import { crmConsumptionService, CrmListQuery } from "../services/crmConsumption.service";

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await crmConsumptionService.list(req.query as CrmListQuery));
});

export const applyToInvoice = asyncHandler(async (req: AuthRequest, res: Response) => {
  res
    .status(200)
    .json(await crmConsumptionService.applyToInvoice(param(req, "id"), req.body.invoiceId, req.user));
});

export const remove = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await crmConsumptionService.remove(param(req, "id"), req.user));
});
