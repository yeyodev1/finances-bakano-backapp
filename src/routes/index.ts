import express, { Application } from "express";
import authRouter from "./auth.router";
import userRouter from "./user.router";
import clientRouter from "./client.router";
import invoiceRouter from "./invoice.router";
import paymentRouter from "./payment.router";
import refundRouter from "./refund.router";
import guaranteeRouter from "./guarantee.router";
import saleRouter from "./sale.router";
import dashboardRouter from "./dashboard.router";
import settingsRouter from "./settings.router";
import workspaceRouter from "./workspace.router";
import mercuryRouter from "./mercury.router";
import cronRouter from "./cron.router";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);

  router.use("/auth", authRouter);
  router.use("/users", userRouter);
  router.use("/clients", clientRouter);
  router.use("/invoices", invoiceRouter);
  router.use("/payments", paymentRouter);
  router.use("/refunds", refundRouter);
  router.use("/guarantees", guaranteeRouter);
  router.use("/sales", saleRouter);

  router.use("/dashboard", dashboardRouter);
  router.use("/settings", settingsRouter);
  router.use("/workspaces", workspaceRouter);
  router.use("/mercury", mercuryRouter);
  router.use("/cron", cronRouter);
}

export default routerApi;
