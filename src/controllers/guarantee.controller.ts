import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { guaranteeService, GuaranteeListQuery } from "../services/guarantee.service";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await guaranteeService.list(req.query as GuaranteeListQuery));
});

export const summary = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.status(200).json(await guaranteeService.summary());
});

export const open = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(201).json(await guaranteeService.open(req.body, req.user));
});

export const extend = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await guaranteeService.extend(param(req, "id"), req.body, req.user));
});

export const close = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await guaranteeService.close(param(req, "id"), req.body, req.user));
});

export const listByClient = asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await guaranteeService.listByClient(param(req, "clientId"));
  const current = await guaranteeService.currentOf(param(req, "clientId"));
  res.status(200).json({ total: items.length, items, current });
});

export const getById = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await guaranteeService.getById(param(req, "id")));
});
