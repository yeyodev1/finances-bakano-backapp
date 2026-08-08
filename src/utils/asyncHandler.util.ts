import { NextFunction, Request, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";

type Handler = (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/** Envuelve controladores async para que los errores lleguen al globalErrorHandler. */
export function asyncHandler(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as AuthRequest, res, next)).catch(next);
  };
}
