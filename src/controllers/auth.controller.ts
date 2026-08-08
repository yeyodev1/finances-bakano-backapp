import { Response } from "express";
import { asyncHandler } from "../utils/asyncHandler.util";
import { authService } from "../services/auth.service";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";

export const login = asyncHandler(async (req: AuthRequest, res: Response) => {
  const { email, password } = req.body;
  const result = await authService.login(email, password);
  res.status(200).json(result);
});

export const me = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new CustomError("No autenticado", 401);
  const user = await authService.getMe(req.user._id);
  res.status(200).json(user);
});

export const changePassword = asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new CustomError("No autenticado", 401);
  const { currentPassword, newPassword } = req.body;
  const result = await authService.changePassword(req.user._id, currentPassword, newPassword);
  res.status(200).json(result);
});
