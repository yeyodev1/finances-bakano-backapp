import { Router } from "express";
import { z } from "zod";
import * as crmController from "../controllers/crmConsumption.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { idParamSchema, objectIdSchema, paginationSchema, periodSchema } from "../validators/common.schema";

const listSchema = z.object({
  clientId: objectIdSchema.optional(),
  period: periodSchema.optional(),
  ...paginationSchema,
});

const applySchema = z.object({ invoiceId: objectIdSchema });

const auth = toHandler(authMiddleware);
const canWrite = requireRole("superadmin", "admin");

const crmConsumptionRouter = Router();
crmConsumptionRouter.use(auth);

crmConsumptionRouter.get("/", validate(listSchema, "query"), crmController.list);
crmConsumptionRouter.post(
  "/:id/apply",
  canWrite,
  validate(idParamSchema, "params"),
  validate(applySchema),
  crmController.applyToInvoice
);
crmConsumptionRouter.delete(
  "/:id",
  requireRole("superadmin"),
  validate(idParamSchema, "params"),
  crmController.remove
);

export default crmConsumptionRouter;
