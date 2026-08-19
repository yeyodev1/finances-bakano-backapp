import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";
import { CustomError } from "../errors/customError.error";
import { stripeService } from "../services/stripe.service";
import { stripeWebhookService } from "../services/stripe.webhook.service";
import { stripeImportService } from "../services/stripe.import.service";

/**
 * Webhook público. Requiere el body crudo (se monta con express.raw en app.ts,
 * antes del express.json global) para poder verificar la firma.
 */
export const webhook = asyncHandler(async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"];
  if (typeof signature !== "string") {
    throw new CustomError("Falta la cabecera stripe-signature", 400);
  }
  if (!Buffer.isBuffer(req.body)) {
    throw new CustomError("El webhook necesita el body crudo", 500);
  }

  const event = stripeService.constructWebhookEvent(req.body, signature);
  const result = await stripeWebhookService.handleEvent(event);

  res.status(200).json(result);
});

export const listCustomers = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.status(200).json({ customers: await stripeImportService.listCustomersWithSuggestions() });
});

export const linkCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await stripeImportService.linkCustomer(req.body, req.user));
});

export const unlinkCustomer = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await stripeImportService.unlinkCustomer(param(req, "clientId"), req.user));
});

export const importCharges = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await stripeImportService.importCharges(req.body.clientId, req.user));
});

export const status = asyncHandler(async (_req: AuthRequest, res: Response) => {
  res.status(200).json({
    configured: stripeService.isConfigured(),
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  });
});
