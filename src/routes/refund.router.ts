import { Router } from "express";
import * as refundController from "../controllers/refund.controller";
import { authMiddleware } from "../middlewares/auth.middleware";
import { toHandler } from "../utils/expressHandler.util";
import { requireRole } from "../middlewares/role.middleware";
import { uploadDocument } from "../middlewares/upload.middleware";
import { validate } from "../middlewares/validate.middleware";
import { idParamSchema } from "../validators/common.schema";
import {
  clientIdParamSchema,
  refundListSchema,
  registerRefundSchema,
} from "../validators/refund.schema";

const auth = toHandler(authMiddleware);

const refundRouter = Router();
const canWrite = requireRole("superadmin", "admin");

refundRouter.use(auth);

refundRouter.get("/", validate(refundListSchema, "query"), refundController.list);
refundRouter.get("/summary", refundController.summary);
refundRouter.post(
  "/",
  canWrite,
  uploadDocument.single("receipt"),
  validate(registerRefundSchema),
  refundController.register
);
refundRouter.get(
  "/client/:clientId",
  validate(clientIdParamSchema, "params"),
  refundController.listByClient
);
refundRouter.get("/:id", validate(idParamSchema, "params"), refundController.getById);
refundRouter.delete(
  "/:id",
  requireRole("superadmin"),
  validate(idParamSchema, "params"),
  refundController.remove
);

export default refundRouter;
