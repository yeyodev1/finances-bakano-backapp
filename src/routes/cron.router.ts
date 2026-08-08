import { NextFunction, Response, Router } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";
import { asyncHandler } from "../utils/asyncHandler.util";
import { param, toHandler } from "../utils/expressHandler.util";
import { schedulerService } from "../services/scheduler.service";
import { invoiceService } from "../services/invoice.service";
import { isValidPeriod } from "../utils/date.util";
import { CustomError } from "../errors/customError.error";

/**
 * Permite el acceso con el header x-cron-secret, con el `Authorization: Bearer
 * <CRON_SECRET>` que envía Vercel Cron, o con un token JWT de superadmin.
 */
function cronAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const secret = req.headers["x-cron-secret"];

  if (env.cronSecret && typeof secret === "string" && secret === env.cronSecret) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (env.cronSecret && authHeader === `Bearer ${env.cronSecret}`) {
    next();
    return;
  }

  if (authHeader?.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(authHeader.split(" ")[1], env.jwtSecret) as JwtPayload;
      if (decoded.role === "superadmin") {
        req.user = decoded;
        next();
        return;
      }
      res.status(403).json({ message: "Solo un superadmin puede ejecutar los procesos" });
      return;
    } catch {
      res.status(401).json({ message: "Token inválido o expirado" });
      return;
    }
  }

  res.status(401).json({ message: "Credenciales de cron inválidas" });
}

const cronRouter = Router();

cronRouter.use(toHandler(cronAuth));

// GET además de POST: Vercel Cron invoca las rutas con GET.
cronRouter.all(
  "/run/daily",
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json(await schedulerService.runDailyJob());
  })
);

cronRouter.all(
  "/run/monthly",
  asyncHandler(async (_req: AuthRequest, res: Response) => {
    res.json(await schedulerService.runMonthlyJob());
  })
);

cronRouter.all(
  "/run/generate/:period",
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const period = param(req, "period");

    if (!isValidPeriod(period)) {
      throw new CustomError(`Período inválido: ${period}. Formato esperado YYYY-MM.`, 400);
    }

    res.json({
      message: `Facturas generadas para el período ${period}`,
      result: await invoiceService.generateForPeriod(period),
    });
  })
);

export default cronRouter;
