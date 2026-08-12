import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { requireRole } from "../middlewares/role.middleware";
import { toHandler } from "../utils/expressHandler.util";
import {
  getAccount,
  getOverview,
  getSubscriptions,
  listAccounts,
  listCards,
  listStatements,
  listTransactions,
  listTreasury,
  mercuryHealth,
} from "../controllers/mercury.controller";

/**
 * Banco (Mercury) — solo lectura y solo para superadmin/admin: expone saldos y
 * movimientos reales de la empresa.
 */
const mercuryRouter = Router();

mercuryRouter.use(toHandler(authMiddleware));
mercuryRouter.use(requireRole("superadmin", "admin"));

mercuryRouter.get("/health", mercuryHealth);
mercuryRouter.get("/overview", getOverview);
mercuryRouter.get("/subscriptions", getSubscriptions);
mercuryRouter.get("/accounts", listAccounts);
mercuryRouter.get("/accounts/:id", getAccount);
mercuryRouter.get("/accounts/:id/transactions", listTransactions);
mercuryRouter.get("/accounts/:id/cards", listCards);
mercuryRouter.get("/accounts/:id/statements", listStatements);
mercuryRouter.get("/treasury", listTreasury);

export default mercuryRouter;
