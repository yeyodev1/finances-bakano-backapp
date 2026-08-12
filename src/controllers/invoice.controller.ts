import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { invoiceBillingService } from "../services/invoice.billing.service";
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

/** Emite la factura electrónica del cobro. No cambia su estado de pago. */
export const issueEInvoice = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(201).json(await invoiceBillingService.issueForInvoice(param(req, "id"), req.user));
});

/** Refresca el estado ante el SRI: pasar a AUTORIZADO puede tardar. */
export const refreshEInvoice = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await invoiceBillingService.refreshStatus(param(req, "id")));
});

/** Resumen de facturación, incluidos los descuadres factura/cobro. */
export const billingSummary = asyncHandler(async (req: AuthRequest, res: Response) => {
  const period = typeof req.query.period === "string" ? req.query.period : undefined;
  res.status(200).json(await invoiceBillingService.summary(period));
});

export const createAdvance = asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await invoiceService.createAdvanceInvoice(
    req.body as CreateAdvanceInvoiceInput,
    req.user
  );
  res.status(result.created ? 201 : 200).json(result);
});
