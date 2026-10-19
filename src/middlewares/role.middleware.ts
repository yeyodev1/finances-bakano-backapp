import { NextFunction, Request, Response } from "express";
import { AuthRequest, UserRole } from "../types/AuthRequest";
import { User } from "../models";

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

/**
 * Quién puede eliminar registros (pagos, reembolsos, consumos, clientes sin
 * pagos): superadmin siempre; los demás solo si un superadmin les activó
 * `canDelete`. Se consulta la base (no el token) para que activar o quitar el
 * permiso aplique al instante, sin esperar un nuevo login. Todo borrado queda
 * en la bitácora (AuditLog) con el nombre de quien lo hizo.
 */
export function requireDeletePermission(req: Request, res: Response, next: NextFunction) {
  const user = (req as AuthRequest).user;

  if (!user) {
    res.status(401).json({ message: "No autenticado" });
    return;
  }

  if (user.role === "superadmin") {
    next();
    return;
  }

  User.findById(user._id)
    .select("canDelete isActive")
    .lean()
    .then((doc) => {
      if (doc?.isActive && doc.canDelete) {
        next();
        return;
      }
      res.status(403).json({
        message: "No tienes el permiso de eliminar. Pídele a un superadmin que te lo active en Usuarios.",
      });
    })
    .catch(next);
}

/**
 * Quienes operan el sistema a diario: administración y equipo comercial.
 * El Banco queda fuera a propósito: usa `requireRole("superadmin", "admin")`.
 */
export const STAFF_ROLES: UserRole[] = ["superadmin", "admin", "vendedor"];
export const requireStaff = requireRole(...STAFF_ROLES);
