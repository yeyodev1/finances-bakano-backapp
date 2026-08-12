import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import {
  getAging,
  getCashflow,
  getCollected,
  getChurn,
  getMethodBreakdown,
  getOverdue,
  getRevenueSeries,
  getStatusBreakdown,
  getSummary,
  getTopClients,
  getUpcoming,
} from "../controllers/dashboard.controller";

const dashboardRouter = Router();

dashboardRouter.use(toHandler(authMiddleware));

dashboardRouter.get("/summary", getSummary);
dashboardRouter.get("/revenue-series", getRevenueSeries);
dashboardRouter.get("/status-breakdown", getStatusBreakdown);
dashboardRouter.get("/method-breakdown", getMethodBreakdown);
dashboardRouter.get("/top-clients", getTopClients);
dashboardRouter.get("/aging", getAging);
dashboardRouter.get("/cashflow", getCashflow);
dashboardRouter.get("/collected", getCollected);
dashboardRouter.get("/upcoming", getUpcoming);
dashboardRouter.get("/overdue", getOverdue);
dashboardRouter.get("/churn", getChurn);

export default dashboardRouter;
