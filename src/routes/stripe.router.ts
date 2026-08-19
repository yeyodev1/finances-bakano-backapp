import { Router } from "express";
import * as stripeController from "../controllers/stripe.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { importChargesSchema, linkCustomerSchema } from "../validators/stripe.schema";

// El webhook NO va acá: necesita el body crudo y se monta directo en app.ts.

const auth = toHandler(authMiddleware);
const canWrite = requireRole("superadmin", "admin");

const stripeRouter = Router();
stripeRouter.use(auth);

stripeRouter.get("/status", stripeController.status);
stripeRouter.get("/import/customers", canWrite, stripeController.listCustomers);
stripeRouter.post(
  "/import/link",
  canWrite,
  validate(linkCustomerSchema),
  stripeController.linkCustomer
);
stripeRouter.delete("/import/link/:clientId", canWrite, stripeController.unlinkCustomer);
stripeRouter.post(
  "/import/charges",
  canWrite,
  validate(importChargesSchema),
  stripeController.importCharges
);

export default stripeRouter;
