import { Router } from "express";
import * as paymentController from "../controllers/payment.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { uploadDocument } from "../middlewares/upload.middleware";
import { validate } from "../middlewares/validate.middleware";
import { idParamSchema } from "../validators/common.schema";
import {
  paymentListSchema,
  registerPaymentSchema,
  settlePaymentSchema,
} from "../validators/payment.schema";

const auth = toHandler(authMiddleware);

const paymentRouter = Router();
const canWrite = requireRole("superadmin", "admin");

paymentRouter.use(auth);

paymentRouter.get("/", validate(paymentListSchema, "query"), paymentController.list);
paymentRouter.post(
  "/",
  canWrite,
  uploadDocument.single("receipt"),
  validate(registerPaymentSchema),
  paymentController.register
);
paymentRouter.post(
  "/settle",
  canWrite,
  validate(settlePaymentSchema),
  paymentController.settle
);
paymentRouter.get("/:id", validate(idParamSchema, "params"), paymentController.getById);
paymentRouter.delete(
  "/:id",
  requireRole("superadmin"),
  validate(idParamSchema, "params"),
  paymentController.remove
);

export default paymentRouter;
