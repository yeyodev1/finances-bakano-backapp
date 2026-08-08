import { Request, RequestHandler } from "express";

/**
 * Adapta middlewares tipados con AuthRequest a la firma que espera el router de Express 5.
 * Necesario porque @types/multer amplía Express.Request con una forma distinta de `files`.
 */
export function toHandler(middleware: unknown): RequestHandler {
  return middleware as RequestHandler;
}

/** Express 5 tipa los params como `string | string[]`; en nuestras rutas siempre es un string. */
export function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? value[0] : String(value ?? "");
}
