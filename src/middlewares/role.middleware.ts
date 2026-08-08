import { NextFunction, Request, Response } from "express";
import { AuthRequest, UserRole } from "../types/AuthRequest";

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as AuthRequest).user;

    if (!user) {
      res.status(401).json({ message: "No autenticado" });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({
        message: "No tienes permisos para realizar esta acción",
      });
      return;
    }

    next();
  };
}

export const requireSuperadmin = requireRole("superadmin");
