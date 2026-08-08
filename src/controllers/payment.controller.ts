import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { paymentService, PaymentListQuery } from "../services/payment.service";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await paymentService.list(req.query as PaymentListQuery));
});

export const register = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { invoiceId, amount, paidAt, method, reference, notes } = req.body;

  const result = await paymentService.register(
    {
      invoiceId,
      amount,
      paidAt,
      method,
      reference,
      notes,
      receipt: req.file?.buffer,
    },
    req.user
  );

  res.status(201).json(result);
});

export const getById = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await paymentService.getById(param(req, "id")));
});

export const remove = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await paymentService.remove(param(req, "id"), req.user));
});
