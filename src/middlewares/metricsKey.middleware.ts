import { NextFunction, Request, Response } from "express";
import crypto from "crypto";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

/**
 * Protege los endpoints /api/portal: solo metrics-backapp puede llamarlos,
 * servidor a servidor, con el header `x-metrics-key`. Es la dirección inversa
 * de la integración existente (finanzas → metrics con x-finance-key) y usa una
 * clave distinta para poder rotarlas por separado.
 */
export function metricsKeyMiddleware(req: Request, _res: Response, next: NextFunction) {
  const expected = env.metricsProxyKey;
  if (!expected) {
    next(new CustomError("El portal no está habilitado en el servidor", 503));
    return;
  }

  const received = req.headers["x-metrics-key"];
  if (typeof received !== "string" || received.length !== expected.length) {
    next(new CustomError("No autorizado", 401));
    return;
  }

  const valid = crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!valid) {
    next(new CustomError("No autorizado", 401));
    return;
  }

  next();
}
