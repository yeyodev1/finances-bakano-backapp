import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { param } from "../utils/expressHandler.util";
import { CustomError } from "../errors/customError.error";
import { portalService } from "../services/portal.service";
import { paymentSubmissionService } from "../services/paymentSubmission.service";

/** Endpoints consumidos SOLO por metrics-backapp (x-metrics-key), nunca por navegadores. */

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
