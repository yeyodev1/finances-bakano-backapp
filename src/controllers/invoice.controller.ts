import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import {
  CreateAdvanceInvoiceInput,
  DeferInvoiceInput,
  invoiceService,
  InvoiceListQuery,
} from "../services/invoice.service";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";
import { IInvoice } from "../models";

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceService.list(req.query as InvoiceListQuery));
});

export const summary = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceService.summaryByPeriod(String(req.query.period)));
});

export const generate = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { period, clientIds, force } = req.body;
  const result = await invoiceService.generateForPeriod(period, { clientIds, force });
  res.status(201).json(result);
});

export const getById = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceService.getById(param(req, "id")));
});

export const update = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceService.update(param(req, "id"), req.body as Partial<IInvoice>));
});

export const waive = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceService.markWaived(param(req, "id"), req.body.reason));
});

export const cancel = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceService.cancel(param(req, "id"), req.body.reason));
});

export const recalc = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceService.recalcStatuses());
});

export const defer = asyncHandler(async (req: AuthRequest, res: Response) => {
  const invoice = await invoiceService.deferInvoice(
    param(req, "id"),
    req.body as DeferInvoiceInput,
    req.user
  );
  res.status(200).json(invoice);
});

export const undoDefer = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceService.removeLastDeferral(param(req, "id"), req.user));
});

export const createAdvance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await invoiceService.createAdvanceInvoice(
    req.body as CreateAdvanceInvoiceInput,
    req.user
  );
  res.status(result.created ? 201 : 200).json(result);
});
