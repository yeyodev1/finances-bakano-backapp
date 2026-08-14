import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { refundService, RefundListQuery } from "../services/refund.service";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await refundService.list(req.query as RefundListQuery));
});

export const summary = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.status(200).json(await refundService.summary());
});

export const register = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { paymentId, invoiceId, amount, reason, refundedAt, method, reference, notes } = req.body;

  const result = await refundService.register(
    {
      paymentId,
      invoiceId,
      amount,
      reason,
      refundedAt,
      method,
      reference,
      notes,
      archiveClient: req.body.archiveClient,
      archiveNotes: req.body.archiveNotes,
      receipt: req.file?.buffer,
    },
    req.user
  );

  res.status(201).json(result);
});

export const listByClient = asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await refundService.listByClient(param(req, "clientId"));
  res.status(200).json({ total: items.length, items });
});

export const getById = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await refundService.getById(param(req, "id")));
});

export const remove = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await refundService.remove(param(req, "id"), req.user));
});
