import { Router } from "express";
import * as invoiceController from "../controllers/invoice.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { validate } from "../middlewares/validate.middleware";
import { idParamSchema } from "../validators/common.schema";
import {
  advanceInvoiceSchema,
  deferInvoiceSchema,
  generateInvoicesSchema,
  invoiceListSchema,
  invoiceReasonSchema,
  invoiceSummarySchema,
  updateInvoiceSchema,
} from "../validators/invoice.schema";

const auth = toHandler(authMiddleware);

const invoiceRouter = Router();
const canWrite = requireRole("superadmin", "admin");

invoiceRouter.use(auth);

invoiceRouter.get("/", validate(invoiceListSchema, "query"), invoiceController.list);
invoiceRouter.get("/summary", validate(invoiceSummarySchema, "query"), invoiceController.summary);
invoiceRouter.get("/billing-summary", invoiceController.billingSummary);
invoiceRouter.get("/einvoices", invoiceController.listEInvoices);
invoiceRouter.post(
  "/generate",
  canWrite,
  validate(generateInvoicesSchema),
  invoiceController.generate
);
invoiceRouter.post("/recalc", canWrite, invoiceController.recalc);
invoiceRouter.post(
  "/advance",
  canWrite,
  validate(advanceInvoiceSchema),
  invoiceController.createAdvance
);

invoiceRouter.post(
  "/:id/einvoice",
  canWrite,
  validate(idParamSchema, "params"),
  invoiceController.issueEInvoice
);
invoiceRouter.post(
  "/:id/einvoice/refresh",
  canWrite,
  validate(idParamSchema, "params"),
  invoiceController.refreshEInvoice
);
invoiceRouter.get("/:id", validate(idParamSchema, "params"), invoiceController.getById);
invoiceRouter.put(
  "/:id",
  canWrite,
  validate(idParamSchema, "params"),
  validate(updateInvoiceSchema),
  invoiceController.update
);
invoiceRouter.patch(
  "/:id/waive",
  canWrite,
  validate(idParamSchema, "params"),
  validate(invoiceReasonSchema),
  invoiceController.waive
);
invoiceRouter.patch(
  "/:id/defer",
  canWrite,
  validate(idParamSchema, "params"),
  validate(deferInvoiceSchema),
  invoiceController.defer
);
invoiceRouter.delete(
  "/:id/defer",
  canWrite,
  validate(idParamSchema, "params"),
  invoiceController.undoDefer
);
invoiceRouter.patch(
  "/:id/cancel",
  canWrite,
  validate(idParamSchema, "params"),
  validate(invoiceReasonSchema),
  invoiceController.cancel
);

export default invoiceRouter;
