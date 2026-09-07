import { Request } from "express";

/**
 * `vendedor`: el equipo comercial. Registra ventas y clientes como un admin,
 * pero no ve el Banco (saldos y movimientos reales de la empresa).
 */
export type UserRole = "superadmin" | "admin" | "vendedor" | "viewer";

export interface JwtPayload {
  _id: string;
  email: string;
  name?: string;
  role: UserRole;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
  file?: Express.Multer.File;
  files?: Express.Multer.File[];
}
