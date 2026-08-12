import { Router } from "express";
import * as saleController from "../controllers/sale.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { idParamSchema } from "../validators/common.schema";
import {
  changeSaleOwnerSchema,
  createSaleSchema,
  installmentParamSchema,
  loseSaleSchema,
  payInstallmentSchema,
  rescheduleInstallmentSchema,
  saleBillingSchema,
  saleListSchema,
  saleSummarySchema,
  updateSaleItemsSchema,
} from "../validators/sale.schema";

const auth = toHandler(authMiddleware);

const saleRouter = Router();
const canWrite = requireRole("superadmin", "admin");

saleRouter.use(auth);

saleRouter.get("/", validate(saleListSchema, "query"), saleController.list);
saleRouter.get("/summary", validate(saleSummarySchema, "query"), saleController.summary);
saleRouter.post("/", canWrite, validate(createSaleSchema), saleController.create);

saleRouter.get("/:id", validate(idParamSchema, "params"), saleController.getById);

saleRouter.post(
  "/:id/installments/:index/pay",
  canWrite,
  validate(installmentParamSchema, "params"),
  validate(payInstallmentSchema),
  saleController.payInstallment
);
saleRouter.patch(
  "/:id/installments/:index/reschedule",
  canWrite,
  validate(installmentParamSchema, "params"),
  validate(rescheduleInstallmentSchema),
  saleController.rescheduleInstallment
);
saleRouter.patch(
  "/:id/items",
  canWrite,
  validate(idParamSchema, "params"),
  validate(updateSaleItemsSchema),
  saleController.updateItems
);
saleRouter.patch(
  "/:id/billing",
  canWrite,
  validate(idParamSchema, "params"),
  validate(saleBillingSchema),
  saleController.updateBilling
);
saleRouter.patch(
  "/:id/owner",
  canWrite,
  validate(idParamSchema, "params"),
  validate(changeSaleOwnerSchema),
  saleController.changeOwner
);
saleRouter.post(
  "/:id/lose",
  canWrite,
  validate(idParamSchema, "params"),
  validate(loseSaleSchema),
  saleController.lose
);
saleRouter.post(
  "/:id/reopen",
  canWrite,
  validate(idParamSchema, "params"),
  saleController.reopen
);

export default saleRouter;
