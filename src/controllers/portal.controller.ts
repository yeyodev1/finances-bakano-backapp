import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { param } from "../utils/expressHandler.util";
import { CustomError } from "../errors/customError.error";
import { portalService } from "../services/portal.service";
import { paymentSubmissionService } from "../services/paymentSubmission.service";
import { mcpService } from "../services/mcp.service";

/** Endpoints consumidos SOLO por metrics-backapp (x-metrics-key), nunca por navegadores. */

export const estadoPagos = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200).json({ estados: await portalService.getEstadoPagos() });
});

export const billing = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await portalService.getBilling(param(req, "workspaceId")));
});

export const checkout = asyncHandler(async (req: Request, res: Response) => {
  const { invoiceId, returnUrl } = req.body;
  res.status(201).json(
    await portalService.createCheckoutSession({
      workspaceId: param(req, "workspaceId"),
      invoiceId,
      returnUrl,
    })
  );
});

export const cardUpdate = asyncHandler(async (req: Request, res: Response) => {
  const { returnUrl } = req.body;
  res.status(201).json(
    await portalService.createCardUpdateSession({
      workspaceId: param(req, "workspaceId"),
      returnUrl,
    })
  );
});

export const submit = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file?.buffer) {
    throw new CustomError("Falta el comprobante de la transferencia", 400);
  }

  const submission = await paymentSubmissionService.submit({
    workspaceId: param(req, "workspaceId"),
    invoiceId: req.body.invoiceId,
    grossAmount: req.body.grossAmount,
    feeAmount: req.body.feeAmount,
    receipt: req.file.buffer,
    submittedByName: req.body.submittedByName,
    submittedByEmail: req.body.submittedByEmail,
  });

  res.status(201).json({ submission });
});

/** MCP del equipo: la persona va en x-actor-email y se valida con su usuario de Finanzas. */
const actorEmail = (req: Request) => String(req.headers["x-actor-email"] || "");

export const mcpClientes = asyncHandler(async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  res.status(200).json(await mcpService.clientes(actorEmail(req), q, req.query.soloDeben === "true"));
});

export const mcpCliente = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await mcpService.cliente(actorEmail(req), String(req.query.cliente || "")));
});

export const mcpResumen = asyncHandler(async (req: Request, res: Response) => {
  const periodo = typeof req.query.periodo === "string" ? req.query.periodo : undefined;
  res.status(200).json(await mcpService.resumen(actorEmail(req), periodo));
});

export const mcpRegistrarPago = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await mcpService.registrarPago(actorEmail(req), req.body || {}));
});

export const mcpBloqueos = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await mcpService.bloqueos(actorEmail(req)));
});

export const mcpVincular = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await mcpService.vincular(actorEmail(req), req.body || {}));
});

export const mcpAcceso = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await mcpService.acceso(actorEmail(req), req.body || {}));
});

export const mcpPlazo = asyncHandler(async (req: Request, res: Response) => {
  res.status(200).json(await mcpService.plazo(actorEmail(req), req.body || {}));
});
