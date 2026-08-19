import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { AuthRequest } from "../types/AuthRequest";
import { param } from "../utils/expressHandler.util";
import {
  paymentSubmissionService,
  SubmissionListQuery,
} from "../services/paymentSubmission.service";

export const list = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await paymentSubmissionService.list(req.query as SubmissionListQuery));
});

export const approve = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await paymentSubmissionService.approve(param(req, "id"), req.body, req.user));
});

export const reject = asyncHandler(async (req: AuthRequest, res: Response) => {
  res.status(200).json(await paymentSubmissionService.reject(param(req, "id"), req.body, req.user));
});
